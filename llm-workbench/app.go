package main

import (
	"context"
	"fmt"
	"os"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	cfg      *Config
	registry *ServerRegistry
	chat     *ChatService
	renderer *Renderer
	profiles *ProfileManager
	projects *ProjectService
	files    *FileService
	sessions *SessionService
	indexes   *IndexRegistry
	indexer   *FileIndexer
	embedder  *EmbeddingService
	rag       *RAGService
	tools     *ToolRegistry
	modes     *ModeService
	approvals *ApprovalManager
	snapshots *SnapshotService
	scripting *ScriptingService
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	cfg, err := LoadConfig()
	if err != nil {
		// Non-fatal: registry can still serve user-managed profiles even
		// if the legacy .env is missing or incomplete. Surface the
		// underlying issue but keep going.
		wruntime.LogWarningf(ctx, "config: %v", err)
	}
	a.cfg = cfg

	pm, err := NewProfileManager()
	if err != nil {
		wruntime.LogErrorf(ctx, "profile manager: %v", err)
		wruntime.EventsEmit(ctx, "app:fatal", fmt.Sprintf("profile manager: %v", err))
		return
	}
	a.profiles = pm
	if cfg != nil {
		if err := pm.SeedFromConfig(cfg); err != nil {
			wruntime.LogErrorf(ctx, "seed profile: %v", err)
		}
	}

	a.registry = NewServerRegistry(pm)
	a.registry.Attach(ctx)
	a.registry.Touch()
	a.registry.hookLegacyStatus()

	prs, err := NewProjectService()
	if err != nil {
		wruntime.LogErrorf(ctx, "project service: %v", err)
	} else {
		a.projects = prs
		a.files = NewFileService(prs)
		a.sessions = NewSessionService(prs)
		a.indexes = NewIndexRegistry(prs)
		a.indexer = NewFileIndexer(prs, a.indexes)
		a.indexer.Attach(ctx)
	}
	if a.indexes != nil {
		a.embedder = NewEmbeddingService(pm, a.registry, a.indexes)
		a.embedder.Attach(ctx)
		a.rag = NewRAGService(a.embedder, a.indexes)
	}
	a.tools = NewToolRegistry()
	RegisterBuiltinTools(a.tools)
	a.modes = NewModeService(a.projects)
	a.approvals = NewApprovalManager()
	a.snapshots = NewSnapshotService(a.projects)

	a.chat = NewChatService(a.registry, pm, a.sessions)
	a.chat.Attach(ctx)
	a.renderer = NewRenderer()
	a.scripting = NewScriptingService(a.projects, a.files, a.chat, a.rag, a.profiles, a.indexes)

	// Hook the agent loop into ChatService so sessions whose mode has
	// a tool whitelist run through the multi-turn tool loop. Must
	// happen after NewChatService so the receiver isn't nil.
	a.chat.AttachAgent(a.tools, a.modes, a.approvals, a.snapshots, func(projectID string) *AgentContext {
		var embedID string
		// Auto-pick the first running embed profile for context.
		if a.registry != nil && a.profiles != nil {
			for _, p := range a.profiles.List() {
				if p.Kind == KindEmbed && a.registry.Status(p.ID).Running {
					embedID = p.ID
					break
				}
			}
		}
		return &AgentContext{
			ProjectID:      projectID,
			EmbedProfileID: embedID,
			Files:          a.files,
			RAG:            a.rag,
		}
	})

	a.startSysMetricsTicker(ctx)

	// Per-profile Autostart flag is the single source of truth.
	// (Legacy .env LLAMA_AUTOSTART path removed — it ignored the profile's
	// own flag and force-started the default chat profile on every launch.)
	a.registry.AutostartAll()
}

func (a *App) shutdown(ctx context.Context) {
	if a.registry != nil {
		a.registry.StopAll()
	}
	if a.indexes != nil {
		a.indexes.CloseAll()
	}
}

