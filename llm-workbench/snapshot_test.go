package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// gitInit lays down a minimal repo in `dir` so SnapshotService.Take
// has somewhere to commit. Skips the test if `git` isn't on PATH so
// CI environments without it stay green.
func gitInit(t *testing.T, dir string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	for _, args := range [][]string{
		{"init", "--quiet"},
		{"config", "user.email", "test@example.com"},
		{"config", "user.name", "test"},
		{"commit", "--allow-empty", "-m", "initial"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
}

func setupSnapshotProject(t *testing.T) (*SnapshotService, string, string) {
	t.Helper()
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	gitInit(t, tmp)
	if err := os.WriteFile(filepath.Join(tmp, "x.md"), []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	prs := &ProjectService{projects: []Project{{ID: "p", Path: tmp, Name: "test"}}}
	return NewSnapshotService(prs), tmp, "p"
}

func TestSnapshotTakeAppendsToLog(t *testing.T) {
	svc, tmp, pid := setupSnapshotProject(t)
	snap, err := svc.Take(context.Background(), pid, "auto-edit", "stream-1")
	if err != nil {
		t.Fatal(err)
	}
	if snap.SHA == "" {
		t.Errorf("SHA empty")
	}
	if snap.ModeID != "auto-edit" || snap.StreamID != "stream-1" {
		t.Errorf("metadata wrong: %+v", snap)
	}
	all, err := svc.List(pid)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].SHA != snap.SHA {
		t.Errorf("log mismatch: %+v", all)
	}

	// Direct file check too.
	body, _ := os.ReadFile(filepath.Join(tmp, ProjectDirName, "snapshots.jsonl"))
	if !strings.Contains(string(body), snap.SHA) {
		t.Errorf("jsonl missing sha")
	}
}

func TestSnapshotRevertRestoresFile(t *testing.T) {
	svc, tmp, pid := setupSnapshotProject(t)
	if _, err := svc.Take(context.Background(), pid, "auto-edit", ""); err != nil {
		t.Fatal(err)
	}
	// Mutate after the snapshot.
	if err := os.WriteFile(filepath.Join(tmp, "x.md"), []byte("v2-AGENT"), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "add", "-A")
	cmd.Dir = tmp
	_ = cmd.Run()
	cmd = exec.Command("git", "commit", "-m", "agent-change")
	cmd.Dir = tmp
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("commit agent-change: %v\n%s", err, out)
	}

	if _, err := svc.Revert(context.Background(), pid, ""); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(tmp, "x.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "v1" {
		t.Errorf("revert content = %q, want v1", string(body))
	}
	// Log entry should now be marked reverted.
	all, _ := svc.List(pid)
	if len(all) == 0 || !all[len(all)-1].Reverted {
		t.Errorf("snapshot not flagged reverted: %+v", all)
	}
}

func TestSnapshotLatestUnrevertedSkipsReverted(t *testing.T) {
	svc, _, pid := setupSnapshotProject(t)
	first, _ := svc.Take(context.Background(), pid, "agent", "")
	second, _ := svc.Take(context.Background(), pid, "agent", "")

	// Mark first as reverted in the log via the revert path on its SHA.
	if _, err := svc.Revert(context.Background(), pid, first.SHA); err != nil {
		t.Fatal(err)
	}
	got, err := svc.LatestUnreverted(pid)
	if err != nil {
		t.Fatal(err)
	}
	if got.SHA != second.SHA {
		t.Errorf("latest unreverted = %s, want %s", got.SHA, second.SHA)
	}
}

func TestSnapshotTakeRefusesNonGitProject(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, ProjectDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	prs := &ProjectService{projects: []Project{{ID: "p", Path: tmp, Name: "x"}}}
	svc := NewSnapshotService(prs)
	if _, err := svc.Take(context.Background(), "p", "agent", ""); err == nil {
		t.Fatal("expected error for non-git project")
	}
}
