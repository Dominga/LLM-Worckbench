package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReindexEndToEnd(t *testing.T) {
	tmp := t.TempDir()
	stateDir := filepath.Join(tmp, ProjectDirName)
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "project.toml"),
		[]byte(`version = 1
name = "test"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	// Two markdown files + one binary that must be skipped.
	if err := os.WriteFile(filepath.Join(tmp, "a.md"),
		[]byte("# Heading\n\nFirst paragraph.\n\nSecond paragraph here."), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "b.md"),
		[]byte(strings.Repeat("alpha ", 200)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "skip.bin"),
		[]byte("not indexed"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Excluded subtree.
	if err := os.MkdirAll(filepath.Join(tmp, "node_modules", "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "node_modules", "pkg", "x.md"),
		[]byte("should not be indexed"), 0o644); err != nil {
		t.Fatal(err)
	}

	idx, err := OpenIndex("test-proj", tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	// Stub registry that returns our pre-opened idx.
	reg := &IndexRegistry{open: map[string]*IndexDB{"test-proj": idx}}
	prs := &ProjectService{
		projects: []Project{{ID: "test-proj", Path: tmp, Name: "test"}},
	}
	reg.projects = prs

	fx := NewFileIndexer(prs, reg)
	prog, err := fx.Reindex("test-proj")
	if err != nil {
		t.Fatal(err)
	}
	if prog.FilesProcessed < 2 {
		t.Fatalf("FilesProcessed = %d, want ≥ 2; errors=%v", prog.FilesProcessed, prog.Errors)
	}
	if prog.ChunksAdded == 0 {
		t.Fatalf("ChunksAdded = 0; errors=%v", prog.Errors)
	}

	// Re-run: should be idempotent, no new chunks.
	prog2, err := fx.Reindex("test-proj")
	if err != nil {
		t.Fatal(err)
	}
	if prog2.ChunksAdded != 0 || prog2.ChunksRemoved != 0 {
		t.Fatalf("idempotency broken: added=%d removed=%d", prog2.ChunksAdded, prog2.ChunksRemoved)
	}

	// Mutate a.md → expect replace.
	if err := os.WriteFile(filepath.Join(tmp, "a.md"),
		[]byte("# Different\n\nNew paragraph entirely."), 0o644); err != nil {
		t.Fatal(err)
	}
	prog3, err := fx.Reindex("test-proj")
	if err != nil {
		t.Fatal(err)
	}
	if prog3.ChunksAdded == 0 || prog3.ChunksRemoved == 0 {
		t.Fatalf("expected replace, got added=%d removed=%d", prog3.ChunksAdded, prog3.ChunksRemoved)
	}

	// Delete b.md → expect GC.
	if err := os.Remove(filepath.Join(tmp, "b.md")); err != nil {
		t.Fatal(err)
	}
	prog4, err := fx.Reindex("test-proj")
	if err != nil {
		t.Fatal(err)
	}
	if prog4.FilesRemoved != 1 {
		t.Fatalf("FilesRemoved = %d, want 1", prog4.FilesRemoved)
	}

	// Verify FTS5 actually populated: search for a known word.
	idx.mu.Lock()
	defer idx.mu.Unlock()
	var n int
	if err := idx.db.QueryRow(
		`SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH ?`,
		"paragraph",
	).Scan(&n); err != nil {
		t.Fatalf("fts query: %v", err)
	}
	if n == 0 {
		t.Fatalf("FTS5 returned 0 hits for 'paragraph'")
	}
}
