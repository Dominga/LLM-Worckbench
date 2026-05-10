package main

import (
	"strings"
	"testing"
)

func TestChunkerEmpty(t *testing.T) {
	c := DefaultChunker()
	if got := c.Chunk("a.md", ""); got != nil {
		t.Fatalf("empty input → %v, want nil", got)
	}
}

func TestChunkerSinglePara(t *testing.T) {
	c := &Chunker{TargetChars: 200, OverlapChars: 0}
	in := "Short paragraph fits in one chunk."
	got := c.Chunk("a.md", in)
	if len(got) != 1 {
		t.Fatalf("len(chunks) = %d, want 1", len(got))
	}
	if got[0].Content != in {
		t.Fatalf("content mismatch")
	}
	if got[0].StartByte != 0 || got[0].EndByte != len(in) {
		t.Fatalf("offsets %d-%d, want 0-%d", got[0].StartByte, got[0].EndByte, len(in))
	}
}

func TestChunkerMultiParaWithOverlap(t *testing.T) {
	c := &Chunker{TargetChars: 60, OverlapChars: 10}
	// 3 paragraphs of ~50 chars; should produce ≥2 chunks with overlap.
	in := strings.Repeat("alpha ", 9) + "\n\n" +
		strings.Repeat("beta ", 9) + "\n\n" +
		strings.Repeat("gamma ", 9)
	got := c.Chunk("x.md", in)
	if len(got) < 2 {
		t.Fatalf("expected ≥2 chunks, got %d", len(got))
	}
	// Each non-first chunk's StartByte must be < previous chunk's EndByte
	// (overlap), and ≥ previous chunk's StartByte (no underflow).
	for i := 1; i < len(got); i++ {
		prev, cur := got[i-1], got[i]
		if cur.StartByte > prev.EndByte {
			t.Fatalf("chunk %d gap: prev=%d-%d, cur start=%d", i, prev.StartByte, prev.EndByte, cur.StartByte)
		}
		if cur.StartByte < prev.StartByte {
			t.Fatalf("chunk %d underflow", i)
		}
	}
}

func TestChunkerHardSplitOversizeBlock(t *testing.T) {
	c := &Chunker{TargetChars: 100, OverlapChars: 0}
	in := strings.Repeat("X", 350) // single paragraph > target
	got := c.Chunk("y.md", in)
	if len(got) < 3 {
		t.Fatalf("expected hard-split into ≥3 chunks, got %d", len(got))
	}
	for _, ch := range got {
		if size := ch.EndByte - ch.StartByte; size > c.TargetChars {
			t.Fatalf("chunk size %d exceeds target %d", size, c.TargetChars)
		}
	}
}

func TestChunkerSHADeterministic(t *testing.T) {
	c := DefaultChunker()
	in := "Some content for hashing.\n\nAnother bit."
	a := c.Chunk("p", in)
	b := c.Chunk("p", in)
	if len(a) != len(b) {
		t.Fatalf("nondeterministic count: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i].SHA256 != b[i].SHA256 {
			t.Fatalf("chunk %d sha drift: %s vs %s", i, a[i].SHA256, b[i].SHA256)
		}
	}
}

func TestGlobMatcherExclude(t *testing.T) {
	m, err := newGlobMatcher(
		[]string{"**/*.md", "**/*.txt"},
		[]string{".git/**", "node_modules/**", ProjectDirName + "/**"},
	)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		path string
		want bool
	}{
		{"README.md", true},
		{"docs/intro.md", true},
		{"node_modules/x/y.md", false},
		{".git/hooks/pre-commit.md", false},
		{ProjectDirName + "/index.db", false},
		{"src/main.go", false},
		{"notes.txt", true},
	}
	for _, c := range cases {
		if got := m.fileMatches(c.path); got != c.want {
			t.Errorf("fileMatches(%q) = %v, want %v", c.path, got, c.want)
		}
	}
	if !m.dirExcluded("node_modules") {
		t.Errorf("dirExcluded(node_modules) = false, want true")
	}
}
