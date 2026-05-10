package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRRFFuse(t *testing.T) {
	dense := map[int64]int{
		1: 0, // top of dense
		2: 1,
		3: 2,
	}
	sparse := map[int64]int{
		3: 0, // top of sparse
		2: 1,
		4: 2,
	}
	fused := rrfFuse(dense, sparse, 60)
	// id=2 ranks 1 in both → 2 * 1/61 ≈ 0.0328
	// id=3 ranks 2 dense + 0 sparse → 1/62 + 1/60 ≈ 0.0328
	// id=1 only dense rank 0 → 1/60 ≈ 0.0167
	// id=4 only sparse rank 2 → 1/62
	if fused[2] == 0 || fused[3] == 0 {
		t.Fatalf("missing dual-source ids in fused map: %v", fused)
	}
	if fused[1] >= fused[2] {
		t.Errorf("expected dual-source id 2 to outrank single-source id 1: %v", fused)
	}
}

func TestTopKStableTieBreak(t *testing.T) {
	scores := map[int64]float64{
		5: 0.5,
		1: 0.5, // same score; smaller id wins on tie-break
		3: 0.9,
		7: 0.1,
	}
	top := topK(scores, 3)
	if len(top) != 3 {
		t.Fatalf("len=%d want 3", len(top))
	}
	if top[0].id != 3 {
		t.Errorf("top[0]=%d want 3", top[0].id)
	}
	if top[1].id != 1 || top[2].id != 5 {
		t.Errorf("tie order = %d,%d want 1,5", top[1].id, top[2].id)
	}
}

func TestSearchSparseOnly(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenIndex("p", tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	// Three chunks; query "kitten" should rank "kittens" hits above "dogs".
	seedChunks(t, idx, []string{
		"the kitten plays with yarn",
		"two kittens napping in the sun",
		"dogs bark loudly outside",
	})

	reg := &IndexRegistry{open: map[string]*IndexDB{"p": idx}}
	prs := &ProjectService{projects: []Project{{ID: "p", Path: tmp}}}
	reg.projects = prs

	rag := NewRAGService(nil, reg)
	// Prefix wildcard so "kitten" matches "kittens" too — unicode61
	// tokenizer doesn't stem.
	hits, err := rag.Search(context.Background(), "p", "", "kitten*", SearchOptions{
		K: 5, SparseOnly: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) < 2 {
		t.Fatalf("got %d hits, want ≥2", len(hits))
	}
	for _, h := range hits {
		if h.SparseRank == 0 {
			t.Errorf("sparse-only hit missing sparse rank: %+v", h)
		}
		if h.DenseRank != 0 {
			t.Errorf("sparse-only hit has dense rank: %+v", h)
		}
	}
	// Top hit must contain the queried token.
	if !contains(hits[0].Content, "kitten") {
		t.Errorf("top hit doesn't contain 'kitten': %q", hits[0].Content)
	}
}

func TestSearchRequiresEmbedProfileForDense(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenIndex("p", tmp)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	reg := &IndexRegistry{open: map[string]*IndexDB{"p": idx}}
	reg.projects = &ProjectService{projects: []Project{{ID: "p", Path: tmp}}}

	rag := NewRAGService(nil, reg)
	_, err = rag.Search(context.Background(), "p", "", "anything", SearchOptions{K: 3})
	if err == nil {
		t.Fatal("expected error when embed profile is empty and SparseOnly is false")
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
