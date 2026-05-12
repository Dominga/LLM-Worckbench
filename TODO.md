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

### App lifecycle / settings

#### TD23 — Global app settings (behaviour config)

A general application-settings surface (the Settings gear in the TitleBar is a
stub) where app-wide behaviour is configured — e.g. the TD22 startup choice
(blank chat vs. reopen last project), default mode, theme, telemetry opt-in
(DESIGN §10.5), etc. Persist to `~/.config/llm-workbench/settings.toml`. Once it
exists, TD22's "blank on startup" becomes a default that the user can flip.

**Files:** new `settings.go` (`AppSettings` + load/save, mirrors `ProfileManager`
shape), `paths.go` (`settingsPath()`), app bindings, a `SettingsModal` /
`SettingsTab` on the frontend.

### Chat / UI

#### TD7 — Inline file autocomplete when chat is hidden (future, low priority)

Once TD6 lands and the chat side can be hidden, give the file editor a
Copilot-style inline completion bound to the active chat profile
(`/v1/completions` with the FIM prompt format the model supports). Unobtrusive —
debounced, dismissable with Esc, accepted with Tab. Wait for the M3 agent loop
prompt-routing pipeline to settle first.

#### TD8 — /search hit click should scroll to the chunk

Clicking a hit opens the file via `onOpenFilePath` but lands at the top. The hit
carries `startByte`/`endByte` already; thread them down to the editor.

- Extend `onOpenFilePath` (or add `onOpenFileAt(path, startByte, endByte)`) to
  carry byte offsets.
- In `Editor` (CM6), convert byte offset → char position (UTF-8 walk), dispatch
  `EditorView.scrollIntoView(EditorSelection.range(start, end))` after content
  load. Optional fading `Decoration.mark` highlight (~2 s).
- Preview pane: anchor scroll to the corresponding offset in rendered HTML — more
  involved, can be deferred.

**Files:** `frontend/src/components/Editor.tsx`, `frontend/src/tabs/ChatTab.tsx`
(hit click handler), `frontend/src/App.tsx` (`onOpenFilePath` signature).

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

### RAG

#### TD2 — Auto-reindex on file save

Reindex is manual via the `RagPanel` button. Hook the project polling tick or the
`WriteProjectFile` flow to debounce-trigger a per-file reindex on change. Enough
to call `FileIndexer.Reindex` with a path filter once that exists, or a full
reindex with a 5 s debounce.

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

#### TD19 — External modes registry + per-mode install

A remote repository of modes users browse and install individually, apt-package
style (`install <mode>`, update/remove per mode; central or community-hosted
index). Implications: stable mode IDs, versioning, a manifest format → keep in
mind when finalising on-disk mode storage so it stays registry-friendly. Out of
scope until M4 modes are solid.

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

### Tech debt

- **TD5** — Duplicate window controls (native + custom). `Frameless: true` in `main.go`; the V5 `TitleBar` is now the OS drag region (`--wails-draggable: drag`, interactive children `no-drag`). Frameless on GTK also drops native edge-resize, so `shell/ResizeFrame.tsx` adds invisible edge/corner drag strips (Linux only — Windows/macOS keep native resize) that drive `WindowSetSize`/`WindowSetPosition`. Linux/webkit2_41 verified; Windows pending (see B9). Possible HiDPI-scaling caveat in the JS resize math — revisit if it feels off on a scaled display. `main.go`, `frontend/src/shell/TitleBar.tsx`, `frontend/src/shell/ResizeFrame.tsx`, `frontend/src/App.tsx`.
- **TD9** — Markdown in chat bubbles. Assistant text now renders sanitized HTML via the Go `RenderMarkdown` binding (`AssistantMarkdown` sub-component; plain-text fallback while the render is in flight / while streaming). `.chat-md` styles in `style.css` (tighter than `.md-preview`). User bubbles stay verbatim; tool-call chips still overlay. `frontend/src/tabs/ChatTab.tsx`, `frontend/src/style.css`.
- **TD10** — Reasoning / activity visualisation. `<think>…</think>` spans (Qwen3/R1) are pulled out by `splitThinking` (streaming-safe — handles partial open/close tags) and shown as a `ThinkingBlock` disclosure: auto-expanded with a dots loader while the model reasons, auto-collapses once the answer starts (user can pin it open). Empty live bubble shows a pulsing `<Loader type="dots">` instead of a static `…`. Tool-call chips (PR21) already cover the per-tool activity strip. `<think>` is left in the JSONL — re-parsed on reload. **Not done:** token-throughput pill in the bubble (t/s still only in the title bar) — pick up if wanted. `frontend/src/tabs/ChatTab.tsx`, `frontend/src/style.css`.
- **TD22** — Start on a blank, project-unbound chat. `App.tsx` no longer auto-restores the last project on startup (`reloadProjects` refreshes only the Recent list); the backend still persists `active_project_id` for a future "reopen last" toggle (TD23). Project-less chat already worked via `ChatStream` (ephemeral, non-persisted) — fixed `ChatTab`'s hydrate effect so a stream-done re-run doesn't wipe it (`prevSessionIdRef`/`prevProjectIdRef`: only reset `messages` on session-leave or project-switch). Empty-state + header copy updated. Open sub-question (promote an ephemeral chat into a project session vs. start fresh): current behaviour clears the ephemeral transcript when a project is opened. Agent modes still need a project — picking one without a project will surface a tool error; acceptable for v1. `frontend/src/App.tsx`, `frontend/src/tabs/ChatTab.tsx`.
- **TD6** — Resizable chat ↔ file split + collapsible chat side. `ChatTab` got a drag-resize divider (double-click = hide chat), a "collapse chat" button in the chat header (shown when a file is open), a collapsed-chat rail mirroring the preview rail to restore it, and `{filePaneWidth, chatOpen, panelOpen}` persisted per project in `localStorage` (`llmwb:chatLayout:<projectId>`). `frontend/src/tabs/ChatTab.tsx`.
- **TD16** — Mode `system_prompt_template` (path + placeholders) — done in PR25.
- **TD17** — Prompt Lab as the mode-template editor — done in PR27.
