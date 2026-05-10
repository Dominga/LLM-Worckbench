package main

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestScriptStore(t *testing.T) (*ScriptStore, string) {
	t.Helper()
	tmp := t.TempDir()
	prs := &ProjectService{projects: []Project{{ID: "p", Path: tmp, Name: "test"}}}
	return NewScriptStore(prs), tmp
}

func TestScriptStoreSaveAndLoad(t *testing.T) {
	s, _ := newTestScriptStore(t)
	src := `app.log("hi");`
	meta, err := s.Save("p", "greet", src)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Name != "greet" {
		t.Errorf("name = %q, want greet", meta.Name)
	}
	got, err := s.Load("p", "greet")
	if err != nil {
		t.Fatal(err)
	}
	if got != src {
		t.Errorf("loaded = %q, want %q", got, src)
	}
}

func TestScriptStoreList(t *testing.T) {
	s, _ := newTestScriptStore(t)
	for _, n := range []string{"b-second", "a-first", "c-third"} {
		if _, err := s.Save("p", n, "// "+n); err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.List("p")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("len = %d, want 3", len(all))
	}
	if all[0].Name != "a-first" || all[2].Name != "c-third" {
		t.Errorf("sort wrong: %v", scriptNames(all))
	}
}

func TestScriptStoreDelete(t *testing.T) {
	s, _ := newTestScriptStore(t)
	if _, err := s.Save("p", "x", "1"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("p", "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load("p", "x"); err == nil {
		t.Error("expected load to fail after delete")
	}
	// Delete-missing is a no-op.
	if err := s.Delete("p", "ghost"); err != nil {
		t.Errorf("delete missing should not error, got %v", err)
	}
}

func TestScriptStoreSaveOverwrites(t *testing.T) {
	s, _ := newTestScriptStore(t)
	if _, err := s.Save("p", "k", "v1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save("p", "k", "v2"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Load("p", "k")
	if got != "v2" {
		t.Errorf("got %q after overwrite", got)
	}
}

func TestScriptStoreNameValidation(t *testing.T) {
	s, _ := newTestScriptStore(t)
	bad := []string{"", "../escape", "with space", "weird/slash", "dot.."}
	for _, n := range bad {
		if _, err := s.Save("p", n, "x"); err == nil {
			t.Errorf("Save(%q) should error", n)
		}
		if _, err := s.Load("p", n); err == nil {
			t.Errorf("Load(%q) should error", n)
		}
		if err := s.Delete("p", n); err == nil {
			t.Errorf("Delete(%q) should error", n)
		}
	}
	for _, n := range []string{"a", "snake_case", "kebab-case", "Mixed.123"} {
		if _, err := s.Save("p", n, "x"); err != nil {
			t.Errorf("Save(%q) should pass, got %v", n, err)
		}
	}
}

func TestScriptStoreListIgnoresNonJS(t *testing.T) {
	s, tmp := newTestScriptStore(t)
	dir := filepath.Join(tmp, ProjectDirName, "scripts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save("p", "real", "x"); err != nil {
		t.Fatal(err)
	}
	all, _ := s.List("p")
	if len(all) != 1 || all[0].Name != "real" {
		t.Errorf("non-js leaked: %v", scriptNames(all))
	}
}

func scriptNames(ss []ScriptFile) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = s.Name
	}
	return out
}
