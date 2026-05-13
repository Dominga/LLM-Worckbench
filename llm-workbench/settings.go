package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/BurntSushi/toml"
)

// StartupMode picks what the chat side shows on app launch (TD22 +
// TD23). "blank" (the v1 default) drops the user into a project-
// unbound chat. "reopen-last" restores the last project they had
// open via active_project_id in projects.toml.
type StartupMode string

const (
	StartupBlank      StartupMode = "blank"
	StartupReopenLast StartupMode = "reopen-last"
)

// AppSettings is the persistent set of app-wide preferences. Each
// field has a safe default so a missing settings.toml degrades to
// "stock behaviour" rather than erroring.
type AppSettings struct {
	SchemaVersion int `json:"schemaVersion" toml:"schema_version"`

	// Theme is reserved for a future light/system mode toggle. v1 ships
	// only the dark theme, so the field is persisted but the UI
	// currently disables anything other than "dark".
	Theme string `json:"theme" toml:"theme"`

	// Startup decides what the chat side opens with (see StartupMode).
	Startup StartupMode `json:"startup" toml:"startup"`

	// AutoRefreshRegistry refreshes every subscribed source on app
	// launch (background goroutine, errors logged, non-blocking).
	AutoRefreshRegistry bool `json:"autoRefreshRegistry" toml:"auto_refresh_registry"`

	// AutoInstallDefaults runs RegistryService.AutoInstallDefaults on
	// every launch (not just the very first one). Useful when the
	// user has uninstalled a default and wants it back the next time
	// they open the app, or when new defaults are added upstream.
	// Defaults to false so the registry doesn't surprise-install
	// things behind the user's back.
	AutoInstallDefaults bool `json:"autoInstallDefaults" toml:"auto_install_defaults"`

	// TelemetryOptIn is a placeholder for DESIGN §10.5 — no telemetry
	// pipeline ships yet. Persisting the flag here means the future
	// implementation has somewhere to read from.
	TelemetryOptIn bool `json:"telemetryOptIn" toml:"telemetry_opt_in"`
}

// DefaultAppSettings returns the seed used when no settings.toml
// exists (or the file is unreadable). Kept as a function rather than
// a var so callers always get a fresh copy.
func DefaultAppSettings() AppSettings {
	return AppSettings{
		SchemaVersion:       1,
		Theme:               "dark",
		Startup:             StartupBlank,
		AutoRefreshRegistry: true,
		AutoInstallDefaults: false,
		TelemetryOptIn:      false,
	}
}

// SettingsService owns the settings.toml file. Caller-side concurrency
// is handled by a single mutex — settings are small and rarely
// written, so contention isn't a concern.
type SettingsService struct {
	mu sync.Mutex
}

func NewSettingsService() *SettingsService { return &SettingsService{} }

// Load returns the persisted settings, falling back to defaults when
// the file is missing. A corrupt file logs no error from this path;
// the caller (App.startup) can log + ignore.
func (s *SettingsService) Load() (AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	path := settingsPath()
	if path == "" {
		return AppSettings{}, errors.New("settings path unresolved")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultAppSettings(), nil
		}
		return AppSettings{}, err
	}
	out := DefaultAppSettings()
	if err := toml.Unmarshal(data, &out); err != nil {
		return AppSettings{}, fmt.Errorf("parse settings.toml: %w", err)
	}
	// Fields not present in older files inherit their defaults
	// because DefaultAppSettings() seeded the struct before Unmarshal.
	return out, nil
}

// Save validates basic fields then atomically writes the file.
func (s *SettingsService) Save(set AppSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if set.SchemaVersion <= 0 {
		set.SchemaVersion = 1
	}
	switch set.Startup {
	case "", StartupBlank, StartupReopenLast:
		if set.Startup == "" {
			set.Startup = StartupBlank
		}
	default:
		return fmt.Errorf("unknown startup mode %q", set.Startup)
	}
	if set.Theme == "" {
		set.Theme = "dark"
	}
	path := settingsPath()
	if path == "" {
		return errors.New("settings path unresolved")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := toml.NewEncoder(&buf)
	enc.Indent = "  "
	if err := enc.Encode(set); err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	return atomicWriteFile(path, buf.Bytes(), 0o644)
}
