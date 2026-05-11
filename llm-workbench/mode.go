package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	ModeSourceGlobal  ModeSource = "global"
	ModeSourceProject ModeSource = "project"
	ModeSourcePlugin  ModeSource = "plugin"
)

// ApprovalPolicy controls how `edit_file` (and any future write tool)
// gates the user before applying changes.
//
//   - always   — every write call pops a modal showing the diff; user
//     must accept or reject. Safest, slowest.
//   - snapshot — the loop runs `git add -A && git commit` before
//     starting; writes go through unattended; user can
//     `revert` afterwards. Fast, recoverable.
//   - auto     — no gate. Only legal for read-only modes (whitelist
//     excludes `edit_file`). Asserted at mode-load time.
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
//     pre-loads top-K hits as a system message.
//   - rag-explicit — RAG only fires when the model calls
//     `search_semantic` itself (or the user types
//     `/search`). Default for tool-using modes.
type ContextStrategy string

const (
	ContextNone        ContextStrategy = "none"
	ContextRAGAuto     ContextStrategy = "rag-auto"
	ContextRAGExplicit ContextStrategy = "rag-explicit"
)

// ModeParam declares one input the mode's prompt template expects.
// Captured at session creation time and substituted into the rendered
// system prompt as `{{param.<name>}}`.
type ModeParam struct {
	Name        string `json:"name" toml:"name"`
	Type        string `json:"type" toml:"type"` // string|int|number|bool
	Default     any    `json:"default,omitempty" toml:"default"`
	Required    bool   `json:"required,omitempty" toml:"required"`
	Description string `json:"description,omitempty" toml:"description"`
}

