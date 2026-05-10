package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// seedChunks inserts a few rows directly into chunks for a freshly
// migrated IndexDB so the embedder pipeline has data to operate on
// without going through Reindex.
func seedChunks(t *testing.T, idx *IndexDB, items []string) []int64 {
	t.Helper()
	idx.mu.Lock()
	defer idx.mu.Unlock()
	now := time.Now().Unix()
	stmt, err := idx.db.Prepare(
		`INSERT INTO chunks(path, start_byte, end_byte, content, sha256, mtime, created_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer stmt.Close()
	ids := make([]int64, len(items))
	for i, s := range items {
		res, err := stmt.Exec("seed.md", 0, len(s), s, "sha-"+s, now, now)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		ids[i] = id
	}
	return ids
}

func TestLoadPendingChunksWithoutVecTable(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenIndex("p", tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	seedChunks(t, idx, []string{"alpha", "beta", "gamma"})

	got, err := loadPendingChunks(idx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3 (vec table absent → all pending)", len(got))
	}
}

func TestEnsureVecTableAndWriteVectors(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenIndex("p", tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	ids := seedChunks(t, idx, []string{"x", "y", "z"})
	dim := 4
	if err := idx.EnsureVecTable("test-embed", dim); err != nil {
		t.Fatal(err)
	}

	pending, err := loadPendingChunks(idx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 3 {
		t.Fatalf("pending = %d before write, want 3", len(pending))
	}

	vecs := [][]float32{
		{1, 0, 0, 0},
		{0, 1, 0, 0},
		{0, 0, 1, 0},
	}
	if err := writeVectors(idx, pending, vecs); err != nil {
		t.Fatal(err)
	}

	pending2, err := loadPendingChunks(idx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending2) != 0 {
		t.Fatalf("pending after write = %d, want 0", len(pending2))
	}

	// Verify each chunk has a vec_chunks row keyed by its id.
	idx.mu.Lock()
	defer idx.mu.Unlock()
	for _, id := range ids {
		var rid int64
		if err := idx.db.QueryRow(`SELECT rowid FROM vec_chunks WHERE rowid = ?`, id).Scan(&rid); err != nil {
			t.Fatalf("vec_chunks rowid=%d missing: %v", id, err)
		}
	}

	// Stats reflect dim/model.
	stats := IndexStats{}
	stats.EmbedDim = idx.embedDim
	if stats.EmbedDim != dim {
		t.Fatalf("EmbedDim = %d, want %d", stats.EmbedDim, dim)
	}
}

func TestEnsureVecTableRejectsDimChange(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenIndex("p", tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	if err := idx.EnsureVecTable("a", 8); err != nil {
		t.Fatal(err)
	}
	if err := idx.EnsureVecTable("b", 16); err == nil {
		t.Fatal("expected error on dim change, got nil")
	}
}

