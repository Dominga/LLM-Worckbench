# LLM Workbench

Local LLM workbench — Wails + llama.cpp desktop app for chat, RAG, and agent workflows over your own models.

> **Status:** Milestone 0 (spike). Single chat profile, hardcoded `llama-server` config via `.env`. Projects, RAG, and agent loop are designed but not yet implemented.

## What it is

A self-hosted desktop workspace for working with local LLMs served by [`llama.cpp`](https://github.com/ggerganov/llama.cpp) (or forks such as [`ik_llama.cpp`](https://github.com/ikawrakow/ik_llama.cpp)). The app supervises `llama-server` as a subprocess and talks to it over its OpenAI-compatible HTTP API. The frontend is a Markdown editor (CodeMirror 6) with streaming chat in the side panel.

The long-term goal is a workbench around three primitives:

- **Profile** = `Build` × `ModelBundle` × `RuntimeArgs` — a fully described way to run one model.
- **Project** = a directory with `project.toml`, `.git`, an SQLite + `sqlite-vec` index, and content files.
- **Mode** = system prompt + tool whitelist + context strategy used by the agent loop.

See [DESIGN.md](DESIGN.md) for the full design doc (in Russian).

## Stack

- **Backend:** Go 1.23+, [Wails v2](https://wails.io/) (uses the system WebView — no bundled Chromium).
- **Frontend:** React 18 + TypeScript + [Mantine v7](https://mantine.dev/) + [CodeMirror 6](https://codemirror.net/).
- **External process:** `llama-server` from `llama.cpp` or a compatible fork.

## Layout

```
.
├── DESIGN.md          # Authoritative design document (RU)
├── llm-workbench/     # Wails desktop app (Go + React)
│   ├── *.go           # App, supervisor, chat service, profiles, paths…
│   ├── frontend/      # React + Mantine + CodeMirror UI
│   └── vendor/        # Vendored Go deps (committed)
└── README.md
```

## Build & run

All commands run from `llm-workbench/`. On Debian 13 (and other distros shipping libwebkit2gtk-4.1) the `webkit2_41` build tag is required.

```bash
cd llm-workbench
cp .env.example .env        # then edit paths to your llama-server + model

# Dev (hot reload, devtools at http://localhost:34115)
PATH=$PATH:$HOME/go/bin wails dev -tags webkit2_41

# Production build → build/bin/llm-workbench
PATH=$PATH:$HOME/go/bin wails build -tags webkit2_41
```

After changing exported methods on the `App` struct, regenerate the JS bindings:

```bash
PATH=$PATH:$HOME/go/bin wails generate module
```

## Configuration

`llm-workbench/.env` (gitignored) holds the runtime config for `llama-server`. Copy from `.env.example` and edit:

| Key | Purpose |
|---|---|
| `LLAMA_SERVER_BIN` | Path to the `llama-server` binary |
| `LLAMA_SERVER_CWD` | Working directory for the binary (matters for forks using relative paths) |
| `LLAMA_MODEL` | Path to the GGUF model file |
| `LLAMA_HOST` / `LLAMA_PORT` | Host/port the server listens on (default `127.0.0.1:8080`) |
| `LLAMA_EXTRA_ARGS` | Extra args passed verbatim to `llama-server` (space-separated). Fork-specific flags (e.g. `--fit`) live here. |
| `LLAMA_HEALTH_TIMEOUT` | Seconds to wait for `/health` to return ok |
| `LLAMA_AUTOSTART` | `true` to spawn `llama-server` automatically on app launch |

## Architecture (M0)

Single-package Go program. Three concerns, each in its own file, all bound onto the `App` struct exposed to JS:

- **`supervisor.go`** — spawns `llama-server` in its own process group, pumps stdout/stderr line-by-line into `llama:log` Wails events, polls `/health`, emits `llama:status`. `Stop()` SIGTERMs the group with 5 s SIGKILL escalation.
- **`chat.go`** — POSTs to `/v1/chat/completions` with `stream=true`, parses SSE, emits `chat:delta:<streamId>` per token and `chat:done:<streamId>` / `chat:error:<streamId>` terminals. Each stream gets a UUID and a cancel func so the UI can abort via `ChatCancel(streamId)`.
- **`app.go`** — holds `cfg / supervisor / chat`, exposes `StartServer / StopServer / ServerStatus / ChatStream / ChatCancel / GetConfig`. `OnShutdown` stops the supervisor so the subprocess doesn't outlive the GUI.

The frontend is single-page (`App.tsx`) with an AppShell: header (start/stop + health badge), navbar (prompt textarea + log viewer), main (CodeMirror editor). An `EditorHandle` ref keeps the imperative CM6 API out of React state — token deltas append directly to the editor doc to avoid per-token re-renders.

## Roadmap

- **M0 — spike** *(current)*: Wails shell, `llama-server` supervisor, streaming chat into editor.
- **M1 — MVP**: one profile, one project, real chat history.
- **M2 — RAG**: embeddings, `sqlite-vec` index, retrieval over project content.
- **M3 — agent loop**: tools, modes, sandboxed `ProjectService` for FS ops.
- **M4 — scripting**.
- **M5 — build orchestrator**: manage `llama.cpp` builds and model bundles.
- **M6 — polish**.

## License

MIT. See [LICENSE](LICENSE).
