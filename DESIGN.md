# Local LLM Workbench — Design Document

**Status:** draft v0.2
**Platforms:** Windows, Linux (Debian 13 / KDE); macOS later
**License:** MIT
**Purpose:** personal tool for working with local LLMs — orchestration of
llama.cpp servers, project-based work on narrative and game design, agentic
editor, prompt experimentation.

---

## 1. Purpose and context

### 1.1. What it is

A desktop application extending the LM Studio idea toward a production-grade
working environment for:

1. **Local LLM infrastructure management** — launch, configuration and
   monitoring of multiple `llama-server` processes in parallel (generative
   model + embedding model + reranker), including fork management and
   automated builds.
2. **Project-based work on textual content** — markdown projects with local
   RAG search, versioning via git under the hood, sharing through files.
3. **Agentic editing** — work modes for narrative, game design, dialogue
   writing (SillyTavern-style), with a tool-loop, project file access and
   semantic search.
4. **Scripted automation** — prompt experiments, batch generation,
   workflows on top of local models.

### 1.2. Audience

Single user. Multi-user explicitly out of scope.
Sharing happens via the file system (git-friendly project layout).

### 1.3. Non-goals

- Cloud functionality, sync, multi-tenant.
- Replacing an IDE for code — focus is narrative and markdown content.
- Production deployment of models (this is not a team server).
- Backends other than `llama-server` (no ollama, vLLM, exllamav2 etc. in
  v1; the abstraction allows adding them later).

---

## 2. Technology stack

### 2.1. Primary language and UI

**Go 1.22+ with Wails v2** for the desktop app.

Rationale:

- Process management (`os/exec` + goroutines + channels) maps naturally to
  orchestrating llama.cpp servers and streaming SSE.
- Wails uses the system WebView (WebView2 / WKWebView / WebKitGTK) → 10–20 MB
  binary, no bundled Chromium.
- A JS frontend gives access to the mature editor ecosystem (CodeMirror 6).
- One `go build` per platform, no separate runtime packaging.

**Frontend:** TypeScript + React + **Mantine v7** as the component library.
Rationale: the project is a multi-panel workspace with many forms (profiles,
build recipes, mode definitions, sampler overrides, indexing settings) and
tabular UI; Mantine covers ~90% of that out of the box (Form, MultiSelect,
NumberInput, Tabs, Drawer, Modal, Notifications), saving substantial time at
the MVP stage. Tailwind is not used — styling via Mantine theme + emotion
(its internal CSS-in-JS) for consistency.

**Markdown editor:** CodeMirror 6 with the Lezer parser. Rationale: the
project is text-heavy with emphasis on viewing and editing markdown;
CodeMirror 6 gives excellent performance on large documents, flexible
customization, and a mature markdown mode.

### 2.2. Storage

- **SQLite + sqlite-vec** — one database file per project. Holds the RAG
  index, chunk metadata, chat session history, embedding cache. Driver:
  `modernc.org/sqlite` (pure Go) or `mattn/go-sqlite3` (CGo, native
  extensions are easier). Decide after a sqlite-vec integration prototype.
- **Project files on disk** — `.md`, images, `project.toml`, mode configs.
  This is the primary source of truth, not the DB.
- **TOML** for all user-visible configuration (profiles, build recipes,
  agent modes, project.toml). Git-friendly, diff-able, human-readable.

### 2.3. Versioning

- **Git under the hood** via `go-git` (pure Go) or system git invocations.
  A project is initialized as a git repository automatically.
- Snapshot commits are made automatically before destructive operations
  (bulk agent edits, batch scripts).
- The user-facing UX stays folder-based (Ideas/, Drafts/, Old Versions/) —
  git complements this, it does not replace it.

### 2.4. Scripting layer

- **Embedded JavaScript via goja** — for inline scripts (Prompt Lab, mode
  definitions, custom agent tools, workflow automation). Pure Go, no
  external runtime.
