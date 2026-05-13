package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// bundledFamiliesFS holds the families/*.toml files shipped with the
// binary. On first launch they're copied into the user's global
// families dir; later runs leave the user's edits alone. Mirrors the
// modes-seed pattern in mode_seed.go.
//
//go:embed families/*
var bundledFamiliesFS embed.FS

// seedGlobalFamiliesOnce extracts the bundled family definitions into
// `~/.config/llm-workbench/families/` the first time the app runs.
// Skipped entirely when the dir already exists so user edits /
// deletions / community-installed entries are preserved across
// upgrades.
//
// Returns the list of paths written (for logging) plus any per-file
// errors that didn't abort the seed.
func seedGlobalFamiliesOnce() ([]string, error) {
	dir := globalFamiliesDir()
	if dir == "" {
		return nil, fmt.Errorf("global families dir unresolved")
	}
	if _, err := os.Stat(dir); err == nil {
		return nil, nil // already seeded — do not overwrite user state
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", dir, err)
	}

	var written []string
	walkErr := fs.WalkDir(bundledFamiliesFS, "families", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, rErr := bundledFamiliesFS.ReadFile(path)
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
