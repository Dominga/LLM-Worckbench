# TODO — backlog

**M1–M5 closed.** PR-by-PR history lives in `git log` + `DESIGN.md` §9.
Only **Milestone 6 — Polish** remains as a planned milestone (DESIGN.md §9 M6):
reranker (`bge-reranker-v2-m3`), hot-swap, multimodal (`mmproj`), SillyTavern
character-card import, Win/Linux installers. Not started — break into PRs when M6 begins.

This file now tracks **bugs** and **tech debt** only.

---

## Open bugs

### B9 — Windows: native window flickers periodically

**Symptom:** on Windows the app window flickers/redraws on a recurring interval
(reported as "мигает периодически"). Not seen on Linux/webkit2_41.

**Status:** TD5 (frameless window) landed — the native frame is gone, which was
one of the suspects (resize-storm between the native chrome and our TitleBar).
**Needs a re-check on Windows.** If the flicker persists with the frameless
window:
- Try `windows.Options{ WebviewGpuIsDisabled: true }` in `main.go` — WebView2 GPU
  compositing glitches are a known flicker source (costs some perf).
- Try `windows.Options{ DisableFramelessWindowDecorations: true }` — drops the
  Wails-drawn shadow/rounded corners on frameless windows, which can fight the
  webview repaint.
- Otherwise: profile which Go-side event burst / poll tick correlates with the
  flicker (`llama:log` pump in `supervisor.go`, `gpu_metrics.go` poll, `App.tsx`
  event subs) and debounce/coalesce that source.

**Files:** `main.go` (Windows options), then TBD — `frontend/src/App.tsx` (event
subs + poll effects), `supervisor.go` (log/status emit cadence).

---

## Tech debt / nice-to-have

### Chat / UI

#### TD24 — Tool modes are inert in a project-unbound chat

A project-less chat (no project open — TD22) sends through the one-shot
`ChatStream` path, which ignores the session mode entirely. So picking Agent /
Auto-edit / Research from the chat-window mode picker does nothing — and all the
builtin tools (`read_file`, `list_files`, `search_semantic`, `edit_file`) are
project-scoped anyway, so they couldn't run regardless. The picker should hide
tool-enabled modes (or disable them with a "open a project to use tools" hint)
when `activeProject == null`. Alternatively, route project-less chat through the
agent loop too (with an empty tool registry) so a system-prompt-only mode still
applies — but the seeded modes all carry tool whitelists, so hiding them is the
simpler fix for v1.

**Files:** `frontend/src/tabs/ChatTab.tsx` (mode picker filter), maybe
`chat.go` (decide whether `StartStream` should honour a mode at all).

#### TD7 — Inline file autocomplete when chat is hidden (future, low priority)

Once TD6 lands and the chat side can be hidden, give the file editor a
Copilot-style inline completion bound to the active chat profile
(`/v1/completions` with the FIM prompt format the model supports). Unobtrusive —
debounced, dismissable with Esc, accepted with Tab. Wait for the M3 agent loop
prompt-routing pipeline to settle first.

#### TD11 — Send button stuck disabled after agent tool call (partial fix landed)

**Fixed so far:** (1) `chat.go` wraps the session-stream goroutine in `defer {
recover; finalize }` so a panic in a tool handler still fires `chat:done` /
`chat:error`; (2) removed the `!healthy` pre-gate that greyed the send button
after a `read_file` injected a fat file and the `/health` probe timed out.

**Still TODO if it recurs:**
- Frontend watchdog: no event in N seconds → force `streaming=false` with a
  "stalled, please retry" toast.
- Debug logging of `streaming` / `streamIdRef` transitions in debug builds.

Original report: in `Agent` mode, after the model called `read_file`, the chat
input went stuck (send icon greyed, Ctrl+Enter dead) until app restart — i.e.
`streaming=true` in `ChatTab` never flipped back.

**Files:** `chat.go`, `frontend/src/tabs/ChatTab.tsx`.

#### TD1 — Copy-logs button still appears blocked in some states

After B6 the `disabled` prop was removed and the click handler always runs (toast
`"Logs empty"` on zero lines), but the button still *feels* blocked — possibly a
CSS/render issue, a CrashBanner overlay, or a stale `selectedLogs` closure. Not
investigated; defer until reliably reproduced.

**Files:** `frontend/src/tabs/ServersTab.tsx` (logs tabs row).

### Servers / supervisor

