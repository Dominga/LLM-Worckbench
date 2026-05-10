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

## Tech debt / nice-to-have

### TD1 — Copy-logs button still appears blocked in some states

After B6 the disabled prop was removed and the click handler always runs (toast `"Logs empty"` on zero lines). User reports the button still feels blocked — possibly a CSS/render issue, possibly a CrashBanner overlay, possibly a stale `selectedLogs` closure. Not investigated. Defer until reproduced reliably.

**Files:** `frontend/src/tabs/ServersTab.tsx` (logs tabs row).

## Next milestone

M2 (RAG) — in progress. See `DESIGN.md` §10.
