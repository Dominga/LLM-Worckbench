package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// stubTool lets tests verify that the registry dispatches to the right
// handler when multiple tools are registered.
type stubTool struct {
	name    string
	handler func(map[string]any) (any, error)
}

func (s stubTool) Name() string                { return s.name }
func (s stubTool) Description() string         { return "stub" }
func (s stubTool) InputSchema() map[string]any { return map[string]any{"type": "object"} }
func (s stubTool) Execute(_ context.Context, _ *AgentContext, args map[string]any) (any, error) {
	return s.handler(args)
}

func TestToolRegistryRegisterAndGet(t *testing.T) {
	reg := NewToolRegistry()
	reg.Register(stubTool{name: "alpha", handler: func(_ map[string]any) (any, error) { return "A", nil }})
	reg.Register(stubTool{name: "bravo", handler: func(_ map[string]any) (any, error) { return "B", nil }})

	if _, ok := reg.Get("alpha"); !ok {
		t.Fatal("alpha not found")
	}
	got := reg.List()
	if len(got) != 2 {
		t.Fatalf("List len=%d want 2", len(got))
	}
	if got[0].Name() != "alpha" || got[1].Name() != "bravo" {
		t.Errorf("List sorted wrong: %v", names(got))
	}
}

func TestToolRegistryFilter(t *testing.T) {
	reg := NewToolRegistry()
	reg.Register(stubTool{name: "alpha"})
	reg.Register(stubTool{name: "bravo"})
	reg.Register(stubTool{name: "charlie"})

	all := reg.Filter(nil)
	if len(all) != 3 {
		t.Fatalf("empty whitelist should return all, got %d", len(all))
	}
	allowed := reg.Filter([]string{"alpha", "charlie"})
	if len(allowed) != 2 || allowed[0].Name() != "alpha" || allowed[1].Name() != "charlie" {
		t.Errorf("Filter wrong: %v", names(allowed))
	}
}

func TestToolRegistryInvokeUnknown(t *testing.T) {
	reg := NewToolRegistry()
	_, err := reg.Invoke(context.Background(), nil, "nope", json.RawMessage(`{}`))
	if err == nil || !strings.Contains(err.Error(), "unknown tool") {
		t.Fatalf("expected unknown-tool error, got %v", err)
	}
}

func TestToolRegistryInvokeBadJSON(t *testing.T) {
	reg := NewToolRegistry()
	reg.Register(stubTool{name: "x", handler: func(_ map[string]any) (any, error) { return nil, nil }})
	_, err := reg.Invoke(context.Background(), nil, "x", json.RawMessage(`{not-json`))
	if err == nil || !strings.Contains(err.Error(), "bad args json") {
		t.Fatalf("expected json error, got %v", err)
	}
}

func TestToolRegistryInvokeArgsRoundtrip(t *testing.T) {
	reg := NewToolRegistry()
	reg.Register(stubTool{
		name: "echo",
		handler: func(a map[string]any) (any, error) {
			return a["msg"], nil
		},
	})
	got, err := reg.Invoke(context.Background(), nil, "echo", json.RawMessage(`{"msg":"hello"}`))
	if err != nil {
		t.Fatal(err)
	}
	if got != "hello" {
		t.Errorf("got %v, want hello", got)
	}
}

// End-to-end: register the four builtin tools and invoke them against
// the real services on a temp-dir project + IndexDB.
func TestBuiltinToolsAgainstRealServices(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "project.toml"),
		[]byte(`version = 1
name = "test"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "notes.md"),
		[]byte("# Notes\n\nThe quick brown fox jumps over the lazy dog."), 0o644); err != nil {
		t.Fatal(err)
	}

	prs := &ProjectService{
		projects: []Project{{ID: "p", Path: tmp, Name: "test"}},
	}
	files := NewFileService(prs)
	idx, err := OpenIndex("p", tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	indexes := &IndexRegistry{open: map[string]*IndexDB{"p": idx}, projects: prs}
	indexer := NewFileIndexer(prs, indexes)
	if _, err := indexer.Reindex("p"); err != nil {
		t.Fatal(err)
	}
	rag := NewRAGService(nil, indexes)

	reg := NewToolRegistry()
	RegisterBuiltinTools(reg)

	ac := &AgentContext{
		ProjectID: "p",
		Files:     files,
		RAG:       rag,
	}
	ctx := context.Background()

	// list_files
	out, err := reg.Invoke(ctx, ac, "list_files", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("list_files: %v", err)
	}
	files1 := out.(map[string]any)["files"].([]map[string]any)
	if len(files1) == 0 {
		t.Fatalf("list_files returned no files")
	}

	// read_file
	out, err = reg.Invoke(ctx, ac, "read_file", json.RawMessage(`{"path":"notes.md"}`))
	if err != nil {
		t.Fatalf("read_file: %v", err)
	}
	if !strings.Contains(out.(map[string]any)["content"].(string), "quick brown fox") {
		t.Errorf("read_file content unexpected")
	}

	// search_semantic (sparse-only because no embed profile)
	out, err = reg.Invoke(ctx, ac, "search_semantic", json.RawMessage(`{"query":"fox*","k":3}`))
	if err != nil {
		t.Fatalf("search_semantic: %v", err)
	}
	hits := out.(map[string]any)["hits"].([]ChunkHit)
	if len(hits) == 0 {
		t.Fatalf("search returned 0 hits")
	}

	// edit_file
	out, err = reg.Invoke(ctx, ac, "edit_file",
		json.RawMessage(`{"path":"new.md","content":"created by agent"}`))
	if err != nil {
		t.Fatalf("edit_file: %v", err)
	}
	if !out.(map[string]any)["ok"].(bool) {
		t.Errorf("edit_file ok=false")
	}
	body, err := os.ReadFile(filepath.Join(tmp, "new.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "created by agent" {
		t.Errorf("edit_file wrote wrong content: %q", string(body))
	}
}

func names(ts []Tool) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = t.Name()
	}
	return out
}
