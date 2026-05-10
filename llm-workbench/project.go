package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/google/uuid"
)

// Project is a workspace tied to a single directory tree on disk. The
// directory itself is the source of truth for content; SQLite (M2) lives
// inside `.llm-workshop/` and only stores derived data.
type Project struct {
	ID         string    `toml:"id"`
	Path       string    `toml:"path"`
	Name       string    `toml:"name"`
	CreatedAt  time.Time `toml:"created_at"`
	LastOpened time.Time `toml:"last_opened"`
}

// projectMeta is the per-project document at <root>/project.toml. The
// global registry holds the user-facing list, this file holds whatever
// lives with the project itself.
type projectMeta struct {
	Version  int            `toml:"version"`
	Name     string         `toml:"name"`
	Indexing IndexingConfig `toml:"indexing,omitempty"`
}

// IndexingConfig is the `[indexing]` section of project.toml. Drives
// FileIndexer's file-walk and Chunker's split parameters. All fields
// have defaults so an empty section is valid.
type IndexingConfig struct {
	Include       []string `toml:"include,omitempty"`
	Exclude       []string `toml:"exclude,omitempty"`
	ChunkChars    int      `toml:"chunk_chars,omitempty"`
	OverlapChars  int      `toml:"overlap_chars,omitempty"`
}

// DefaultIndexingConfig returns the baseline rules. The exclude list
// covers the paths this app itself writes to plus the most common
// build/vendor noise so a fresh `git init`'d project does not index its
// own dependencies.
func DefaultIndexingConfig() IndexingConfig {
	return IndexingConfig{
		Include: []string{"**/*.md", "**/*.markdown", "**/*.txt"},
		Exclude: []string{
			ProjectDirName + "/**",
			".git/**",
			"node_modules/**",
			"vendor/**",
			"build/**",
			"dist/**",
		},
		ChunkChars:   2048,
		OverlapChars: 256,
	}
}

// projectsFile is the global registry shape.
type projectsFile struct {
	Version          int       `toml:"version"`
	ActiveProjectID  string    `toml:"active_project_id,omitempty"`
	Projects         []Project `toml:"project"`
}

// ProjectService manages the global project registry plus per-project
// initialization (project.toml, .llm-workshop dir, .gitignore, git init).
type ProjectService struct {
	mu       sync.RWMutex
	path     string
	active   string
	projects []Project
}

func NewProjectService() (*ProjectService, error) {
	path, err := projectsPath()
	if err != nil {
		return nil, err
	}
	ps := &ProjectService{path: path}
	if err := ps.load(); err != nil {
		return nil, err
	}
	return ps, nil
}

func (ps *ProjectService) load() error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	data, err := os.ReadFile(ps.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read %s: %w", ps.path, err)
	}
	var doc projectsFile
	if err := toml.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("parse %s: %w", ps.path, err)
	}
	ps.projects = doc.Projects
	ps.active = doc.ActiveProjectID
	return nil
}

func (ps *ProjectService) save() error {
	doc := projectsFile{
		Version:         1,
		ActiveProjectID: ps.active,
		Projects:        append([]Project(nil), ps.projects...),
	}
	tmp := ps.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("create %s: %w", tmp, err)
	}
	enc := toml.NewEncoder(f)
	enc.Indent = "  "
	if err := enc.Encode(doc); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, ps.path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// List returns all known projects, sorted by LastOpened descending so the
// UI can show "recent" naturally.
func (ps *ProjectService) List() []Project {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	out := make([]Project, len(ps.projects))
	copy(out, ps.projects)
	sort.Slice(out, func(i, j int) bool {
		return out[i].LastOpened.After(out[j].LastOpened)
	})
	return out
}

func (ps *ProjectService) Get(id string) (Project, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	for _, p := range ps.projects {
		if p.ID == id {
			return p, nil
		}
	}
	return Project{}, fmt.Errorf("project %q not found", id)
}

// ActiveID returns the currently active project ID, "" if none.
func (ps *ProjectService) ActiveID() string {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return ps.active
}

func (ps *ProjectService) Active() (Project, bool) {
	ps.mu.RLock()
	id := ps.active
	ps.mu.RUnlock()
	if id == "" {
		return Project{}, false
	}
	p, err := ps.Get(id)
	if err != nil {
		return Project{}, false
	}
	return p, true
}

// SetActive marks a registered project as the current one. Updates
// LastOpened so it floats to the top of the list.
func (ps *ProjectService) SetActive(id string) (Project, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	for i, p := range ps.projects {
		if p.ID == id {
			ps.projects[i].LastOpened = time.Now().UTC()
			ps.active = id
			if err := ps.save(); err != nil {
				return Project{}, err
			}
			return ps.projects[i], nil
		}
	}
	return Project{}, fmt.Errorf("project %q not found", id)
}

