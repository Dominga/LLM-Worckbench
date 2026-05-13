# LLM Workbench

Local LLM workbench — Wails + llama.cpp desktop app for chat, RAG, and agent workflows over your own models. Primary use case is narrative writing and game design; the agent toolset is general enough for coding too.

> **Status:** M1–M5 shipped. Only **M6 — polish** (reranker, hot-swap, multimodal `mmproj`, SillyTavern character-card import, installers) is open. PR-by-PR history lives in `git log` and [DESIGN.md](DESIGN.md) §9; the active backlog is in [TODO.md](TODO.md).

## What it is

A self-hosted desktop workspace for working with local LLMs served by [`llama.cpp`](https://github.com/ggerganov/llama.cpp) (or forks such as [`ik_llama.cpp`](https://github.com/ikawrakow/ik_llama.cpp)). The app supervises `llama-server` as a subprocess and talks to it over its OpenAI-compatible HTTP API. The frontend pairs a Markdown editor (CodeMirror 6) with a streaming chat pane, a per-project file tree, the Prompt Lab (mode + script editor), and the Servers tab for managing profiles + builds.

The workbench is built around three primitives:

- **Profile** = `Build` × `ModelBundle` × `RuntimeArgs` — a fully described way to run one model. Multiple profiles can run in parallel (e.g. chat + embedding sidecar).
- **Project** = a directory with `project.toml`, optional `.git`, the per-project state dir `.llm-workshop/` (sessions, RAG `index.db`, modes overrides, `memory.md`), and content files.
- **Mode** = system prompt + tool whitelist + approval policy + context strategy used by the agent loop. Modes are TOML + Markdown files; bundled set seeds into the global modes dir on first launch and can be overridden per project.

See [DESIGN.md](DESIGN.md) for the full design doc (in Russian).

## Features

- **Streaming chat** over the OpenAI-compatible API with cancel, token-throughput pill, and per-session JSONL transcripts.
- **Multi-profile supervisor** with per-profile autostart, health checks, log capture, GPU metrics, and a Servers tab.
- **Projects** with per-project sessions, modes, RAG index, memory, and snapshot-based revert.
- **Hybrid RAG** (BM25 via SQLite FTS5 + dense vectors via `sqlite-vec`) over project content; auto-reindex on file save; per-file delta updates. Session transcripts are indexed too (`source="history"`) and `search_semantic` accepts a `kinds` filter to choose between project content and conversation history.
- **Agent loop** with native function calling + ReAct fallback. Built-in tools: `search_semantic`, `read_file`, `list_files`, `edit_file`, `make_directory`, `read_memory`, `append_memory`. Writes go through an approval modal (`approval=always`) or a git snapshot (`approval=snapshot`); `approval=auto` is read-only-safe.
- **Modes as files** — TOML + `<id>.system.md` template with placeholder substitution. Editable in the Prompt Lab; scope toggle (project override vs. global edit) plus a "remove override" button.
- **Memory.md** — append-only freeform notes per scope (`~/.config/llm-workbench/memory.md` global, `<project>/.llm-workshop/memory.md` project). Auto-injected into mode prompts via `{{memory.global}}` / `{{memory.project}}`; the agent can record durable facts with `append_memory` and recall them via `read_memory`. See [`llm-workbench/docs/prompt-variables.md`](llm-workbench/docs/prompt-variables.md) for the full template-variable reference.
- **External registry** — Settings → Registry subscribes to one or more HTTP-served `index.json` endpoints listing installable modes + model families. Default subscription is the curated repo at [`Dominga/llm-workbench-registry`](https://github.com/Dominga/llm-workbench-registry); private or community mirrors can be added. Install / uninstall / update notifications are managed per artifact. Schema in [`llm-workbench/docs/registry-format.md`](llm-workbench/docs/registry-format.md).
- **Model families** — bundled `families/` describe ChatML, Gemma, Llama-3, DeepSeek-R1, Mistral, Qwen3 chat templates + sampling defaults. ProfileForm autodetects family from GGUF header; Servers tab groups profiles by family; mode prompt templates can ship `<id>.<family>.system.md` variants picked up automatically.
- **Prompt Lab** with a mode-template editor (placeholder highlighting + live preview) and a scripts pane (JS sandboxed via goja, exposes `app.tools.run(...)`, `app.llm.chat(...)`, etc.).
- **Build orchestrator** (M5) — fetch `llama.cpp` source, configure, build, register the resulting binary as a `Build` you can pin profiles against.
- **Frameless window** with custom title bar (TD5); resizable chat ↔ file split with collapsible chat side (TD6); project-unbound "blank chat" start (TD22).

## Stack

- **Backend:** Go 1.23+, [Wails v2](https://wails.io/) (uses the system WebView — no bundled Chromium).
- **Frontend:** React 18 + TypeScript + [Mantine v7](https://mantine.dev/) + [CodeMirror 6](https://codemirror.net/).
- **External process:** `llama-server` from `llama.cpp` or a compatible fork.

## Layout

```
.
├── DESIGN.md                  # Authoritative design document (RU)
├── TODO.md                    # Open bugs + tech-debt backlog (M1–M5 closed)
├── llm-workbench/
│   ├── *.go                   # App, supervisor, chat, profiles, projects,
│   │                          # rag, indexer, agent loop, modes, memory…
│   ├── modes/                 # Bundled mode definitions (.toml + .system.md)
│   ├── docs/                  # Reference docs (prompt-variables.md, …)
│   ├── frontend/              # React + Mantine + CodeMirror UI
│   │   ├── src/tabs/          # ChatTab, ServersTab, LabTab, RagTab, …
│   │   ├── src/components/    # ApprovalModal, Editor, …
│   │   └── wailsjs/           # Auto-generated Go bindings (committed)
│   └── vendor/                # Vendored Go deps (committed)
└── README.md
```

Per-project state lives under `<project>/.llm-workshop/`:

```
.llm-workshop/
├── sessions/<id>.jsonl   # Chat transcripts (also indexed as source="history")
├── modes/                # Project-local mode overrides
├── memory.md             # Project-scope agent notes
├── index.db              # SQLite + FTS5 + sqlite-vec RAG index
└── project.toml          # Indexing globs and other project metadata
```

## Build & run

All commands run from `llm-workbench/`. The app embeds SQLite via CGo (mattn/go-sqlite3) for the M2 RAG index, so a working C toolchain is required on every platform.

### Build tags

Two build tags are required on every `wails dev` / `wails build`:

| Tag | Why |
|---|---|
| `webkit2_41` | Linux only. Needed on distros shipping `libwebkit2gtk-4.1` (Debian 13, Ubuntu 24.04+, Fedora 40+). Harmless on Windows but the Wails CLI ignores it there. |
| `sqlite_fts5` | Enables the FTS5 module in mattn/go-sqlite3, used by the RAG index for BM25 retrieval. Required on every platform. |

Always pass them via `-tags "webkit2_41,sqlite_fts5"` (Windows: `-tags sqlite_fts5`).

> ⚠️ Wails CLI takes the `-tags` value as a **comma-separated** list (not space-separated like plain `go build`). If you pass `-tags "tag1 tag2"` Wails will forward only the first tag and the resulting binary will fail at runtime with `no such module: fts5` when the RAG index is opened. Use `,` between tags.

### Linux (Debian 13 / Ubuntu 24.04+ / Fedora 40+)

System packages:

```bash
# Debian / Ubuntu
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev nodejs npm

# Fedora
sudo dnf install gcc gcc-c++ make pkgconfig webkit2gtk4.1-devel gtk3-devel nodejs npm
```

Toolchain:

- Go 1.23+ from [go.dev/dl](https://go.dev/dl/) (or your distro's `golang` package if recent enough).
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest` — installs to `$HOME/go/bin`.

Build:

```bash
cd llm-workbench
cp .env.example .env        # then edit paths to your llama-server + model (legacy seed, M1+ uses profiles.toml)

# Dev (hot reload, devtools at http://localhost:34115)
PATH=$PATH:$HOME/go/bin wails dev -tags "webkit2_41,sqlite_fts5"

# Production build → build/bin/llm-workbench
PATH=$PATH:$HOME/go/bin wails build -tags "webkit2_41,sqlite_fts5"
```

### Windows 10 / 11

Toolchain:

- **Go 1.23+** — installer from [go.dev/dl](https://go.dev/dl/).
- **Node.js LTS** — installer from [nodejs.org](https://nodejs.org/).
- **C compiler for CGo** — required by mattn/go-sqlite3. **Visual Studio (MSVC / `cl.exe`) does NOT work with Go CGo** — you need a gcc-style compiler. Pick whichever is least intrusive:

  | Option | How |
  |---|---|
  | **WinLibs** *(smallest, no installer)* | Download a MinGW-w64 zip from [winlibs.com](https://winlibs.com/), extract to e.g. `C:\winlibs`, add `C:\winlibs\mingw64\bin` to `PATH`. |
  | **TDM-GCC** | One-click installer: [jmeubank.github.io/tdm-gcc](https://jmeubank.github.io/tdm-gcc/). |
  | **scoop** | `scoop install mingw` |
  | **chocolatey** | `choco install mingw` |
  | **MSYS2** | Heaviest. From [msys2.org](https://www.msys2.org/): in the MinGW64 shell run `pacman -S --needed mingw-w64-x86_64-gcc`, then add `C:\msys64\mingw64\bin` to `PATH`. |

  Verify with `gcc --version` in a fresh `cmd.exe` or PowerShell. Any of the above is fine — they all expose the same `gcc.exe` binary that CGo needs.
- **Wails CLI**: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`. Installs to `%USERPROFILE%\go\bin` — make sure that directory is on `PATH`.
- **WebView2 runtime** — preinstalled on Windows 11 and on most Windows 10 systems via Edge. If `wails doctor` complains, grab the Evergreen Bootstrapper from Microsoft.

Build (PowerShell):

```powershell
cd llm-workbench
copy .env.example .env       # edit to point at your llama-server.exe + model

# Dev
wails dev -tags sqlite_fts5

# Production build → build\bin\llm-workbench.exe
wails build -tags sqlite_fts5
```

The `webkit2_41` tag is Linux-specific and not needed on Windows. If you see `error: 'gcc' executable file not found in %PATH%`, your MinGW install is not on `PATH` yet — open a fresh shell after editing it.

### After changing Go bindings

After adding/renaming any exported method on the `App` struct, regenerate the TypeScript bindings the frontend imports:

```bash
PATH=$PATH:$HOME/go/bin wails generate module     # or: wails generate module  (Windows)
```

### After changing Go dependencies

`vendor/` is committed — refresh it whenever you touch `go.mod`:

```bash
cd llm-workbench
go get <pkg>          # or: go mod tidy
go mod vendor
```

Commit `go.mod`, `go.sum`, and `vendor/` together. Never edit files under `vendor/` by hand.

## Configuration

Runtime config lives in `~/.config/llm-workbench/` (or `$XDG_CONFIG_HOME/llm-workbench/`):

| Path | What |
|---|---|
| `profiles.toml` | Profile registry — one entry per `llama-server` instance you want to run (binary path, model, port, extra args, autostart flag, embedding/chat kind, etc.). Managed through the Servers tab; editing the file by hand also works. |
| `projects.toml` | Project registry — `{id, name, path}` triples plus the active-project pointer. |
| `builds.toml` | Build registry — `BuildRecipe` definitions + the `Build` artifacts they produced (paths to compiled `llama-server` binaries). M5. |
| `modes/` | Global mode overrides (`<id>.toml` + `<id>.system.md`). Seeded from the bundled set on first launch. |
| `memory.md` | Per-user freeform notes the agent reads/appends across every project. |

`llm-workbench/.env` is a **legacy seed** kept for backward compatibility: on first launch it populates a default profile in `profiles.toml`. Subsequent edits should happen through the Servers tab (or by editing `profiles.toml` directly). Recognised keys:

| Key | Purpose |
|---|---|
| `LLAMA_SERVER_BIN` | Path to the `llama-server` binary |
| `LLAMA_SERVER_CWD` | Working directory for the binary (matters for forks using relative paths) |
| `LLAMA_MODEL` | Path to the GGUF model file |
| `LLAMA_HOST` / `LLAMA_PORT` | Host/port the server listens on (default `127.0.0.1:8080`) |
| `LLAMA_EXTRA_ARGS` | Extra args passed verbatim to `llama-server` (space-separated). Fork-specific flags (e.g. `--fit`) live here. |
| `LLAMA_HEALTH_TIMEOUT` | Seconds to wait for `/health` to return ok |

(`LLAMA_AUTOSTART` was retired — the per-profile `autostart` flag in `profiles.toml` is the single source of truth.)

## Architecture

Single-package Go program. Each concern lives in its own file; all services are bound onto the `App` struct exposed to JS via Wails.

Process supervision and chat:
- **`supervisor.go`** — `ServerRegistry` spawns each profile's `llama-server` in its own process group, pumps stdout/stderr into `llama:log` events, polls `/health`, emits `llama:status`. Stop is SIGTERM with a 5 s SIGKILL escalation.
- **`chat.go`** — POSTs `/v1/chat/completions` with `stream=true`, parses SSE, emits `chat:delta:<streamId>` per token plus `chat:done` / `chat:error` terminals. Cancellation via `ChatCancel(streamId)`. Sessions with a non-empty mode `tool_whitelist` get routed through the agent loop instead of the plain chat path.
- **`agent.go` + `agent_loop.go`** — `ToolRegistry` + the two-mode dispatcher (native OpenAI-style function calling first; ReAct text-prompt fallback when the model doesn't support tools natively). Tool calls hit the approval gate (`approval.go`) when the mode policy says so.

Projects, files, modes:
- **`project.go`** — `ProjectService` (registry + per-project metadata in `~/.config/llm-workbench/projects.toml`).
- **`file.go`** — `FileService` (sandboxed read/write/listTree/makeDirectory; refuses paths escaping the project root). Hooked to the indexer so every write triggers a background per-file reindex.
- **`mode.go` + `mode_seed.go`** — `ModeService` merges builtin + global + project-local mode definitions. Bundled `modes/*.toml` + `*.system.md` get seeded into `~/.config/llm-workbench/modes/` on first launch.
- **`memory.go`** — `MemoryService` reads / appends `memory.md` for each scope. `ModeService.buildTemplateContext` injects the contents into `{{memory.global}}` / `{{memory.project}}` placeholders.

RAG:
- **`index.go`** — per-project SQLite at `<project>/.llm-workshop/index.db`. Schema: `chunks` (with `source` column for content / history tagging), `chunks_fts` (FTS5 BM25 mirror via triggers), `vec_chunks` (sqlite-vec virtual table, dimension pinned by the active embed profile).
- **`indexer.go`** — walks the project tree honoring `project.toml` include/exclude globs, chunks each file, and upserts the delta against `chunks`. Also walks `.llm-workshop/sessions/*.jsonl` and indexes transcripts with `source="history"`.
- **`embedder.go` + `embedclient.go`** — drives the embedding profile (`/v1/embeddings`) to fill `vec_chunks`.
- **`rag.go`** — hybrid retrieval: dense + sparse pools fused via Reciprocal Rank Fusion; post-filters by `Kinds` so `search_semantic` can scope queries to project content, history, or both.

Build orchestrator + scripting:
- **`build.go` + `build_orchestrator.go`** — `BuildRecipe` → `Build` pipeline (fetch / configure / compile / register). Builds are referenced by profile.
- **`scripting.go` + `scripts_store.go`** — goja sandbox exposing `app.tools.run(...)`, `app.llm.chat(...)`, `app.search.semantic(...)`, etc. for Prompt Lab scripts.

Frontend:
- React 18 + Mantine v7 + CodeMirror 6. Tabs (`Chat`, `Servers`, `Lab`, `Rag`, …) own their state; the chat side uses a CM6 `EditorHandle` ref so token deltas append directly to the doc without per-token React re-renders.
- `frontend/wailsjs/go/main/App.{js,d.ts}` is regenerated by `wails generate module` whenever an exported `App` method is added or renamed.

## Roadmap

- **M0 — spike** ✅: Wails shell, `llama-server` supervisor, streaming chat into editor.
- **M1 — MVP** ✅: multi-profile supervisor, projects, sessions, V5 UI.
- **M2 — RAG** ✅: per-project SQLite index with FTS5 + `sqlite-vec`, embeddings, hybrid retrieval, session-log RAG (`source="history"`).
- **M3 — agent loop** ✅: tools (`search_semantic` / `read_file` / `list_files` / `edit_file` / `make_directory` / `read_memory` / `append_memory`), modes with approval policies, sandboxed FS access, memory.md.
- **M4 — scripting** ✅: Prompt Lab + goja sandbox.
- **M5 — build orchestrator** ✅: manage `llama.cpp` builds and model bundles.
- **M6 — polish** *(open)*: reranker (`bge-reranker-v2-m3`), hot-swap, multimodal (`mmproj`), SillyTavern character-card import, Windows/Linux installers.

## License

MIT. See [LICENSE](LICENSE).
