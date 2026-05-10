package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"sync"
	"syscall"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ErrAlreadyRunning is returned by Start() when the instance is already
// up. Callers (e.g. linked-embed sidecar auto-start) treat this as a
// no-op rather than a real failure.
var ErrAlreadyRunning = errors.New("already running")

// ServerState is the public lifecycle label shown in the UI status pill.
type ServerState string

const (
	StateStopped  ServerState = "stopped"
	StateStarting ServerState = "starting"
	StateRunning  ServerState = "running"
	StateCrashed  ServerState = "crashed"
)

// InstanceStatus is a snapshot of a single server's runtime state.
// Sent to the frontend on `llama:status:<profileID>`.
type InstanceStatus struct {
	ProfileID string      `json:"profileId"`
	State     ServerState `json:"state"`
	Running   bool        `json:"running"`
	Healthy   bool        `json:"healthy"`
	PID       int         `json:"pid"`
	BaseURL   string      `json:"baseUrl"`
	UptimeSec int64       `json:"uptimeSec"`
	StartedAt time.Time   `json:"startedAt,omitempty"`
}

// InstanceMetrics is a small sample bundle pushed periodically while a
// server is running (`llama:metrics:<profileID>`).
type InstanceMetrics struct {
	ProfileID string    `json:"profileId"`
	LastTPS   float64   `json:"lastTps"`
	TPSSpark  []float64 `json:"tpsSpark"`
	Reqs      int64     `json:"reqs"`
}

// LogLine is one captured stderr/stdout line with the source stream.
type LogLine struct {
	ProfileID string `json:"profileId"`
	Stream    string `json:"stream"`
	Text      string `json:"text"`
}

// Status is the legacy single-server status shape kept for backwards
// compatibility with the M0 frontend (`llama:status` event, ServerStatus
// binding). Always reports the default profile if any.
type Status struct {
	Running bool   `json:"running"`
	PID     int    `json:"pid"`
	BaseURL string `json:"baseUrl"`
	Healthy bool   `json:"healthy"`
}

const (
	logRingSize    = 1000
	tpsSparkSize   = 30
	metricsTickSec = 2
)

// tpsLine matches llama-server's release log:
//   slot 0 released | tokens 1284 | 41.2 t/s
var tpsLine = regexp.MustCompile(`tokens\s+(\d+)\s*\|\s*([\d.]+)\s*t/s`)

// ServerInstance owns one llama-server subprocess plus its derived state
// (logs, metrics, health). It is the unit of supervision; ServerRegistry
// stitches them together.
type ServerInstance struct {
	profile Profile
	ctx     context.Context

	mu            sync.Mutex
	cmd           *exec.Cmd
	state         ServerState
	healthy       bool
	startedAt     time.Time
	cancelHC      context.CancelFunc
	stopRequested bool

	logRing []string
	logHead int

	tpsSpark []float64
	lastTPS  float64
	reqs     int64
}

func newServerInstance(profile Profile, ctx context.Context) *ServerInstance {
	return &ServerInstance{
		profile: profile,
		ctx:     ctx,
		state:   StateStopped,
		logRing: make([]string, 0, logRingSize),
	}
}

func (si *ServerInstance) BaseURL() string { return si.profile.BaseURL() }

// effectiveArgs builds the CLI argv for this profile, auto-adding
// kind-specific flags if missing so users don't have to remember them.
func (si *ServerInstance) effectiveArgs() []string {
	args := []string{
		"-m", si.profile.ModelPath,
		"--host", si.profile.Host,
		"--port", strconv.Itoa(si.profile.Port),
	}
	if si.profile.CtxSize > 0 {
		args = append(args, "-c", strconv.Itoa(si.profile.CtxSize))
	}
	if si.profile.NGL > 0 {
		args = append(args, "-ngl", strconv.Itoa(si.profile.NGL))
	}
	// Vision-projector (multimodal) — appended before user ExtraArgs so a
	// user override can still cancel/replace it via --mmproj … in
	// ExtraArgs.
	if si.profile.MMProjPath != "" {
		args = append(args, "--mmproj", si.profile.MMProjPath)
	}
	args = append(args, si.profile.ExtraArgs...)
	switch si.profile.Kind {
	case KindEmbed:
		if !hasFlag(args, "--embedding", "--embeddings") {
			args = append(args, "--embedding")
		}
	case KindRerank:
		if !hasFlag(args, "--reranking") {
			args = append(args, "--reranking")
		}
	}
	return args
}