// ─────────────────────────── RAG bindings ────────────────────────────

// GetIndexStats returns the current snapshot of the index for the
// given project. Used by Servers/Project tabs and debug surfaces.
func (a *App) GetIndexStats(projectID string) (IndexStats, error) {
	if a.indexes == nil {
		return IndexStats{}, fmt.Errorf("indexes not available")
	}
	idx, err := a.indexes.For(projectID)
	if err != nil {
		return IndexStats{}, err
	}
	return idx.Stats(), nil
}

// RebuildIndex triggers a synchronous file-walk + chunk upsert for
// the given project. Embedding generation is a separate pass (PR11);
// this binding only refreshes the chunks/chunks_fts tables. Returns
// the per-run progress summary.
func (a *App) RebuildIndex(projectID string) (IndexProgress, error) {
	if a.indexer == nil {
		return IndexProgress{}, fmt.Errorf("indexer not available")
	}
	return a.indexer.Reindex(projectID)
}

// BuildEmbeddings runs the embedding pass for the given project,
// using the named embed-kind profile. Auto-starts the profile if it
// is not running. Idempotent: only chunks without an existing vector
// are sent to the embed server.
func (a *App) BuildEmbeddings(projectID, embedProfileID string) (EmbeddingProgress, error) {
	if a.embedder == nil {
		return EmbeddingProgress{}, fmt.Errorf("embedder not available")
	}
	return a.embedder.BuildEmbeddings(a.ctx, projectID, embedProfileID)
}

// RunScript executes a Prompt-Lab script under the project's
// scripting sandbox. Synchronous: returns the full ScriptResult
// (output lines, optional return value, error, duration). Cancel by
// not blocking the UI — goja runs in-process and is fast for the
// short scripts the Lab is designed for.
func (a *App) RunScript(projectID, source string) ScriptResult {
	if a.scripting == nil {
		return ScriptResult{Error: "scripting service unavailable"}
	}
	return a.scripting.Run(a.ctx, projectID, source)
}

// RevertLastAgentSnapshot rolls the project tree back to the most
// recent unreverted snapshot taken by an `approval=snapshot` agent
// loop. Pass an empty SHA to use the latest unreverted entry; pass a
// specific SHA to revert to that one.
func (a *App) RevertLastAgentSnapshot(projectID, sha string) (AgentSnapshot, error) {
	if a.snapshots == nil {
		return AgentSnapshot{}, fmt.Errorf("snapshots not available")
	}
	return a.snapshots.Revert(a.ctx, projectID, sha)
}

// ListAgentSnapshots returns the per-project snapshot log, oldest
// first. Used by the UI to render a "revert" affordance.
func (a *App) ListAgentSnapshots(projectID string) ([]AgentSnapshot, error) {
	if a.snapshots == nil {
		return nil, fmt.Errorf("snapshots not available")
	}
	return a.snapshots.List(projectID)
}

// RespondToApproval delivers the user's accept/reject decision for a
// pending write-tool call. The agent loop is blocking on this — until
// it lands, the run sits in a select waiting on the approval channel
// or the stream ctx.
func (a *App) RespondToApproval(approvalID string, accept bool, reason string) error {
	if a.approvals == nil {
		return fmt.Errorf("approvals not available")
	}
	return a.approvals.Respond(approvalID, ApprovalDecision{Accept: accept, Reason: reason})
}

// SearchProject runs hybrid (dense + BM25, fused via RRF) retrieval
// over the project's index. embedProfileID may be empty when sparseOnly
// is true. k is the number of hits to return; pass 0 for the default 8.
func (a *App) SearchProject(projectID, embedProfileID, query string, k int, sparseOnly, denseOnly bool) ([]ChunkHit, error) {
	if a.rag == nil {
		return nil, fmt.Errorf("rag not available")
	}
	return a.rag.Search(a.ctx, projectID, embedProfileID, query, SearchOptions{
		K: k, SparseOnly: sparseOnly, DenseOnly: denseOnly,
	})
}

