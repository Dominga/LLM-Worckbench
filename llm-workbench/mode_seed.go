package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// bundledModesFS holds the .toml + .system.md files shipped with the
// binary. On first launch they are copied into the user's global
// modes dir; later runs leave the user's edits alone.
//
//go:embed modes/*
var bundledModesFS embed.FS

// seedGlobalModesOnce extracts the bundled mode definitions into
// `~/.config/llm-workbench/modes/` the first time the app runs. Skip
// entirely when the dir already exists so user edits / deletions are
// preserved across upgrades.
//
// Returns the list of paths written (for logging) plus any per-file
// errors that didn't abort the seed.
func seedGlobalModesOnce() ([]string, error) {
	dir := globalModesDir()
	if dir == "" {
		return nil, fmt.Errorf("global modes dir unresolved")
	}
	if _, err := os.Stat(dir); err == nil {
		return nil, nil // already seeded — do not overwrite user state
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", dir, err)
	}

	var written []string
	walkErr := fs.WalkDir(bundledModesFS, "modes", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, rErr := bundledModesFS.ReadFile(path)
		if rErr != nil {
			return rErr
		}
		dst := filepath.Join(dir, filepath.Base(path))
		if wErr := os.WriteFile(dst, data, 0o644); wErr != nil {
			return fmt.Errorf("write %s: %w", dst, wErr)
		}
		written = append(written, dst)
		return nil
	})
	return written, walkErr
}
