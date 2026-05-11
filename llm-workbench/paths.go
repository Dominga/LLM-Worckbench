package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const (
	// AppDirName is the per-user config directory under XDG_CONFIG_HOME.
	AppDirName = "llm-workbench"

	// ProjectDirName is the per-project state directory created at
	// <projectRoot>/.llm-workshop. Holds sessions JSONL, sqlite-vec index
	// (M2+), caches. Added to .gitignore.
	ProjectDirName = ".llm-workshop"
)

// configDir returns the global config directory (created if missing).
// Resolution order:
//  1. $XDG_CONFIG_HOME/llm-workbench
//  2. $HOME/.config/llm-workbench
func configDir() (string, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home: %w", err)
		}
		base = filepath.Join(home, ".config")
	}
	dir := filepath.Join(base, AppDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", dir, err)
	}
	return dir, nil
}

func profilesPath() (string, error) {
	d, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "profiles.toml"), nil
}

func projectsPath() (string, error) {
	d, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "projects.toml"), nil
}

// buildsPath is `~/.config/llm-workbench/builds.toml` — the registry of
// llama.cpp BuildRecipes and the Build artifacts produced from them (M5).
func buildsPath() (string, error) {
	d, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "builds.toml"), nil
}

// globalModesDir is `~/.config/llm-workbench/modes/`. Per-user mode
// overrides + their .system.md templates live here. Missing returns
// "" without error so callers can treat it as "no overrides".
func globalModesDir() string {
	d, err := configDir()
	if err != nil {
		return ""
	}
	return filepath.Join(d, "modes")
}
