package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestBuiltinFamiliesEmbed pins the bundled set so a renamed or
// dropped family file doesn't slip through the build.
func TestBuiltinFamiliesEmbed(t *testing.T) {
	fs := builtinFamiliesFromEmbedFS()
	want := []string{"deepseek-r1", "gemma3", "gemma4", "llama3", "mistral", "qwen3"}
	got := make(map[string]bool, len(fs))
	for _, f := range fs {
		got[f.ID] = true
		if f.Source != FamilySourceBuiltin {
			t.Errorf("family %s source = %q, want builtin", f.ID, f.Source)
		}
		if f.Name == "" {
			t.Errorf("family %s missing Name", f.ID)
		}
	}
	for _, id := range want {
		if !got[id] {
			t.Errorf("expected bundled family %q missing", id)
		}
	}
}

// TestFamilyValidate covers the id charset + required name rules.
func TestFamilyValidate(t *testing.T) {
	good := Family{ID: "qwen3", Name: "Qwen 3"}
	if err := good.validate(); err != nil {
		t.Errorf("good family rejected: %v", err)
	}
	cases := []struct {
		f    Family
		want string
	}{
		{Family{ID: "", Name: "x"}, "invalid id"},
		{Family{ID: "with space", Name: "x"}, "invalid id"},
		{Family{ID: "../evil", Name: "x"}, "invalid id"},
		{Family{ID: "UPPER", Name: "x"}, "invalid id"},
		{Family{ID: "ok", Name: "  "}, "name is required"},
	}
	for _, c := range cases {
		err := c.f.validate()
		if err == nil {
			t.Errorf("expected error for %+v", c.f)
			continue
		}
		if !strings.Contains(err.Error(), c.want) {
			t.Errorf("error %q missing %q for %+v", err.Error(), c.want, c.f)
		}
	}
}

// TestFamilyServiceGlobalOverridesBuiltin writes a TOML into the
// global dir with the same ID as a bundled family and confirms
// FamilyService.Get returns the global version.
func TestFamilyServiceGlobalOverridesBuiltin(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	dir := globalFamiliesDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	body := `id = "qwen3"
name = "Overridden Qwen"
description = "user-local override"
`
	if err := os.WriteFile(filepath.Join(dir, "qwen3.toml"), []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	svc := NewFamilyService()
	fam, ok := svc.Get("qwen3")
	if !ok {
		t.Fatal("qwen3 missing after override")
	}
	if fam.Source != FamilySourceGlobal {
		t.Errorf("source = %q, want global", fam.Source)
	}
	if fam.Name != "Overridden Qwen" {
		t.Errorf("name = %q, want override", fam.Name)
	}
}

// TestFamilyServiceListSortedAndMerged verifies the merged List
// returns each ID at most once and sorted alphabetically.
func TestFamilyServiceListSortedAndMerged(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	svc := NewFamilyService()
	list := svc.List()
	if len(list) == 0 {
		t.Fatal("List() empty — embed broken?")
	}
	seen := map[string]bool{}
	prev := ""
	for _, f := range list {
		if seen[f.ID] {
			t.Errorf("duplicate id %q", f.ID)
		}
		seen[f.ID] = true
		if prev != "" && f.ID < prev {
			t.Errorf("not sorted: %q before %q", prev, f.ID)
		}
		prev = f.ID
	}
}

// TestSeedGlobalFamiliesOnce checks that the seed copies files into
// the global dir on first run and skips re-writing on subsequent
// runs (so user edits aren't clobbered).
func TestSeedGlobalFamiliesOnce(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	dir := globalFamiliesDir()

	written, err := seedGlobalFamiliesOnce()
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	if len(written) == 0 {
		t.Fatal("seed wrote 0 files")
	}
	if _, err := os.Stat(filepath.Join(dir, "qwen3.toml")); err != nil {
		t.Errorf("qwen3.toml not in global dir: %v", err)
	}

	// Mutate one file, re-run seed, ensure mutation survives.
	target := filepath.Join(dir, "qwen3.toml")
	if err := os.WriteFile(target, []byte(`id = "qwen3"
name = "User Mutation"
`), 0o644); err != nil {
		t.Fatalf("mutate: %v", err)
	}
	written2, err := seedGlobalFamiliesOnce()
	if err != nil {
		t.Fatalf("seed second pass: %v", err)
	}
	if len(written2) != 0 {
		t.Errorf("second seed re-wrote %d files; should be a no-op", len(written2))
	}
	data, _ := os.ReadFile(target)
	if !strings.Contains(string(data), "User Mutation") {
		t.Error("user mutation lost on second seed")
	}
}
