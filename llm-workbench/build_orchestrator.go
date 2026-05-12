package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// BuildPhase is the current step of a build run, shown in the UI pill.
type BuildPhase string

const (
	BuildPhaseIdle      BuildPhase = "idle"
	BuildPhaseCloning   BuildPhase = "cloning"
	BuildPhaseFetching  BuildPhase = "fetching"
	BuildPhaseConfigure BuildPhase = "configuring"
	BuildPhaseCompile   BuildPhase = "compiling"
	BuildPhaseDone      BuildPhase = "done"
	BuildPhaseFailed    BuildPhase = "failed"
	BuildPhaseCancelled BuildPhase = "cancelled"
)

// BuildStatus is a snapshot of a build run. Emitted on
// `build:status:<recipeID>` whenever the phase changes.
type BuildStatus struct {
	RecipeID  string     `json:"recipeId"`
	Phase     BuildPhase `json:"phase"`
	Running   bool       `json:"running"`
	Message   string     `json:"message,omitempty"` // human summary, or error text on failure
	BuildID   string     `json:"buildId,omitempty"` // set when the run produced a Build
	StartedAt time.Time  `json:"startedAt,omitempty"`
}

// buildLogMax caps the captured log line count per run. A full llama.cpp
// cmake build is a few thousand lines; this is generous headroom.
const buildLogMax = 30000

// buildRun is the live state of one in-flight (or just-finished) build.
type buildRun struct {
	cancel context.CancelFunc
	cmd    *exec.Cmd // current child process (for direct SIGTERM); nil between commands
	status BuildStatus
	log    []string
}

// BuildOrchestrator drives `git` + `cmake` to turn a BuildRecipe into a
// Build artifact, streaming the combined stdout/stderr to the frontend.
// One in-flight build per recipe. Mirrors LlamaSupervisor's process-group
// discipline: each child runs in its own group so a cancel SIGTERMs the
// whole tree (5s SIGKILL escalation).
//
// Mutex discipline: o.mu guards `runs` and the fields inside each buildRun.
// It is never held across a subprocess wait or an external command — those
// run unlocked; status/log mutations take the lock only for the write.
type BuildOrchestrator struct {
	ctx    context.Context
	builds *BuildManager

	mu   sync.Mutex
	runs map[string]*buildRun // recipeID -> run (kept after finish so Status/Log work)
}

// NewBuildOrchestrator returns an orchestrator bound to the build registry.
// builds must be non-nil — callers gate construction on a loaded manager.
func NewBuildOrchestrator(builds *BuildManager) *BuildOrchestrator {
	return &BuildOrchestrator{builds: builds, runs: map[string]*buildRun{}}
}

// Attach wires the Wails ctx so log/status events reach the frontend.
func (o *BuildOrchestrator) Attach(ctx context.Context) { o.ctx = ctx }

