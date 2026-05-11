package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInspectSourceDir(t *testing.T) {
	root := t.TempDir()

	// .git/config with two remotes — "origin" should win.
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	gitCfg := `[core]
	repositoryformatversion = 0
[remote "upstream"]
	url = https://github.com/ggml-org/llama.cpp
	fetch = +refs/heads/*:refs/remotes/upstream/*
[remote "origin"]
	url = git@github.com:me/llama.cpp.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "master"]
	remote = origin
`
	if err := os.WriteFile(filepath.Join(root, ".git", "config"), []byte(gitCfg), 0o644); err != nil {
		t.Fatal(err)
	}

	// build/CMakeCache.txt — a realistic-ish subset.
	if err := os.MkdirAll(filepath.Join(root, "build"), 0o755); err != nil {
		t.Fatal(err)
	}
	cache := `# This is the CMakeCache file.
//Build type
CMAKE_BUILD_TYPE:STRING=Release
//Enable CUDA
GGML_CUDA:BOOL=ON
//flash-attn quants
GGML_CUDA_FA_ALL_QUANTS:BOOL=ON
//native arch
GGML_NATIVE:BOOL=ON
//vulkan
GGML_VULKAN:BOOL=OFF
//tests
LLAMA_BUILD_TESTS:BOOL=OFF
//cuda arch
CMAKE_CUDA_ARCHITECTURES:STRING=89
//internal noise
GGML_CUDA_AVAILABLE:INTERNAL=1
CMAKE_INSTALL_PREFIX:PATH=/usr/local
GGML_CUDA-ADVANCED:INTERNAL=1
`
	if err := os.WriteFile(filepath.Join(root, "build", "CMakeCache.txt"), []byte(cache), 0o644); err != nil {
		t.Fatal(err)
	}

	info := InspectSourceDir(root)
	if !info.Exists {
		t.Fatal("Exists should be true")
	}
	if !info.IsGitRepo {
		t.Error("IsGitRepo should be true")
	}
	if info.GitRemote != "git@github.com:me/llama.cpp.git" {
		t.Errorf("GitRemote = %q, want origin URL", info.GitRemote)
	}
	if info.ConfiguredBuildDir != "build" {
		t.Errorf("ConfiguredBuildDir = %q", info.ConfiguredBuildDir)
	}
	want := map[string]bool{
		"-DCMAKE_BUILD_TYPE=Release":    true,
		"-DGGML_CUDA=ON":                true,
		"-DGGML_CUDA_FA_ALL_QUANTS=ON":  true,
		"-DGGML_NATIVE=ON":              true,
		"-DCMAKE_CUDA_ARCHITECTURES=89": true,
	}
	got := map[string]bool{}
	for _, f := range info.CMakeFlags {
		got[f] = true
	}
	for f := range want {
		if !got[f] {
			t.Errorf("missing flag %q in %v", f, info.CMakeFlags)
		}
	}
	for _, bad := range []string{"-DGGML_VULKAN=OFF", "-DLLAMA_BUILD_TESTS=OFF", "-DGGML_CUDA_AVAILABLE=1", "-DCMAKE_INSTALL_PREFIX=/usr/local", "-DGGML_CUDA-ADVANCED=1"} {
		if got[bad] {
			t.Errorf("flag %q should have been filtered out", bad)
		}
	}
	if info.Backend != "cuda12" {
		t.Errorf("Backend = %q, want cuda12", info.Backend)
	}
}

func TestInspectSourceDirEmpty(t *testing.T) {
	if info := InspectSourceDir(""); info.Exists {
		t.Error("empty path should not Exist")
	}
	if info := InspectSourceDir(filepath.Join(t.TempDir(), "nope")); info.Exists {
		t.Error("missing dir should not Exist")
	}
	// Plain dir, no .git, no build.
	plain := t.TempDir()
	info := InspectSourceDir(plain)
	if !info.Exists || info.IsGitRepo || info.GitRemote != "" || info.ConfiguredBuildDir != "" || len(info.CMakeFlags) != 0 {
		t.Errorf("plain dir: %+v", info)
	}
}

func TestInspectSourceDirGitFilePointer(t *testing.T) {
	// A worktree-style ".git" file pointing at the real git dir.
	root := t.TempDir()
	realGit := filepath.Join(t.TempDir(), "realgit")
	if err := os.MkdirAll(realGit, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realGit, "config"), []byte("[remote \"origin\"]\n\turl = https://example.com/x.git\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git"), []byte("gitdir: "+realGit+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	info := InspectSourceDir(root)
	if !info.IsGitRepo || info.GitRemote != "https://example.com/x.git" {
		t.Errorf("git-file pointer: %+v", info)
	}
}