- **External Python via subprocess** — for ML-specific tasks (TTS, Whisper,
  OCR, document parsing). Not a startup dependency, but additional tools
  registered and invoked on demand.

### 2.5. Embedding and RAG models

- **Generative LLM:** user choice, any GGUF model.
- **Embeddings (default):** `deepvk/USER-bge-m3` (BGE-M3 fine-tuned on
  Russian). 1024d, context 8192, no prefixes. CLS pooling.
- **Reranker (optional):** `BAAI/bge-reranker-v2-m3`, multilingual.
- **Alternatives (profiles):** Qwen3-Embedding-0.6B/4B/8B, original
  BGE-M3, nomic-embed-text-v1.5 (if content is mostly English).

The embedding model is **a profile of the same kind as the generative one**,
not a hardcoded constant. Indices are versioned by `(model_id, dim)`.

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (TypeScript + React/Svelte + CodeMirror 6)         │
│  ├─ Workspace shell (sidebar, tabs, panels)                  │
│  ├─ Editor (markdown view/edit)                              │
│  ├─ Chat panel (streaming, tool calls, sources)              │
│  ├─ Profile/Server manager UI                                │
│  ├─ Prompt Lab (script editor + run/output)                  │
│  └─ Project explorer (files, git history, snapshots)         │
├─────────────────────────────────────────────────────────────┤
│  Wails bindings (autogenerated TS ↔ Go)                      │
├─────────────────────────────────────────────────────────────┤
│  Application services (Go)                                   │
│  ├─ ProfileManager      — TOML configs, builds, models       │
│  ├─ ServerSupervisor    — multiple llama-server processes    │
│  ├─ ProjectService      — FS sandbox, git ops, watcher       │
│  ├─ ChatService         — sessions, streaming, tool routing  │
│  ├─ AgentRuntime        — modes, tool-loop, system prompts   │
│  ├─ RagService          — chunking, embedding, retrieval     │
│  ├─ ScriptingService    — goja runtime + API bindings        │
│  ├─ WorkflowEngine      — triggers, pipelines, batch         │
│  └─ BuildOrchestrator   — git clone/pull, cmake, packaging   │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure (Go)                                         │
│  ├─ LlamaCppClient      — HTTP + SSE streaming               │
│  ├─ ProcessHost         — subprocess lifecycle, log capture  │
│  ├─ VectorStore         — SQLite + sqlite-vec wrapper        │
│  ├─ FileIndexer         — fs watcher, chunker, hashing       │
│  └─ GitWorker           — go-git or system git wrapper       │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
External processes:
  - llama-server (one or more instances: chat, embed, rerank)
  - Python sidecars (optional: TTS, Whisper, OCR — on demand)