// Start kicks off a build for the named recipe in the background. Returns
// an error synchronously for the cases worth surfacing before any work
// happens (unknown recipe, missing source dir with nothing to clone, a
// build already in flight). Progress is reported via events / Status.
func (o *BuildOrchestrator) Start(recipeID string) error {
	if o.builds == nil {
		return fmt.Errorf("build manager unavailable")
	}
	r, err := o.builds.GetRecipe(recipeID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(r.SourceDir) == "" {
		return fmt.Errorf("recipe %q has no source_dir", recipeID)
	}
	if strings.TrimSpace(r.SourceRepo) == "" && !pathExists(absPath(r.SourceDir)) {
		return fmt.Errorf("source_dir %q does not exist and recipe has no source_repo to clone", r.SourceDir)
	}
	o.mu.Lock()
	if run := o.runs[recipeID]; run != nil && run.status.Running {
		o.mu.Unlock()
		return fmt.Errorf("a build for recipe %q is already running", recipeID)
	}
	o.mu.Unlock()

	go o.run(recipeID, r)
	return nil
}

// Cancel requests cancellation of the in-flight build for the recipe.
// No-op if nothing is running. Cancels the build context (the per-command
// watchdog SIGTERMs the group) and also pokes the current child group
// directly in case the cancel lands between commands.
func (o *BuildOrchestrator) Cancel(recipeID string) {
	o.mu.Lock()
	r := o.runs[recipeID]
	if r == nil || !r.status.Running {
		o.mu.Unlock()
		return
	}
	cancel := r.cancel
	cmd := r.cmd
	o.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if cmd != nil && cmd.Process != nil {
		terminateTree(cmd.Process)
	}
}

// Status returns a snapshot of the latest run for the recipe. A zero-value
// BuildStatus (Phase "") means no build has ever been started for it.
func (o *BuildOrchestrator) Status(recipeID string) BuildStatus {
	o.mu.Lock()
	defer o.mu.Unlock()
	if r := o.runs[recipeID]; r != nil {
		return r.status
	}
	return BuildStatus{RecipeID: recipeID}
}

// Log returns the captured log lines for the recipe's latest run.
func (o *BuildOrchestrator) Log(recipeID string) []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	if r := o.runs[recipeID]; r != nil {
		out := make([]string, len(r.log))
		copy(out, r.log)
		return out
	}
	return nil
}

// ─────────────────────────── the build itself ───────────────────────

func (o *BuildOrchestrator) run(recipeID string, r BuildRecipe) {
	ctx, cancel := context.WithCancel(context.Background())
	run := &buildRun{
		cancel: cancel,
		status: BuildStatus{RecipeID: recipeID, Phase: BuildPhaseIdle, Running: true, StartedAt: time.Now()},
	}
	o.mu.Lock()
	o.runs[recipeID] = run
	o.mu.Unlock()
	o.emitStatus(recipeID)

	srcAbs := absPath(r.SourceDir)
	buildDirAbs := filepath.Join(srcAbs, r.BuildDirOrDefault())

	// Phase 1 — obtain / update the source tree (only when a remote is set).
	if strings.TrimSpace(r.SourceRepo) != "" {
		if !pathExists(srcAbs) || isEmptyDir(srcAbs) {
			o.setPhase(recipeID, BuildPhaseCloning, "git clone "+r.SourceRepo)
			if err := o.runCmd(ctx, recipeID, "", "git", "clone", r.SourceRepo, srcAbs); err != nil {
				o.fail(recipeID, ctx, "clone failed: "+err.Error())
				return
			}
		} else {
			o.setPhase(recipeID, BuildPhaseFetching, "git fetch --all --tags")
			if err := o.runCmd(ctx, recipeID, srcAbs, "git", "fetch", "--all", "--tags"); err != nil {
				o.fail(recipeID, ctx, "fetch failed: "+err.Error())
				return
			}
		}
		if ref := strings.TrimSpace(r.GitRef); ref != "" {
			if err := o.runCmd(ctx, recipeID, srcAbs, "git", "checkout", ref); err != nil {
				o.fail(recipeID, ctx, "checkout "+ref+" failed: "+err.Error())
				return
			}
		}
	}
	if !pathExists(srcAbs) {
		o.fail(recipeID, ctx, "source_dir "+srcAbs+" does not exist")
		return
	}
	if ctx.Err() != nil {
		o.fail(recipeID, ctx, "cancelled")
		return
	}

	// Resolve the commit the tree is on (best-effort — source may not be git).
	commit := ""
	if out, err := o.capture(ctx, srcAbs, "git", "rev-parse", "HEAD"); err == nil {
		commit = strings.TrimSpace(out)
		if commit != "" {
			o.appendLog(recipeID, "source at commit "+commit)
		}
	}

	// Phase 2 — configure.
	cfgArgs := append([]string{"-S", srcAbs, "-B", buildDirAbs}, r.CMakeFlags...)
	o.setPhase(recipeID, BuildPhaseConfigure, "cmake "+strings.Join(cfgArgs, " "))
	if err := o.runCmd(ctx, recipeID, srcAbs, "cmake", cfgArgs...); err != nil {
		o.fail(recipeID, ctx, "configure failed: "+err.Error())
		return
	}

	// Phase 3 — compile.
	buildArgs := []string{"--build", buildDirAbs, "--config", "Release"}
	if r.Jobs > 0 {
		buildArgs = append(buildArgs, "-j", strconv.Itoa(r.Jobs))
	} else {
		buildArgs = append(buildArgs, "-j")
	}
	o.setPhase(recipeID, BuildPhaseCompile, "cmake "+strings.Join(buildArgs, " "))
	if err := o.runCmd(ctx, recipeID, srcAbs, "cmake", buildArgs...); err != nil {
		o.fail(recipeID, ctx, "compile failed: "+err.Error())
		return
	}

	// Locate the produced binary.
	binPath, err := locateLlamaServer(buildDirAbs)
	if err != nil {
		o.fail(recipeID, ctx, "build finished but llama-server binary not found under "+buildDirAbs+": "+err.Error())
		return
	}

	o.persistLog(recipeID, filepath.Join(buildDirAbs, "llm-workbench-build.log"))

	b := Build{
		ID:           recipeID, // stable: a rebuild from the same recipe replaces this entry
		RecipeID:     recipeID,
		DisplayName:  buildDisplayName(r, commit),
		SourceRepo:   r.SourceRepo,
		Commit:       commit,
		Backend:      r.Backend,
		BinaryPath:   binPath,
		Capabilities: []string{"chat", "embed", "rerank", "mmproj"},
		BuiltAt:      time.Now().UTC(),
	}
	saved, err := o.builds.AddBuild(b)
	if err != nil {
		o.fail(recipeID, ctx, "register build: "+err.Error())
		return
	}
	o.finish(recipeID, BuildPhaseDone, "built "+saved.BinaryPath, saved.ID)
}