// ──────────────────────────── Config ────────────────────────────────

func (a *App) GetConfig() map[string]any {
	if a.cfg == nil {
		return map[string]any{"loaded": false}
	}
	return map[string]any{
		"loaded":    true,
		"binPath":   a.cfg.BinPath,
		"modelPath": a.cfg.ModelPath,
		"baseUrl":   a.cfg.BaseURL(),
		"args":      a.cfg.ExtraArgs,
		"autostart": a.cfg.Autostart,
	}
}

// ──────────────────────────── Profiles ──────────────────────────────

func (a *App) ListProfiles() []Profile {
	if a.profiles == nil {
		return []Profile{}
	}
	return a.profiles.List()
}

func (a *App) GetProfile(id string) (Profile, error) {
	if a.profiles == nil {
		return Profile{}, fmt.Errorf("profile manager not initialized")
	}
	return a.profiles.Get(id)
}

func (a *App) CreateProfile(p Profile) (Profile, error) {
	if a.profiles == nil {
		return Profile{}, fmt.Errorf("profile manager not initialized")
	}
	out, err := a.profiles.Create(p)
	if err != nil {
		return Profile{}, err
	}
	if a.registry != nil {
		a.registry.Touch()
	}
	return out, nil
}

func (a *App) UpdateProfile(id string, p Profile) (Profile, error) {
	if a.profiles == nil {
		return Profile{}, fmt.Errorf("profile manager not initialized")
	}
	out, err := a.profiles.Update(id, p)
	if err != nil {
		return Profile{}, err
	}
	if a.registry != nil {
		a.registry.refreshProfile(out)
	}
	return out, nil
}

func (a *App) DeleteProfile(id string) error {
	if a.profiles == nil {
		return nil
	}
	if a.registry != nil {
		_ = a.registry.Stop(id)
	}
	return a.profiles.Delete(id)
}

// ──────────────────────────── Server lifecycle ──────────────────────

func (a *App) StartProfile(id string) error {
	if a.registry == nil {
		return fmt.Errorf("registry not initialized")
	}
	return a.registry.Start(id)
}

func (a *App) StopProfile(id string) error {
	if a.registry == nil {
		return nil
	}
	return a.registry.Stop(id)
}

func (a *App) RestartProfile(id string) error {
	if a.registry == nil {
		return fmt.Errorf("registry not initialized")
	}
	return a.registry.Restart(id)
}

func (a *App) ProfileStatus(id string) InstanceStatus {
	if a.registry == nil {
		return InstanceStatus{ProfileID: id, State: StateStopped}
	}
	return a.registry.Status(id)
}

func (a *App) ProfileMetrics(id string) InstanceMetrics {
	if a.registry == nil {
		return InstanceMetrics{ProfileID: id}
	}
	return a.registry.Metrics(id)
}

func (a *App) ProfileLogs(id string) []string {
	if a.registry == nil {
		return nil
	}
	return a.registry.Logs(id)
}

// Legacy single-server bindings — operate on the default chat profile.
// Kept until the frontend fully migrates to the per-profile API.

func (a *App) StartServer() error {
	if a.registry == nil {
		return fmt.Errorf("registry not initialized")
	}
	id := a.registry.DefaultProfileID()
	if id == "" {
		return fmt.Errorf("no chat profile configured")
	}
	return a.registry.Start(id)
}

func (a *App) StopServer() error {
	if a.registry == nil {
		return nil
	}
	id := a.registry.DefaultProfileID()
	if id == "" {
		return nil
	}
	return a.registry.Stop(id)
}

func (a *App) ServerStatus() Status {
	if a.registry == nil {
		return Status{}
	}
	return a.registry.LegacyStatus()
}

// ──────────────────────────── Chat ──────────────────────────────────

