# TODO — backlog

M1 closed (PR1–PR8 merged). Planning history: see git log + `DESIGN.md`.

Bugs / improvements on top of M1, before M2 (RAG) starts.

## Bugs

### B1 — Port uniqueness: enforce at runtime, not in the profile form ✓ done

**Was:** `profile.go` (`CreateProfile`/`UpdateProfile`) rejected saving a profile if another profile already used the same `port`. Two profiles with the same port could not be created at all.

**Should be:** port collision is a runtime concern (only one process can listen on a port), but statically two profiles sharing a port are valid. Use case: two variants of the same server (different models/args), launched one at a time.

**Fix:**
- `profile.go` — drop port-uniqueness check from `CreateProfile`/`UpdateProfile`. Keep the `1..65535` range check.
- `supervisor.go` `StartProfile(id)` — before `cmd.Start()`, iterate `instances` and find any running one with the same `Port`. If found → return `port %d already in use by profile %q (running)`. Optionally probe `net.Listen` on `host:port` for external occupants.
- Frontend: surface Start errors via Mantine `notifications.show`, no silent failures.

**Files:** `profile.go`, `supervisor.go` (Start path), `ProfileForm.tsx`.

### B2 — Copy/paste `extra_args` between profiles ✓ done

**Was:** the `LLAMA_EXTRA_ARGS` value in the profile form was awkward to copy/paste manually (Mantine `TagsInput` stores a string array).

**Should be:** in the profile editor, a "Copy" button next to extra_args puts the joined string on the clipboard; a "Paste" button parses a whitespace-split string back into the array.

**Fix:**
- Add `ActionIcon` with `IconCopy` → `navigator.clipboard.writeText(args.join(' '))`.
- Add `ActionIcon` with `IconClipboard` → read clipboard, split on whitespace, set value.
- Toast on success ("Copied" / "Pasted N args").

**Files:** `frontend/src/components/ProfileForm.tsx`.

### B3 — Legacy `.env` autostart ignored the profile flag ✓ done

**Was:** `app.go` started the default chat profile based on `cfg.Autostart` (from `.env`, defaulting to `LLAMA_AUTOSTART=true`), ignoring `Profile.Autostart`. Unchecking the autostart toggle in the UI had no effect.

**Fix:** removed the legacy block in `app.go:73-81`. Per-profile `AutostartAll()` is now the single source of truth.

### B4 — Server-stop wrongly flagged as `crashed` ✓ done

**Was:** `cmd.Wait()` after `Stop()` returned a signal error (SIGTERM), so the status pill flipped to `crashed` and `CrashBanner` appeared on a clean user-requested stop.

**Fix:** added `stopRequested` flag on `ServerInstance`. `Stop()` sets it before SIGTERM; the Wait goroutine maps the signal-induced exit to `StateStopped` when the flag is set. Reset on next `Start()`.

**Files:** `supervisor.go`.

### B5 — Pre-start VRAM snapshot in log ✓ done

**Was:** `--fit` non-determinism (WSL2 + WDDM scheduler causing free-VRAM jitter) made it hard to compare app-launch vs terminal-launch baselines when CUDA OOM showed up at mmproj-warmup.

**Fix:** `vramSnapshotLine()` in `gpu_metrics.go` runs uncached `nvidia-smi`, supervisor logs `pre-start VRAM: GPU0 used=… free=… total=…` right after the per-Start log-ring reset.

**Files:** `gpu_metrics.go`, `supervisor.go`.

### B6 — Logs cleared on each Start + Copy-logs button ✓ done

**Was:** server logs from previous runs accumulated in the ring; users had to manually scroll/scrub.

**Fix:** `ServerInstance.Start()` resets `logRing` and emits `llama:log:cleared:<profileID>`. Frontend resets its per-profile log buffer on that event. Added a `copy` button in the logs/config/metrics tabs row that copies the full log ring to clipboard via `navigator.clipboard.writeText`.

**Files:** `supervisor.go`, `frontend/src/App.tsx`, `frontend/src/tabs/ServersTab.tsx`.

### B7 — Modes from settings don't show in the chat window ✓ done

**Was:** the in-chat `ModePicker` (`ChatTab.tsx`) rendered from the static
`MODES` const, which after the M4 builtin-trim holds only `chat` — so global
(`~/.config/llm-workbench/modes/*.toml`) and project-local modes never appeared
in the session mode switcher. (`NewSessionModal` already fetched `ListModes`;
`ModeService.List` already merged builtin+global+project — only the chat-window
picker was stuck on the static list.)

**Fix:** `ChatTab` fetches `ListModes(activeProject?.ID ?? '')` into state
(static `MODES` as the bootstrap fallback), resolves the active session's mode
from that list, and passes it to `ModePicker` (now `modes`-driven).
`Sidebar`'s per-session mode dot still uses `MODE_BY_ID` and will show the
`chat` colour for non-builtin modes — minor cosmetic nit, follow-up.

### B8 — Modes are read-only on the Prompts (Prompt Lab) tab ✓ done

**Was:** the Prompt-Lab mode editor only edited the *system-prompt template*
(and `SaveModeTemplate` errored for the builtin `chat`, which has no template).
The mode *definition* (tools / approval / params / name / color / context)
couldn't be touched from the UI.

**Fix (backend):** `saveProjectModeFile(projectRoot, modeID, def Mode, template)`
in `mode.go` writes a project-local override — `<project>/.llm-workshop/modes/
<id>.toml` (the definition, via a dedicated `modeFileDoc`/`modeParamDoc` shape
so `omitempty` handles nil param defaults; `tool_whitelist` kept non-omitempty
so an empty list survives as "no tools") plus `<id>.system.md` (the template);
the template path is normalised to `<id>.system.md` and any inline
`system_prompt` dropped. Promotes builtin/global modes into a project-owned copy.
`modeIDRe` blocks path traversal. App binding `SaveMode(projectID, modeID, def,
template)`. Tests: round-trip through `loadModesDir` (metadata/params/whitelist
preserved, int default comes back as int64, inline prompt dropped); overwrite;
empty-whitelist survives; bad IDs (`""`, `../evil`, `a/b`, `with space`,
`.hidden`) rejected.

**Fix (frontend, `LabTab.tsx` `ModesPanel`):** the editor column is now split —
top: the CM6 markdown prompt editor with `{{…}}` placeholder highlighting (a
`ViewPlugin` + `EditorView.theme` decoration); bottom: a Mantine form for the
mode definition (name, color `ColorInput`, description, approval/context
`Select`s, tool-whitelist `TagsInput` seeded with the known tool names, and a
param repeater — name / type / default / required / remove). One Save calls
`SaveMode` with the def + template; backend validation errors (e.g.
`approval=auto` + `edit_file`) surface as a toast. Right rail (param-value form
+ live preview) unchanged.