// runCmd runs one external command, streaming its merged stdout+stderr into
// the run's log, and waits for it. The child gets its own process group; a
// ctx cancellation SIGTERMs the group, escalating to SIGKILL after 5s.
// Returns ctx.Err() when cancelled, the wrapped wait error otherwise.
func (o *BuildOrchestrator) runCmd(ctx context.Context, recipeID, dir, name string, args ...string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	cmd := exec.Command(name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	setProcGroup(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	o.appendLog(recipeID, "$ "+name+" "+strings.Join(args, " "))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	o.mu.Lock()
	if r := o.runs[recipeID]; r != nil {
		r.cmd = cmd
	}
	o.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); o.pumpInto(recipeID, stdout) }()
	go func() { defer wg.Done(); o.pumpInto(recipeID, stderr) }()

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			if cmd.Process != nil {
				proc := cmd.Process
				terminateTree(proc)
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					killTree(proc)
				}
			}
		case <-done:
		}
	}()

	wg.Wait()          // drain pipes (EOF after the process exits)
	werr := cmd.Wait() // safe now that all reads have completed
	close(done)

	o.mu.Lock()
	if r := o.runs[recipeID]; r != nil {
		r.cmd = nil
	}
	o.mu.Unlock()

	if ctx.Err() != nil {
		return ctx.Err()
	}
	if werr != nil {
		return fmt.Errorf("%s exited: %w", name, werr)
	}
	return nil
}

// capture runs a short command and returns its stdout. Used for
// `git rev-parse HEAD`. Honours ctx but doesn't bother with a watchdog —
// these are sub-second.
func (o *BuildOrchestrator) capture(ctx context.Context, dir, name string, args ...string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.Output()
	return string(out), err
}

func (o *BuildOrchestrator) pumpInto(recipeID string, rc io.ReadCloser) {
	sc := bufio.NewScanner(rc)
	// cmake/ninja status lines and compiler errors can be long.
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		o.appendLog(recipeID, sc.Text())
	}
}

// ─────────────────────────── status / log plumbing ──────────────────

