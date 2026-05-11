package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// mustWriteExec writes an executable script (used for the fake git/cmake
// shims).
func mustWriteExec(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	if err := os.Chmod(path, 0o755); err != nil {
		t.Fatalf("chmod %s: %v", path, err)
	}
}

// fakeToolsDir creates a temp dir holding fake `git` and `cmake` shims and
// returns its path. With compileSleepSecs > 0 the fake cmake's `--build`
// step sleeps that long before producing the binary (so a test can cancel
// mid-compile). Skips the test on platforms without a POSIX shell.
func fakeToolsDir(t *testing.T, compileSleepSecs int) string {
	t.Helper()
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("fake-tool harness requires a POSIX shell")
	}
	dir := t.TempDir()

	gitScript := `#!/bin/sh
case "$1" in
  rev-parse)
    echo "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    ;;
  clone)
    echo "git clone $2 -> $3"
    mkdir -p "$3/.git"
    ;;
  *)
    echo "git $*"
    ;;
esac
exit 0
`
	sleepLine := ""
	if compileSleepSecs > 0 {
		sleepLine = fmt.Sprintf("    sleep %d\n", compileSleepSecs)
	}
	cmakeScript := `#!/bin/sh
echo "cmake $*"
bdir=""
prev=""
for a in "$@"; do
  case "$prev" in
    -B|--build) bdir="$a" ;;
  esac
  prev="$a"
done
[ -n "$bdir" ] && mkdir -p "$bdir/bin"
case " $* " in
  *" --build "*)
` + sleepLine + `    : > "$bdir/bin/llama-server"
    chmod +x "$bdir/bin/llama-server"
    ;;
esac
exit 0
`
	mustWriteExec(t, filepath.Join(dir, "git"), gitScript)
	mustWriteExec(t, filepath.Join(dir, "cmake"), cmakeScript)
	return dir
}