// Open registers a project from an existing directory and runs the
// initialisation steps (project.toml, .llm-workshop, .gitignore, git
// init). If the directory is already registered, it is bumped to active.
func (ps *ProjectService) Open(path string) (Project, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Project{}, fmt.Errorf("abs path: %w", err)
	}
	st, err := os.Stat(abs)
	if err != nil {
		return Project{}, fmt.Errorf("stat %s: %w", abs, err)
	}
	if !st.IsDir() {
		return Project{}, fmt.Errorf("%s is not a directory", abs)
	}

	ps.mu.Lock()
	for i, p := range ps.projects {
		if p.Path == abs {
			ps.projects[i].LastOpened = time.Now().UTC()
			ps.active = p.ID
			updated := ps.projects[i]
			err := ps.save()
			ps.mu.Unlock()
			if err != nil {
				return Project{}, err
			}
			// Best-effort re-init in case the user wiped the dir between
			// sessions.
			_ = ps.initLayout(updated)
			return updated, nil
		}
	}
	ps.mu.Unlock()

	name := readProjectName(abs)
	if name == "" {
		name = filepath.Base(abs)
	}

	now := time.Now().UTC()
	p := Project{
		ID:         uuid.NewString(),
		Path:       abs,
		Name:       name,
		CreatedAt:  now,
		LastOpened: now,
	}
	if err := ps.initLayout(p); err != nil {
		return Project{}, err
	}

	ps.mu.Lock()
	ps.projects = append(ps.projects, p)
	ps.active = p.ID
	if err := ps.save(); err != nil {
		ps.projects = ps.projects[:len(ps.projects)-1]
		ps.mu.Unlock()
		return Project{}, err
	}
	ps.mu.Unlock()
	return p, nil
}

// Create makes a new project at `path` (mkdir-p), then registers it like
// Open. The provided `name` is written into project.toml; defaults to the
// directory's basename.
func (ps *ProjectService) Create(path, name string) (Project, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Project{}, fmt.Errorf("abs path: %w", err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return Project{}, fmt.Errorf("mkdir %s: %w", abs, err)
	}
	if name == "" {
		name = filepath.Base(abs)
	}
	if err := writeProjectMeta(abs, name); err != nil {
		return Project{}, err
	}
	return ps.Open(abs)
}

// Delete removes a project from the registry. Files on disk are NOT
// touched — only the bookkeeping. The active selection moves to the next
// most-recent project, or "" if none remain.
func (ps *ProjectService) Delete(id string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	for i, p := range ps.projects {
		if p.ID == id {
			ps.projects = append(ps.projects[:i], ps.projects[i+1:]...)
			if ps.active == id {
				ps.active = ""
				// Pick the next most-recent project as fallback.
				var newest Project
				for _, q := range ps.projects {
					if q.LastOpened.After(newest.LastOpened) {
						newest = q
					}
				}
				if newest.ID != "" {
					ps.active = newest.ID
				}
			}
			return ps.save()
		}
	}
	return nil
}

// initLayout creates the per-project state directory, the gitignore
// entry, and an `git init` if no `.git` is present. Failures of git init
// are non-fatal (M1: git wrap is M3).
func (ps *ProjectService) initLayout(p Project) error {
	stateDir := filepath.Join(p.Path, ProjectDirName)
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return fmt.Errorf("mkdir state dir: %w", err)
	}
	// Sessions sub-directory — JSONL drops here in PR4.
	if err := os.MkdirAll(filepath.Join(stateDir, "sessions"), 0o755); err != nil {
		return fmt.Errorf("mkdir sessions dir: %w", err)
	}
	// project.toml is owned by the user; only stamp it if missing.
	metaPath := filepath.Join(p.Path, "project.toml")
	if _, err := os.Stat(metaPath); errors.Is(err, os.ErrNotExist) {
		if err := writeProjectMeta(p.Path, p.Name); err != nil {
			return err
		}
	}
	if err := ensureGitignoreEntry(p.Path, ProjectDirName); err != nil {
		return err
	}
	// Optional `git init`.
	if _, err := os.Stat(filepath.Join(p.Path, ".git")); errors.Is(err, os.ErrNotExist) {
		if path, err := exec.LookPath("git"); err == nil {
			cmd := exec.Command(path, "init", "--quiet")
			cmd.Dir = p.Path
			_ = cmd.Run() // best effort — failures don't block project open
		}
	}
	return nil
}

// readProjectName reads project.toml if present and returns its `name`.
func readProjectName(root string) string {
	data, err := os.ReadFile(filepath.Join(root, "project.toml"))
	if err != nil {
		return ""
	}
	var meta projectMeta
	if err := toml.Unmarshal(data, &meta); err != nil {
		return ""
	}
	return meta.Name
}

func writeProjectMeta(root, name string) error {
	meta := projectMeta{Version: 1, Name: name}
	tmp := filepath.Join(root, "project.toml.tmp")
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("create %s: %w", tmp, err)
	}
	enc := toml.NewEncoder(f)
	enc.Indent = "  "
	if err := enc.Encode(meta); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, filepath.Join(root, "project.toml"))
}

// ensureGitignoreEntry appends a line for `entry` to the project's
// .gitignore if not already present. Creates the file if missing. Skips
// if the project has no .git directory yet (we still want it tracked once
// the user enables git later, so always write it).
func ensureGitignoreEntry(root, entry string) error {
	path := filepath.Join(root, ".gitignore")
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read .gitignore: %w", err)
	}
	pattern := "/" + entry + "/"
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if t == pattern || t == entry+"/" || t == entry {
			return nil
		}
	}
	prefix := ""
	if len(data) > 0 && !strings.HasSuffix(string(data), "\n") {
		prefix = "\n"
	}
	out := string(data) + prefix + pattern + "\n"
	return os.WriteFile(path, []byte(out), 0o644)
}
