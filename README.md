# LLM Workbench

Local LLM workbench — Wails + llama.cpp desktop app for chat, RAG, and agent workflows over your own models.

> **Status:** Milestone 2 (RAG) in progress. M0 (spike) and M1 (MVP — multi-profile supervisor, projects, sessions, V5 UI) shipped. Agent loop and scripting layer remain.

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

All commands run from `llm-workbench/`. The app embeds SQLite via CGo (mattn/go-sqlite3) for the M2 RAG index, so a working C toolchain is required on every platform.

### Build tags

Two build tags are required on every `wails dev` / `wails build`:

| Tag | Why |
|---|---|
| `webkit2_41` | Linux only. Needed on distros shipping `libwebkit2gtk-4.1` (Debian 13, Ubuntu 24.04+, Fedora 40+). Harmless on Windows but the Wails CLI ignores it there. |
| `sqlite_fts5` | Enables the FTS5 module in mattn/go-sqlite3, used by the RAG index for BM25 retrieval. Required on every platform. |

Always pass them via `-tags "webkit2_41 sqlite_fts5"` (or `-tags sqlite_fts5` on Windows).

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
PATH=$PATH:$HOME/go/bin wails dev -tags "webkit2_41 sqlite_fts5"

# Production build → build/bin/llm-workbench
PATH=$PATH:$HOME/go/bin wails build -tags "webkit2_41 sqlite_fts5"
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

- **M0 — spike** ✅: Wails shell, `llama-server` supervisor, streaming chat into editor.
- **M1 — MVP** ✅: multi-profile supervisor, projects, sessions, V5 UI.
- **M2 — RAG** *(in progress)*: per-project SQLite index with FTS5 + `sqlite-vec`, embeddings, hybrid retrieval.
- **M3 — agent loop**: tools, modes, sandboxed `ProjectService` for FS ops.
- **M4 — scripting**.
- **M5 — build orchestrator**: manage `llama.cpp` builds and model bundles.
- **M6 — polish**.

## License

MIT. See [LICENSE](LICENSE).