type Mode struct {
	ID     string     `json:"id" toml:"id"`
	Name   string     `json:"name" toml:"name"`
	Color  string     `json:"color" toml:"color"`
	Source ModeSource `json:"source" toml:"-"`
	Desc   string     `json:"desc" toml:"desc"`
	Plugin string     `json:"plugin,omitempty" toml:"-"`

	// SystemPromptTemplate is the project-relative (or absolute) path
	// to a markdown file whose contents become the rendered system
	// prompt. Placeholder syntax: `{{project.id}}`, `{{project.name}}`,
	// `{{project.path}}`, `{{param.<name>}}`. DESIGN.md §4.6.
	//
	// Resolution order when set as a bare basename:
	//   1. `<project>/.llm-workshop/modes/<value>` (if exists)
	//   2. `<globalModesDir>/<value>` (if exists)
	//   3. error — referenced template not found
	SystemPromptTemplate string `json:"systemPromptTemplate,omitempty" toml:"system_prompt_template"`

	// SystemPrompt is the inline fallback used when no template path
	// is set or the file can't be loaded. Multi-line strings via
	// TOML triple-quote work for short overrides without authoring a
	// separate .system.md.
	SystemPrompt string `json:"systemPrompt,omitempty" toml:"system_prompt"`

	// Params declares the inputs the template expects. The
	// NewSessionModal renders a form from this schema (TD16 follow-up
	// is the UI side); ChatService stamps the values into Session at
	// create time.
	Params []ModeParam `json:"params,omitempty" toml:"params"`

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

// builtinModes is the always-available fallback set. v1 ships exactly
// one: a minimum-viable `chat` mode with no template, no tools, no
// approval gate. Everything else (research / agent / auto-edit /
// project-specific) lives in the global modes dir, seeded from the
// bundled `modes/` directory on first launch (see mode_seed.go).
var builtinModes = []Mode{
	{
		ID:            "chat",
		Name:          "Chat",
		Color:         "#94a3b8",
		Source:        ModeSourceBuiltin,
		Desc:          "Plain conversation. No tools, no system prompt, no RAG injection.",
		SystemPrompt:  "",
		ToolWhitelist: []string{},
		Approval:      ApprovalAuto,
		Context:       ContextNone,
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

// loadModesDir reads `*.toml` from `dir` and stamps each with the
// given source. Used by both global and per-project loaders so the
// parse loop stays in one place.
func loadModesDir(dir string, source ModeSource) ([]Mode, []string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
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
		m.Source = source
		m.normalise()
		if vErr := m.validate(); vErr != nil {
			warns = append(warns, vErr.Error())
			continue
		}
		modes = append(modes, m)
	}
	return modes, warns
}

func loadProjectModes(projectRoot string) ([]Mode, []string) {
	return loadModesDir(filepath.Join(projectRoot, ProjectDirName, "modes"), ModeSourceProject)
}

func loadGlobalModes() ([]Mode, []string) {
	dir := globalModesDir()
	if dir == "" {
		return nil, nil
	}
	return loadModesDir(dir, ModeSourceGlobal)
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
// given project. Precedence on collision: project > global > builtin.
// Empty projectID skips the project layer.
func (s *ModeService) List(projectID string) []Mode {
	merged := map[string]Mode{}
	for _, m := range ListBuiltinModes() {
		merged[m.ID] = m
	}
	if globals, _ := loadGlobalModes(); globals != nil {
		for _, m := range globals {
			merged[m.ID] = m
		}
	}
	if projectID != "" && s.projects != nil {
		if p, err := s.projects.Get(projectID); err == nil {
			locals, _ := loadProjectModes(p.Path)
			for _, m := range locals {
				merged[m.ID] = m
			}
		}
	}
	out := make([]Mode, 0, len(merged))
	for _, m := range merged {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		// Builtin first, then global, then project; alphabetical inside.
		if out[i].Source != out[j].Source {
			return sourceRank(out[i].Source) < sourceRank(out[j].Source)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func sourceRank(s ModeSource) int {
	switch s {
	case ModeSourceBuiltin:
		return 0
	case ModeSourceGlobal:
		return 1
	case ModeSourceProject:
		return 2
	default:
		return 3
	}
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
	if m, ok := ModeByID("chat"); ok {
		return m
	}
	m := Mode{ID: "chat", Name: "Chat only", Source: ModeSourceBuiltin}
	m.normalise()
	return m
}

// ResolveSystemPrompt loads the mode's prompt template (preferring
// SystemPromptTemplate when set, falling back to the inline
// SystemPrompt) and substitutes `{{project.*}}` + `{{param.*}}`
// placeholders. The agent loop calls this once per agent run with the
// session's captured params.
func (s *ModeService) ResolveSystemPrompt(projectID string, m Mode, params map[string]any) (string, error) {
	tmpl := m.SystemPrompt
	if strings.TrimSpace(m.SystemPromptTemplate) != "" {
		body, err := s.loadTemplate(projectID, m.SystemPromptTemplate)
		if err != nil {
			// Template miss falls back to the inline string rather than
			// dropping the agent to no system prompt at all.
			if strings.TrimSpace(tmpl) == "" {
				return "", fmt.Errorf("mode %s: load template %s: %w", m.ID, m.SystemPromptTemplate, err)
			}
		} else {
			tmpl = body
		}
	}
	ctx := s.buildTemplateContext(projectID, params)
	return renderTemplate(tmpl, ctx), nil
}

// loadTemplate resolves a relative template path against (in order):
//  1. `<projectRoot>/.llm-workshop/modes/<value>`
//  2. `<globalModesDir>/<value>`
//  3. absolute path (when value is already absolute)
//
// Absolute and project-rooted paths are accepted as-is. Used for both
// the mode's SystemPromptTemplate field and any future include/import.
func (s *ModeService) loadTemplate(projectID, path string) (string, error) {
	if filepath.IsAbs(path) {
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	if s.projects != nil && projectID != "" {
		if p, err := s.projects.Get(projectID); err == nil {
			candidate := filepath.Join(p.Path, ProjectDirName, "modes", path)
			if data, err := os.ReadFile(candidate); err == nil {
				return string(data), nil
			}
		}
	}
	if g := globalModesDir(); g != "" {
		candidate := filepath.Join(g, path)
		if data, err := os.ReadFile(candidate); err == nil {
			return string(data), nil
		}
	}
	return "", fmt.Errorf("template %q not found in project or global modes dir", path)
}

// buildTemplateContext assembles the variable map fed to renderTemplate.
// Always seeded with project metadata; the caller's `params` get
// namespaced under `param.<name>` so they can't clobber built-ins.
func (s *ModeService) buildTemplateContext(projectID string, params map[string]any) map[string]any {
	ctx := map[string]any{
		"project.id":   projectID,
		"project.name": "",
		"project.path": "",
	}
	if s.projects != nil && projectID != "" {
		if p, err := s.projects.Get(projectID); err == nil {
			ctx["project.name"] = p.Name
			ctx["project.path"] = p.Path
		}
	}
	for k, v := range params {
		ctx["param."+k] = v
	}
	return ctx
}

// RenderWithSource renders an arbitrary template source (not loaded
// from disk) against the project+params context. Used by the Prompt
// Lab preview pane so the user can see substitutions on the unsaved
// buffer without round-tripping a Save.
func (s *ModeService) RenderWithSource(projectID, source string, params map[string]any) string {
	return renderTemplate(source, s.buildTemplateContext(projectID, params))
}

// TemplatePath resolves the on-disk path the mode's system_prompt_template
// would load from. Project-local wins over global; absolute paths are
// returned as-is. Returns the path that exists, or the project-local
// candidate (which doesn't exist yet) so SaveModeTemplate has a
// well-defined destination for new templates.
func (s *ModeService) TemplatePath(projectID string, m Mode) (string, error) {
	if strings.TrimSpace(m.SystemPromptTemplate) == "" {
		return "", fmt.Errorf("mode %q has no system_prompt_template", m.ID)
	}
	path := m.SystemPromptTemplate
	if filepath.IsAbs(path) {
		return path, nil
	}
	// Only return a candidate that actually exists. Returning a missing
	// project-local path here is wrong for callers that read it: a global
	// mode would resolve to a non-existent <project>/.llm-workshop path and
	// LoadModeTemplate would hand back an empty buffer even though the
	// template sits in the global dir.
	if s.projects != nil && projectID != "" {
		if p, err := s.projects.Get(projectID); err == nil {
			candidate := filepath.Join(p.Path, ProjectDirName, "modes", path)
			if _, statErr := os.Stat(candidate); statErr == nil {
				return candidate, nil
			}
		}
	}
	if g := globalModesDir(); g != "" {
		candidate := filepath.Join(g, path)
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("template %q not found", path)
}

// renderTemplate substitutes `{{key}}` placeholders with the matching
// value from ctx. Unknown keys are left as-is (visible `{{foo}}`) so
// authors notice typos rather than getting silently empty output.
var placeholderRe = regexp.MustCompile(`\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}`)

func renderTemplate(template string, ctx map[string]any) string {
	return placeholderRe.ReplaceAllStringFunc(template, func(match string) string {
		sub := placeholderRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		key := sub[1]
		v, ok := ctx[key]
		if !ok {
			return match
		}
		return fmt.Sprintf("%v", v)
	})
}

// ─────────────────────── project mode persistence ───────────────────

// modeIDRe constrains mode IDs (= the .toml/.system.md basename) so the
// editor can't write outside the project's modes dir.
var modeIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// modeParamDoc / modeFileDoc are the on-disk shapes for a project-local
// mode file. Distinct from Mode/ModeParam so the encoder can use
// `omitempty` (a nil `any` default would otherwise make the TOML encoder
// choke). Field layout matches ModeParam so a plain conversion works.
type modeParamDoc struct {
	Name        string `toml:"name"`
	Type        string `toml:"type"`
	Default     any    `toml:"default,omitempty"`
	Required    bool   `toml:"required,omitempty"`
	Description string `toml:"description,omitempty"`
}

type modeFileDoc struct {
	Name                 string `toml:"name,omitempty"`
	Color                string `toml:"color,omitempty"`
	Desc                 string `toml:"desc,omitempty"`
	SystemPromptTemplate string `toml:"system_prompt_template,omitempty"`
	// tool_whitelist is intentionally NOT omitempty: an empty array means
	// "no tools" and must survive the round-trip (omitting it would load
	// back as nil = "all tools").
	ToolWhitelist []string       `toml:"tool_whitelist"`
	Params        []modeParamDoc `toml:"params,omitempty"`
	Approval      string         `toml:"approval,omitempty"`
	Context       string         `toml:"context,omitempty"`
}

// atomicWriteFile writes data to path via a temp file + rename.
func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// saveProjectModeFile writes a project-local mode override under
// <projectRoot>/.llm-workshop/modes/: <id>.toml (the definition) plus
// <id>.system.md (the prompt template). Used by the Prompt-Lab mode
// editor; promotes builtin/global modes into a project-owned copy. The
// template path is normalised to "<id>.system.md" regardless of what the
// source mode used.
func saveProjectModeFile(projectRoot, modeID string, def Mode, template string) error {
	id := strings.TrimSpace(modeID)
	if !modeIDRe.MatchString(id) {
		return fmt.Errorf("invalid mode id %q", modeID)
	}
	def.ID = id
	def.Source = ""
	def.Plugin = ""
	def.SystemPrompt = "" // template-backed from now on
	def.SystemPromptTemplate = id + ".system.md"
	def.normalise()
	if err := def.validate(); err != nil {
		return err
	}

	dir := filepath.Join(projectRoot, ProjectDirName, "modes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := atomicWriteFile(filepath.Join(dir, def.SystemPromptTemplate), []byte(template), 0o644); err != nil {
		return err
	}

	doc := modeFileDoc{
		Name:                 def.Name,
		Color:                def.Color,
		Desc:                 def.Desc,
		SystemPromptTemplate: def.SystemPromptTemplate,
		ToolWhitelist:        def.ToolWhitelist,
		Approval:             string(def.Approval),
		Context:              string(def.Context),
	}
	if doc.ToolWhitelist == nil {
		doc.ToolWhitelist = []string{}
	}
	for _, p := range def.Params {
		doc.Params = append(doc.Params, modeParamDoc(p))
	}
	var buf bytes.Buffer
	enc := toml.NewEncoder(&buf)
	enc.Indent = "  "
	if err := enc.Encode(doc); err != nil {
		return fmt.Errorf("encode mode %q: %w", id, err)
	}
	return atomicWriteFile(filepath.Join(dir, id+".toml"), buf.Bytes(), 0o644)
}
