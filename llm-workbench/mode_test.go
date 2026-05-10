package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuiltinModesValidate(t *testing.T) {
	for _, m := range ListBuiltinModes() {
		if err := m.validate(); err != nil {
			t.Errorf("builtin %q: %v", m.ID, err)
		}
	}
}

func TestApprovalAutoForbidsEditFile(t *testing.T) {
	m := Mode{
		ID:            "bad",
		Approval:      ApprovalAuto,
		ToolWhitelist: []string{"edit_file"},
	}
	m.normalise()
	if err := m.validate(); err == nil {
		t.Fatal("expected validate error for approval=auto with edit_file")
	}
}

func TestModeContainsTool(t *testing.T) {
	all := Mode{}
	all.normalise()
	if !all.containsTool("edit_file") {
		t.Errorf("nil whitelist should allow any tool")
	}
	limited := Mode{ToolWhitelist: []string{"read_file"}}
	if limited.containsTool("edit_file") {
		t.Errorf("whitelist should reject edit_file")
	}
	if !limited.containsTool("read_file") {
		t.Errorf("whitelist should allow read_file")
	}
	none := Mode{ToolWhitelist: []string{}}
	if none.containsTool("read_file") {
		t.Errorf("empty whitelist should allow nothing")
	}
}

func TestModeNormaliseDefaults(t *testing.T) {
	m := Mode{ID: "x"}
	m.normalise()
	if m.Approval != ApprovalAlways {
		t.Errorf("approval default = %q, want always", m.Approval)
	}
	if m.Context != ContextRAGExplicit {
		t.Errorf("context default = %q, want rag-explicit", m.Context)
	}
	if m.Color == "" {
		t.Error("color default missing")
	}
}