Note: a `{{user_input}}`-style substitution isn't added — the system prompt is
built before the user's turn, so there's nothing to substitute; the `{{…}}`
highlighting covers `{{param.*}}` / `{{project.*}}` either way.

**Follow-up fix (prompt editor showed empty for global modes):** `ModeService.
TemplatePath` had a "return the project-local candidate even if it doesn't
exist" early-return — so for a *global* mode (template lives in
`~/.config/llm-workbench/modes/`) it resolved to a non-existent
`<project>/.llm-workshop/modes/<x>.system.md`, and `LoadModeTemplate` then
returned an empty string (the preview was fine because `ResolveSystemPrompt` →
`loadTemplate` does project-*then-global*-then-error). Fixed: `TemplatePath`
only returns a candidate that exists, falling through project → global →
absolute. `LoadModeTemplate` on a still-unresolved template now returns an empty
buffer (so the editor lets you create it) instead of erroring. The Prompt-Lab
load effect also pushes the loaded text straight into the CM6 view, and the
`{{…}}` decoration builder is wrapped so it can't break view construction.

## Milestone 4 — Scripting + Prompt Lab

DESIGN.md §5.5 + §9 M4. Decisions:

- **JS runtime:** goja (pure-Go ES5.1+).
- **Initial scope:** runtime + global API, Prompt Lab UI, script storage. Workflows
  and external Python tools deferred to TDs.
- **Permissions:** full project access — same surface as M3 tools.

### PRs

- [x] **PR22** — `scripting.go` with `ScriptingService.Run(ctx, projectID, source)`.
      goja runtime per call; project-scoped `app` global wired with:
      `app.log(...)`, `app.fs.{read,write,list}`, `app.rag.search(query, opts)`,
      `app.chat.complete({messages, profileId?, temperature?})`, and
      `app.project.{id,name,path}`. Output lines collected for the UI; final
      expression value exported as `Return`. Cooperative ctx cancellation via
      `runtime.Interrupt`. `ChatService.complete` non-streaming helper added so
      scripts can call the LLM synchronously. App binding `RunScript(projectID,
      source) ScriptResult`. Tests cover log capture, fs read/write/list, RAG
      sparse search, error surfacing, return-value export, project global,
      path-traversal containment.
- [x] **PR23** — `scripts_store.go` `ScriptStore` manages
      `<project>/.llm-workshop/scripts/<name>.js`. Bindings:
      `ListScripts`, `LoadScript`, `SaveScript`, `DeleteScript`. Save is atomic
      (tmp+rename); name validation enforces `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`
      so traversal/space/slash names are rejected. List sorts by name, skips
      non-`.js` siblings. Tests: save+load roundtrip, sorted list, delete (and
      no-op on missing), overwrite, name-validation matrix (rejects `""`,
      `../escape`, `with space`, `weird/slash`, `dot..`; accepts snake_case,
      kebab-case, Mixed.123), list ignoring `notes.txt`.
- [x] **PR24** — Prompt Lab tab enabled. `LabTab.tsx` lays out a 200px scripts
      rail (list + New + Reload + per-row Delete) plus an editor pane
      (CodeMirror 6 + `@codemirror/lang-javascript` + oneDark) and a 240px
      output panel below it. Toolbar: name input, dirty `●` indicator, Save,
      Run. Keyboard: `Ctrl/⌘+Enter` runs, `Ctrl/⌘+S` saves. Output panel
      renders error (red), each `app.log(...)` line, and the final
      expression's `Return` as JSON. STARTER_SCRIPT showcases the `app` API
      surface so new users land on a working example. Tab toggle in
      `TitleBar` flipped to `enabled: true`.

- [x] **PR25** — Mode prompt templates (DESIGN §4.6 alignment). `Mode` gains
      `SystemPromptTemplate string` (relative path or absolute) and
      `Params []ModeParam` (name/type/default/required/description). New
      `ModeService.ResolveSystemPrompt(projectID, mode, params)` loads the
      template file (looks up project-local → global → absolute), renders
      `{{project.id|name|path}}` and `{{param.<name>}}` placeholders via a
      regex substitutor (unknown keys stay literal so typos surface).
      Inline `SystemPrompt` remains as a fallback. New global modes dir
      `~/.config/llm-workbench/modes/*.toml` with precedence
      `project > global > builtin`. `AgentContext.Params` carries
      session-bound values; agent loop (`resolveSystemPromptFor`) routes
      every system-message build through the service so live edits to a
      template file land on the next turn. Tests: placeholder render with
      unknown-key passthrough, template load + project params, inline
      fallback, missing-template error, global vs project precedence.

### Deferred to follow-ups

- [x] **PR26** — Session-bound mode params. `Session.Params map[string]any`
      added (carried through `sessionHeader` JSONL line 1 + `readMeta` →
      `Session.Params`). `SessionService.CreateWithParams(...)` writes them;
      `Create(...)` stays as the legacy no-params wrapper. App binding
      `CreateSessionWithParams`. `ChatService` plugs `sess.Params` into
      `AgentContext.Params` right before the agent loop dispatch, so the
      prompt template's `{{param.<name>}}` resolves to the user's input.
      Frontend: `NewSessionModal` fetches `ListModes(projectID)` on open
      (merged builtin+global+project), reads the selected mode's
      `params[]`, renders a dynamic form (`string|int|number|bool` → text /
      number / switch). Submit validates required fields and calls
      `CreateSessionWithParams`. Frontend `Mode` type extended with
      `params?` + `systemPromptTemplate?`.
- [x] **PR27** — Prompt Lab as the mode-template editor. LabTab gets a
      `Modes`/`Scripts` segmented toggle. New `ModesPanel`: mode list (source
      chip per row: builtin/global/project) → CM6 markdown editor for the
      template → right rail with params form (driven by `mode.params`) and a
      live debounced (200ms) preview. Edits to a builtin/global mode's
      template land in the project-local dir so the user owns the override.
      Backend bindings: `LoadModeTemplate(projectID, modeID)`,
      `SaveModeTemplate(projectID, modeID, content)`,
      `PreviewModeTemplate(projectID, modeID, source, params)`. New
      `ModeService.RenderWithSource` lets the preview render an unsaved
      buffer; `ModeService.TemplatePath` resolves on-disk path
      (project-local → global → absolute) so SaveModeTemplate has a
      well-defined destination. The Scripts segment keeps the PR24 JS Lab
      unchanged.
