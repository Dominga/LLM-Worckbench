package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSeedGlobalModesPopulatesEmptyDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", home)

	written, err := seedGlobalModesOnce()
	if err != nil {
		t.Fatal(err)
	}
	if len(written) == 0 {
		t.Fatal("expected at least one file to be written")
	}
	gdir := filepath.Join(home, AppDirName, "modes")
	entries, err := os.ReadDir(gdir)
	if err != nil {
		t.Fatal(err)
	}
	hasToml := false
	hasMd := false
	for _, e := range entries {
		switch filepath.Ext(e.Name()) {
		case ".toml":
			hasToml = true
		case ".md":
			hasMd = true
		}
	}
	if !hasToml || !hasMd {
		t.Errorf("expected both .toml and .md files; got %v", entries)
	}
}

func TestSeedGlobalModesSkipsWhenDirExists(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", home)
	gdir := filepath.Join(home, AppDirName, "modes")
	if err := os.MkdirAll(gdir, 0o755); err != nil {
		t.Fatal(err)
	}
	// User-edited file should survive a second call.
	keeper := filepath.Join(gdir, "mine.toml")
	if err := os.WriteFile(keeper, []byte("name = \"mine\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	written, err := seedGlobalModesOnce()
	if err != nil {
		t.Fatal(err)
	}
	if len(written) != 0 {
		t.Errorf("expected no writes when dir exists, got %v", written)
	}
	// Bundled files must NOT have appeared since the dir already existed.
	if _, err := os.Stat(filepath.Join(gdir, "agent.toml")); err == nil {
		t.Error("agent.toml should not have been seeded over existing dir")
	}
	// User file still there.
	if _, err := os.Stat(keeper); err != nil {
		t.Errorf("user file got clobbered: %v", err)
	}
}

func TestSeedGlobalModesProducesResolveableModes(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", home)
	if _, err := seedGlobalModesOnce(); err != nil {
		t.Fatal(err)
	}
	prs := &ProjectService{projects: []Project{{ID: "p", Path: t.TempDir()}}}
	svc := NewModeService(prs)
	got := svc.Resolve("p", "agent")
	if got.ID != "agent" {
		t.Fatalf("agent mode not resolvable after seed: got %q", got.ID)
	}
	if got.Source != ModeSourceGlobal {
		t.Errorf("source = %q, want global", got.Source)
	}
}
