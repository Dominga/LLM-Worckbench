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
- [ ] **PR13** — `/search …` slash-command parsed in chat input → results panel inline (chips with file + start–end).
      No automatic context-injection yet (that lands in M3 with the agent loop).
- [ ] **PR14** — Reindex job: explicit "Rebuild index" button + on-save trigger via existing 3s polling tick.
      Progress event `rag:index:progress:<projectID>` with chunks_done / chunks_total.

### Open

- Embedding model is per-project? Probably yes — `[rag] embed_profile_id` in `project.toml`. Decide in PR11.
- Reranker (`bge-reranker-v2-m3`) — defer to M6 polish.