- TD12 — JSDoc `@param` → auto-generated parameter form on the Lab tab.
- TD13 — Workflow TOML triggers + steps (`[workflow.foo]`).
- TD14 — External Python sidecar tools (`[external_tool.*]`).
- TD15 — Script API versioning (`requireApi("1.0")`).
- TD18 — Scripts global/per-project split (mirror modes: `~/.config/llm-workbench/scripts/`
  alongside per-project `<project>/.llm-workshop/scripts/`, project overrides
  global by name). Once landed, list-merge in `ScriptStore`.
- TD19 — External modes registry + per-mode install. Think about a remote
  repository of modes that users browse and install individually,
  apt-package style (`install <mode>`, update/remove per mode; central or
  community-hosted index). Implications: stable mode IDs, versioning, a
  manifest format → keep in mind when finalising on-disk mode storage so it's
  registry-friendly. Out of scope until M4 modes are solid.

## Milestone 5 — Builds & forks

DESIGN.md §4.1–4.2 + §5.1 (FR-LLM-1..3) + §9 M5. Decisions:

- **UI placement:** builds live on the **Servers tab** alongside profiles —
  the user manages llama.cpp compilation there (point at an existing source
  checkout, or a folder + a git remote to clone into it, plus cmake flags),
  then profiles reference the produced `Build` by id.
- **Source location:** user-supplied. `BuildRecipe.source_dir` is the local
  checkout; optional `source_repo` + `git_ref` drive a clone/fetch+checkout
  before building. The cmake build output (`<source_dir>/<build_dir>/bin/llama-server`)
  is the artifact path — no extra copy/stage step in v1.
- **Model split:** `BuildRecipe` (the *how* — source dir/repo/ref + cmake
  flags) is editable & long-lived; `Build` (the *artifact* — resolved commit,
  binary path, backend, built_at) is produced by the orchestrator and is
  effectively immutable (a rebuild from the same recipe replaces it in place).
- **Storage:** single `~/.config/llm-workbench/builds.toml` holding both
  `[[recipe]]` and `[[build]]` arrays, managed by `BuildManager` (mirrors
  `ProfileManager`: atomic tmp+rename save, RWMutex, CRUD).

### PRs

- [x] **PR28** — `build.go`: `BuildBackend` enum (cpu/cuda11/cuda12/rocm/
      vulkan/metal), `BuildRecipe` (id, display_name, source_dir, source_repo?,
      git_ref?, backend?, cmake_flags[], build_dir=`build`, jobs) and `Build`
      (id, recipe_id, source_repo?, commit?, backend?, binary_path,
      capabilities[], built_at) structs with `Validate()`. `BuildManager`
      loads/saves `builds.toml`; recipe CRUD (`ListRecipes/GetRecipe/
      CreateRecipe/UpdateRecipe/DeleteRecipe` — gen-id-if-blank, dedupe,
      preserve CreatedAt, atomic save+rollback) and build CRUD
      (`ListBuilds/GetBuild/AddBuild` (replace-on-same-id, for the
      orchestrator)/`DeleteBuild`). `buildsPath()` in `paths.go`. Wired into
      `App` (`a.builds`, non-fatal on load failure) + bindings
      `ListBuildRecipes/GetBuildRecipe/CreateBuildRecipe/UpdateBuildRecipe/
      DeleteBuildRecipe/ListBuilds/GetBuild/DeleteBuild`. Tests: backend
      validity, recipe/build validate matrices, BuildDirOrDefault, recipe CRUD
      (sorted list, dup reject, update preserves/bumps timestamps, delete
      no-op), build CRUD (gen-id, replace-on-same-id, delete no-op),
      persistence roundtrip (recipes + builds in one file).
- [x] **PR29** — `gpu_detect.go`: `GPUVendor` enum (nvidia/amd/intel/apple),
      `DetectedGPU` (vendor, name, vramMib, source-probe, suggested backend —
      kept separate from `GPUInfo` in `gpu_metrics.go`, which is live VRAM
      telemetry), `GPUDetection` (gpus[], probed-tools[], available).
      `DetectGPU()` runs whichever of `nvidia-smi` / `rocminfo` / `vulkaninfo`
      / `system_profiler` are on PATH (4 s timeout each), parses each, and
      dedups by (vendor, name) — probe order doubles as dedup priority so a
      card seen by the vendor tool beats the generic Vulkan probe. Per-probe
      parsers are pure string→[]DetectedGPU funcs (`parseNvidiaSmiNames` CSV,
      `parseRocminfo` agent-block state machine filtering Device Type=GPU,
      `parseVulkaninfoSummary` GPUn: blocks skipping llvmpipe/CPU,
      `parseSystemProfilerDisplays` Chipset Model lines → Metal). Vendor
      inference from PCI id (`vendorFromPCIID`) + marketing-name heuristics
      (`inferVendorFromName`). `SuggestRecipes(GPUDetection)` → always a
      `cpu` recipe + one per distinct GPU backend, cmake flags pre-filled
      (`-DGGML_CUDA=ON -DGGML_CUDA_FA_ALL_QUANTS=ON`, `-DGGML_HIP=ON`,
      `-DGGML_VULKAN=ON`, none for Metal/CPU), `SourceDir` left empty for the
      user; not persisted. App bindings `DetectGPU()`, `SuggestBuildRecipes()`.
      Tests: each parser on a realistic sample (incl. CPU-agent / llvmpipe
      filtering, vendorID-missing → name fallback), vendor inference tables,
      `dedupGPUs` keeps the cuda entry over the vulkan one, `SuggestRecipes`
      empty→cpu-only / nvidia→cpu+cuda / nvidia+amd→cpu+cuda+rocm in order /
      two-nvidia→still one cuda recipe.
- [x] **PR30** — `build_orchestrator.go`: `BuildOrchestrator` (bound to
      `BuildManager`, one in-flight build per recipe, mutex never held across
      a subprocess wait). `Start(recipeID)` validates synchronously (unknown
      recipe / missing source_dir with no source_repo / already running) then
      runs in the background; `Cancel(recipeID)`, `Status(recipeID)
      BuildStatus`, `Log(recipeID) []string`. Phases streamed as
      `build:status:<recipeID>` (`idle→cloning|fetching→configuring→compiling→
      done|failed|cancelled`, with `Running`/`Message`/`BuildID`) + every
      line on `build:log:<recipeID>` (log capped at 30k lines). Steps: (1)
      if `source_repo` set & `source_dir` empty/absent → `git clone <repo>
      <dir>`; else `git fetch --all --tags`; then if `git_ref` → `git checkout
      <ref>`; (2) `git rev-parse HEAD` → resolved commit (best-effort);
      (3) `cmake -S <src> -B <buildDir> <cmake_flags...>`; (4) `cmake --build
      <buildDir> --config Release -j[N]`; (5) `locateLlamaServer` checks
      `bin/`, `bin/Release/`, root, then a tree walk; (6) persist the log to
      `<buildDir>/llm-workbench-build.log` and `BuildManager.AddBuild` (build
      ID = recipe ID, so a rebuild replaces in place). Each child runs in its
      own process group (`procGroupAttr`: `Setpgid` + Linux `Pdeathsig`); a
      per-command watchdog SIGTERMs the group on ctx cancel, SIGKILL after 5s
      (mirrors `LlamaSupervisor.Stop`). Pipes drained before `cmd.Wait`. App
      bindings `StartBuild/CancelBuild/GetBuildStatus/GetBuildLog`; orchestrator
      built in `startup` only when `BuildManager` loaded. Tests use fake
      `git`/`cmake` shell shims on PATH (skip on non-POSIX): existing-source
      build → Done + Build registered with resolved commit & located binary on
      disk + rebuild replaces (no dup); clone path → `.git` created + checkout
      logged; missing source + no repo → `Start` errors; cancel mid-compile
      (4s sleep in fake `--build`) → Cancelled + no Build registered + can
      restart; second `Start` while running → errors.