func (a *App) ChatStream(profileID string, messages []ChatMessage, temperature float64) (StreamHandle, error) {
	if a.chat == nil {
		return StreamHandle{}, fmt.Errorf("chat service not initialized")
	}
	return a.chat.StartStream(profileID, messages, temperature)
}

// SessionChatStream is the session-bound entry point. The user message is
// appended to the JSONL, and the assistant response is persisted on
// completion.
func (a *App) SessionChatStream(projectID, sessionID, userText string, temperature float64) (StreamHandle, error) {
	if a.chat == nil {
		return StreamHandle{}, fmt.Errorf("chat service not initialized")
	}
	return a.chat.StartSessionStream(projectID, sessionID, userText, temperature)
}

func (a *App) ChatCancel(streamID string) {
	if a.chat != nil {
		a.chat.CancelStream(streamID)
	}
}

// ──────────────────────────── Sessions ──────────────────────────────

func (a *App) ListSessions(projectID string) ([]Session, error) {
	if a.sessions == nil {
		return nil, fmt.Errorf("session service not initialized")
	}
	return a.sessions.List(projectID)
}

func (a *App) GetSession(projectID, sessionID string) (Session, error) {
	if a.sessions == nil {
		return Session{}, fmt.Errorf("session service not initialized")
	}
	return a.sessions.Get(projectID, sessionID)
}

func (a *App) CreateSession(projectID, title, modeID, profileID string) (Session, error) {
	if a.sessions == nil {
		return Session{}, fmt.Errorf("session service not initialized")
	}
	return a.sessions.Create(projectID, title, modeID, profileID)
}

func (a *App) RenameSession(projectID, sessionID, title string) (Session, error) {
	if a.sessions == nil {
		return Session{}, fmt.Errorf("session service not initialized")
	}
	return a.sessions.Rename(projectID, sessionID, title)
}

func (a *App) UpdateSessionMode(projectID, sessionID, modeID string) (Session, error) {
	if a.sessions == nil {
		return Session{}, fmt.Errorf("session service not initialized")
	}
	return a.sessions.UpdateMode(projectID, sessionID, modeID)
}

func (a *App) DeleteSession(projectID, sessionID string) error {
	if a.sessions == nil {
		return nil
	}
	return a.sessions.Delete(projectID, sessionID)
}

func (a *App) SessionMessages(projectID, sessionID string) ([]SessionMessage, error) {
	if a.sessions == nil {
		return nil, fmt.Errorf("session service not initialized")
	}
	return a.sessions.LoadMessages(projectID, sessionID)
}

// ──────────────────────────── Modes ─────────────────────────────────

// ListModes returns builtin modes plus any project-local overrides
// from `<project>/.llm-workshop/modes/*.toml` for the given project.
// Empty projectID returns just the builtins.
func (a *App) ListModes(projectID string) []Mode {
	if a.modes == nil {
		return ListBuiltinModes()
	}
	return a.modes.List(projectID)
}

// ──────────────────────────── Projects ──────────────────────────────

func (a *App) ListProjects() []Project {
	if a.projects == nil {
		return []Project{}
	}
	return a.projects.List()
}

// CurrentProject returns the active project, or a zero-value Project (ID
// "") if none is selected. The TS layer checks `result.ID !== ''`.
func (a *App) CurrentProject() Project {
	if a.projects == nil {
		return Project{}
	}
	p, _ := a.projects.Active()
	return p
}

func (a *App) OpenProject(path string) (Project, error) {
	if a.projects == nil {
		return Project{}, fmt.Errorf("project service not initialized")
	}
	return a.projects.Open(path)
}

func (a *App) CreateProject(path, name string) (Project, error) {
	if a.projects == nil {
		return Project{}, fmt.Errorf("project service not initialized")
	}
	return a.projects.Create(path, name)
}

func (a *App) SetActiveProject(id string) (Project, error) {
	if a.projects == nil {
		return Project{}, fmt.Errorf("project service not initialized")
	}
	return a.projects.SetActive(id)
}

