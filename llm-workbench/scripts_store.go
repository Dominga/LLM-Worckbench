package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ScriptFile is one persisted Prompt-Lab script. Lives at
// `<project>/.llm-workshop/scripts/<name>.js`. Name is the basename
// without extension — that's the user-facing identifier.
type ScriptFile struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"` // project-relative, .llm-workshop/scripts/<name>.js
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

// scriptNameRe pins script names to a safe alphabet so they can't
// escape the scripts dir via path tricks or shell-special chars.
// Snake/kebab-case is fine; spaces and slashes are not.
var scriptNameRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)

// ScriptStore manages the per-project scripts directory.
type ScriptStore struct {
	projects *ProjectService
}

func NewScriptStore(ps *ProjectService) *ScriptStore {
	return &ScriptStore{projects: ps}
}

// scriptsDir returns the absolute path of `<project>/.llm-workshop/scripts`,
// creating it lazily on first call.
func (s *ScriptStore) scriptsDir(projectID string) (string, error) {
	if s.projects == nil {
		return "", errors.New("project service unavailable")
	}
	p, err := s.projects.Get(projectID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(p.Path, ProjectDirName, "scripts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// validateName ensures the script name can't escape the dir or clash
// with hidden / dotfile patterns we don't want to surface as scripts.
func validateScriptName(name string) error {
	if name == "" {
		return errors.New("name is required")
	}
	if !scriptNameRe.MatchString(name) {
		return fmt.Errorf("invalid script name %q (alphanumeric + . _ - only, 1..64 chars)", name)
	}
	if strings.Contains(name, "..") {
		return errors.New("name must not contain '..'")
	}
	return nil
}

// List returns all *.js files in the scripts dir, sorted by name.
func (s *ScriptStore) List(projectID string) ([]ScriptFile, error) {
	dir, err := s.scriptsDir(projectID)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []ScriptFile
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".js") {
			continue
		}
		info, iErr := e.Info()
		if iErr != nil {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".js")
		out = append(out, ScriptFile{
			Name:     name,
			Path:     filepath.ToSlash(filepath.Join(ProjectDirName, "scripts", e.Name())),
			Size:     info.Size(),
			Modified: info.ModTime(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Load returns the raw source of the named script.
func (s *ScriptStore) Load(projectID, name string) (string, error) {
	if err := validateScriptName(name); err != nil {
		return "", err
	}
	dir, err := s.scriptsDir(projectID)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, name+".js"))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// Save writes `source` to <name>.js atomically (tmp + rename).
// Overwrites an existing file without prompting; the UI is expected
// to keep its own dirty-flag.
func (s *ScriptStore) Save(projectID, name, source string) (ScriptFile, error) {
	if err := validateScriptName(name); err != nil {
		return ScriptFile{}, err
	}
	dir, err := s.scriptsDir(projectID)
	if err != nil {
		return ScriptFile{}, err
	}
	path := filepath.Join(dir, name+".js")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(source), 0o644); err != nil {
		return ScriptFile{}, fmt.Errorf("write tmp: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return ScriptFile{}, fmt.Errorf("rename: %w", err)
	}
	info, _ := os.Stat(path)
	return ScriptFile{
		Name:     name,
		Path:     filepath.ToSlash(filepath.Join(ProjectDirName, "scripts", name+".js")),
		Size:     info.Size(),
		Modified: info.ModTime(),
	}, nil
}

// Delete removes <name>.js. Returns nil if the file is already gone.
func (s *ScriptStore) Delete(projectID, name string) error {
	if err := validateScriptName(name); err != nil {
		return err
	}
	dir, err := s.scriptsDir(projectID)
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, name+".js"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
