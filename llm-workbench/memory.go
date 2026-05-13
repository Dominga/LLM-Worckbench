package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// MemoryScope selects which memory.md a read/append targets.
//
//   - "global"  → <globalMemoryPath()> = ~/.config/llm-workbench/memory.md.
//     Visible across every project for the current user.
//   - "project" → <projectRoot>/.llm-workshop/memory.md. Scoped to one
//     project; requires a projectID to resolve the root.
type MemoryScope string

const (
	MemoryScopeGlobal  MemoryScope = "global"
	MemoryScopeProject MemoryScope = "project"
)

// MemoryService is the freeform-notes surface the agent uses to leave
// itself reminders across turns. v1 stores plain markdown, append-only
// from the tool side — destructive edits go through the Prompt-Lab /
// editor UI so the model can't accidentally wipe accumulated notes.
type MemoryService struct {
	projects *ProjectService
}

func NewMemoryService(ps *ProjectService) *MemoryService {
	return &MemoryService{projects: ps}
}

// pathFor returns the absolute file path for the requested scope. An
// empty projectID is fine for global; project scope needs a real
// project so the caller can't accidentally write to the wrong tree.
func (ms *MemoryService) pathFor(scope MemoryScope, projectID string) (string, error) {
	switch scope {
	case MemoryScopeGlobal:
		p := globalMemoryPath()
		if p == "" {
			return "", errors.New("global memory path unresolved")
		}
		return p, nil
	case MemoryScopeProject:
		if ms.projects == nil {
			return "", errors.New("project service unavailable")
		}
		if strings.TrimSpace(projectID) == "" {
			return "", errors.New("project memory requires a projectID")
		}
		p, err := ms.projects.Get(projectID)
		if err != nil {
			return "", err
		}
		return projectMemoryPath(p.Path), nil
	default:
		return "", fmt.Errorf("unknown memory scope %q", scope)
	}
}

// Read returns the current memory contents for the scope. A missing
// file is not an error — the caller gets an empty string so prompt
// injection can default to "(empty)" cleanly.
func (ms *MemoryService) Read(scope MemoryScope, projectID string) (string, error) {
	path, err := ms.pathFor(scope, projectID)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

// Append writes `entry` to the bottom of the scope's memory.md, prefixed
// with a `## <UTC timestamp>` heading so successive entries are
// distinguishable. Creates the file (and the project state dir for
// project scope) if missing. Returns the bytes appended for the
// caller's response payload.
//
// Trailing whitespace on entry is trimmed; an empty body is rejected so
// the agent can't poison memory with no-ops.
func (ms *MemoryService) Append(scope MemoryScope, projectID, entry string) (int, error) {
	body := strings.TrimRight(entry, " \t\r\n")
	if strings.TrimSpace(body) == "" {
		return 0, errors.New("entry is empty")
	}
	path, err := ms.pathFor(scope, projectID)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, fmt.Errorf("mkdir parent: %w", err)
	}
	stamp := time.Now().UTC().Format("2006-01-02 15:04:05Z")
	var b strings.Builder
	// Separator only when the file already has content — keeps fresh
	// files from starting with a blank line.
	if st, statErr := os.Stat(path); statErr == nil && st.Size() > 0 {
		b.WriteString("\n\n")
	}
	b.WriteString("## ")
	b.WriteString(stamp)
	b.WriteString("\n\n")
	b.WriteString(body)
	b.WriteString("\n")

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, fmt.Errorf("open: %w", err)
	}
	defer f.Close()
	n, err := f.WriteString(b.String())
	if err != nil {
		return 0, fmt.Errorf("write: %w", err)
	}
	return n, nil
}
