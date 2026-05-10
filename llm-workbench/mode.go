package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

// Mode is the agent-loop personality bundle. Each mode pins a system
// prompt, a tool whitelist, an approval policy for write tools, and a
// context strategy that controls how the runtime feeds project content
// into the LLM.
//
// In M1 only the metadata fields (ID/Name/Color/Desc) were used —
// AgentRuntime in M3 actually consults the rest.

type ModeSource string

const (
	ModeSourceBuiltin ModeSource = "builtin"
	ModeSourceProject ModeSource = "project"
	ModeSourcePlugin  ModeSource = "plugin"
)

// ApprovalPolicy controls how `edit_file` (and any future write tool)
// gates the user before applying changes.
//
//   - always   — every write call pops a modal showing the diff; user
//                must accept or reject. Safest, slowest.
//   - snapshot — the loop runs `git add -A && git commit` before
//                starting; writes go through unattended; user can
//                `revert` afterwards. Fast, recoverable.
//   - auto     — no gate. Only legal for read-only modes (whitelist
//                excludes `edit_file`). Asserted at mode-load time.
type ApprovalPolicy string

const (
	ApprovalAlways   ApprovalPolicy = "always"
	ApprovalSnapshot ApprovalPolicy = "snapshot"
	ApprovalAuto     ApprovalPolicy = "auto"
)

// ContextStrategy decides what the agent injects before each user turn.
//
//   - none         — plain chat, no RAG, no tool block.
//   - rag-auto     — runs `search_semantic` implicitly on every turn,
//                    pre-loads top-K hits as a system message.
//   - rag-explicit — RAG only fires when the model calls
//                    `search_semantic` itself (or the user types
//                    `/search`). Default for tool-using modes.
type ContextStrategy string

const (
	ContextNone        ContextStrategy = "none"
	ContextRAGAuto     ContextStrategy = "rag-auto"
	ContextRAGExplicit ContextStrategy = "rag-explicit"
)

type Mode struct {
	ID     string     `json:"id" toml:"id"`
	Name   string     `json:"name" toml:"name"`
	Color  string     `json:"color" toml:"color"`
	Source ModeSource `json:"source" toml:"-"`
	Desc   string     `json:"desc" toml:"desc"`
	Plugin string     `json:"plugin,omitempty" toml:"-"`

	// SystemPrompt is prepended as the system message for every turn
	// when this mode is active. Multi-line strings are fine — TOML
	// triple-quote literals work well for project-local overrides.
	SystemPrompt string `json:"systemPrompt,omitempty" toml:"system_prompt"`

	// ToolWhitelist enumerates tool names the agent may call. nil means
	// "all registered tools"; empty slice means "no tools" (chat only).
	ToolWhitelist []string `json:"toolWhitelist,omitempty" toml:"tool_whitelist"`

	// Approval is checked before invoking any write tool. See
	// ApprovalPolicy doc for semantics.
	Approval ApprovalPolicy `json:"approval,omitempty" toml:"approval"`

	// Context controls implicit RAG injection. See ContextStrategy doc.
	Context ContextStrategy `json:"context,omitempty" toml:"context"`
}

// containsTool tells whether the whitelist permits a tool name. nil
// whitelist = all tools allowed.
func (m Mode) containsTool(name string) bool {
	if m.ToolWhitelist == nil {
		return true
	}
	for _, n := range m.ToolWhitelist {
		if n == name {
			return true
		}
	}
	return false
}

// validate enforces invariants that catch obviously broken mode files
// (e.g. approval=auto with edit_file in the whitelist) before they
// reach the agent loop.
func (m Mode) validate() error {
	if strings.TrimSpace(m.ID) == "" {
		return errors.New("mode id is required")
	}
	switch m.Approval {
	case "", ApprovalAlways, ApprovalSnapshot, ApprovalAuto:
		// ok ("" defaults to always at runtime, see normalise)
	default:
		return fmt.Errorf("mode %s: unknown approval %q", m.ID, m.Approval)
	}
	switch m.Context {
	case "", ContextNone, ContextRAGAuto, ContextRAGExplicit:
		// ok
	default:
		return fmt.Errorf("mode %s: unknown context %q", m.ID, m.Context)
	}
	if m.Approval == ApprovalAuto {
		// `auto` is a no-gate path — only legal when no write tools are
		// reachable. Hard-coded write tool list keeps this explicit;
		// when more writes land, extend the slice.
		writes := []string{"edit_file"}
		for _, w := range writes {
			if m.containsTool(w) {
				return fmt.Errorf("mode %s: approval=auto cannot include write tool %q", m.ID, w)
			}
		}
	}
	return nil
}

// normalise fills in missing-field defaults. Called after parsing
// builtin / project / plugin definitions so the rest of the runtime
// can rely on every Mode having complete fields.
func (m *Mode) normalise() {
	if m.Color == "" {
		m.Color = "#3b82f6"
	}
	if m.Approval == "" {
		m.Approval = ApprovalAlways
	}
	if m.Context == "" {
		m.Context = ContextRAGExplicit
	}
}

// ───────────────────────────── Builtin set ──────────────────────────