```

### 3.1. Principles

- **Single-process GUI in v1.** A headless daemon is an extension, not the
  foundation. All application services are kept behind interfaces so they
  can be extracted later.
- **The file system is the primary store.** SQLite holds frequently
  changing data (index, chat history, cache). Configs and content live in
  files.
- **All agent file operations go through ProjectService.** Sandboxed within
  the project root, audited, allowing a virtual FS later.
- **External processes use a stable contract** (HTTP / argv+stdout JSON).
  No CGo embedding of llama.cpp or Python.

---

## 4. Domain concepts

A clear separation of these concepts is critical — they evolve
independently.

### 4.1. Build

A specific compiled `llama-server` binary from a specific fork.

```toml
[build."llama-mainline-cuda12"]
source_repo = "https://github.com/ggml-org/llama.cpp"
commit = "a1b2c3d"          # actual committed snapshot
backend = "cuda12"           # cuda11 / cuda12 / rocm / vulkan / metal / cpu
binary_path = "~/.local/llm-workbench/builds/llama-mainline-cuda12/llama-server"
build_recipe_id = "cuda12-default"
capabilities = ["chat", "embed", "rerank", "mmproj"]
built_at = "2026-05-08T12:34:56Z"
```

### 4.2. BuildRecipe

A declarative description of how to build a Build.

```toml
[recipe."cuda12-default"]
cmake_flags = ["-DGGML_CUDA=ON", "-DGGML_CUDA_FA_ALL_QUANTS=ON"]
post_build = []
```

`BuildOrchestrator` uses `BuildRecipe` + git ref → produces a `Build`.

### 4.3. ModelBundle

A model or a model + accessories bundle.

```toml
[model."qwen-2.5-32b-instruct-q5"]
type = "chat"                # chat / embed / rerank
gguf_path = "~/models/qwen2.5-32b-instruct-q5_k_m.gguf"
mmproj_path = ""             # for vision models
draft_model = ""             # for speculative decoding
context_max = 32768
chat_template = "auto"       # auto / explicit string
recommended_sampler = { temperature = 0.7, top_p = 0.95, min_p = 0.05 }
```

### 4.4. Profile

`Profile = Build × ModelBundle × RuntimeArgs`. This is what gets launched.

```toml
[profile."qwen-32b-cuda-prod"]
build_id = "llama-mainline-cuda12"
model_id = "qwen-2.5-32b-instruct-q5"
endpoints = ["chat"]
host = "127.0.0.1"
port = 18080
[profile."qwen-32b-cuda-prod".args]
ctx_size = 16384
n_gpu_layers = 99
parallel = 2
cont_batching = true
flash_attn = true
cache_type_k = "q8_0"
cache_type_v = "q8_0"

[profile."embed-user-bge-m3"]
build_id = "llama-mainline-cuda12"
model_id = "user-bge-m3"
endpoints = ["embed"]
host = "127.0.0.1"
port = 18081
[profile."embed-user-bge-m3".args]
embeddings = true
pooling = "cls"           # critical for BGE-style models
ctx_size = 8192
n_gpu_layers = 99
```

Profiles activate in parallel — a project may have a "current chat",
"current embed", and "current rerank".

### 4.5. Project

A directory containing:

```
my-game/
├── project.toml          # metadata, active profiles, modes
├── .git/                 # automatic git
├── index.db              # SQLite + sqlite-vec
├── chats/                # JSONL sessions
│   └── 2026-05-08-narrative-session.jsonl
├── modes/                # user mode overrides
│   └── my-narrative-mode.toml
├── scripts/              # user JS scripts
│   └── generate-tts-prompts.js
├── narrative/
├── characters/
├── lore/
├── ideas/
├── drafts/
└── illustrations/
```

`project.toml`:

```toml
[project]
name = "Crimson Tide"
created_at = "2026-05-08T10:00:00Z"
default_chat_profile = "qwen-32b-cuda-prod"
default_embed_profile = "embed-user-bge-m3"
default_rerank_profile = "rerank-bge-v2-m3"
default_mode = "narrative-coauthor"

[indexing]
include = ["narrative/**/*.md", "characters/**/*.md", "lore/**/*.md"]
exclude = ["drafts/**", "ideas/scratch/**"]
chunk_size = 512
chunk_overlap = 64
```

### 4.6. Mode

A declarative description of an agent work mode — system prompt, available
tools, context structure.

```toml
[mode."narrative-coauthor"]
display_name = "Narrative Co-Author"
description = "Assistant for plot, scenes, and characters"
system_prompt_template = "modes/narrative-coauthor.system.md"
tools = ["read_file", "search_files", "search_semantic", "list_dir",
         "get_outline", "edit_file"]
context_strategy = "outline+recent+rag"   # key into ContextBuilder

[mode."dialogue-writer"]
display_name = "Dialogue Writer"
system_prompt_template = "modes/dialogue-writer.system.md"
tools = ["read_file", "get_character_card", "update_character_card",
         "search_semantic"]
context_strategy = "character-cards+scene+history"

[mode."game-designer"]
display_name = "Game Designer"
system_prompt_template = "modes/game-designer.system.md"
tools = ["read_file", "write_file", "search_files", "search_semantic",
         "list_dir"]