func hasFlag(args []string, flags ...string) bool {
	for _, a := range args {
		for _, f := range flags {
			if a == f {
				return true
			}
		}
	}
	return false
}

func (si *ServerInstance) Start() error {
	si.mu.Lock()
	if si.cmd != nil && si.cmd.Process != nil {
		si.mu.Unlock()
		return ErrAlreadyRunning
	}
	si.mu.Unlock()

	args := si.effectiveArgs()
	cmd := exec.Command(si.profile.BinPath, args...)
	if si.profile.BinCwd != "" {
		cmd.Dir = si.profile.BinCwd
	}
	// Setpgid: own process group so we can SIGTERM the whole tree on Stop().
	// Pdeathsig (Linux-only): if our process dies unexpectedly (crash, kill -9,
	// IDE forces a reload during `wails dev`), the kernel delivers SIGKILL
	// to the child so we don't leak a 22 GB VRAM-holding subprocess. Build
	// targets v1 are Linux/Windows; macOS is Future per DESIGN.md §9.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid:   true,
		Pdeathsig: syscall.SIGKILL,
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	// VRAM snapshot computed before exec but logged after the ring reset
	// below, so it survives clear-on-start and the user can compare
	// baselines between app- and terminal-launches (--fit non-determinism).
	vramSnap := vramSnapshotLine()

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start llama-server: %w", err)
	}

	hcCtx, cancelHC := context.WithCancel(context.Background())

	si.mu.Lock()
	si.cmd = cmd
	si.state = StateStarting
	si.startedAt = time.Now()
	si.cancelHC = cancelHC
	si.healthy = false
	si.stopRequested = false
	si.tpsSpark = nil
	si.lastTPS = 0
	si.reqs = 0
	// Reset log ring on each Start so the user sees only the current run.
	// Previous-run output stays in the JSONL/ring of the dead process and
	// is lost when the instance is replaced.
	si.logRing = si.logRing[:0]
	si.logHead = 0
	si.mu.Unlock()

	if si.ctx != nil {
		wruntime.EventsEmit(si.ctx, "llama:log:cleared:"+si.profile.ID)
	}

	if vramSnap != "" {
		si.appendLog("stdout", vramSnap)
	}
	si.appendLog("stdout", fmt.Sprintf("started pid=%d cmd=%s %v", cmd.Process.Pid, si.profile.BinPath, args))
	si.emitStatus()

	go si.pump("stdout", stdout)
	go si.pump("stderr", stderr)
	go func() {
		werr := cmd.Wait()
		si.mu.Lock()
		si.cmd = nil
		wasHealthy := si.healthy
		intentional := si.stopRequested
		// Stop() SIGTERMs the subprocess, so cmd.Wait() returns a non-nil
		// signal error even on a normal user-requested shutdown. Don't
		// flag those as crashes.
		if intentional {
			si.state = StateStopped
		} else if werr != nil {
			si.state = StateCrashed
		} else if wasHealthy {
			si.state = StateStopped
		} else {
			si.state = StateCrashed
		}
		si.healthy = false
		si.stopRequested = false
		if si.cancelHC != nil {
			si.cancelHC()
			si.cancelHC = nil
		}
		si.mu.Unlock()
		if werr != nil {
			si.appendLog("stderr", fmt.Sprintf("exited: %v", werr))
		} else {
			si.appendLog("stdout", "exited cleanly")
		}
		si.emitStatus()
	}()
	go si.runHealthAndMetrics(hcCtx)

	return nil
}

func (si *ServerInstance) Stop() error {
	si.mu.Lock()
	if si.cmd == nil || si.cmd.Process == nil {
		si.mu.Unlock()
		return nil
	}
	pid := si.cmd.Process.Pid
	si.stopRequested = true
	si.mu.Unlock()

	_ = syscall.Kill(-pid, syscall.SIGTERM)

	go func() {
		time.Sleep(5 * time.Second)
		si.mu.Lock()
		stillRunning := si.cmd != nil && si.cmd.Process != nil && si.cmd.Process.Pid == pid
		si.mu.Unlock()
		if stillRunning {
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		}
	}()
	return nil
}