var builtinModes = []Mode{
	{
		ID:     "chat-only",
		Name:   "Chat only",
		Color:  "#94a3b8",
		Source: ModeSourceBuiltin,
		Desc:   "Plain conversation. No tools, no RAG injection. Useful when the model just needs to talk.",
		SystemPrompt: "You are a helpful assistant. Respond directly to the user; do not call tools.",
		ToolWhitelist: []string{},
		Approval:      ApprovalAuto,
		Context:       ContextNone,
	},
	{
		ID:     "research",
		Name:   "Research",
		Color:  "#22c55e",
		Source: ModeSourceBuiltin,
		Desc:   "Read-only investigation. Searches and reads project content; never writes.",
		SystemPrompt: "You are a careful research assistant. Use the available tools to search and read project content before answering. Cite the file paths you read in your response. Never edit anything.",
		ToolWhitelist: []string{"search_semantic", "read_file", "list_files"},
		Approval:      ApprovalAuto,
		Context:       ContextRAGAuto,
	},
	{
		ID:     "agent",
		Name:   "Agent",
		Color:  "#3b82f6",
		Source: ModeSourceBuiltin,
		Desc:   "Full toolset. User confirms each write via a diff modal.",
		SystemPrompt: "You are an autonomous coding agent. Use the tools to inspect the project, propose edits, and explain changes before writing. Each edit is reviewed by the user before it lands.",
		ToolWhitelist: []string{"search_semantic", "read_file", "list_files", "edit_file"},
		Approval:      ApprovalAlways,
		Context:       ContextRAGExplicit,
	},
	{
		ID:     "auto-edit",
		Name:   "Auto-edit",
		Color:  "#f59e0b",
		Source: ModeSourceBuiltin,
		Desc:   "Full toolset, no per-edit confirmation. The runtime takes a git snapshot before the loop so the user can revert.",
		SystemPrompt: "You are an autonomous coding agent. Make the edits you think are needed. The user has snapshotted the working tree and can revert; explain the plan briefly, then act.",
		ToolWhitelist: []string{"search_semantic", "read_file", "list_files", "edit_file"},
		Approval:      ApprovalSnapshot,
		Context:       ContextRAGExplicit,
	},
}

// ListBuiltinModes returns a defensive copy of the static builtin set.
func ListBuiltinModes() []Mode {
	out := make([]Mode, len(builtinModes))
	copy(out, builtinModes)
	for i := range out {
		out[i].normalise()
	}
	return out
}

// ModeByID looks up a builtin by ID. Project-local overrides are not
// reflected here; use ModeService.Resolve for the merged view.
func ModeByID(id string) (Mode, bool) {
	for _, m := range builtinModes {
		if m.ID == id {
			cp := m
			cp.normalise()
			return cp, true
		}
	}
	return Mode{}, false
}

// ───────────────────────────── Project-local ────────────────────────

// projectModeFile is the shape of <project>/.llm-workshop/modes/<id>.toml.
// Each file defines exactly one mode; the file's basename (sans .toml)
// is used as the ID if the document doesn't override it.
type projectModeFile struct {
	Mode
}

// loadProjectModes reads `<projectRoot>/.llm-workshop/modes/*.toml`
// into Mode values. Bad files are skipped with a warning; one broken
// override should not deny the user every project-local mode.
func loadProjectModes(projectRoot string) ([]Mode, []string) {
	dir := filepath.Join(projectRoot, ProjectDirName, "modes")
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Missing directory is the normal case for projects that haven't
		// added overrides yet — quietly return.
		return nil, nil
	}
	var modes []Mode
	var warns []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".toml") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		data, rErr := os.ReadFile(path)
		if rErr != nil {
			warns = append(warns, fmt.Sprintf("read %s: %v", e.Name(), rErr))
			continue
		}
		var pmf projectModeFile
		if uErr := toml.Unmarshal(data, &pmf); uErr != nil {
			warns = append(warns, fmt.Sprintf("parse %s: %v", e.Name(), uErr))
			continue
		}
		m := pmf.Mode
		if m.ID == "" {
			m.ID = strings.TrimSuffix(e.Name(), ".toml")
		}
		m.Source = ModeSourceProject
		m.normalise()
		if vErr := m.validate(); vErr != nil {
			warns = append(warns, vErr.Error())
			continue
		}
		modes = append(modes, m)
	}
	return modes, warns
}

// ───────────────────────────── Service ──────────────────────────────

// ModeService merges builtin and project-local modes for a given
// project. Project-local IDs override builtin IDs (precedence is
// per-project, so the same ID can mean different things in different
// projects). One instance per app is enough.
type ModeService struct {
	projects *ProjectService
}

func NewModeService(ps *ProjectService) *ModeService {
	return &ModeService{projects: ps}
}

// List returns the merged + sorted set of modes available for the
// given project. Empty projectID returns the builtin set.
func (s *ModeService) List(projectID string) []Mode {
	merged := map[string]Mode{}
	for _, m := range ListBuiltinModes() {
		merged[m.ID] = m
	}
	if projectID != "" && s.projects != nil {
		if p, err := s.projects.Get(projectID); err == nil {
			locals, _ := loadProjectModes(p.Path)
			for _, m := range locals {
				merged[m.ID] = m // project overrides builtin
			}
		}
	}
	out := make([]Mode, 0, len(merged))
	for _, m := range merged {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		// Builtin first, project after, then alphabetical inside each.
		if out[i].Source != out[j].Source {
			return out[i].Source == ModeSourceBuiltin
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Resolve fetches the merged mode for a project + id. Falls back to a
// safe `chat-only` builtin if the id is unknown so the agent loop
// always has SOMETHING to run with.
func (s *ModeService) Resolve(projectID, modeID string) Mode {
	for _, m := range s.List(projectID) {
		if m.ID == modeID {
			return m
		}
	}
	if m, ok := ModeByID("chat-only"); ok {
		return m
	}
	// Last-ditch synthetic — should never hit unless builtins are wiped.
	m := Mode{ID: "chat-only", Name: "Chat only", Source: ModeSourceBuiltin}
	m.normalise()
	return m
}