context_strategy = "full-rag"
```

`tools` is a whitelist of registered tool names. Mode files come both as
built-in (inside the binary, defaults) and project-local (`modes/`, which
override built-ins by id).

### 4.7. Tool

A named instrument available to the agent in a tool-loop. The description
includes a JSON Schema for inputs/outputs and an implementation (Go
function or JS script).

Built-in tools (minimal v1 set):

| Tool                  | Purpose                                               |
|-----------------------|-------------------------------------------------------|
| `read_file`           | Read a project file (sandbox)                         |
| `write_file`          | Write/overwrite a file                                |
| `edit_file`           | Apply a unified diff (atomic, via snapshot)           |
| `list_dir`            | List files in a directory                             |
| `search_files`        | Lexical search by name and content (FTS5)             |
| `search_semantic`     | RAG search across the project                         |
| `get_outline`         | Heading structure of a markdown file or tree          |
| `get_character_card`  | Read a character card by id                           |
| `update_character_card` | Update a character card                             |

User-defined tools are JS functions via ScriptingService.

---

## 5. Functional requirements

### 5.1. llama.cpp infrastructure management

**FR-LLM-1.** Manage multiple Builds from different forks in parallel.
**FR-LLM-2.** Automated build via `BuildRecipe`: `git clone/pull` →
`cmake -B build [...]` → `cmake --build build` with stdout/stderr streamed
to UI and recorded in a build log.
**FR-LLM-3.** GPU detection on first launch (`nvidia-smi`, `rocminfo`,
`vulkaninfo`, `system_profiler` on macOS) → default `BuildRecipe`s.
**FR-LLM-4.** ServerSupervisor runs multiple llama-server instances
concurrently on different ports. Health check each via `/health`.
**FR-LLM-5.** Auto-start required profiles on project open. Stop on close
(with a keep-alive option for long-running background sessions).
**FR-LLM-6.** UI shows live logs per process, RAM/VRAM utilization (when
available via nvidia-smi), token throughput from the `/metrics` endpoint.
**FR-LLM-7.** Hot-swap a model within a single profile: stop the process,
change args, restart. Active chat sessions reconnect gracefully.
**FR-LLM-8.** Support multimodal (mmproj), embeddings, rerank via the
correct endpoints and flags.

### 5.2. Project and file management

**FR-PRJ-1.** Project creation: pick a directory → initialize `project.toml`
+ `.git` + `index.db` + a default folder layout.
**FR-PRJ-2.** Open existing project: validate `project.toml`, check
`index.db` integrity, re-index if necessary.
**FR-PRJ-3.** File watcher (via `fsnotify`) with a polling fallback (for
inotify-limit exhaustion on Linux). File changes → incremental
re-indexing.
**FR-PRJ-4.** Auto-snapshot before bulk agent edits
(`commit -m "pre-agent: <mode>: <task summary>"`). UI for "restore to
snapshot" rollback.
**FR-PRJ-5.** File history: show git log for a specific `.md`, diff between
versions, blame.
**FR-PRJ-6.** Import SillyTavern character cards (V2 format, JSON-in-PNG)
→ markdown with frontmatter in `characters/`.
**FR-PRJ-7.** Optional binding of a project to a remote git (user's choice;
the app does not enforce it).

### 5.3. Chat and agentic editor

**FR-AGT-1.** Streaming chat session (SSE from llama-server → goroutine →
Wails event → editor).
**FR-AGT-2.** Tool-loop: model returns a tool-call → ScriptingService or a
Go handler executes it → result fed into the next step → until the model
returns a final answer. Limits: max iterations, max wall time, max tokens
per iteration.
**FR-AGT-3.** Tool-calling format support: OpenAI-compatible function
calling (native in recent llama-server), Hermes, Qwen, Llama 3.x. The
parser is selected by the model's chat_template or set explicitly in the
profile.
**FR-AGT-4.** Mode switching within a single session (with context rebuilt
by the matching `context_strategy`).
**FR-AGT-5.** Source attribution UI: which files the agent read, which it
edited, which RAG chunks made it into context.
**FR-AGT-6.** Manual approval gate for destructive tools (`write_file`,
`edit_file`) — configurable per mode.
**FR-AGT-7.** Persist sessions to `chats/*.jsonl` with the full trace:
messages, tool calls, token counts, timestamps, profile used.

### 5.4. RAG

**FR-RAG-1.** Indexing follows the `[indexing]` rules in project.toml. The
chunker is a recursive splitter with overlap, defaulting to 512/64 tokens;
markdown-aware (uses headings and paragraphs as natural boundaries).
**FR-RAG-2.** Chunk hashing (SHA-256 of content) for idempotent
re-indexing: only changed chunks are recomputed.
**FR-RAG-3.** Hybrid retrieval: dense (vectors via sqlite-vec) + sparse
(BM25 via SQLite FTS5), combined via RRF (Reciprocal Rank Fusion).
**FR-RAG-4.** Optional reranking of top-N via bge-reranker-v2-m3.
Pipeline: query → dense + BM25 → top-50 → rerank → top-K into context.
**FR-RAG-5.** Index is versioned by `(model_id, dim)`. Switching the
embedding profile creates a new index (or reuses an existing one if
parameters match).
**FR-RAG-6.** The full chunk text is stored in the DB separately from its
vector, so embeddings can be recomputed without re-reading source files.

### 5.5. Scripting layer and Prompt Lab

**FR-SCR-1.** Inline JavaScript runtime (goja). Global `app` object with
bindings: `app.llm`, `app.project`, `app.fs`, `app.rag`, `app.chat`,
`app.log`. Async via Promise.
**FR-SCR-2.** Prompt Lab UI: editor (CodeMirror) + Run + output. Scripts
saved under `scripts/`. Parameterization via an input form generated from
JSDoc annotations or an explicit schema object.
**FR-SCR-3.** Workflow definitions in TOML: trigger (manual / file change /
schedule) → steps (`llm.chat`, `script`, `subprocess`) → output paths.
**FR-SCR-4.** External Python tools registered as `[external_tool.*]` in
the global config: interpreter path, script path, contract (argv /
stdin-json / http). Available from JS as
`app.tools.run("xtts", {...})`.
**FR-SCR-5.** The scripting API is versioned. Each script may declare
`requireApi("1.0")` on its first line.

---

## 6. Non-functional requirements

### 6.1. Performance

- Opening a project with 100k chunks — < 3 s to interactivity.
- Streaming tokens from llama-server into the editor — no visible latency
  (Wails event → DOM update < 16 ms per token).
- Incremental re-index on save of a single `.md` — < 500 ms.

### 6.2. Reliability

- A llama-server crash must not bring the app down. The supervisor
  restarts with exponential backoff; UI shows status.
- All agent file writes use temp-file + atomic rename.
- A pre-agent git snapshot is mandatory for destructive operations.

### 6.3. Security

- The tool-loop runs in a file sandbox limited to the project root. Path
  traversal (`../../etc/passwd`) is blocked in ProjectService.
- User-defined JS scripts in goja: limits on wall time, memory, no Node
  API access. Goja is isolated by default — that's a plus.
- External tools (Python sidecars) are launched with explicit args, no
  shell interpolation of user data.

### 6.4. Maintainability

- Structured logging (slog in Go); log files in
  `~/.local/share/llm-workbench/logs/`.
- Each external integration (llama.cpp, git, Python tool) sits behind an
  interface with mocks for tests.

### 6.5. Distribution

- Windows: a single `.exe` (from Wails) + an installer via NSIS or Inno
  Setup.
- Linux: `.AppImage` or `.deb` for Debian-based.
- macOS (future): `.dmg`, notarization is a separate task.
- Update mechanism: in v1 — manual (new version → restart). Auto-update
  potentially via go-selfupdate, but not in v1.

---

## 7. Data model

### 7.1. SQLite schema (simplified)

```sql
-- project metadata
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- tracked project files
CREATE TABLE files (
    id           INTEGER PRIMARY KEY,
    rel_path     TEXT UNIQUE NOT NULL,
    content_hash TEXT NOT NULL,
    size_bytes   INTEGER,
    indexed_at   INTEGER,            -- unix timestamp
    git_blob_sha TEXT
);

-- chunks
CREATE TABLE chunks (
    id           INTEGER PRIMARY KEY,
    file_id      INTEGER REFERENCES files(id) ON DELETE CASCADE,
    ord          INTEGER,            -- ordinal within the file
    text         TEXT NOT NULL,
    text_hash    TEXT NOT NULL,
    start_byte   INTEGER,
    end_byte     INTEGER,
    heading_path TEXT                -- "## Chapter 3 > ### Scene 2" for context
);
CREATE INDEX idx_chunks_file ON chunks(file_id);
CREATE UNIQUE INDEX idx_chunks_text_hash ON chunks(text_hash);

-- embeddings (one index per model+dim pair)
-- vec0 — virtual table from sqlite-vec
CREATE VIRTUAL TABLE embeddings_user_bge_m3_1024 USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding FLOAT[1024]
);

-- BM25 index
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    heading_path,
    content='chunks',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

-- chat sessions (lightweight shadow table; primary store is JSONL in chats/)
CREATE TABLE chat_sessions (
    id           TEXT PRIMARY KEY,   -- uuid
    title        TEXT,
    mode_id      TEXT,
    profile_id   TEXT,
    created_at   INTEGER,
    updated_at   INTEGER,
    file_path    TEXT                -- relative to project root
);
```

### 7.2. JSONL chat session format

One file = one session. Each line is an event:

```jsonl
{"t":"session_start","id":"...","mode":"narrative-coauthor","profile":"qwen-32b-cuda-prod","ts":"..."}
{"t":"user_message","content":"...","ts":"..."}
{"t":"assistant_token_stream","stream_id":"s1","delta":"...","ts":"..."}
{"t":"tool_call","stream_id":"s1","tool":"read_file","args":{"path":"narrative/ch1.md"},"ts":"..."}
{"t":"tool_result","stream_id":"s1","tool":"read_file","ok":true,"summary":"3.4 KB read","ts":"..."}
{"t":"assistant_message","stream_id":"s1","content":"...","tokens_in":1234,"tokens_out":567,"ts":"..."}
{"t":"sources","stream_id":"s1","files":["narrative/ch1.md"],"chunks":[{"file_id":3,"chunk_id":42,"score":0.81}]}
```

JSONL is append-only, easy to resume after a crash, easy to diff.

---

## 8. Scripting API (draft v1.0)

```ts
declare const app: {
  llm: {
    /** One-shot request, optionally streaming. */
    chat(opts: {
      profile?: string;       // default — current project profile
      messages: Message[];
      tools?: ToolDef[];
      sampler?: SamplerOverrides;
      onToken?: (delta: string) => void;
    }): Promise<ChatResult>;

    embed(opts: {
      profile?: string;
      texts: string[];
    }): Promise<number[][]>;

    rerank(opts: {
      profile?: string;
      query: string;
      docs: string[];
    }): Promise<{index: number, score: number}[]>;
  };

  project: {
    root: string;
    listFiles(glob?: string): Promise<string[]>;
    getCharacterCard(id: string): Promise<CharacterCard>;
    updateCharacterCard(id: string, patch: Partial<CharacterCard>): Promise<void>;
    snapshot(message: string): Promise<string>;  // git commit, returns sha
  };

  fs: {
    read(relPath: string): Promise<string>;
    write(relPath: string, content: string): Promise<void>;
    edit(relPath: string, unifiedDiff: string): Promise<void>;
    exists(relPath: string): Promise<boolean>;
  };

  rag: {
    search(query: string, opts?: {
      k?: number;
      hybrid?: boolean;
      rerank?: boolean;
      filter?: { paths?: string[] };
    }): Promise<RagHit[]>;
    reindex(): Promise<void>;
  };

  chat: {
    /** Access to the current chat session (when the script runs from one). */
    current?: {
      messages: Message[];
      append(msg: Message): Promise<void>;
    };
  };

  tools: {
    /** Run a registered external tool. */
    run(name: string, payload: any): Promise<any>;
    list(): string[];
  };

  log: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
};

