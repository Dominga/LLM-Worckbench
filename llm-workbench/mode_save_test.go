package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveProjectModeFile(t *testing.T) {
	root := t.TempDir()

	def := Mode{
		Name:          "My Research",
		Color:         "#22c55e",
		Desc:          "read-only digging",
		ToolWhitelist: []string{"search_semantic", "read_file"},
		Approval:      ApprovalAuto,
		Context:       ContextRAGAuto,
		Params: []ModeParam{
			{Name: "topic", Type: "string", Required: true, Description: "what to dig into"},
			{Name: "depth", Type: "int", Default: 3},
		},
		// SystemPromptTemplate intentionally left empty — must be promoted.
		SystemPrompt: "stale inline prompt that should be dropped",
	}
	tmpl := "You research {{param.topic}} for project {{project.name}}.\nDepth {{param.depth}}."

	if err := saveProjectModeFile(root, "my-research", def, tmpl); err != nil {
		t.Fatalf("saveProjectModeFile: %v", err)
	}

	modesDir := filepath.Join(root, ProjectDirName, "modes")
	gotTmpl, err := os.ReadFile(filepath.Join(modesDir, "my-research.system.md"))
	if err != nil {
		t.Fatalf("read template: %v", err)
	}
	if string(gotTmpl) != tmpl {
		t.Errorf("template = %q, want %q", gotTmpl, tmpl)
	}
	if _, err := os.Stat(filepath.Join(modesDir, "my-research.toml")); err != nil {
		t.Fatalf("toml not written: %v", err)
	}

	// Round-trip through the loader.
	modes, warns := loadModesDir(modesDir, ModeSourceProject)
	if len(warns) != 0 {
		t.Errorf("loader warnings: %v", warns)
	}
	if len(modes) != 1 {
		t.Fatalf("loaded %d modes, want 1", len(modes))
	}
	m := modes[0]
	if m.ID != "my-research" {
		t.Errorf("ID = %q", m.ID)
	}
	if m.Name != "My Research" || m.Color != "#22c55e" || m.Desc != "read-only digging" {
		t.Errorf("metadata lost: %+v", m)
	}
	if m.SystemPromptTemplate != "my-research.system.md" {
		t.Errorf("SystemPromptTemplate = %q", m.SystemPromptTemplate)
	}
	if m.SystemPrompt != "" {
		t.Errorf("inline SystemPrompt should have been dropped, got %q", m.SystemPrompt)
	}
	if m.Approval != ApprovalAuto || m.Context != ContextRAGAuto {
		t.Errorf("approval/context lost: %q / %q", m.Approval, m.Context)
	}
	if len(m.ToolWhitelist) != 2 || m.ToolWhitelist[0] != "search_semantic" {
		t.Errorf("tool whitelist = %v", m.ToolWhitelist)
	}
	if len(m.Params) != 2 {
		t.Fatalf("params = %d, want 2", len(m.Params))
	}
	if m.Params[0].Name != "topic" || m.Params[0].Type != "string" || !m.Params[0].Required {
		t.Errorf("param[0] = %+v", m.Params[0])
	}
	// TOML ints come back as int64; the loader leaves Default as `any`.
	if got, ok := m.Params[1].Default.(int64); !ok || got != 3 {
		t.Errorf("param[1].Default = %#v, want int64(3)", m.Params[1].Default)
	}

	// Overwriting the same id is fine.
	def.Name = "Renamed"
	if err := saveProjectModeFile(root, "my-research", def, "new body"); err != nil {
		t.Fatalf("re-save: %v", err)
	}
	modes, _ = loadModesDir(modesDir, ModeSourceProject)
	if len(modes) != 1 || modes[0].Name != "Renamed" {
		t.Errorf("overwrite not applied: %+v", modes)
	}
}

func TestSaveProjectModeFileEmptyToolWhitelist(t *testing.T) {
	root := t.TempDir()
	// Empty (non-nil) whitelist must survive as "no tools", not become
	// "all tools" on reload.
	if err := saveProjectModeFile(root, "chat", Mode{Name: "Chat", ToolWhitelist: []string{}, Approval: ApprovalAuto, Context: ContextNone}, "hi"); err != nil {
		t.Fatalf("save: %v", err)
	}
	modes, _ := loadModesDir(filepath.Join(root, ProjectDirName, "modes"), ModeSourceProject)
	if len(modes) != 1 {
		t.Fatalf("loaded %d", len(modes))
	}
	if modes[0].ToolWhitelist == nil {
		t.Error("empty tool whitelist became nil (= all tools) on reload")
	}
	if len(modes[0].ToolWhitelist) != 0 {
		t.Errorf("tool whitelist = %v, want empty", modes[0].ToolWhitelist)
	}
}

func TestSaveProjectModeFileBadID(t *testing.T) {
	root := t.TempDir()
	for _, bad := range []string{"", "  ", "../evil", "a/b", "with space", ".hidden"} {
		if err := saveProjectModeFile(root, bad, Mode{Name: "x"}, "y"); err == nil {
			t.Errorf("id %q should be rejected", bad)
		}
	}
}