#### TD3 — Linked embed sidecar should start BEFORE chat (not after)

`supervisor.go` `Start(chat)` kicks off the linked embed profile in a goroutine
**after** the chat process spawns. With `--fit` (ik_llama.cpp), the chat
allocator reads `cudaMemGetInfo` at startup and greedily fills the GPU — by the
time the embed sidecar loads, there's no room and BGE-M3 OOMs on warmup.

**Fix:** when `LaunchEmbedding=true && EmbedProfileID != ""`, start the embed
profile FIRST, wait for `/health`, then start the chat profile. Chat's `--fit`
then sees real free VRAM (minus embed). An embed-start failure should still not
block chat (downgrade to warning + skip the linked sidecar).

**Files:** `supervisor.go` `ServerRegistry.Start`.

#### TD4 — Configurable startup order for linked profiles (future, low priority)

Once TD3 lands with hard-coded "embed first", expose the order as a profile field
(or a `[startup]` block in profiles.toml) so users can mix arbitrary sidecars
(rerank, multimodal projector, future tool servers) and choose the order.

### Scripting / Prompt Lab / modes

#### TD12 — JSDoc-driven Lab parameter form

Auto-generate a small input form on the Prompt Lab (Scripts) tab from `@param`
JSDoc annotations in the script source. Feed values into a `params` global the
script can read. Lets users author parameterised utility scripts without
hand-coding a UI per script.

#### TD13 — Workflow TOML

`<project>/.llm-workshop/workflows/*.toml` definitions: `trigger` (manual /
file-change / cron) → `steps` (`llm.chat`, `script`, `subprocess`) → output
paths. `WorkflowEngine` + UI to browse / run / schedule. Bigger block.

#### TD14 — External Python sidecar tools

`[external_tool.foo]` in `~/.config/llm-workbench/external_tools.toml`:
interpreter + script + contract (argv / stdin-json / http). Surfaces in the agent
loop as a tool named `foo` and inside scripts as `app.tools.run("foo", …)`.
Useful for heavy NLP utilities (xtts, whisper) outside Go's pure-runtime scope.

#### TD15 — Script API versioning

Per-script `requireApi("1.0")` directive so newer global-API surface can ship
without breaking older scripts. Service tracks the active set of method signatures
keyed by major.minor.

#### TD18 — Scripts global/per-project split

Mirror modes: `~/.config/llm-workbench/scripts/` alongside per-project
`<project>/.llm-workshop/scripts/`, project overrides global by name. Once landed,
list-merge in `ScriptStore`.

### Builds & forks

#### TD20 — Multi-platform cross-builds

One recipe → several backends in a matrix. Deferred; v1 is one recipe = one
binary.

#### TD21 — Auto-detect `Build.capabilities`

Probe the built `llama-server --help` for `--embeddings` / `--mmproj` / rerank
flags instead of taking the recipe's `backend` hint at face value. (The recipe's
`backend` field is advisory — the actual backend is whatever the cmake flags
enable. PR29 keeps them in sync for *suggested* recipes; user-edited recipes can
drift. Acceptable for v1; TD21 closes it.)

---

## Closed (one-line index — full detail in `git log`)

### Bugs

- **B1** — Port uniqueness enforced at runtime (Start path), not in the profile form. `profile.go`, `supervisor.go`, `ProfileForm.tsx`.
- **B2** — Copy/paste `extra_args` between profiles (clipboard buttons in the form). `ProfileForm.tsx`.
- **B3** — Legacy `.env` autostart ignored the per-profile flag; removed, `AutostartAll()` is the single source of truth. `app.go`.
- **B4** — Server-stop wrongly flagged `crashed`; `stopRequested` flag maps the SIGTERM exit to `StateStopped`. `supervisor.go`.
- **B5** — Pre-start VRAM snapshot logged via uncached `nvidia-smi` (`vramSnapshotLine()`). `gpu_metrics.go`, `supervisor.go`.
- **B6** — Logs cleared on each Start + Copy-logs button. `supervisor.go`, `App.tsx`, `ServersTab.tsx`.
- **B7** — Modes from settings now show in the chat-window picker (`ChatTab` fetches `ListModes`). 
- **B8** — Modes editable on the Prompt Lab tab (`SaveMode(projectID, modeID, def, template)` writes project-local override; `LabTab` `ModesPanel` def form). `mode.go`, `LabTab.tsx`.
- **B10** — Tool modes inert: `App.ensureSession()` hard-coded the new session's mode as `chat`, so the first message in a project (the common path post-TD22, which starts session-less) always created a `chat` session no matter what the picker showed → `StartSessionStream` → no `tools[]`. Fix: `ensureSession(modeId?)` adopts the picker's mode; `ChatTab.send()` passes it. (Project-unbound chat still ignores the mode — see TD24.) `frontend/src/App.tsx`, `frontend/src/shell/MainPane.tsx`, `frontend/src/tabs/ChatTab.tsx`.