func (si *ServerInstance) Status() InstanceStatus {
	si.mu.Lock()
	defer si.mu.Unlock()
	st := InstanceStatus{
		ProfileID: si.profile.ID,
		State:     si.state,
		BaseURL:   si.profile.BaseURL(),
		Healthy:   si.healthy,
	}
	if si.cmd != nil && si.cmd.Process != nil {
		st.Running = true
		st.PID = si.cmd.Process.Pid
		st.StartedAt = si.startedAt
		st.UptimeSec = int64(time.Since(si.startedAt).Seconds())
	}
	return st
}

func (si *ServerInstance) Metrics() InstanceMetrics {
	si.mu.Lock()
	defer si.mu.Unlock()
	spark := make([]float64, len(si.tpsSpark))
	copy(spark, si.tpsSpark)
	return InstanceMetrics{
		ProfileID: si.profile.ID,
		LastTPS:   si.lastTPS,
		TPSSpark:  spark,
		Reqs:      si.reqs,
	}
}

func (si *ServerInstance) Logs() []string {
	si.mu.Lock()
	defer si.mu.Unlock()
	out := make([]string, len(si.logRing))
	copy(out, si.logRing)
	return out
}

func (si *ServerInstance) healthCheckOnce() bool {
	client := &http.Client{Timeout: 1 * time.Second}
	resp, err := client.Get(si.profile.BaseURL() + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

// runHealthAndMetrics drives the per-instance liveness probe and metrics
// emit ticker. The probe transitions starting→running on first 200; the
// ticker pushes throughput samples at metricsTickSec cadence.
func (si *ServerInstance) runHealthAndMetrics(ctx context.Context) {
	timeout := time.Duration(si.profile.HealthTimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	deadline := time.Now().Add(timeout)
	probeTimer := time.NewTicker(500 * time.Millisecond)
	defer probeTimer.Stop()
	metricsTimer := time.NewTicker(metricsTickSec * time.Second)
	defer metricsTimer.Stop()

	healthy := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-probeTimer.C:
			ok := si.healthCheckOnce()
			if ok && !healthy {
				si.mu.Lock()
				si.healthy = true
				si.state = StateRunning
				si.mu.Unlock()
				si.appendLog("stdout", "server healthy")
				si.emitStatus()
				healthy = true
				probeTimer.Reset(5 * time.Second) // slow down once healthy
			} else if !ok && healthy {
				si.mu.Lock()
				si.healthy = false
				si.mu.Unlock()
				si.emitStatus()
				healthy = false
			} else if !ok && !healthy && time.Now().After(deadline) {
				si.appendLog("stderr", "health-check timed out")
				return
			}
		case <-metricsTimer.C:
			if healthy {
				si.emitMetrics()
			}
		}
	}
}

func (si *ServerInstance) pump(stream string, r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		si.appendLog(stream, line)
		si.parseTPS(line)
	}
}

// parseTPS extracts a tokens-per-second sample from a llama-server log line
// and pushes it onto the rolling sparkline buffer.
func (si *ServerInstance) parseTPS(line string) {
	m := tpsLine.FindStringSubmatch(line)
	if m == nil {
		return
	}
	tps, err := strconv.ParseFloat(m[2], 64)
	if err != nil {
		return
	}
	si.mu.Lock()
	si.lastTPS = tps
	si.reqs++
	si.tpsSpark = append(si.tpsSpark, tps)
	if len(si.tpsSpark) > tpsSparkSize {
		si.tpsSpark = si.tpsSpark[len(si.tpsSpark)-tpsSparkSize:]
	}
	si.mu.Unlock()
}

func (si *ServerInstance) appendLog(stream, text string) {
	formatted := fmt.Sprintf("[%s] %s", stream, text)
	si.mu.Lock()
	if len(si.logRing) < logRingSize {
		si.logRing = append(si.logRing, formatted)
	} else {
		si.logRing[si.logHead] = formatted
		si.logHead = (si.logHead + 1) % logRingSize
	}
	si.mu.Unlock()

	if si.ctx == nil {
		return
	}
	wruntime.EventsEmit(si.ctx, "llama:log:"+si.profile.ID, formatted)
	// Backwards-compat fan-out for the legacy single-channel log subscriber.
	wruntime.EventsEmit(si.ctx, "llama:log", formatted)
}