func (o *BuildOrchestrator) appendLog(recipeID, line string) {
	o.mu.Lock()
	if r := o.runs[recipeID]; r != nil {
		switch {
		case len(r.log) < buildLogMax:
			r.log = append(r.log, line)
		case len(r.log) == buildLogMax:
			r.log = append(r.log, "… (build log truncated)")
		}
	}
	o.mu.Unlock()
	if o.ctx != nil {
		wruntime.EventsEmit(o.ctx, "build:log:"+recipeID, line)
	}
}

func (o *BuildOrchestrator) setPhase(recipeID string, phase BuildPhase, msg string) {
	o.mu.Lock()
	if r := o.runs[recipeID]; r != nil {
		r.status.Phase = phase
		r.status.Message = msg
	}
	o.mu.Unlock()
	if msg != "" {
		o.appendLog(recipeID, "── "+string(phase)+": "+msg)
	}
	o.emitStatus(recipeID)
}

// finish marks the run as no longer running, with a terminal phase.
func (o *BuildOrchestrator) finish(recipeID string, phase BuildPhase, msg, buildID string) {
	o.mu.Lock()
	if r := o.runs[recipeID]; r != nil {
		r.status.Phase = phase
		r.status.Running = false
		r.status.Message = msg
		r.status.BuildID = buildID
		r.cancel = nil
	}
	o.mu.Unlock()
	if msg != "" {
		o.appendLog(recipeID, "── "+string(phase)+": "+msg)
	}
	o.emitStatus(recipeID)
}

// fail picks Cancelled vs Failed based on the build context and finishes.
func (o *BuildOrchestrator) fail(recipeID string, ctx context.Context, msg string) {
	if ctx.Err() != nil {
		o.finish(recipeID, BuildPhaseCancelled, "cancelled", "")
		return
	}
	o.finish(recipeID, BuildPhaseFailed, msg, "")
}

func (o *BuildOrchestrator) emitStatus(recipeID string) {
	if o.ctx == nil {
		return
	}
	o.mu.Lock()
	var st BuildStatus
	if r := o.runs[recipeID]; r != nil {
		st = r.status
	} else {
		st = BuildStatus{RecipeID: recipeID}
	}
	o.mu.Unlock()
	wruntime.EventsEmit(o.ctx, "build:status:"+recipeID, st)
}

func (o *BuildOrchestrator) persistLog(recipeID, path string) {
	lines := o.Log(recipeID)
	if len(lines) == 0 {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		o.appendLog(recipeID, "warning: could not create dir for build log: "+err.Error())
		return
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		o.appendLog(recipeID, "warning: could not write build log: "+err.Error())
		return
	}
	o.appendLog(recipeID, "build log written to "+path)
}

// ─────────────────────────── helpers ────────────────────────────────

func absPath(p string) string {
	if a, err := filepath.Abs(p); err == nil {
		return a
	}
	return p
}

func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func isEmptyDir(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	names, err := f.Readdirnames(1)
	return err == io.EOF || (err == nil && len(names) == 0)
}

// locateLlamaServer finds the built `llama-server` under buildDir. Checks
// the common cmake output spots first, then falls back to a tree walk.
func locateLlamaServer(buildDir string) (string, error) {
	exe := "llama-server"
	if runtime.GOOS == "windows" {
		exe = "llama-server.exe"
	}
	for _, cand := range []string{
		filepath.Join(buildDir, "bin", exe),
		filepath.Join(buildDir, exe),
		filepath.Join(buildDir, "bin", "Release", exe),
	} {
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
			return cand, nil
		}
	}
	var found string
	_ = filepath.WalkDir(buildDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if !d.IsDir() && d.Name() == exe {
			found = path
			return fs.SkipAll
		}
		return nil
	})
	if found != "" {
		return found, nil
	}
	return "", fmt.Errorf("%s not found", exe)
}

func buildDisplayName(r BuildRecipe, commit string) string {
	base := strings.TrimSpace(r.DisplayName)
	if base == "" {
		base = r.ID
	}
	if len(commit) >= 8 {
		return base + " @" + commit[:8]
	}
	return base
}
