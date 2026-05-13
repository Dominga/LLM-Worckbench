package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSettingsDefaultWhenMissing pins the no-file path — Load should
// hand back a usable default struct, not error out.
func TestSettingsDefaultWhenMissing(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	svc := NewSettingsService()
	out, err := svc.Load()
	if err != nil {
		t.Fatalf("Load on missing file: %v", err)
	}
	if out.Startup != StartupBlank || out.Theme != "dark" || out.AutoRefreshRegistry != true {
		t.Errorf("defaults wrong: %+v", out)
	}
	if out.AutoInstallDefaults || out.TelemetryOptIn {
		t.Errorf("expected opt-in defaults off: %+v", out)
	}
}

// TestSettingsRoundTrip writes + reloads and checks fields survive.
func TestSettingsRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	svc := NewSettingsService()
	set := AppSettings{
		Theme:               "dark",
		Startup:             StartupReopenLast,
		AutoRefreshRegistry: false,
		AutoInstallDefaults: true,
		TelemetryOptIn:      true,
	}
	if err := svc.Save(set); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tmp, AppDirName, "settings.toml")); err != nil {
		t.Errorf("file not on disk: %v", err)
	}
	got, err := svc.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Startup != StartupReopenLast || got.AutoRefreshRegistry || !got.AutoInstallDefaults || !got.TelemetryOptIn {
		t.Errorf("round-trip lost fields: %+v", got)
	}
}

// TestSettingsRejectUnknownStartup makes sure a bogus startup mode
// fails the Save validate so a typo can't quietly land in the file.
func TestSettingsRejectUnknownStartup(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	svc := NewSettingsService()
	if err := svc.Save(AppSettings{Startup: "bogus"}); err == nil || !strings.Contains(err.Error(), "unknown startup mode") {
		t.Errorf("expected unknown-startup error, got %v", err)
	}
}

// TestSettingsLoadMergesWithDefaults checks that older / hand-edited
// files missing newer fields fall back to defaults rather than zero
// values.
func TestSettingsLoadMergesWithDefaults(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	path := filepath.Join(tmp, AppDirName, "settings.toml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	// Only theme + startup present — every other field should fall
	// back to DefaultAppSettings.
	if err := os.WriteFile(path, []byte(`schema_version = 1
theme = "dark"
startup = "blank"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := NewSettingsService()
	got, err := svc.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !got.AutoRefreshRegistry {
		t.Error("missing field should fall back to default true for AutoRefreshRegistry")
	}
}