func (a *App) DeleteProject(id string) error {
	if a.projects == nil {
		return nil
	}
	return a.projects.Delete(id)
}

// ──────────────────────────── Files ─────────────────────────────────

func (a *App) ListFiles(projectID string) ([]FileNode, error) {
	if a.files == nil {
		return nil, fmt.Errorf("file service not initialized")
	}
	return a.files.ListTree(projectID)
}

func (a *App) ReadProjectFile(projectID, relPath string) (FileContent, error) {
	if a.files == nil {
		return FileContent{}, fmt.Errorf("file service not initialized")
	}
	return a.files.ReadFile(projectID, relPath)
}

func (a *App) WriteProjectFile(projectID, relPath, content string) error {
	if a.files == nil {
		return fmt.Errorf("file service not initialized")
	}
	return a.files.WriteFile(projectID, relPath, content)
}

// ──────────────────────────── System metrics ───────────────────────

func (a *App) GetSystemMetrics() SystemMetrics {
	return ReadSystemMetrics()
}

func (a *App) GetGPUMetrics() GPUMetrics {
	return ReadGPUMetrics()
}

// startSysMetricsTicker pushes RAM + GPU snapshots on `sys:metrics`
// every 2 seconds while the app is running. Frontend KPI cards consume
// the event instead of polling per-render.
func (a *App) startSysMetricsTicker(ctx context.Context) {
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		emit := func() {
			payload := map[string]any{
				"ram": ReadSystemMetrics(),
				"gpu": ReadGPUMetrics(),
			}
			wruntime.EventsEmit(ctx, "sys:metrics", payload)
		}
		emit() // immediate snapshot so UI doesn't sit on placeholders
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				emit()
			}
		}
	}()
}

// ──────────────────────────── File pickers ──────────────────────────

// PickFile opens a system file-picker dialog. `filterPattern` is a
// space-separated glob list (e.g. "*.gguf") shown under a single filter
// labelled `filterLabel`. Returns "" if the user cancels.
func (a *App) PickFile(title, filterLabel, filterPattern string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("not ready")
	}
	opts := wruntime.OpenDialogOptions{Title: title}
	if filterLabel != "" || filterPattern != "" {
		opts.Filters = []wruntime.FileFilter{{
			DisplayName: filterLabel,
			Pattern:     filterPattern,
		}}
	}
	return wruntime.OpenFileDialog(a.ctx, opts)
}

// PickDirectory opens a system folder-picker dialog. Returns "" on cancel.
func (a *App) PickDirectory(title string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("not ready")
	}
	return wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:                title,
		CanCreateDirectories: true,
	})
}

// ──────────────────────────── Markdown ──────────────────────────────

func (a *App) RenderMarkdown(source string) RenderResult {
	if a.renderer == nil {
		a.renderer = NewRenderer()
	}
	return a.renderer.Render(source)
}

type InitialDoc struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Bytes    int    `json:"bytes"`
	LoadedMs int64  `json:"loadedMs"`
}

// LoadInitialDoc reads the file at LOAD_DOC_PATH (relative paths resolve
// against the binary's CWD). Returns empty content if unset or unreadable.
func (a *App) LoadInitialDoc() InitialDoc {
	if a.cfg == nil || a.cfg.LoadDocPath == "" {
		return InitialDoc{}
	}
	t0 := time.Now()
	b, err := os.ReadFile(a.cfg.LoadDocPath)
	if err != nil {
		wruntime.LogErrorf(a.ctx, "LoadInitialDoc: %v", err)
		return InitialDoc{Path: a.cfg.LoadDocPath}
	}
	return InitialDoc{
		Path:     a.cfg.LoadDocPath,
		Content:  string(b),
		Bytes:    len(b),
		LoadedMs: time.Since(t0).Milliseconds(),
	}
}
