package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// FileNode is one entry in the project file tree.
type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`     // posix-style, relative to project root
	IsDir    bool       `json:"isDir"`
	Size     int64      `json:"size"`
	Modified time.Time  `json:"modified"`
	Children []FileNode `json:"children,omitempty"`
}

// FileContent is the result of reading a file. `Truncated` is true if the
// file exceeded `maxReadBytes` and was clipped to fit.
type FileContent struct {
	Path      string `json:"path"`
	Bytes     int    `json:"bytes"`
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
}

const maxReadBytes = 5 * 1024 * 1024 // 5 MB

// FileService offers project-scoped read access. All paths are validated
// against the project's root via resolveSafe, so traversal escapes
// (..//etc/passwd, symlinks pointing outside) return an error.
type FileService struct {
	projects *ProjectService
}

func NewFileService(ps *ProjectService) *FileService {
	return &FileService{projects: ps}
}

// resolveSafe returns the absolute filesystem path for `relPath` inside
// the given project, or an error if the path tries to escape the root.
func (fsrv *FileService) resolveSafe(projectID, relPath string) (string, Project, error) {
	if fsrv.projects == nil {
		return "", Project{}, fmt.Errorf("project service unavailable")
	}
	p, err := fsrv.projects.Get(projectID)
	if err != nil {
		return "", Project{}, err
	}
	rel := filepath.Clean("/" + relPath)            // anchor to root, drops leading ..
	rel = strings.TrimPrefix(rel, string(os.PathSeparator))
	abs := filepath.Join(p.Path, rel)
	rootAbs, err := filepath.Abs(p.Path)
	if err != nil {
		return "", Project{}, err
	}
	resolved, err := filepath.Abs(abs)
	if err != nil {
		return "", Project{}, err
	}
	if !strings.HasPrefix(resolved+string(os.PathSeparator), rootAbs+string(os.PathSeparator)) &&
		resolved != rootAbs {
		return "", Project{}, fmt.Errorf("path escapes project root: %q", relPath)
	}
	return resolved, p, nil
}

// ListTree walks the project root recursively. Hidden files (leading dot)
// and the per-project state dir (.llm-workshop) are excluded. Returns the
// children of the root directly — the root itself is implicit.
func (fsrv *FileService) ListTree(projectID string) ([]FileNode, error) {
	if fsrv.projects == nil {
		return nil, fmt.Errorf("project service unavailable")
	}
	p, err := fsrv.projects.Get(projectID)
	if err != nil {
		return nil, err
	}
	return readDir(p.Path, "")
}

func readDir(root, rel string) ([]FileNode, error) {
	dir := filepath.Join(root, rel)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	out := make([]FileNode, 0, len(entries))
	for _, e := range entries {
		if isHidden(e.Name()) {
			continue
		}
		// project.toml is app metadata, not user content. Hide it from the
		// tree so users don't accidentally edit it; rag/profile config UI
		// is the supported way to change those fields.
		if rel == "" && e.Name() == "project.toml" {
			continue
		}
		full := filepath.Join(dir, e.Name())
		info, err := e.Info()
		if err != nil {
			continue
		}
		childRel := posixJoin(rel, e.Name())
		node := FileNode{
			Name:     e.Name(),
			Path:     childRel,
			IsDir:    e.IsDir(),
			Size:     info.Size(),
			Modified: info.ModTime(),
		}
		if e.IsDir() {
			children, err := readDir(root, childRel)
			if err == nil {
				node.Children = children
			}
		}
		_ = full
		out = append(out, node)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func isHidden(name string) bool {
	if name == "" {
		return true
	}
	if name[0] == '.' {
		return true
	}
	return false
}

func posixJoin(parent, name string) string {
	if parent == "" {
		return name
	}
	return parent + "/" + name
}

// ReadFile returns the contents of `relPath` inside the project. Reads
// up to maxReadBytes; oversize files are truncated and the flag is set.
func (fsrv *FileService) ReadFile(projectID, relPath string) (FileContent, error) {
	abs, _, err := fsrv.resolveSafe(projectID, relPath)
	if err != nil {
		return FileContent{}, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return FileContent{}, fmt.Errorf("stat: %w", err)
	}
	if st.IsDir() {
		return FileContent{}, fmt.Errorf("%s is a directory", relPath)
	}
	f, err := os.Open(abs)
	if err != nil {
		return FileContent{}, fmt.Errorf("open: %w", err)
	}
	defer f.Close()

	limit := int64(maxReadBytes)
	truncated := false
	if st.Size() > limit {
		truncated = true
	}
	buf := make([]byte, limit)
	n, err := f.Read(buf)
	if err != nil && err.Error() != "EOF" && n == 0 {
		return FileContent{}, fmt.Errorf("read: %w", err)
	}
	return FileContent{
		Path:      relPath,
		Bytes:     int(st.Size()),
		Content:   string(buf[:n]),
		Truncated: truncated,
	}, nil
}

// WriteFile replaces the file's content (or creates it) atomically via
// temp + rename. Used by the editor in PR6. Refuses to write outside the
// project root or into the state directory.
func (fsrv *FileService) WriteFile(projectID, relPath, content string) error {
	abs, p, err := fsrv.resolveSafe(projectID, relPath)
	if err != nil {
		return err
	}
	stateDir := filepath.Join(p.Path, ProjectDirName)
	if strings.HasPrefix(abs+string(os.PathSeparator), stateDir+string(os.PathSeparator)) {
		return fmt.Errorf("refusing to write into project state directory")
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("mkdir parent: %w", err)
	}
	tmp := abs + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write tmp: %w", err)
	}
	if err := os.Rename(tmp, abs); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// statForChange is a small helper that returns mod-time + size — used by
// future polling logic to detect external file changes (M1 polling
// strategy from TODO.md).
func statForChange(path string) (time.Time, int64, error) {
	st, err := os.Stat(path)
	if err != nil {
		return time.Time{}, 0, err
	}
	if st.IsDir() {
		return time.Time{}, 0, fs.ErrInvalid
	}
	return st.ModTime(), st.Size(), nil
}
