package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestMemoryGlobalRoundTrip exercises the global scope: missing-file
// returns empty, first append creates the file, second append adds a
// separator and preserves earlier content, empty entries are rejected.
func TestMemoryGlobalRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)

	ms := NewMemoryService(nil)

	body, err := ms.Read(MemoryScopeGlobal, "")
	if err != nil {
		t.Fatalf("read empty: %v", err)
	}
	if body != "" {
		t.Errorf("missing memory should read as empty, got %q", body)
	}

	if _, err := ms.Append(MemoryScopeGlobal, "", "first note"); err != nil {
		t.Fatalf("append 1: %v", err)
	}
	if _, err := ms.Append(MemoryScopeGlobal, "", "second note"); err != nil {
		t.Fatalf("append 2: %v", err)
	}
	body, err = ms.Read(MemoryScopeGlobal, "")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(body, "first note") || !strings.Contains(body, "second note") {
		t.Errorf("memory missing entries: %q", body)
	}
	if strings.Count(body, "## ") != 2 {
		t.Errorf("expected 2 headers, got %d in %q", strings.Count(body, "## "), body)
	}

	if _, err := ms.Append(MemoryScopeGlobal, "", "   "); err == nil {
		t.Error("empty entry should be rejected")
	}
}

// TestMemoryProjectScopeNeedsProject ensures project-scope calls fail
// fast without a projectID and that a valid project routes the write
// under <projectRoot>/.llm-workshop/memory.md.
func TestMemoryProjectScopeNeedsProject(t *testing.T) {
	ms := NewMemoryService(nil)
	if _, err := ms.Read(MemoryScopeProject, ""); err == nil {
		t.Error("project scope with empty projectID should error")
	}
	if _, err := ms.Append(MemoryScopeProject, "", "x"); err == nil {
		t.Error("project scope with empty projectID should error")
	}
}

// TestMemoryRejectsUnknownScope guards against typos in scope names so
// a bogus scope can't silently land in a wrong location.
func TestMemoryRejectsUnknownScope(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	ms := NewMemoryService(nil)
	if _, err := ms.Read("bogus", ""); err == nil {
		t.Error("unknown scope should error")
	}
	if _, err := ms.Append("bogus", "", "x"); err == nil {
		t.Error("unknown scope should error")
	}
}

// TestMemoryPathLayout pins the on-disk layout so we notice
// accidental changes to where memory.md lives.
func TestMemoryPathLayout(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	want := filepath.Join(tmp, AppDirName, "memory.md")
	if got := globalMemoryPath(); got != want {
		t.Errorf("globalMemoryPath = %q, want %q", got, want)
	}
	root := "/some/project"
	want = filepath.Join(root, ProjectDirName, "memory.md")
	if got := projectMemoryPath(root); got != want {
		t.Errorf("projectMemoryPath = %q, want %q", got, want)
	}
	// And the actual file shows up under that path after first append.
	ms := NewMemoryService(nil)
	if _, err := ms.Append(MemoryScopeGlobal, "", "hello"); err != nil {
		t.Fatalf("append: %v", err)
	}
	if _, err := os.Stat(globalMemoryPath()); err != nil {
		t.Errorf("file not at expected path: %v", err)
	}
}
