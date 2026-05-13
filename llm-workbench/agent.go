package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
)

// ─────────────────────────────── Tool API ────────────────────────────

// Tool is the contract every callable surface the agent loop can invoke
// must satisfy. Spec, schema, and handler in one place.
//
// Naming convention: snake_case verb_noun (`read_file`, not `ReadFile`).
// The registry maps names → tool, so this is also the function-calling
// `tools[].function.name` we send to llama-server.
type Tool interface {
	Name() string
	Description() string
	// InputSchema returns a JSON-Schema-compatible map describing the
	// arguments the tool accepts. Stored as a map (not a JSON string) so
	// the agent can include it verbatim in `tools[].function.parameters`.
	InputSchema() map[string]any
	// Execute runs the tool. ctx carries the AgentContext so the handler
	// can access services + project scope without holding global refs.
	// args is the parsed JSON payload (already verified to be a JSON
	// object). The return is marshaled back to JSON for the LLM.
	Execute(ctx context.Context, ac *AgentContext, args map[string]any) (any, error)
}

// AgentContext is the per-loop state passed to every tool. Wires the
// services agent tools need (RAG, files, indexes, profiles) and the
// project + mode bindings the user picked.
type AgentContext struct {
	ProjectID      string
	EmbedProfileID string // empty when no embed profile is configured
	Mode           Mode
	// Params captured from the session at create-time, available to
	// the mode's prompt template as `{{param.<key>}}`. Empty for ad-hoc
	// chats that never went through NewSessionModal.
	Params map[string]any

	Files *FileService
	RAG   *RAGService
}

// ToolRegistry holds the set of tools available to the agent. Lookups
// are by Name. Concurrency-safe — registration is one-shot at startup
// but lookups happen mid-stream from many goroutines.
type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{tools: map[string]Tool{}}
}

// Register adds a tool. Re-registering the same name overwrites — useful
// for tests or for project-local mode definitions later.
func (r *ToolRegistry) Register(t Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[t.Name()] = t
}

// Get fetches a tool by name.
func (r *ToolRegistry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

// List returns all tools, sorted by name. Used to render the schema
// block for ReAct prompts and the tools[] array for native function
// calling.
func (r *ToolRegistry) List() []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name() < out[j].Name() })
	return out
}

// Filter returns only the tools whose names are in `whitelist`. Empty
// whitelist returns all (used by the `agent` mode); non-empty returns
// just the listed (used by `research`, `chat-only`, etc).
func (r *ToolRegistry) Filter(whitelist []string) []Tool {
	if len(whitelist) == 0 {
		return r.List()
	}
	want := make(map[string]struct{}, len(whitelist))
	for _, n := range whitelist {
		want[n] = struct{}{}
	}
	out := make([]Tool, 0, len(whitelist))
	for _, t := range r.List() {
		if _, ok := want[t.Name()]; ok {
			out = append(out, t)
		}
	}
	return out
}

// Invoke runs a tool by name. Argument unmarshaling errors and
// per-tool execution errors are returned verbatim so the loop can
// feed them back into the model as observations.
func (r *ToolRegistry) Invoke(ctx context.Context, ac *AgentContext, name string, rawArgs json.RawMessage) (any, error) {
	t, ok := r.Get(name)
	if !ok {
		return nil, fmt.Errorf("unknown tool %q", name)
	}
	var args map[string]any
	if len(rawArgs) > 0 && string(rawArgs) != "null" {
		if err := json.Unmarshal(rawArgs, &args); err != nil {
			return nil, fmt.Errorf("tool %s: bad args json: %w", name, err)
		}
	}
	return t.Execute(ctx, ac, args)
}

// ─────────────────────────────── Builtin tools ─────────────────────────

// searchSemanticTool wraps RAGService.Search.
type searchSemanticTool struct{}

func (searchSemanticTool) Name() string { return "search_semantic" }
func (searchSemanticTool) Description() string {
	return "Search project content using hybrid (dense vector + BM25) retrieval. Use this to find chunks relevant to the user's question before reading whole files."
}
func (searchSemanticTool) InputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"query"},
		"properties": map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "The search query, in natural language.",
			},
			"k": map[string]any{
				"type":        "integer",
				"description": "Maximum number of hits to return. Defaults to 8.",
				"minimum":     1,
				"maximum":     50,
			},
		},
	}
}
func (searchSemanticTool) Execute(ctx context.Context, ac *AgentContext, args map[string]any) (any, error) {
	if ac == nil || ac.RAG == nil {
		return nil, errors.New("RAG service unavailable")
	}
	query, _ := args["query"].(string)
	if query == "" {
		return nil, errors.New("query is required")
	}
	k := 8
	if raw, ok := args["k"]; ok {
		switch v := raw.(type) {
		case float64:
			k = int(v)
		case int:
			k = v
		}
	}
	opts := SearchOptions{K: k, SparseOnly: ac.EmbedProfileID == ""}
	hits, err := ac.RAG.Search(ctx, ac.ProjectID, ac.EmbedProfileID, query, opts)
	if err != nil {
		return nil, err
	}
	return map[string]any{"hits": hits}, nil
}