- [x] **PR31** — `Profile.BuildID` field (`build_id,omitempty`); `BinPath`
      now `bin_path,omitempty`. `Profile.Validate()` requires at least one of
      `build_id` / `bin_path` (both is tolerated for hand-edited TOML; the UI
      keeps them mutually exclusive — picking a build clears the manual path).
      `ServerInstance` gains a `*BuildManager` ref and a `binPath()` resolver:
      `build_id` set → `BuildManager.GetBuild(id).BinaryPath` *and* an
      `os.Stat` so a deleted/unfinished build fails loudly instead of exec'ing
      a missing file; otherwise the manual `BinPath`. `Start()` resolves via
      `binPath()` before spawning; the started-pid log line shows the resolved
      path. `NewServerRegistry(pm, builds)` / `newServerInstance(p, ctx, builds)`
      thread the manager through; `app.go` passes `a.builds` (may be nil →
      `binPath()` errors only if a profile actually references a build).
      `ProfileForm.tsx`: a "Build" `Select` (fetched via `ListBuilds()` on
      open) with a `— manual binary path —` option; choosing a build hides the
      manual path field and shows the resolved `BinaryPath` (or a "not found —
      rebuild it" hint); `toProfile` sends `BinPath=""` when a build is
      picked. Tests: `Profile.Validate` bin-source matrix (bin only / build
      only / both ok / neither rejected); `binPath()` — manual path; build_id
      with nil registry → error; build_id → resolved existing binary;
      unknown build id → error; build whose binary file is gone → error.
- [x] **PR32** — `frontend/src/components/BuildsPanel.tsx`, mounted at the
      bottom of `ServersTab.tsx` (collapsible `Card`, default collapsed; no
      new tab). On expand: `ListBuildRecipes` + `ListBuilds` + `DetectGPU`,
      and `EventsOn('build:status:<id>' / 'build:log:<id>')` for every recipe
      (re-subscribed on recipe-set change; cleaned up on collapse/unmount).
      Sections: (1) "Detected accelerators" card — `DetectedGPU` rows
      (backend badge, name, VRAM GB, `via <probe>`) + a re-probe button; (2)
      recipes list — per recipe a card with display name / backend badge /
      live phase badge, `source_dir` (+ `← repo @ref` when set), cmake flags,
      and actions: Build (`StartBuild`, sync error → toast) or Cancel
      (`CancelBuild`) while running, a log toggle (`build:log` lines streamed
      into a bottom-anchored `ScrollArea`, falls back to `GetBuildLog`), Edit,
      Delete; (3) "Built binaries" — `ListBuilds` rows (display name, backend,
      short commit, path, "forget" delete). `RecipeEditor` modal (create /
      edit): ID (locked on edit), display name, source dir (`PickDirectory`),
      git remote + ref, backend `Select`, build subdir, parallel jobs, cmake
      flags `TagsInput` with copy/paste-as-space-string buttons, plus a
      "prefill from a detected-hardware suggestion" `Select` (from
      `SuggestBuildRecipes()` — fills backend + flags, leaves source dir to
      the user); submit → `CreateBuildRecipe` / `UpdateBuildRecipe`. Toasts on
      build done / failed / cancelled.

- [x] **PR33** — Source-dir introspection in the recipe editor.
      `source_inspect.go`: `InspectSourceDir(dir) SourceDirInfo` (path /
      exists / isGitRepo / gitRemote / configuredBuildDir / cmakeFlags /
      backend). Git remote: parse `<dir>/.git/config` directly (no `git`
      dependency), following a worktree-style `.git` *file*'s `gitdir:`
      pointer; prefer `origin`, else first remote with a URL. CMake flags:
      probe `<dir>/build*/CMakeCache.txt`, reconstruct `-D…` for
      `GGML_*`/`LLAMA_*` BOOLs that are ON + their string values +
      `CMAKE_BUILD_TYPE` + `AMDGPU_TARGETS`/`CMAKE_CUDA_ARCHITECTURES`,
      skipping `INTERNAL`/`STATIC`/`*-ADVANCED`. `backendFromFlags` derives a
      backend hint (`GGML_CUDA→cuda12`, `GGML_HIP→rocm`, `GGML_VULKAN→vulkan`,
      `GGML_METAL→metal`). App binding `InspectSourceDir`. Tests: full
      `.git/config` (two remotes → origin wins) + realistic `CMakeCache.txt`
      (ON flags kept, OFF/INTERNAL/ADVANCED/non-GGML filtered, backend=cuda12);
      empty/missing/plain-dir; `.git`-file `gitdir:` pointer. `BuildsPanel`
      `RecipeEditor`: after `PickDirectory` (and via a "scan" magnifier
      button next to the folder picker) calls `InspectSourceDir` and
      pre-fills only the *empty* fields (`SourceRepo`, `BuildDir`,
      `CMakeFlags`, `Backend`); shows a hint line ("git remote: …" /
      "prior cmake build in build/ → imported N flags" / "directory not found
      yet").

### Open / deferred

- TD20 — Multi-platform cross-builds (one recipe → several backends in a
  matrix). Defer; v1 is one recipe = one binary.
- TD21 — Auto-detect `Build.capabilities` by probing the built `llama-server
  --help` for `--embeddings` / `--mmproj` / rerank flags instead of taking
  the recipe's backend hint at face value.
- Backend hint vs reality: the recipe's `backend` field is advisory — the
  actual backend is whatever the cmake flags enable. PR29 keeps them in sync
  for *suggested* recipes; user-edited recipes can drift. Acceptable for v1;
  TD21 would close it.

## Milestone 3 — Agent loop

DESIGN.md §5.3 + §9 M3. Decisions for M3:

- **Tool protocol:** hybrid. On first use probe the active chat profile via a small
  `/v1/chat/completions` call with `tools=[]` and an empty user message; if the model
  accepts and surfaces tool_calls in the response, use OpenAI-style function calling
  for that profile (cached). Otherwise fall back to ReAct text-prompting (system
  prompt explains an `Action:`/`Args:` line format, the loop parses it from the
  stream).
- **Toolset (M3 minimum):** `search_semantic` (wrap `RAGService.Search`),
  `list_files` (wrap `FileService.ListTree`), `read_file` (wrap `ReadFile`),
  `edit_file` (wrap `WriteFile`). No `run_shell` — shell sandboxing is M5/M6.
- **Approval policy:** declared per-mode (`approval = "always" | "snapshot" | "auto"`).
  `always` shows a modal with a diff for every write (`edit_file`); `snapshot` runs
  `git add -A && git commit -m "agent: …"` before the loop and lets the agent write
  freely (rollback via `git reset --hard <snap>`); `auto` skips the gate entirely
  and is only legal for read-only mode definitions.

### PRs

- [x] **PR15** — `agent.go`: `Tool` interface (Name/Description/InputSchema/Execute),
      `ToolRegistry` (Register/Get/List/Filter/Invoke, concurrency-safe),
      `AgentContext` (project + mode + service refs). Builtin tools wrap existing
      services: `search_semantic` → `RAGService.Search`, `list_files` →
      `FileService.ListTree`, `read_file` → `FileService.ReadFile`, `edit_file` →
      `FileService.WriteFile`. Each carries a JSON-Schema input spec ready for
      `tools[].function.parameters` in PR17 / the ReAct prompt block in PR18.
      Wired into `App` (registry built in `startup`). Tests cover register/get,
      whitelist filter, unknown-tool / bad-JSON paths, args roundtrip, and an
      end-to-end pass that runs all four tools against real services on a temp
      project (Reindex → list → read → search → edit + on-disk verify).
- [x] **PR16** — `Mode` extended with `SystemPrompt`, `ToolWhitelist`,
      `Approval` (`always | snapshot | auto`), `Context` (`none | rag-auto |
      rag-explicit`). `validate()` rejects `approval=auto` combined with any write
      tool. `normalise()` fills missing fields with safe defaults
      (`approval=always`, `context=rag-explicit`). New builtin set: `chat-only`,
      `research`, `agent`, `auto-edit` — replaces the M1 narrative roles since
      those were metadata-only. `ModeService.List(projectID)` merges builtins with
      project-local TOML files at `<project>/.llm-workshop/modes/*.toml` (project
      overrides builtin by ID). `Resolve` falls back to `chat-only`. Frontend
      `MODES` static list mirrors the new IDs (consumed before backend list
      resolves). Tests: builtin validate, approval=auto+write rejection,
      whitelist semantics, normalise defaults, project-local override + bad-file
      skipping, fallback resolution. Mode picker still routes through
      `UpdateSessionMode` — actual behaviour wiring lands in PR17/18.
- [x] **PR17** — Native tool-calling agent loop. `agent_loop.go` adds
      `ChatService.streamWithTools` which builds the OpenAI `tools=[]` array from
      the mode's whitelist, runs an SSE stream, accumulates fragmented
      `delta.tool_calls[]` (id+name on first chunk, arguments stream as a string),
      dispatches each call through `ToolRegistry.Invoke`, appends the assistant
      tool_call turn + the `tool` result turn to the convo, and re-enters the
      stream. Bounded by `maxAgentIterations=8`. System prompt from the mode is
      injected as the first system message. Per-call frontend events:
      `agent:tool:request:<streamId>` + `agent:tool:result:<streamId>`. Tool
      results persisted as `SessionMessage.ToolCalls` (raw JSON). `ChatService`
      auto-routes through the agent loop when the resolved mode has a non-empty
      tool whitelist; chat-only mode keeps the plain SSE drain. Capability probe
      deferred — sending `tools=[]` to a non-tools model results in plain text
      reply (no tool_calls in stream → loop exits with content), which is a
      graceful degradation. Tests: SSE fragment reassembly, plain-content path,
      whitelist-driven schema build, mock end-to-end loop (stub server returns
      tool_call → final answer; verifies request bodies don't carry tool_call_id
      on iter 1, do on iter 2).
- [x] **PR18** — ReAct fallback. `ChatService.streamWithReAct` builds a system
      prompt enumerating allowed tools (name, description, JSON-Schema args), uses
      the plain SSE drain (no `tools[]`), and parses `Action:` / `Args:` lines
      anchored at line start (mid-line mentions skipped). Tool result is appended
      as a synthetic `Observation: <json>` user turn so non-OpenAI chat templates
      that don't support a `tool` role still work. `Final Answer: …` ends the
      loop. Same 8-iteration cap as the native path. New `Profile.ToolMode`
      string field (`""|"native"|"react"|"none"`) selects the wire protocol per
      profile, plus a Select in `ProfileForm` (chat-kind only). ChatService
      branches on it: `react` → `streamWithReAct`, `none` → plain stream
      regardless of session mode, anything else → `streamWithTools`. Tests:
      prompt builder includes tools and skips filtered ones, regex skips
      mid-line "Action:" mentions, picks the last action when many, end-to-end
      mock with action turn → final-answer turn.
- [x] **PR19** — Approval gate. Backend `ApprovalManager` opens a fresh
      `(id, chan)` per pending write call; agent loop emits
      `agent:approval:request:<streamId>` AND a global `agent:approval:request`
      event with `{id, streamId, tool, args, path, oldContent, newContent}` and
      blocks on the channel. Frontend `ApprovalModal` subscribes to the global
      channel, shows side-by-side old/new for `edit_file` (raw args for other
      writes), captures an optional reject reason, calls
      `App.RespondToApproval(id, accept, reason)`. Policy enforced:
      `auto` skips the gate (and is rejected at mode-validate time when
      combined with any write tool); `snapshot` proceeds (PR20 owns the git
      side); `always` blocks until decision. Fails closed: `always` mode with
      no `ApprovalManager` wired returns an error rather than letting writes
      slip through. Tests: manager roundtrip, double-respond is an error,
      cancel closes channel, read tools bypass gate, accept proceeds, reject
      surfaces as error, snapshot bypass, fail-closed without manager.
- [x] **PR20** — Pre-agent git snapshots for `approval=snapshot` modes.
      `snapshot.go` `SnapshotService.Take` ensures `.llm-workshop/` is in
      `.gitignore` (so the snapshot log itself doesn't ride into the commit and
      get wiped on revert), runs `git add -A && git commit --allow-empty
      -m "agent: snapshot before <mode> @ <ts>"`, captures the resulting SHA,
      and appends an `AgentSnapshot` record to
      `<project>/.llm-workshop/snapshots.jsonl`. ChatService routes
      `approval=snapshot` runs through `Take` before invoking the agent loop;
      failures emit `agent:snapshot:failed:<streamId>` but don't abort the run.
      Bindings: `RevertLastAgentSnapshot(projectID, sha)` (empty SHA = latest
      unreverted), `ListAgentSnapshots(projectID)`. Revert does
      `git reset --hard <sha>` and flips the log entry's `reverted` flag. Toast
      in App on `agent:snapshot:taken`. Tests: take→log append, revert→file
      restoration, latest-unreverted skipping flagged entries, refusal on
      non-git projects. Per-message revert UI lives in PR21 (source attribution).
- [x] **PR21** — Source-attribution UI for tool calls + revert affordance.
      ChatTab subscribes to `agent:tool:request:<streamId>` /
      `agent:tool:result:<streamId>` during a stream, lands a placeholder chip
      under the assistant bubble on request, patches in the result/error on
      response. Persisted `SessionMessage.toolCalls` (PR17) is hydrated on
      session load so chips survive reloads. `ToolCallChips` renders an emoji
      icon, tool name, and a derived summary
      (`search_semantic("foo")`, `📄 README.md`, `✏️ x.md · 42B`). Chips with a
      `path` arg are clickable → `onOpenFilePath`. Pending chips show `…`,
      errored chips go red with `title=error`. New `AgentSnapshotControls`
      block in `RagPanel` reads `ListAgentSnapshots(projectID)`, surfaces the
      latest unreverted snapshot's short SHA + mode, exposes a `revert` button
      that calls `RevertLastAgentSnapshot`. Subscribes to
      `agent:snapshot:taken` to refresh after each agent run.

### Open

- Mode-local modes vs builtin: do we let projects override builtin IDs? Probably
  yes with a precedence rule (project > builtin) — decide in PR16.
- Iteration cap and infinite-loop detection — agent.go has to enforce a hard
  ceiling and detect oscillating tool calls (same Args twice in a row → abort).
- M3-blockers worth surfacing as TDs: cancel mid-tool-call (right now ChatCancel
  cancels stream; we'll need to also cancel an in-flight tool handler).

## Tech debt / nice-to-have

### TD16 — Mode system_prompt_template (DESIGN §4.6 alignment)

**Status:** PR16 stored `SystemPrompt` as an inline string field on `Mode`.
DESIGN §4.6 says it should be a relative path to a markdown template:

```toml
[mode."narrative-coauthor"]
system_prompt_template = "modes/narrative-coauthor.system.md"
```

The template can carry placeholders that the agent loop substitutes before
sending to the LLM — project metadata, session-bound parameters captured at
session-creation time, etc. Inline strings can't be edited in a real markdown
editor with diff/preview, can't pull in fragments from other files, and can't
be authored by the same Prompt Lab UX that owns project content.

**Refactor plan:**

1. **Mode struct:** add `SystemPromptTemplate string` (relative to project
   root, default `.llm-workshop/modes/<id>.system.md`). Keep `SystemPrompt`
   as a deprecated inline fallback during transition.
2. **`ModeService.Resolve`** loads the template file when present, falls back
   to the inline string otherwise. Templates resolve at AGENT-LOOP time so
   edits land on the next turn without reloading the session.
3. **Placeholder syntax:** `{{project.name}}`, `{{project.path}}`,
   `{{param.<name>}}`. Built-ins always available; user params declared in a
   `[mode.params]` block with name/type/default/required.
4. **Session-bound params:** extend `Session` with a `params map[string]any`
   field, captured at NewSessionModal via an auto-generated form from the
   mode's params schema.
5. **Builtin modes:** ship `.system.md` files alongside the binary (or as Go
   `embed.FS`) instead of the M3 inline strings.

### TD17 — Prompt Lab as the mode-template editor

The current Lab tab edits JS scripts (M4 PR22–24). That's a useful surface
for workflows / tooling but it's NOT what the original DESIGN §4.6 +
§5.5 flow intended. The PRIMARY Lab use case is authoring parameterised
mode prompt templates with a live preview:

- left rail → list of modes (builtin + project-local), filter by source
- editor → markdown template content with `{{…}}` placeholder highlighting
- right pane → preview with resolved placeholders given the current
  session/test params
- bottom → "Run with these params" button that opens a throwaway chat
  session using this mode template

Reuse PR24's CM6 setup but with markdown lang + a separate file backend
(`<project>/.llm-workshop/modes/<id>.system.md`). Keep the JS-script tab
underneath as a sub-mode (or move to a separate "Scripts" tab once we
materialise workflows in TD13).

### TD12 — JSDoc-driven Lab parameter form

Auto-generate a small input form on the Prompt Lab tab from `@param` JSDoc
annotations in the script source. Feed the values into a `params` global the
script can read. Lets users author parameterised utility scripts without
hand-coding a UI per script.

### TD13 — Workflow TOML

`<project>/.llm-workshop/workflows/*.toml` definitions: `trigger` (manual /
file-change / cron) → `steps` (`llm.chat`, `script`, `subprocess`) → output
paths. WorkflowEngine + UI to browse / run / schedule. Bigger block —
materialise once PR22–PR24 settle.

### TD14 — External Python sidecar tools

`[external_tool.foo]` in `~/.config/llm-workbench/external_tools.toml`:
interpreter + script + contract (argv / stdin-json / http). Surfaces in the
agent loop as a tool named `foo` and inside scripts as `app.tools.run("foo",
…)`. Useful for heavy NLP utilities (xtts, whisper) outside Go's pure-runtime
scope.

### TD15 — Script API versioning

Per-script `requireApi("1.0")` directive so newer global-API surface can ship
without breaking older scripts. Service tracks the active set of method
signatures keyed by major.minor.

### TD11 — Send button stuck disabled after agent tool call ✓ partial fix

**Two probable causes identified, both addressed:**

1. **Panic in agent goroutine.** chat.go wrapped the session-stream goroutine
   in `defer { recover; finalize }` so a panic in any tool handler / vec
   query / persist path still terminates the UI side (`chat:done` or
   `chat:error` always fires). Without this, the JS listener never gets a
   terminal event and `streaming=true` was stuck forever.
2. **`!healthy` pre-gate.** After a `read_file` injected a fat file, the
   chat profile becomes CPU-bound for prompt eval; `/health` probes time
   out; `activeStatus.healthy` flips false; UI greyed the send button and
   `send()` early-returned. Both gates removed — UI now lets the request
   fly even when the probe is unhealthy, since the chat endpoint usually
   still accepts the request. Tooltip surfaces the probe state.

**Still TODO if it recurs:**

- Frontend watchdog (no event in N seconds → force `streaming=false` with
  a "stalled, please retry" toast).
- Debug logging of `streaming`/`streamIdRef` transitions.

Reported once: in `Agent` mode, after the model called `read_file`, the chat
input went into a stuck state — send icon greyed out, Ctrl+Enter did nothing.
Recovered only by restarting the app.

**Likely cause:** `streaming=true` in `ChatTab` never flipped back. Suspects:

1. `chat:done:<id>` / `chat:error:<id>` event missed (delivered before the
   handler was wired? streamId mismatch? Wails listener race?). `cleanup()`
   never runs → `setStreaming(false)` never called.
2. Agent loop returned without an error AND without ever hitting
   `c.finalize` (some code path short-circuits). Worth auditing
   `streamWithTools` / `streamWithReAct` for early returns that bypass the
   wrapping goroutine's `finalize` call.
3. Approval modal opened but `RespondToApproval` never completed; loop
   parked on `<-ch`. ctx.Done should unblock but isn't if streamCtx never
   gets cancelled.

**Fix direction (when reproduced):**

- Add a watchdog: if no event lands within N seconds of the request,
  ChatTab auto-resets `streaming`.
- Always emit `chat:done` in a defer (`go func(){ defer c.finalize(...) }`
  pattern) so any early return still terminates the UI side.
- Log every state transition (`streaming`, `streamIdRef.current`) when
  debug build is on.

**Files:** `chat.go` (finalize-defer), `frontend/src/tabs/ChatTab.tsx`
(watchdog timer, debug logging).

### TD10 — Visualise model thinking / long-running activity

When the model "thinks" silently (Qwen3 emits `<think>…</think>` blocks before
the visible reply, or the agent loop runs a tool call that takes a few seconds),
the chat looks frozen. No spinner, no token counter, no indication that anything
is happening.

**Fix ideas (review V1–V4 mockups in `Design/` for reference):**
- Inline "thinking" bubble — render `<think>` content collapsed, expandable
  on click. Strip it from the final assistant message in the saved JSONL or
  store it under a separate `reasoning_content` field.
- Activity strip below the bubble: "🔧 read_file(path=README.md)…" updates
  via the existing `agent:tool:request/result:<streamId>` events. Live tool
  call counter while the loop iterates.
- Token-throughput pill (we already track per-profile TPS in the supervisor —
  surface it here while a stream is in flight).
- Pulse / shimmer on the empty assistant bubble until the first delta
  arrives, so first-token latency feels intentional rather than hung.

**Files:** `frontend/src/tabs/ChatTab.tsx` (bubble + activity strip),
`render.go` if we need a `<think>`-stripping pass.

### TD9 — Chat bubbles must render markdown

Assistant messages currently render as plain text in the chat panel — fenced code,
emoji, lists, bold/italic, links all show as raw `**`, ` ``` `, etc. Backend already
has a `Renderer` (`render.go`) that produces sanitized HTML (used by the file Preview
pane); reuse it for chat too.

**Fix:**
- ChatTab message list: pipe `assistant` content through `RenderMarkdown` (existing
  binding) into the bubble's HTML; for streaming deltas re-render on each delta tick
  (debounce ~50 ms) or render on `chat:done`.
- Keep `user` bubbles as plain text (we send what the user typed verbatim).
- Tool-call chips (PR21) should still overlay the rendered HTML, not get stripped.
- Safety: existing renderer already runs through bluemonday; don't add raw-HTML
  passthrough.

**Files:** `frontend/src/tabs/ChatTab.tsx` (message renderer), maybe extract a tiny
`MarkdownBubble` helper.

### TD8 — /search hit click should scroll to the chunk

Today clicking a hit opens the file via `onOpenFilePath` but lands at the top — user
has to manually scroll to find the matched chunk. Hit carries `startByte`/`endByte`
already; thread them down to the editor.

**Fix:**
- Extend `onOpenFilePath` (or add `onOpenFileAt(path, startByte, endByte)`) to also
  carry byte offsets.
- In `Editor` (CodeMirror 6), convert byte offset → character position (UTF-8 walk),
  dispatch `EditorView.scrollIntoView(EditorSelection.range(start, end))` on next
  tick after content load. Optionally add a fading highlight (`Decoration.mark`) for
  ~2 seconds so the user sees what matched.
- Same for Preview pane — anchor scroll to the corresponding offset in the rendered
  HTML (more involved; can be deferred).

**Files:** `frontend/src/components/Editor.tsx`, `frontend/src/tabs/ChatTab.tsx`
(hit click handler), `frontend/src/App.tsx` (`onOpenFilePath` signature).

### TD6 — Resizable chat ↔ file panes + collapsible chat side

Right now the chat pane is fixed width and only the file pane has a collapse rail.
Two improvements:

1. **Drag-resize divider** between chat (left) and file (right) panes. Persist width
   per-project in localStorage so layouts survive restarts.
2. **Collapse chat side** — mirror the file-pane behaviour (`activeFilePath && !panelOpen`
   shows a thin rail with restore button). Lets the user focus on a file alone.

**Files:** `frontend/src/tabs/ChatTab.tsx` (split layout, divider, collapse state), maybe
extract `SplitPane` helper.

### TD7 — Inline file autocomplete when chat is hidden (future)

Once TD6 lands and the chat side can be hidden, give the file editor a Copilot-style
inline completion bound to the active chat profile (`/v1/completions` with the FIM
prompt format the model supports). Should be unobtrusive — debounced, dismissable
with Esc, accepted with Tab. **Priority: low / much later** — wait for M3 agent loop
to settle the prompt-routing pipeline first.

### TD5 — Duplicate window controls (native + custom)

App shows two sets of window controls: native OS title-bar (min/max/close) plus our custom
TitleBar buttons in the V5 shell. Need to hide the native chrome.

**Fix:** set `Frameless: true` in `wails.Run` options (`main.go`). On Linux+webkit2_41 this
removes the GTK header bar entirely — our custom TitleBar already implements drag-to-move
(via `WindowSetPosition` / `--wails-draggable` CSS) and min/max/close (`WindowMinimise`,
`WindowMaximise`, `Hide`). Verify drag region still works on Linux + Windows after the
toggle; webview drag has historically been finicky on GTK.

**Files:** `main.go` (Wails options), `frontend/src/shell/TitleBar.tsx` (ensure draggable
region attribute set on the bar — Wails uses `style="--wails-draggable: drag"` on the
element that should act as the OS-level grab handle).

### TD3 — Linked embed sidecar should start BEFORE chat (not after)

`supervisor.go` `Start(chat)` currently kicks off the linked embed profile in a goroutine
**after** the chat process spawns. With `--fit` (ik_llama.cpp), the chat allocator reads
`cudaMemGetInfo` at startup and greedily fills the GPU — by the time the embed sidecar
tries to load, there's no room left and BGE-M3 OOMs on warmup.

**Fix:** when `LaunchEmbedding=true && EmbedProfileID != ""`, start the embed profile FIRST,
wait for `/health`, then start the chat profile. Chat's `--fit` then sees real free VRAM
(minus embed) and distributes layers correctly. Failures of the embed start should still
not block chat (downgrade to warning + skip linked sidecar).

**Files:** `supervisor.go` `ServerRegistry.Start`.

### TD4 — Configurable startup order for linked profiles (future)

Once TD3 lands with hard-coded "embed first", expose the order as a profile field
(or a separate `[startup]` block in profiles.toml) so users can mix-and-match arbitrary
sidecars (rerank, multimodal projector, future tool servers) and choose the order.
**Priority: low / much later.**

### TD2 — Auto-reindex on file save

Currently Reindex is manual via the `RagPanel` button. Hook the project polling tick
or the WriteProjectFile flow to debounce-trigger a per-file reindex when a file changes.
Probably enough to call `FileIndexer.Reindex` with a path filter once that exists, or
just full reindex with a 5s debounce.

### TD1 — Copy-logs button still appears blocked in some states

After B6 the disabled prop was removed and the click handler always runs (toast `"Logs empty"` on zero lines). User reports the button still feels blocked — possibly a CSS/render issue, possibly a CrashBanner overlay, possibly a stale `selectedLogs` closure. Not investigated. Defer until reproduced reliably.

**Files:** `frontend/src/tabs/ServersTab.tsx` (logs tabs row).

## Milestone 2 — RAG

DESIGN.md §5.4 + §9 M2. SQLite driver: **mattn/go-sqlite3** (CGo, easier sqlite-vec). Default embed model: **BGE-M3** (1024 dim, 8192 ctx, multilingual) — referenced in seed/UI hints but not bundled (user provides GGUF).

### PRs

- [x] **PR9** — `mattn/go-sqlite3` + `sqlite-vec-go-bindings/cgo` deps (vendored).
      Per-project `<project>/.llm-workshop/index.db` opened lazily via `IndexRegistry`.
      Schema: `chunks(id, path, start_byte, end_byte, content, sha256, mtime, created_at)`,
      `chunks_fts` (FTS5 contentless mirror, triggers for ai/ad/au), `meta(key, value)` for
      `schema_version`/`embed_model_id`/`embed_dim`. `vec_chunks` is created lazily by
      `EnsureVecTable(modelID, dim)` once the embed profile is known (PR11).
      Build tags now `webkit2_41 sqlite_fts5` — CLAUDE.md updated.
      App binding `GetIndexStats(projectID)` wired.
- [x] **PR10** — `Chunker` (paragraph-cascade-to-hard-split, ~512/64 tokens via 4 chars/tok approx).
      `FileIndexer.Reindex(projectID)` walks the project tree per `[indexing]` rules from
      `project.toml` (`include`/`exclude` doublestar globs, `chunk_chars`, `overlap_chars`),
      replace-on-change per file, GCs chunks for paths gone from disk. Tests cover empty input,
      single para, multi-para overlap, oversize hard-split, SHA determinism, glob include/exclude,
      end-to-end reindex (idempotent → mutate → delete → FTS5 search).
      App binding `RebuildIndex(projectID)` returns `IndexProgress` (no streaming yet — PR14).
- [x] **PR11** — `EmbedClient` POSTs to llama-server `/v1/embeddings` (OpenAI-compatible, reorders
      response items by `index`). `EmbeddingService.BuildEmbeddings(projectID, embedProfileID)`:
      auto-starts the embed-kind profile, polls health, probes one chunk to discover the model's
      vector dimension, calls `EnsureVecTable(modelID, dim)`, then streams remaining unembedded
      chunks in batches of 16, INSERTing serialized float32 BLOBs into `vec_chunks` keyed by
      `chunks.id`. Per-file replace and GC paths (PR10) now clean `vec_chunks` rows when
      chunks they reference are deleted. App binding `BuildEmbeddings(projectID, embedProfileID)`.
      Tests: embed-client mock (reorder, empty input, HTTP error), pending-chunks scan with/without
      vec table, write+rescan idempotency, dim-change rejection.
- [x] **PR12** — `RAGService.Search(ctx, projectID, embedProfileID, query, opts)` runs hybrid
      retrieval: embed query via `EmbedClient` → top-N dense KNN over `vec_chunks` (sqlite-vec
      MATCH + k=N), top-N BM25 over `chunks_fts`. Reciprocal Rank Fusion (default k=60) merges
      the two rank maps. Stable tie-break by id ascending. `ChunkHit` includes per-ranker
      sub-scores for diagnostics. `SearchOptions.SparseOnly` / `DenseOnly` toggles allow
      skipping either ranker (e.g. when no embed profile is configured yet).
      App binding `SearchProject(projectID, embedProfileID, query, k, sparseOnly, denseOnly)`.
      Tests: RRF math, top-K tie-break, sparse-only end-to-end, embed-required-for-dense guard.
- [x] **PR13** — `/search …` intercepted client-side in `ChatTab.send()` (case-insensitive,
      space- or no-arg form), routed to `SearchProject(...)`. Results panel above the input:
      collapsible header with hit count + last query + ranker badge (`hybrid` if a kind=embed
      profile is running, otherwise `sparse`), per-hit chip showing path, byte range, fused
      score, and a 3-line clamped content preview. Click a hit → opens the file in the
      Edit/Preview pane via new `App.onOpenFilePath` helper. Send button stays enabled while
      an unhealthy chat server prevents normal sends, so `/search` works without a chat profile up.
      No auto-context-injection — that lands in M3 with the agent loop.
- [x] **PR14** — RAG controls panel + streaming progress events.
      Backend: `FileIndexer.Attach(ctx)` + `EmbeddingService.Attach(ctx)` wire the Wails ctx so
      Reindex emits `rag:index:progress:<projectID>` per file (with `currentPath` and a final
      `done=true`) and BuildEmbeddings emits `rag:embed:progress:<projectID>` per batch.
      UI: new `RagPanel` at the bottom of the Files segment in the sidebar — shows chunk
      count + embed dim + model id, an embed-profile dropdown (running profiles first), and
      Reindex/Embed buttons. Live counter while a pass is running. Toast on completion with
      summary stats. Auto-on-save reindex deferred to a TD item.

### Open

- Embedding model is per-project? Probably yes — `[rag] embed_profile_id` in `project.toml`. Decide in PR11.
- Reranker (`bge-reranker-v2-m3`) — defer to M6 polish.
