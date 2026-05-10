package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestScripting(t *testing.T) (*ScriptingService, string) {
	t.Helper()
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "notes.md"),
		[]byte("# Notes\n\nfox jumps."), 0o644); err != nil {
		t.Fatal(err)
	}
	prs := &ProjectService{projects: []Project{{ID: "p", Path: tmp, Name: "test"}}}
	files := NewFileService(prs)
	idx, err := OpenIndex("p", tmp)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = idx.Close() })
	indexes := &IndexRegistry{open: map[string]*IndexDB{"p": idx}, projects: prs}
	indexer := NewFileIndexer(prs, indexes)
	if _, err := indexer.Reindex("p"); err != nil {
		t.Fatal(err)
	}
	rag := NewRAGService(nil, indexes)
	return NewScriptingService(prs, files, nil, rag, nil, indexes), tmp
}

func TestScriptingLogCollects(t *testing.T) {
	s, _ := newTestScripting(t)
	res := s.Run(context.Background(), "p", `app.log("hello", "world"); app.log(42);`)
	if res.Error != "" {
		t.Fatalf("err: %q", res.Error)
	}
	if len(res.Output) != 2 {
		t.Fatalf("output len = %d, want 2: %v", len(res.Output), res.Output)
	}
	if res.Output[0] != "hello world" {
		t.Errorf("out[0] = %q", res.Output[0])
	}
}

func TestScriptingFSRead(t *testing.T) {
	s, _ := newTestScripting(t)
	res := s.Run(context.Background(), "p", `app.fs.read("notes.md");`)
	if res.Error != "" {
		t.Fatalf("err: %q", res.Error)
	}
	content, ok := res.Return.(string)
	if !ok || !strings.Contains(content, "fox jumps") {
		t.Errorf("return = %v, want notes content", res.Return)
	}
}

func TestScriptingFSWrite(t *testing.T) {
	s, tmp := newTestScripting(t)
	res := s.Run(context.Background(), "p", `app.fs.write("new.md", "from script"); app.fs.read("new.md");`)
	if res.Error != "" {
		t.Fatalf("err: %q", res.Error)
	}
	body, err := os.ReadFile(filepath.Join(tmp, "new.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "from script" {
		t.Errorf("on-disk content = %q", string(body))
	}
}

func TestScriptingFSList(t *testing.T) {
	s, _ := newTestScripting(t)
	res := s.Run(context.Background(), "p", `app.fs.list();`)
	if res.Error != "" {
		t.Fatalf("err: %q", res.Error)
	}
	list, ok := res.Return.([]string)
	if !ok {
		t.Fatalf("return type = %T, want []string", res.Return)
	}
	found := false
	for _, p := range list {
		if p == "notes.md" {
			found = true
		}
	}
	if !found {
		t.Errorf("notes.md not in list: %v", list)
	}
}

func TestScriptingRAGSearchSparse(t *testing.T) {
	s, _ := newTestScripting(t)
	res := s.Run(context.Background(), "p", `app.rag.search("fox*");`)
	if res.Error != "" {
		t.Fatalf("err: %q", res.Error)
	}
	list, ok := res.Return.([]ChunkHit)
	if !ok {
		t.Fatalf("return = %T %v", res.Return, res.Return)
	}
	if len(list) == 0 {
		t.Errorf("no hits for fox*")
	}
}

func TestScriptingErrorBubblesUp(t *testing.T) {
	s, _ := newTestScripting(t)
	res := s.Run(context.Background(), "p", `throw new Error("nope");`)
	if res.Error == "" {
		t.Fatal("expected error to surface")
	}
	if !strings.Contains(res.Error, "nope") {
		t.Errorf("error = %q, want 'nope'", res.Error)
	}
}

func TestScriptingReturnValueExported(t *testing.T) {
	s, _ := newTestScripting(t)
	res := s.Run(context.Background(), "p", `1 + 2`)
	if res.Error != "" {
		t.Fatalf("err: %q", res.Error)
	}
	// goja exports JS number → int64 or float64 depending on value.
	switch v := res.Return.(type) {
	case int64:
		if v != 3 {
			t.Errorf("got %d", v)
		}
	case float64:
		if v != 3 {
			t.Errorf("got %v", v)
		}
	default:
		t.Errorf("return type = %T", res.Return)
	}
}

func TestScriptingProjectGlobal(t *testing.T) {
	s, _ := newTestScripting(t)
	res := s.Run(context.Background(), "p", `app.project.id + ":" + app.project.name`)
	if res.Error != "" {
		t.Fatalf("err: %q", res.Error)
	}
	if got, _ := res.Return.(string); got != "p:test" {
		t.Errorf("project = %q, want p:test", got)
	}
}

func TestScriptingFSPathsClampedToProject(t *testing.T) {
	s, tmp := newTestScripting(t)
	// resolveSafe anchors `..` to the project root, so "../foo" lands
	// at <root>/foo rather than escaping. Verify that the parent dir
	// got no new file.
	res := s.Run(context.Background(), "p", `app.fs.write("../escape.md", "x");`)
	if res.Error != "" {
		t.Fatalf("expected write to land inside project, got error: %q", res.Error)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(tmp), "escape.md")); err == nil {
		t.Fatal("path traversal leaked outside project root!")
	}
}
