# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

- `DESIGN.md` — full design doc (Russian). Authoritative source for architecture decisions, milestones, domain model. Read this before non-trivial changes.
- `llm-workbench/` — Wails desktop app implementing the design. Currently at **Milestone 0 (spike)**: single chat profile, hardcoded llama-server via `.env`, no projects/RAG/agents yet.

## Stack

- **Backend:** Go 1.23+, Wails v2 (system WebView, no Chromium).
- **Frontend:** React 18 + TypeScript + Mantine v7 + CodeMirror 6 (markdown editor).
- **External process:** `llama-server` (mainline llama.cpp or `ik_llama.cpp` fork) — spawned as subprocess, OpenAI-compatible API on `127.0.0.1:8080`.

## Common commands

All run from `llm-workbench/`. Build tags:
- `webkit2_41` — Linux Debian 13 needs this (system has libwebkit2gtk-4.1, not 4.0).
- `sqlite_fts5` — enables the FTS5 module in mattn/go-sqlite3, required by the M2 RAG index.

Always pass both via `-tags "webkit2_41 sqlite_fts5"`. A plain `go build ./...` (used for compile checks) does NOT need `webkit2_41` (no webview embed) but DOES need `sqlite_fts5` once index code is exercised by a test or smoke run.

```bash
# Dev (hot reload, devtools at :34115)
PATH=$PATH:$HOME/go/bin wails dev -tags "webkit2_41 sqlite_fts5"

# Production build → build/bin/llm-workbench
PATH=$PATH:$HOME/go/bin wails build -tags "webkit2_41 sqlite_fts5"

# Regenerate JS bindings after changing exported App methods
PATH=$PATH:$HOME/go/bin wails generate module

# Frontend-only typecheck + bundle (no Go)
cd frontend && npm run build

# Go-only compile check (skips frontend embed)
go build ./...
```

No test suite exists yet. No linter configured.

## Go vendoring

Go deps are vendored in `llm-workbench/vendor/` and committed to the repo. Go automatically uses `vendor/` when it exists (`-mod=vendor` is the default). Rationale: reproducible builds without network, pinned to exact versions of Wails + transitive deps.

After changing `go.mod` (adding/removing/upgrading deps):

```bash
cd llm-workbench
go get <pkg>          # or go mod tidy
go mod vendor         # refresh vendor/ — required, or build will fail
```

Commit `go.mod`, `go.sum`, and `vendor/` together. Never edit files under `vendor/` by hand. If `wails build` complains about missing modules, the fix is `go mod vendor`, not deleting `vendor/`.

## Configuration

`llm-workbench/.env` (gitignored) — runtime config for `llama-server`. Copy from `.env.example`. Keys: `LLAMA_SERVER_BIN`, `LLAMA_SERVER_CWD`, `LLAMA_MODEL`, `LLAMA_HOST`, `LLAMA_PORT`, `LLAMA_EXTRA_ARGS`, `LLAMA_HEALTH_TIMEOUT`, `LLAMA_AUTOSTART`. Loaded by `config.go` (minimal in-tree parser, no godotenv dep).

`LLAMA_EXTRA_ARGS` is space-split and appended after `-m / --host / --port`. Fork-specific flags (e.g. ik_llama's `--fit`) live here.

## Architecture

Single-package Go program (`package main`). Three concerns, each in its own file, all bound onto the `App` struct exposed to JS:

- `supervisor.go` — `LlamaSupervisor`: spawns `llama-server` in its own process group (`Setpgid`), pumps stdout/stderr line-by-line into `llama:log` Wails events, polls `/health` on a deadline, emits `llama:status`. `Stop()` SIGTERMs the group with 5s SIGKILL escalation.
- `chat.go` — `ChatService`: POSTs to `/v1/chat/completions` with `stream=true`, parses SSE (`data: …\n`), emits `chat:delta:<streamId>` per token, `chat:done:<streamId>` / `chat:error:<streamId>` terminal. Each stream gets a UUID and a `context.CancelFunc` so JS can call `ChatCancel(streamId)`.
- `app.go` — `App` struct holds `cfg/supervisor/chat`, exposes `StartServer/StopServer/ServerStatus/ChatStream/ChatCancel/GetConfig` to the frontend. `OnShutdown` stops the supervisor so the subprocess doesn't outlive the GUI.

Wails generates TS bindings into `frontend/wailsjs/go/main/App.d.ts`. **After adding/renaming an exported method on `App`, run `wails generate module` or the next `wails dev/build` will use stale bindings.**

Frontend is single-page (`App.tsx`):
- AppShell with header (start/stop button + health badge), navbar (prompt textarea + log viewer), main (CodeMirror editor).
- `EditorHandle` ref pattern (`appendText/setValue/getValue`) keeps CM6 imperative API out of React state — token deltas append directly to the editor doc instead of going through `useState` (avoids per-token re-render).
- `EventsOn` subscriptions are scoped per-stream (`chat:delta:${id}`) and torn down in `cleanup()` on done/error.

## Domain concepts (from DESIGN.md, not yet implemented)

`Build` × `ModelBundle` × `RuntimeArgs` = `Profile`. `Project` = directory with `project.toml` + `.git` + `index.db` (SQLite + sqlite-vec) + content. `Mode` = system prompt + tool whitelist + context strategy. `Tool` = function exposed to agent loop. Embedding model is a profile of `type = "embed"`, not a constant.

Milestone progression: M0 spike (current) → M1 MVP (one profile, project, chat, no agent loop) → M2 RAG → M3 agent loop → M4 scripting → M5 build orchestrator → M6 polish. Don't add features from later milestones unless asked.

## Conventions

- **Documentation language: English.** All new docs (README, contributor docs, inline `*.md` notes) must be written in English. Existing Russian design docs (e.g. `DESIGN.md`) stay as-is until explicitly translated; do not rewrite them on the fly. User-facing UI labels may stay bilingual where the existing prose already mixes both.
- Code identifiers and comments stay English.
- File system is the source of truth for content; SQLite (future) only for derived data (index, chat history, embedding cache).
- All file ops the agent will eventually do must go through a sandboxed `ProjectService` — don't add direct `os.WriteFile` calls in handler code when project-scoped paths are involved.
- External processes (llama.cpp, future Python sidecars) communicate via HTTP or argv+stdout JSON. No CGo embedding.