func (si *ServerInstance) emitStatus() {
	if si.ctx == nil {
		return
	}
	st := si.Status()
	wruntime.EventsEmit(si.ctx, "llama:status:"+si.profile.ID, st)
}

func (si *ServerInstance) emitMetrics() {
	if si.ctx == nil {
		return
	}
	wruntime.EventsEmit(si.ctx, "llama:metrics:"+si.profile.ID, si.Metrics())
}

// ─────────────────────────── Registry ────────────────────────────────

// ServerRegistry maps profile IDs to live ServerInstance objects. The
// ProfileManager is the source of truth for profile definitions; the
// registry only owns *running* state.
type ServerRegistry struct {
	mu        sync.Mutex
	ctx       context.Context
	pm        *ProfileManager
	instances map[string]*ServerInstance
}

func NewServerRegistry(pm *ProfileManager) *ServerRegistry {
	return &ServerRegistry{
		pm:        pm,
		instances: make(map[string]*ServerInstance),
	}
}

func (r *ServerRegistry) Attach(ctx context.Context) {
	r.mu.Lock()
	r.ctx = ctx
	for _, si := range r.instances {
		si.ctx = ctx
	}
	r.mu.Unlock()
}

// instanceFor returns the live ServerInstance for `id`, creating one from
// the profile registry if it does not yet exist.
func (r *ServerRegistry) instanceFor(id string) (*ServerInstance, error) {
	r.mu.Lock()
	si, ok := r.instances[id]
	r.mu.Unlock()
	if ok {
		return si, nil
	}
	if r.pm == nil {
		return nil, fmt.Errorf("profile manager unavailable")
	}
	p, err := r.pm.Get(id)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if si, ok := r.instances[id]; ok {
		return si, nil
	}
	si = newServerInstance(p, r.ctx)
	r.instances[id] = si
	return si, nil
}

// refreshProfile is used after Update — replaces the stored profile so the
// next Start() picks up the new flags. No-op if the instance is running.
func (r *ServerRegistry) refreshProfile(p Profile) {
	r.mu.Lock()
	defer r.mu.Unlock()
	si, ok := r.instances[p.ID]
	if !ok {
		return
	}
	si.mu.Lock()
	running := si.cmd != nil
	if !running {
		si.profile = p
	}
	si.mu.Unlock()
}

func (r *ServerRegistry) Start(id string) error {
	si, err := r.instanceFor(id)
	if err != nil {
		return err
	}
	// Runtime port-collision check. Profiles may share a Port (different
	// model/args variants of the same server), but only one can listen at a
	// time. Look across the registry for another running instance bound to
	// the same host:port.
	if conflict := r.findPortConflict(si); conflict != "" {
		return fmt.Errorf("port %d already in use by running profile %q", si.profile.Port, conflict)
	}
	if err := si.Start(); err != nil {
		return err
	}
	// Sidecar embed: if this is a chat profile flagged
	// LaunchEmbedding=true with a paired embed profile, kick that off
	// best-effort. Failures don't roll back the chat start — the user
	// can still chat, RAG just won't be available.
	if si.profile.Kind == KindChat && si.profile.LaunchEmbedding && si.profile.EmbedProfileID != "" {
		go func(embedID string) {
			err := r.Start(embedID)
			if err == nil || errors.Is(err, ErrAlreadyRunning) {
				return // silent no-op when sidecar is already up
			}
			if r.ctx != nil {
				wruntime.LogWarningf(r.ctx, "linked embed start (%s): %v", embedID, err)
			}
		}(si.profile.EmbedProfileID)
	}
	return nil
}

// findPortConflict returns the ID of another running ServerInstance bound
// to the same host:port as `target`, or "" if none. Two stopped profiles
// sharing a port is fine; only one may be live at a time.
func (r *ServerRegistry) findPortConflict(target *ServerInstance) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, si := range r.instances {
		if si == target {
			continue
		}
		si.mu.Lock()
		running := si.cmd != nil && si.cmd.Process != nil
		samePort := si.profile.Port == target.profile.Port && si.profile.Host == target.profile.Host
		si.mu.Unlock()
		if running && samePort {
			return id
		}
	}
	return ""
}

