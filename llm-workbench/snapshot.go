package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// AgentSnapshot is one git checkpoint taken before an agent loop run
// under `approval = "snapshot"`. SHA is the commit the project was on
// when the snapshot was taken — i.e. the parent the user's working
// tree should be restored to on revert.
type AgentSnapshot struct {
	SHA       string    `json:"sha"`
	StreamID  string    `json:"streamId,omitempty"`
	ModeID    string    `json:"modeId"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"ts"`
	Reverted  bool      `json:"reverted,omitempty"`
}

// SnapshotService takes / lists / reverts pre-agent git snapshots for
// a project. State (the JSONL log of taken snapshots) lives at
// `<project>/.llm-workshop/snapshots.jsonl` so it survives across app
// restarts. The actual git history is the source of truth for the
// commits themselves; the JSONL just lets us pair commits with the
// loop / mode that triggered them, and find the most recent one to
// revert to.
type SnapshotService struct {
	mu       sync.Mutex
	projects *ProjectService
}

func NewSnapshotService(ps *ProjectService) *SnapshotService {
	return &SnapshotService{projects: ps}
}

// Take stages everything in the working tree, creates an empty-allowed
// commit so the snapshot is reachable even if the index was clean,
// and returns the new commit SHA. The SHA is also appended to the
// project's snapshots.jsonl. Errors propagate intact (e.g. when git
// is missing or the project is not a repo).
func (s *SnapshotService) Take(ctx context.Context, projectID, modeID, streamID string) (AgentSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.projects == nil {
		return AgentSnapshot{}, errors.New("project service unavailable")
	}
	p, err := s.projects.Get(projectID)
	if err != nil {
		return AgentSnapshot{}, err
	}
	if !isGitRepo(p.Path) {
		return AgentSnapshot{}, errors.New("snapshot: project is not a git repo (run `git init`)")
	}
	// Ensure .llm-workshop/ is gitignored so the snapshot.jsonl log
	// itself doesn't ride into the snapshot commit and get wiped on
	// revert. Idempotent — does nothing when the entry already
	// exists.
	if err := ensureGitignoreEntry(p.Path, ProjectDirName); err != nil {
		return AgentSnapshot{}, fmt.Errorf("gitignore: %w", err)
	}

	if _, err := runGit(ctx, p.Path, "add", "-A"); err != nil {
		return AgentSnapshot{}, fmt.Errorf("git add: %w", err)
	}
	msg := fmt.Sprintf("agent: snapshot before %s @ %s", modeID, time.Now().UTC().Format(time.RFC3339))
	// --allow-empty so a clean tree still produces a checkpoint.
	if _, err := runGit(ctx, p.Path, "commit", "--allow-empty", "-m", msg); err != nil {
		// Git may complain about identity / hooks. Surface the message
		// so the user can see the underlying issue.
		return AgentSnapshot{}, fmt.Errorf("git commit: %w", err)
	}
	sha, err := runGit(ctx, p.Path, "rev-parse", "HEAD")
	if err != nil {
		return AgentSnapshot{}, fmt.Errorf("git rev-parse: %w", err)
	}
	snap := AgentSnapshot{
		SHA:       strings.TrimSpace(sha),
		StreamID:  streamID,
		ModeID:    modeID,
		Message:   msg,
		Timestamp: time.Now().UTC(),
	}
	if err := appendSnapshotLog(p.Path, snap); err != nil {
		// Non-fatal — the commit exists either way; revert can still
		// fall back to git reflog.
		fmt.Fprintf(os.Stderr, "snapshot log append: %v\n", err)
	}
	return snap, nil
}

// LatestUnreverted returns the most recent snapshot in the log that
// has not been marked reverted yet. Used by Revert when the caller
// does not name a SHA explicitly.
func (s *SnapshotService) LatestUnreverted(projectID string) (AgentSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.projects.Get(projectID)
	if err != nil {
		return AgentSnapshot{}, err
	}
	all, err := readSnapshotLog(p.Path)
	if err != nil {
		return AgentSnapshot{}, err
	}
	for i := len(all) - 1; i >= 0; i-- {
		if !all[i].Reverted {
			return all[i], nil
		}
	}
	return AgentSnapshot{}, errors.New("no unreverted snapshot found")
}

// List returns the full snapshot log for the project, oldest first.
func (s *SnapshotService) List(projectID string) ([]AgentSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.projects.Get(projectID)
	if err != nil {
		return nil, err
	}
	return readSnapshotLog(p.Path)
}

// Revert hard-resets the working tree to the parent of the snapshot
// commit, effectively undoing every change the agent made on top of
// it. Marks the snapshot as reverted in the log. If `sha` is empty,
// uses the latest unreverted snapshot.
func (s *SnapshotService) Revert(ctx context.Context, projectID, sha string) (AgentSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.projects == nil {
		return AgentSnapshot{}, errors.New("project service unavailable")
	}
	p, err := s.projects.Get(projectID)
	if err != nil {
		return AgentSnapshot{}, err
	}
	all, _ := readSnapshotLog(p.Path)
	target := AgentSnapshot{}
	if sha == "" {
		for i := len(all) - 1; i >= 0; i-- {
			if !all[i].Reverted {
				target = all[i]
				break
			}
		}
	} else {
		for _, snap := range all {
			if snap.SHA == sha {
				target = snap
				break
			}
		}
	}
	if target.SHA == "" {
		return AgentSnapshot{}, errors.New("no matching snapshot")
	}
	// Reset to the snapshot SHA itself — the snapshot represents the
	// state to restore to (it was taken right BEFORE the agent ran).
	if _, err := runGit(ctx, p.Path, "reset", "--hard", target.SHA); err != nil {
		return AgentSnapshot{}, fmt.Errorf("git reset: %w", err)
	}
	target.Reverted = true
	if err := rewriteSnapshotLog(p.Path, all, target); err != nil {
		fmt.Fprintf(os.Stderr, "snapshot log update: %v\n", err)
	}
	return target, nil
}

// ───────────────────────── helpers ──────────────────────────

func isGitRepo(root string) bool {
	st, err := os.Stat(filepath.Join(root, ".git"))
	if err != nil {
		return false
	}
	// .git can be a directory (normal repo) or a file (submodule /
	// worktree gitlink). Either is fine for our use.
	return st.IsDir() || st.Mode().IsRegular()
}

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return stdout.String(), fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

func snapshotLogPath(root string) string {
	return filepath.Join(root, ProjectDirName, "snapshots.jsonl")
}

func appendSnapshotLog(root string, snap AgentSnapshot) error {
	path := snapshotLogPath(root)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	return enc.Encode(snap)
}

func readSnapshotLog(root string) ([]AgentSnapshot, error) {
	path := snapshotLogPath(root)
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var out []AgentSnapshot
	for sc.Scan() {
		var snap AgentSnapshot
		if err := json.Unmarshal(sc.Bytes(), &snap); err != nil {
			continue
		}
		out = append(out, snap)
	}
	return out, sc.Err()
}

// rewriteSnapshotLog replaces the entry whose SHA matches `updated`
// with the new value, and rewrites the file atomically. Used by
// Revert to flip the `reverted` flag.
func rewriteSnapshotLog(root string, all []AgentSnapshot, updated AgentSnapshot) error {
	path := snapshotLogPath(root)
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	for _, snap := range all {
		if snap.SHA == updated.SHA {
			snap = updated
		}
		if err := enc.Encode(snap); err != nil {
			f.Close()
			os.Remove(tmp)
			return err
		}
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}
