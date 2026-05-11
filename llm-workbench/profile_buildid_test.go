package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProfileValidateBinSource(t *testing.T) {
	base := Profile{ID: "p1", Kind: KindChat, ModelPath: "/m.gguf", Port: 8080}

	withBin := base
	withBin.BinPath = "/usr/local/bin/llama-server"
	if err := withBin.Validate(); err != nil {
		t.Errorf("bin_path only should validate: %v", err)
	}

	withBuild := base
	withBuild.BuildID = "cuda-default"
	if err := withBuild.Validate(); err != nil {
		t.Errorf("build_id only should validate: %v", err)
	}

	both := base
	both.BinPath = "/x/llama-server"
	both.BuildID = "cuda-default"
	if err := both.Validate(); err != nil {
		t.Errorf("both set should validate (build_id wins): %v", err)
	}

	if err := base.Validate(); err == nil {
		t.Error("neither build_id nor bin_path should be rejected")
	}
}

func TestServerInstanceBinPath(t *testing.T) {
	// Manual bin_path, no build registry.
	si := newServerInstance(Profile{ID: "m", BinPath: "/opt/llama-server"}, nil, nil)
	if got, err := si.binPath(); err != nil || got != "/opt/llama-server" {
		t.Errorf("manual bin_path: got %q err %v", got, err)
	}

	// build_id but no build registry -> error.
	si = newServerInstance(Profile{ID: "m", BuildID: "b1"}, nil, nil)
	if _, err := si.binPath(); err == nil {
		t.Error("build_id with nil registry should error")
	}

	// build_id pointing at a build whose binary exists -> resolves.
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	bm, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	binFile := filepath.Join(t.TempDir(), "llama-server")
	if err := os.WriteFile(binFile, []byte("#!/bin/true\n"), 0o755); err != nil {
		t.Fatalf("write fake binary: %v", err)
	}
	if _, err := bm.AddBuild(Build{ID: "b1", RecipeID: "r1", BinaryPath: binFile}); err != nil {
		t.Fatalf("AddBuild: %v", err)
	}
	si = newServerInstance(Profile{ID: "m", BuildID: "b1"}, nil, bm)
	if got, err := si.binPath(); err != nil || got != binFile {
		t.Errorf("resolved build binary: got %q err %v, want %q", got, err, binFile)
	}

	// build_id referencing an unknown build -> error.
	si = newServerInstance(Profile{ID: "m", BuildID: "ghost"}, nil, bm)
	if _, err := si.binPath(); err == nil {
		t.Error("unknown build id should error")
	}

	// build_id whose binary no longer exists on disk -> error.
	if _, err := bm.AddBuild(Build{ID: "b2", RecipeID: "r1", BinaryPath: filepath.Join(t.TempDir(), "gone")}); err != nil {
		t.Fatalf("AddBuild b2: %v", err)
	}
	si = newServerInstance(Profile{ID: "m", BuildID: "b2"}, nil, bm)
	if _, err := si.binPath(); err == nil {
		t.Error("build with missing binary file should error")
	}
}