func (r *ServerRegistry) Stop(id string) error {
	r.mu.Lock()
	si, ok := r.instances[id]
	r.mu.Unlock()
	if !ok {
		return nil
	}
	return si.Stop()
}

func (r *ServerRegistry) Restart(id string) error {
	if err := r.Stop(id); err != nil {
		return err
	}
	// Wait briefly for SIGTERM to take effect.
	time.Sleep(300 * time.Millisecond)
	return r.Start(id)
}

func (r *ServerRegistry) Status(id string) InstanceStatus {
	si, err := r.instanceFor(id)
	if err != nil {
		return InstanceStatus{ProfileID: id, State: StateStopped}
	}
	return si.Status()
}

func (r *ServerRegistry) Metrics(id string) InstanceMetrics {
	si, err := r.instanceFor(id)
	if err != nil {
		return InstanceMetrics{ProfileID: id}
	}
	return si.Metrics()
}

func (r *ServerRegistry) Logs(id string) []string {
	si, err := r.instanceFor(id)
	if err != nil {
		return nil
	}
	return si.Logs()
}

// StopAll halts every live server (best-effort) and is meant for app
// shutdown. Failures are swallowed.
func (r *ServerRegistry) StopAll() {
	r.mu.Lock()
	ids := make([]string, 0, len(r.instances))
	for id := range r.instances {
		ids = append(ids, id)
	}
	r.mu.Unlock()
	for _, id := range ids {
		_ = r.Stop(id)
	}
}

// DefaultProfileID returns the ID of the first chat-kind profile from the
// manager. Used by legacy bindings that don't carry a profileID.
func (r *ServerRegistry) DefaultProfileID() string {
	if r.pm == nil {
		return ""
	}
	for _, p := range r.pm.List() {
		if p.Kind == KindChat {
			return p.ID
		}
	}
	return ""
}

// LegacyStatus rolls up the default chat profile into the M0-shaped Status
// struct so older event subscribers keep working until the frontend swaps
// over.
func (r *ServerRegistry) LegacyStatus() Status {
	id := r.DefaultProfileID()
	if id == "" {
		return Status{}
	}
	st := r.Status(id)
	return Status{
		Running: st.Running,
		PID:     st.PID,
		BaseURL: st.BaseURL,
		Healthy: st.Healthy,
	}
}

// emitLegacyStatus republishes the default profile's status on the legacy
// `llama:status` channel so the unmodified F1/F2 frontend stays alive.
// Wired to fire on each per-profile status event by app.go.
func (r *ServerRegistry) emitLegacyStatus() {
	if r.ctx == nil {
		return
	}
	wruntime.EventsEmit(r.ctx, "llama:status", r.LegacyStatus())
}

// AutostartAll starts every profile flagged Autostart=true. Best-effort:
// errors are logged but do not abort the others.
func (r *ServerRegistry) AutostartAll() {
	if r.pm == nil {
		return
	}
	for _, p := range r.pm.List() {
		if !p.Autostart {
			continue
		}
		if err := r.Start(p.ID); err != nil && r.ctx != nil {
			wruntime.LogErrorf(r.ctx, "autostart %s: %v", p.ID, err)
		}
	}
}

// hookLegacyStatus subscribes to per-profile status events and re-emits a
// rolled-up legacy `llama:status` event for any pre-multi-profile
// frontend code that still depends on it. Call once after Attach().
func (r *ServerRegistry) hookLegacyStatus() {
	if r.ctx == nil {
		return
	}
	id := r.DefaultProfileID()
	if id == "" {
		return
	}
	wruntime.EventsOn(r.ctx, "llama:status:"+id, func(_ ...interface{}) {
		r.emitLegacyStatus()
	})
}

// Touch ensures every persisted profile has a corresponding (stopped)
// ServerInstance so List() returns them. Useful right after startup so
// the UI can subscribe to status events without waiting for the user to
// click Start.
func (r *ServerRegistry) Touch() {
	if r.pm == nil {
		return
	}
	for _, p := range r.pm.List() {
		_, _ = r.instanceFor(p.ID)
	}
}