### Tech debt

- **TD5** — Duplicate window controls (native + custom). `Frameless: true` in `main.go`; the V5 `TitleBar` is now the OS drag region (`--wails-draggable: drag`, interactive children `no-drag`). Frameless on GTK also drops native edge-resize, so `shell/ResizeFrame.tsx` adds invisible edge/corner drag strips (Linux only — Windows/macOS keep native resize) that drive `WindowSetSize`/`WindowSetPosition`. Linux/webkit2_41 verified; Windows pending (see B9). Possible HiDPI-scaling caveat in the JS resize math — revisit if it feels off on a scaled display. `main.go`, `frontend/src/shell/TitleBar.tsx`, `frontend/src/shell/ResizeFrame.tsx`, `frontend/src/App.tsx`.
- **TD2** — Auto-reindex on file save. New `FileIndexer.ReindexFile(projectID, relPath)` re-syncs one file's chunks against disk (respects `[indexing]` globs; a deleted file gets its chunks removed; emits a `rag:index:progress:<projectID>` `done:true` event so `RagPanel` refreshes its stats). Hooked at `FileService.WriteFile` (`AttachIndexer` + `ReindexFileBG` — background, logged on error), so it covers every write path: editor save, agent `edit_file`, scripts. Per-file → cheap, no debounce. `indexer.go`, `file.go`, `app.go`.
- **TD8** — /search hit click scrolls to the chunk. `onOpenFilePath(path, range?)` now carries the hit's byte range; App passes it to ChatTab as a `revealRequest` (nonce so re-clicking re-fires). `EditorHandle.revealByteRange` converts byte→char (UTF-8 walk), `scrollIntoView({y:'center'})`, sets the selection, and flashes a `Decoration.mark` (`.cm-search-flash` fade, ~1.8s) cleared via timeout. ChatTab's reveal effect opens the preview pane + switches to the editor view + retries across frames until the editor handle exists. Preview-pane scroll-to-offset still deferred. `frontend/src/components/Editor.tsx`, `frontend/src/tabs/ChatTab.tsx`, `frontend/src/App.tsx`, `frontend/src/shell/MainPane.tsx`, `frontend/src/style.css`.
- **TD9** — Markdown in chat bubbles. Assistant text now renders sanitized HTML via the Go `RenderMarkdown` binding (`AssistantMarkdown` sub-component; plain-text fallback while the render is in flight / while streaming). `.chat-md` styles in `style.css` (tighter than `.md-preview`). User bubbles stay verbatim; tool-call chips still overlay. `frontend/src/tabs/ChatTab.tsx`, `frontend/src/style.css`.
- **TD10** — Reasoning / activity visualisation. `<think>…</think>` spans (Qwen3/R1) are pulled out by `splitThinking` (streaming-safe — handles partial open/close tags) and shown as a `ThinkingBlock` disclosure: auto-expanded with a dots loader while the model reasons, auto-collapses once the answer starts (user can pin it open). Empty live bubble shows a pulsing `<Loader type="dots">` instead of a static `…`. Tool-call chips (PR21) already cover the per-tool activity strip. `<think>` is left in the JSONL — re-parsed on reload. **Not done:** token-throughput pill in the bubble (t/s still only in the title bar) — pick up if wanted. `frontend/src/tabs/ChatTab.tsx`, `frontend/src/style.css`.
- **TD28** — `memory.md` (global + project) + agent tools `read_memory` / `append_memory`. Global file at `~/.config/llm-workbench/memory.md`, project file at `<project>/.llm-workshop/memory.md`. New `MemoryService` (paths, atomic append with `## <utc>` headers, empty-entry rejection); read returns `""` for missing files. Mode template context exposes `{{memory.global}}` / `{{memory.project}}`, seeded in `agent` / `auto-edit` system prompts (research stays read-only — only `read_memory` whitelisted). `append_memory` joins `writeTools`; approval modal pre-fills `Path = "memory.md (<scope>)"` + `NewContent = entry`. App bindings `ReadMemory` / `AppendMemory`. `memory.go`, `memory_test.go`, `paths.go`, `mode.go` (AttachMemory + buildTemplateContext), `agent.go` (tools + AgentContext.Memory), `agent_loop.go` (approval prefill), `approval.go`, `app.go`, `modes/*.toml` + `*.system.md`, `frontend/src/tabs/ChatTab.tsx` (chip icon + summary).
- **TD29** — Session log RAG. `chunks` table gains `source TEXT NOT NULL DEFAULT 'content'` (schema_version 2 with idempotent `ALTER TABLE ADD COLUMN` for v1 indexes); existing rows stay tagged `content`. `FileIndexer.Reindex` now also walks `<project>/.llm-workshop/sessions/*.jsonl`, flattens transcripts (drops system + tool turns, joins `[role] content` blocks), and upserts chunks with `source="history"` and `path="sessions/<id>.jsonl"`. Same `walked` set feeds `gcMissingPaths` so deleted sessions are cleaned up. `RAGService.Search` grows a `Kinds []string` option that defaults to `["content"]`; `allowedSourceIDs` builds the allow-set in one query and `filterRanks` post-filters dense + sparse ranker outputs (keeps original RRF positions). `search_semantic` tool schema exposes `kinds` (enum `content` / `history`). `index.go`, `indexer.go`, `rag.go`, `agent.go`, `agent_loop_test.go` (builtin count bumped to 7).
- **TD30** — Docs: `docs/prompt-variables.md` reference listing every `{{...}}` substitution available in mode templates (`project.*`, `param.<name>`, `memory.global`, `memory.project`) with an example and a note on how to add new ones.
- **TD23** — Global app settings persisted to `~/.config/llm-workbench/settings.toml`: theme (stub — dark only in v1), startup mode (blank chat vs. reopen-last), auto-refresh registry on launch (default on), auto-install default artifacts on every launch (default off — explicit install state preferred), telemetry opt-in (placeholder for DESIGN §10.5). `AppSettings` + `SettingsService` (paths helper, atomic save, defaults-on-missing-file, schema-merge for new fields landing in older files). App startup gates registry refresh + auto-install behind the toggles. UI: Settings → General tab with eager-save form (every toggle flushes to disk). `settings.go` + tests, `paths.go` (`settingsPath`), `app.go` (bindings + startup wiring), `frontend/src/components/{SettingsModal,GeneralSettingsPanel}.tsx`.
- **TD19 / TD33** — External registry for modes + families. `RegistryService` manages subscribed sources in `~/.config/llm-workbench/registry/sources.toml`, caches per-source `index.json` files, tracks installed artifacts in `installed.toml`. Schema covers `type` (mode|family), `version`, optional aggregate sha256, files list. Install verifies sha + atomic-writes into the per-type dest; uninstall is idempotent. Curated repo at `github.com/Dominga/llm-workbench-registry` with `scripts/build_index.py` + GitHub Action that rebuilds `index.json` on every push. App seeds the default source on first launch. Settings → Registry UI (sources strip, browse pane with type/tag/query filter + preview, installed pane with update-available badges + uninstall). `registry.go`, `paths.go`, `app.go`, `frontend/src/components/{SettingsModal,RegistryPanel}.tsx`, `frontend/src/shell/TitleBar.tsx`, `docs/registry-format.md`, registry repo skeleton.
- **TD27** — Chat debug mode. `ChatService.StartStream` / `StartSessionStream` take a `debug bool`; when on, plain `runStream` and both agent loops emit per-iteration `chat:debug:request:<id>` (baseURL + full body sent to llama-server, including `tools[]` schema for native mode) and `chat:debug:raw:<id>` (raw model content + finishReason + parsed tool_calls) before any frontend post-processing (splitThinking / sanitize / markdown). Events are gated by the flag so non-debug streams stay quiet. Frontend: UI-local `debug` toggle pill in the chat header (sticks for tab lifetime, not persisted), wired through `ChatStream` / `SessionChatStream`. Per-message `DebugPanel` with one collapsible block per agent-loop iteration, request/raw subsections each independently togglable. Payloads ephemeral — not persisted to JSONL. `chat.go`, `agent_loop.go`, `app.go`, `frontend/src/tabs/ChatTab.tsx`.
- **TD31 / TD32** — Model family metadata + family-aware mode prompts. `Family` records (id, chat-template hint, reasoning token, sampling defaults) live in `~/.config/llm-workbench/families/`; bundled seed for qwen3 / gemma3 / gemma4 / llama3 / deepseek-r1 / mistral. Profile gains `family` + `family_version`; GGUF mini-parser drives a one-click Detect button; Servers tab groups profiles by family. ModeService template resolver tries `<id>.<family>.<version>.system.md` → `<id>.<family>.system.md` → `<id>.system.md` so authors can ship family-tuned prompts without TOML changes. Mode TOML carries advisory `recommended_for = [...]`; ChatTab picker renders a soft "!" warning when active family isn't covered. `family.go`, `family_seed.go`, `families/*.toml`, `gguf.go`, `profile.go`, `mode.go`, `agent.go`, `chat.go`, `frontend/src/components/ProfileForm.tsx`, `frontend/src/tabs/ServersTab.tsx`, `frontend/src/tabs/ChatTab.tsx`, `docs/prompt-variables.md`.
- **TD25** — Global modes alongside project overrides. `SaveMode(scope, projectID, modeID, def, template)` — `scope="global"` routes to `<globalModesDir>/`, `scope="project"` (default) to `<project>/.llm-workshop/modes/`. New `App.RemoveProjectModeOverride(projectID, modeID)` deletes the project-local `.toml` + `.system.md` so the resolver falls back to global/builtin. Refactored `saveProjectModeFile` to thin wrapper over shared `saveModeFileToDir`. ModesPanel: "Save to: project / global" select (defaults to current mode's source — global for builtin/global, project for project overrides); "project override" badge in the toolbar when `selected.source==="project"`; "remove override" button next to Save (with a fallback-aware confirm dialog). Resolver precedence + global seeding already shipped earlier — TD25 just adds the write path + UI. `mode.go` (saveGlobalModeFile / removeProjectModeOverride / saveModeFileToDir refactor), `app.go` (binding scope param + RemoveProjectModeOverride), `mode_save_test.go` (`TestSaveGlobalModeFile`, `TestRemoveProjectModeOverride`), `frontend/src/tabs/LabTab.tsx` (scope state + badge + remove button), regenerated `frontend/wailsjs/go/main/App.*`.
- **TD26** — Agent tool `make_directory` (mkdir -p semantics, sandbox via `FileService.resolveSafe`, refuses project state dir). Registered in `RegisterBuiltinTools`; added to `agent` + `auto-edit` mode whitelists; gated by approval as a write tool (modal shows "Create directory: <path>" instead of a diff). Existing dir = no-op (`created: false`). `file.go` (`MakeDirectory`), `agent.go` (`makeDirectoryTool`), `approval.go` (`writeTools`), `agent_loop.go` (pre-fill `Path`), `modes/agent.toml` + `agent.system.md` + `auto-edit.toml` + `auto-edit.system.md`, `frontend/src/tabs/ChatTab.tsx` (chip icon + summary), `frontend/src/components/ApprovalModal.tsx` (path-only branch).
- **TD22** — Start on a blank, project-unbound chat. `App.tsx` no longer auto-restores the last project on startup (`reloadProjects` refreshes only the Recent list); the backend still persists `active_project_id` for a future "reopen last" toggle (TD23). Project-less chat already worked via `ChatStream` (ephemeral, non-persisted) — fixed `ChatTab`'s hydrate effect so a stream-done re-run doesn't wipe it (`prevSessionIdRef`/`prevProjectIdRef`: only reset `messages` on session-leave or project-switch). Empty-state + header copy updated. Open sub-question (promote an ephemeral chat into a project session vs. start fresh): current behaviour clears the ephemeral transcript when a project is opened. Agent modes still need a project — picking one without a project will surface a tool error; acceptable for v1. `frontend/src/App.tsx`, `frontend/src/tabs/ChatTab.tsx`.
- **TD6** — Resizable chat ↔ file split + collapsible chat side. `ChatTab` got a drag-resize divider (double-click = hide chat), a "collapse chat" button in the chat header (shown when a file is open), a collapsed-chat rail mirroring the preview rail to restore it, and `{filePaneWidth, chatOpen, panelOpen}` persisted per project in `localStorage` (`llmwb:chatLayout:<projectId>`). `frontend/src/tabs/ChatTab.tsx`.
- **TD16** — Mode `system_prompt_template` (path + placeholders) — done in PR25.
- **TD17** — Prompt Lab as the mode-template editor — done in PR27.