declare function requireApi(version: string): void;
```

Example script (batch generation of TTS prompts):

```js
requireApi("1.0");

const characters = await app.project.listFiles("characters/*.md");
for (const path of characters) {
  const md = await app.fs.read(path);
  const result = await app.llm.chat({
    messages: [
      { role: "system", content: "Generate a brief TTS voice description from this character card." },
      { role: "user", content: md }
    ]
  });
  const outPath = path.replace("characters/", "tts/voices/").replace(".md", ".voice.txt");
  await app.fs.write(outPath, result.content);
  app.log.info("voice generated", { character: path });
}

await app.project.snapshot("batch: generated TTS voice prompts");
```

---

## 9. Phased plan

### Milestone 0 — Spike (1–2 weeks)

Goal: take technical risk off the stack.

- A Wails project, minimal window, CodeMirror 6 on a single 50k-line `.md`.
- A Go service spawning `llama-server`, reading SSE, streaming tokens via
  Wails events into the editor.
- Tested on Linux Debian KDE and Windows.

If smooth — continue. If WebKitGTK lag or streaming issues show up at
this stage — revisit the stack.

#### M0 results (2026-05-09, Debian 13 / KDE / WebKitGTK 4.1)

- **CodeMirror 6 / 50k lines / 3.6 MB markdown** — smooth scroll, no
  visual stalls. `setValue` of a large doc — single hundreds of ms,
  acceptable for a one-time load. `oneDark` + `lineWrapping` work without
  artifacts.
- **Token streaming** — `llama-server` SSE → Go goroutine →
  `EventsEmit("chat:delta:<id>", delta)` → CM6 `appendText` directly via
  `EditorView.dispatch` (no React state on the per-token level) — no
  visible latency.
- **Markdown preview** — JS `marked` on 3.6 MB **freezes the main thread**
  for ~a minute, unacceptable. Decision: parsing of any rendered formats
  (markdown, later asciidoc/org/rst, syntax highlighting) happens on the
  Go side and is streamed to the frontend as HTML/AST. The MVP uses
  `yuin/goldmark` + `microcosm-cc/bluemonday`. Measurements on 3.6 MB
  stress.md: **goldmark parse 110 ms, total 231 ms (incl. IPC and
  innerHTML), HTML 3.7 MB**. The bottleneck shifts from parsing to
  building a large DOM in WebKit; insignificant for typical project
  files. Solvable via chapter-block streaming when needed.
- **Process supervision incident.** The first version of
  `LlamaSupervisor.Start()` held `sync.Mutex` and called
  `emitStatus()` → `Status()` → `mu.Lock()` → self-deadlock on a
  non-reentrant Mutex. UI hung; `Stop()` could not acquire the lock;
  `OnShutdown` did not run. **Hard rule:** in supervisor / chat services,
  hold a mutex **only** while reading/writing state, never during external
  I/O (HTTP, subprocess spawn, event emit). The health probe runs outside
  the lock; a status snapshot is read under the lock and then used
  unlocked.
- **Polling vs events.** The frontend initially supplemented the
  `llama:status` events with a 3-second polling — at the first deadlock
  this turned into a queue of blocked goroutines. Polling was removed;
  status is event-only.

Decisions made as a result:

- The renderer pipeline for all formats lives in Go, not JS.
- All long-lived services (`*Supervisor`, `*Service`) document the
  mutex-discipline contract in a comment on the struct; reviewing this
  rule is mandatory during code review of such services.

### Milestone 1 — MVP

- ProfileManager + ServerSupervisor (one chat profile).
- ProjectService + git init + a basic file explorer.
- Chat window without an agent loop, without RAG.
- Save/load sessions to JSONL.
- A simple markdown viewer/editor.

### Milestone 2 — RAG

- FileIndexer + chunker + sqlite-vec.
- Embedding profile (USER-bge-m3) running alongside chat.
- FTS5 + RRF.
- `search_semantic` available in chat as a simple command (`/search ...`).

### Milestone 3 — Agent loop

- AgentRuntime, tool-loop with file/search/edit tools.
- Mode definitions (built-in + project-local).
- Approval gate, source attribution UI.
- Pre-agent snapshots.

### Milestone 4 — Scripting + Prompt Lab

- ScriptingService with goja, API v1.0.
- Prompt Lab UI.
- WorkflowEngine for batch tasks.
- External tools registry.

### Milestone 5 — Builds & forks

- BuildOrchestrator: git clone/pull, cmake invocations with streaming, GPU
  detect.
- UI for managing Builds and BuildRecipes.

### Milestone 6 — Polish

- Reranker, hot-swap, multimodal (mmproj).
- SillyTavern character card import.
- Win/Linux installers.

### Future / not-v1

- macOS support.
- Headless daemon mode.
- Auto-update.
- Alternative backends (ollama, vLLM).
- Branching for alternative storylines in the UI on top of git branches.

---

## 10. Open questions

1. **SQLite driver** — `modernc.org/sqlite` (no CGo, but loading
   extensions is harder) vs `mattn/go-sqlite3` (CGo, easier with
   sqlite-vec, but pulls deps for cross-compilation). Decide at Milestone
   2.

2. **Rich-text edge cases in CodeMirror 6** — is it sufficient for
   narrative editing with inline agent annotations? If not — possibly a
   partial switch to Tiptap for specific modes. Verify at Milestone 1.

3. **Character card format** — own format (markdown with frontmatter) plus
   SillyTavern V2 import, or SillyTavern V2 natively? Markdown is easier
   to diff and edit by hand; ST V2 gives compatibility. Most likely —
   markdown as primary, ST V2 on import/export.

4. **Windows file watcher on network shares** — `fsnotify` does not
   support it; a polling fallback is needed. Plan for early.

5. **Telemetry / crash reporting** — explicitly absent in v1, but
   error-handling design must keep a future opt-in report option in mind.

### 10.1. Decisions log

- **Frontend stack** → **React + Mantine v7**. Picked for its rich
  ready-made component library, critical for a multi-panel workspace UI
  with many forms and configuration screens. The alternative (Svelte +
  Skeleton/shadcn-svelte) gives nicer DX but requires noticeably more
  manual work on complex components. *(2026-05)*
- **License** → **MIT**. Default in the Go and npm ecosystems, maximum
  compatibility with dependencies, minimal legal text. Before public
  release — run `go-licenses` and `license-checker` over transitive deps.
  *(2026-05)*

---

## Appendix A. Glossary

- **Profile** — a Build + Model + Args bundle representing a launchable
  llama-server instance.
- **Mode** — agent work mode definition (system prompt + tools + context
  strategy).
- **Tool** — a function exposed to the agent via function calling.
- **Tool-loop** — iterative cycle "model requests a tool call → result
  back to the model" until a final answer.
- **Chunk** — a fragment of project text, the unit of indexing in RAG.
- **Hybrid retrieval** — a combination of dense (vector) and sparse (BM25)
  search.
- **RRF (Reciprocal Rank Fusion)** — algorithm for merging rankings from
  multiple retrievers.
- **mmproj** — multimodal projection file, needed for vision models in
  llama.cpp.
- **Speculative decoding** — generation speed-up via a draft model.
- **Pooling (cls/mean)** — method of aggregating token embeddings into a
  final sentence embedding. For BGE-style models — cls.