func prependPATH(t *testing.T, dir string) {
	t.Helper()
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func waitBuild(t *testing.T, o *BuildOrchestrator, recipeID string, timeout time.Duration) BuildStatus {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		st := o.Status(recipeID)
		if st.Phase != "" && !st.Running {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("build %q did not finish within %s; last status: %+v", recipeID, timeout, o.Status(recipeID))
	return BuildStatus{}
}

func waitPhase(t *testing.T, o *BuildOrchestrator, recipeID string, want BuildPhase, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if o.Status(recipeID).Phase == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("recipe %q never reached phase %q; current=%q", recipeID, want, o.Status(recipeID).Phase)
}

func TestOrchestratorExistingSource(t *testing.T) {
	prependPATH(t, fakeToolsDir(t, 0))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	bm, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	o := NewBuildOrchestrator(bm) // no Attach: ctx nil, events suppressed

	srcDir := t.TempDir()
	mustWriteExec(t, filepath.Join(srcDir, "CMakeLists.txt"), "project(llama.cpp)\n") // make the dir non-empty
	r, err := bm.CreateRecipe(BuildRecipe{ID: "local", SourceDir: srcDir, Backend: BackendCPU, CMakeFlags: []string{"-DGGML_NATIVE=ON"}})
	if err != nil {
		t.Fatalf("CreateRecipe: %v", err)
	}

	if err := o.Start(r.ID); err != nil {
		t.Fatalf("Start: %v", err)
	}
	st := waitBuild(t, o, r.ID, 15*time.Second)
	if st.Phase != BuildPhaseDone {
		t.Fatalf("phase=%s msg=%q", st.Phase, st.Message)
	}
	if st.BuildID == "" {
		t.Fatal("no build id on a successful run")
	}

	b, err := bm.GetBuild(st.BuildID)
	if err != nil {
		t.Fatalf("GetBuild: %v", err)
	}
	wantBin := filepath.Join(srcDir, "build", "bin", "llama-server")
	if b.BinaryPath != wantBin {
		t.Errorf("BinaryPath = %q, want %q", b.BinaryPath, wantBin)
	}
	if b.Commit != "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" {
		t.Errorf("Commit = %q", b.Commit)
	}
	if b.RecipeID != r.ID {
		t.Errorf("RecipeID = %q, want %q", b.RecipeID, r.ID)
	}
	if !pathExists(wantBin) {
		t.Error("llama-server binary not on disk")
	}

	log := strings.Join(o.Log(r.ID), "\n")
	if !strings.Contains(log, "cmake -S") {
		t.Errorf("configure step missing from log:\n%s", log)
	}
	if !strings.Contains(log, "--build") {
		t.Errorf("compile step missing from log:\n%s", log)
	}
	if !strings.Contains(log, "build log written to") {
		t.Errorf("build log not persisted:\n%s", log)
	}

	// Rebuild from the same recipe replaces the entry (stable build ID).
	if err := o.Start(r.ID); err != nil {
		t.Fatalf("re-Start: %v", err)
	}
	st = waitBuild(t, o, r.ID, 15*time.Second)
	if st.Phase != BuildPhaseDone {
		t.Fatalf("rebuild phase=%s msg=%q", st.Phase, st.Message)
	}
	if len(bm.ListBuilds()) != 1 {
		t.Errorf("rebuild created a duplicate: %d builds", len(bm.ListBuilds()))
	}
}

func TestOrchestratorClone(t *testing.T) {
	prependPATH(t, fakeToolsDir(t, 0))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	bm, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	o := NewBuildOrchestrator(bm)

	srcDir := filepath.Join(t.TempDir(), "llama.cpp") // does not exist yet
	r, err := bm.CreateRecipe(BuildRecipe{
		ID: "remote", SourceDir: srcDir, SourceRepo: "https://example.com/llama.cpp",
		GitRef: "master", Backend: BackendCUDA12, CMakeFlags: []string{"-DGGML_CUDA=ON"},
	})
	if err != nil {
		t.Fatalf("CreateRecipe: %v", err)
	}

	if err := o.Start(r.ID); err != nil {
		t.Fatalf("Start: %v", err)
	}
	st := waitBuild(t, o, r.ID, 15*time.Second)
	if st.Phase != BuildPhaseDone {
		t.Fatalf("phase=%s msg=%q", st.Phase, st.Message)
	}
	if !pathExists(filepath.Join(srcDir, ".git")) {
		t.Error("clone did not create .git in the source dir")
	}
	b, err := bm.GetBuild(st.BuildID)
	if err != nil {
		t.Fatalf("GetBuild: %v", err)
	}
	if b.SourceRepo != "https://example.com/llama.cpp" {
		t.Errorf("SourceRepo = %q", b.SourceRepo)
	}
	log := strings.Join(o.Log(r.ID), "\n")
	if !strings.Contains(log, "git clone https://example.com/llama.cpp") {
		t.Errorf("clone not in log:\n%s", log)
	}
	if !strings.Contains(log, "git checkout master") {
		t.Errorf("checkout not in log:\n%s", log)
	}
}

func TestOrchestratorMissingSourceNoRepo(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	bm, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	o := NewBuildOrchestrator(bm)

	r, err := bm.CreateRecipe(BuildRecipe{ID: "broken", SourceDir: filepath.Join(t.TempDir(), "nope")})
	if err != nil {
		t.Fatalf("CreateRecipe: %v", err)
	}
	if err := o.Start(r.ID); err == nil {
		t.Fatal("Start should reject a missing source dir when there's no source_repo to clone")
	}
}

func TestOrchestratorCancel(t *testing.T) {
	prependPATH(t, fakeToolsDir(t, 4)) // 4s sleep inside `cmake --build`
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	bm, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	o := NewBuildOrchestrator(bm)

	srcDir := t.TempDir()
	mustWriteExec(t, filepath.Join(srcDir, "CMakeLists.txt"), "x\n")
	r, err := bm.CreateRecipe(BuildRecipe{ID: "slow", SourceDir: srcDir, Backend: BackendCPU})
	if err != nil {
		t.Fatalf("CreateRecipe: %v", err)
	}

	if err := o.Start(r.ID); err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitPhase(t, o, r.ID, BuildPhaseCompile, 5*time.Second)
	o.Cancel(r.ID)

	st := waitBuild(t, o, r.ID, 15*time.Second)
	if st.Phase != BuildPhaseCancelled {
		t.Fatalf("phase=%s, want cancelled (msg=%q)", st.Phase, st.Message)
	}
	if len(bm.ListBuilds()) != 0 {
		t.Errorf("cancelled build was registered: %d builds", len(bm.ListBuilds()))
	}
	// A second build can start after a cancel.
	if err := o.Start(r.ID); err != nil {
		t.Fatalf("Start after cancel: %v", err)
	}
	o.Cancel(r.ID) // don't actually wait out another 4s
}

func TestOrchestratorRejectsConcurrentBuild(t *testing.T) {
	prependPATH(t, fakeToolsDir(t, 4))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	bm, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	o := NewBuildOrchestrator(bm)

	srcDir := t.TempDir()
	mustWriteExec(t, filepath.Join(srcDir, "CMakeLists.txt"), "x\n")
	r, err := bm.CreateRecipe(BuildRecipe{ID: "busy", SourceDir: srcDir})
	if err != nil {
		t.Fatalf("CreateRecipe: %v", err)
	}
	if err := o.Start(r.ID); err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitPhase(t, o, r.ID, BuildPhaseCompile, 5*time.Second)
	if err := o.Start(r.ID); err == nil {
		t.Error("second Start while a build is running should error")
	}
	o.Cancel(r.ID)
	waitBuild(t, o, r.ID, 15*time.Second)
}