func TestProjectLocalModeOverridesBuiltin(t *testing.T) {
	tmp := t.TempDir()
	dir := filepath.Join(tmp, ProjectDirName, "modes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `id = "agent"
name = "Custom agent"
desc = "Project-tuned override."
system_prompt = "You are project X's agent."
tool_whitelist = ["search_semantic", "read_file"]
approval = "always"
context = "rag-auto"
`
	if err := os.WriteFile(filepath.Join(dir, "agent.toml"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	prs := &ProjectService{
		projects: []Project{{ID: "p", Path: tmp, Name: "test"}},
	}
	svc := NewModeService(prs)
	list := svc.List("p")

	var found *Mode
	for i, m := range list {
		if m.ID == "agent" {
			found = &list[i]
		}
	}
	if found == nil {
		t.Fatal("agent mode missing after merge")
	}
	if found.Source != ModeSourceProject {
		t.Errorf("source = %q, want project (override took effect?)", found.Source)
	}
	if found.Name != "Custom agent" {
		t.Errorf("name = %q, want override", found.Name)
	}
	if found.Context != ContextRAGAuto {
		t.Errorf("context not overridden: %q", found.Context)
	}
	// Builtin chat-only should still be present.
	hasChatOnly := false
	for _, m := range list {
		if m.ID == "chat" {
			hasChatOnly = true
		}
	}
	if !hasChatOnly {
		t.Error("chat-only builtin missing after merge")
	}
}

func TestProjectLocalModeBadFileSkipped(t *testing.T) {
	tmp := t.TempDir()
	dir := filepath.Join(tmp, ProjectDirName, "modes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "broken.toml"),
		[]byte(`approval = "auto"
tool_whitelist = ["edit_file"]
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ok.toml"),
		[]byte(`name = "OK"
desc = "fine"
approval = "always"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	modes, warns := loadProjectModes(tmp)
	if len(warns) == 0 {
		t.Error("expected at least one warning for broken.toml")
	}
	hasOK := false
	for _, m := range modes {
		if m.ID == "ok" {
			hasOK = true
		}
		if m.ID == "broken" {
			t.Error("broken mode should be skipped")
		}
	}
	if !hasOK {
		t.Errorf("ok mode missing; modes=%v warns=%v", modeIDs(modes), warns)
	}
}

func TestModeServiceResolveFallback(t *testing.T) {
	// Isolate XDG so the test doesn't see whatever the developer has
	// seeded in their real config dir.
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	prs := &ProjectService{
		projects: []Project{{ID: "p", Path: t.TempDir()}},
	}
	svc := NewModeService(prs)
	got := svc.Resolve("p", "does-not-exist")
	if got.ID != "chat" {
		t.Errorf("fallback id = %q, want chat", got.ID)
	}
}

func TestRenderTemplateSubstitutesPlaceholders(t *testing.T) {
	tmpl := `Project: {{project.name}} ({{project.id}})
Topic: {{param.topic}}
Unknown: {{param.missing}}`
	out := renderTemplate(tmpl, map[string]any{
		"project.id":   "p1",
		"project.name": "Test",
		"param.topic":  "weather",
	})
	if !strings.Contains(out, "Project: Test (p1)") {
		t.Errorf("project placeholders not substituted: %q", out)
	}
	if !strings.Contains(out, "Topic: weather") {
		t.Errorf("param placeholder not substituted: %q", out)
	}
	if !strings.Contains(out, "{{param.missing}}") {
		t.Errorf("unknown placeholder should remain literal: %q", out)
	}
}

func TestResolveSystemPromptFromTemplate(t *testing.T) {
	tmp := t.TempDir()
	dir := filepath.Join(tmp, ProjectDirName, "modes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	tmplPath := "narrative.system.md"
	if err := os.WriteFile(filepath.Join(dir, tmplPath),
		[]byte("You are a narrator for {{project.name}}.\nFocus on {{param.theme}}."),
		0o644); err != nil {
		t.Fatal(err)
	}
	prs := &ProjectService{projects: []Project{{ID: "p", Path: tmp, Name: "Test"}}}
	svc := NewModeService(prs)
	m := Mode{ID: "narrative", SystemPromptTemplate: tmplPath}
	m.normalise()
	out, err := svc.ResolveSystemPrompt("p", m, map[string]any{"theme": "dread"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "narrator for Test") {
		t.Errorf("project.name not resolved: %q", out)
	}
	if !strings.Contains(out, "Focus on dread") {
		t.Errorf("param.theme not resolved: %q", out)
	}
}

func TestResolveSystemPromptFallsBackToInline(t *testing.T) {
	prs := &ProjectService{projects: []Project{{ID: "p", Path: t.TempDir(), Name: "X"}}}
	svc := NewModeService(prs)
	m := Mode{ID: "x", SystemPrompt: "inline prompt"}
	m.normalise()
	out, err := svc.ResolveSystemPrompt("p", m, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out != "inline prompt" {
		t.Errorf("expected inline, got %q", out)
	}
}

func TestResolveSystemPromptMissingTemplateErrs(t *testing.T) {
	prs := &ProjectService{projects: []Project{{ID: "p", Path: t.TempDir(), Name: "X"}}}
	svc := NewModeService(prs)
	m := Mode{ID: "x", SystemPromptTemplate: "ghost.md"}
	m.normalise()
	_, err := svc.ResolveSystemPrompt("p", m, nil)
	if err == nil {
		t.Fatal("expected error for missing template without inline fallback")
	}
}

func TestModePrecedenceProjectOverGlobalOverBuiltin(t *testing.T) {
	// Stand up a global modes dir pointing at a temp home.
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", home)
	gdir := filepath.Join(home, AppDirName, "modes")
	if err := os.MkdirAll(gdir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gdir, "agent.toml"),
		[]byte(`name = "Global agent"
desc = "from global"
system_prompt = "global"
approval = "always"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	// Project layer with same id overrides global.
	proj := t.TempDir()
	pdir := filepath.Join(proj, ProjectDirName, "modes")
	if err := os.MkdirAll(pdir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pdir, "agent.toml"),
		[]byte(`name = "Project agent"
desc = "from project"
system_prompt = "project"
approval = "always"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	prs := &ProjectService{projects: []Project{{ID: "p", Path: proj}}}
	svc := NewModeService(prs)
	list := svc.List("p")
	var found Mode
	for _, m := range list {
		if m.ID == "agent" {
			found = m
		}
	}
	if found.Name != "Project agent" {
		t.Errorf("project should win: got %q", found.Name)
	}
	if found.Source != ModeSourceProject {
		t.Errorf("source = %q, want project", found.Source)
	}

	// Drop the project override → global should win.
	if err := os.Remove(filepath.Join(pdir, "agent.toml")); err != nil {
		t.Fatal(err)
	}
	list = svc.List("p")
	for _, m := range list {
		if m.ID == "agent" {
			found = m
		}
	}
	if found.Name != "Global agent" {
		t.Errorf("global should win after project removed: got %q", found.Name)
	}
	if found.Source != ModeSourceGlobal {
		t.Errorf("source = %q, want global", found.Source)
	}
}

func modeIDs(ms []Mode) []string {
	out := make([]string, len(ms))
	for i, m := range ms {
		out[i] = m.ID
	}
	return out
}