// listFilesTool wraps FileService.ListTree.
type listFilesTool struct{}

func (listFilesTool) Name() string { return "list_files" }
func (listFilesTool) Description() string {
	return "List the project's file tree. Returns a flat array of paths (relative to the project root) with size and mtime."
}
func (listFilesTool) InputSchema() map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{},
	}
}
func (listFilesTool) Execute(ctx context.Context, ac *AgentContext, args map[string]any) (any, error) {
	if ac == nil || ac.Files == nil {
		return nil, errors.New("file service unavailable")
	}
	tree, err := ac.Files.ListTree(ac.ProjectID)
	if err != nil {
		return nil, err
	}
	flat := flattenTree(tree)
	return map[string]any{"files": flat}, nil
}

// flattenTree recursively walks a FileNode tree into a flat slice of
// {path, isDir, size} maps. Cuts directories from the result so the
// model sees just leaf paths it can read.
func flattenTree(nodes []FileNode) []map[string]any {
	var out []map[string]any
	var walk func([]FileNode)
	walk = func(ns []FileNode) {
		for _, n := range ns {
			if n.IsDir {
				walk(n.Children)
				continue
			}
			out = append(out, map[string]any{
				"path": n.Path,
				"size": n.Size,
			})
		}
	}
	walk(nodes)
	return out
}

// readFileTool wraps FileService.ReadFile.
type readFileTool struct{}

func (readFileTool) Name() string { return "read_file" }
func (readFileTool) Description() string {
	return "Read a project file by relative path. Returns the full text content (truncated at 5 MB)."
}
func (readFileTool) InputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"path"},
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Project-relative path, e.g. src/main.go.",
			},
		},
	}
}
func (readFileTool) Execute(ctx context.Context, ac *AgentContext, args map[string]any) (any, error) {
	if ac == nil || ac.Files == nil {
		return nil, errors.New("file service unavailable")
	}
	path, _ := args["path"].(string)
	if path == "" {
		return nil, errors.New("path is required")
	}
	fc, err := ac.Files.ReadFile(ac.ProjectID, path)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"path":      fc.Path,
		"bytes":     fc.Bytes,
		"truncated": fc.Truncated,
		"content":   fc.Content,
	}, nil
}

// editFileTool wraps FileService.WriteFile. The approval gate is
// enforced one level up (in the agent loop / UI), not in this handler.
type editFileTool struct{}

func (editFileTool) Name() string { return "edit_file" }
func (editFileTool) Description() string {
	return "Replace the full content of a project file. Creates the file if absent. Subject to the active mode's approval policy — under modes with approval=\"always\" the user must confirm via the UI before the write lands."
}
func (editFileTool) InputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"path", "content"},
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Project-relative target path.",
			},
			"content": map[string]any{
				"type":        "string",
				"description": "Full new file content (atomic replace).",
			},
		},
	}
}
func (editFileTool) Execute(ctx context.Context, ac *AgentContext, args map[string]any) (any, error) {
	if ac == nil || ac.Files == nil {
		return nil, errors.New("file service unavailable")
	}
	path, _ := args["path"].(string)
	if path == "" {
		return nil, errors.New("path is required")
	}
	content, _ := args["content"].(string)
	if err := ac.Files.WriteFile(ac.ProjectID, path, content); err != nil {
		return nil, err
	}
	return map[string]any{
		"path":  path,
		"bytes": len(content),
		"ok":    true,
	}, nil
}

// makeDirectoryTool wraps FileService.MakeDirectory. Sandboxed identically
// to edit_file; same approval policy applies.
type makeDirectoryTool struct{}

func (makeDirectoryTool) Name() string { return "make_directory" }
func (makeDirectoryTool) Description() string {
	return "Create a directory in the project (including missing parents, like `mkdir -p`). No-op if the directory already exists. Subject to the active mode's approval policy."
}
func (makeDirectoryTool) InputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"path"},
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Project-relative directory path, e.g. world/characters.",
			},
		},
	}
}
func (makeDirectoryTool) Execute(ctx context.Context, ac *AgentContext, args map[string]any) (any, error) {
	if ac == nil || ac.Files == nil {
		return nil, errors.New("file service unavailable")
	}
	path, _ := args["path"].(string)
	if path == "" {
		return nil, errors.New("path is required")
	}
	created, err := ac.Files.MakeDirectory(ac.ProjectID, path)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"path":    path,
		"created": created,
		"ok":      true,
	}, nil
}

// RegisterBuiltinTools wires the M3-minimum tools into a registry.
// Called once at app startup; project-local modes can later add more.
func RegisterBuiltinTools(reg *ToolRegistry) {
	reg.Register(searchSemanticTool{})
	reg.Register(listFilesTool{})
	reg.Register(readFileTool{})
	reg.Register(editFileTool{})
	reg.Register(makeDirectoryTool{})
}
