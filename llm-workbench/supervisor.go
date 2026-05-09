package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type LlamaSupervisor struct {
	cfg *Config

	mu  sync.Mutex
	cmd *exec.Cmd

	ctx context.Context // wails ctx for emitting log events
}

func NewLlamaSupervisor(cfg *Config) *LlamaSupervisor {
	return &LlamaSupervisor{cfg: cfg}
}

func (s *LlamaSupervisor) Attach(ctx context.Context) {
	s.ctx = ctx
}

type Status struct {
	Running bool   `json:"running"`
	PID     int    `json:"pid"`
	BaseURL string `json:"baseUrl"`
	Healthy bool   `json:"healthy"`
}

// Start spawns llama-server. Mutex is only held while mutating state;
// I/O, subprocess launch, and event emits happen unlocked to avoid
// deadlocking with Status() callers.
func (s *LlamaSupervisor) Start() error {
	s.mu.Lock()
	if s.cmd != nil && s.cmd.Process != nil {
		pid := s.cmd.Process.Pid
		s.mu.Unlock()
		return fmt.Errorf("already running (pid %d)", pid)
	}
	s.mu.Unlock()

	args := []string{
		"-m", s.cfg.ModelPath,
		"--host", s.cfg.Host,
		"--port", strconv.Itoa(s.cfg.Port),
	}
	args = append(args, s.cfg.ExtraArgs...)

	cmd := exec.Command(s.cfg.BinPath, args...)
	if s.cfg.BinCwd != "" {
		cmd.Dir = s.cfg.BinCwd
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start llama-server: %w", err)
	}

	s.mu.Lock()
	s.cmd = cmd
	s.mu.Unlock()

	pid := cmd.Process.Pid
	s.emitLog(fmt.Sprintf("started pid=%d cmd=%s %v", pid, s.cfg.BinPath, args))

	go s.pump("stdout", stdout)
	go s.pump("stderr", stderr)
	go func() {
		werr := cmd.Wait()
		s.mu.Lock()
		s.cmd = nil
		s.mu.Unlock()
		if werr != nil {
			s.emitLog(fmt.Sprintf("exited: %v", werr))
		} else {
			s.emitLog("exited cleanly")
		}
		s.emitStatus()
	}()

	go s.waitHealthy()
	s.emitStatus()
	return nil
}

func (s *LlamaSupervisor) Stop() error {
	s.mu.Lock()
	if s.cmd == nil || s.cmd.Process == nil {
		s.mu.Unlock()
		return nil
	}
	pid := s.cmd.Process.Pid
	s.mu.Unlock()

	_ = syscall.Kill(-pid, syscall.SIGTERM)

	go func() {
		time.Sleep(5 * time.Second)
		s.mu.Lock()
		stillRunning := s.cmd != nil && s.cmd.Process != nil && s.cmd.Process.Pid == pid
		s.mu.Unlock()
		if stillRunning {
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		}
	}()
	return nil
}

// Status returns a snapshot. The mutex is released before the /health
// HTTP probe so concurrent Status() calls don't serialize on a 1s timeout.
func (s *LlamaSupervisor) Status() Status {
	s.mu.Lock()
	st := Status{BaseURL: s.cfg.BaseURL()}
	if s.cmd != nil && s.cmd.Process != nil {
		st.Running = true
		st.PID = s.cmd.Process.Pid
	}
	s.mu.Unlock()

	if st.Running {
		st.Healthy = s.healthCheckOnce()
	}
	return st
}

func (s *LlamaSupervisor) healthCheckOnce() bool {
	client := &http.Client{Timeout: 1 * time.Second}
	resp, err := client.Get(s.cfg.BaseURL() + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func (s *LlamaSupervisor) waitHealthy() {
	deadline := time.Now().Add(time.Duration(s.cfg.HealthTimeout) * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		running := s.cmd != nil
		s.mu.Unlock()
		if !running {
			return
		}
		if s.healthCheckOnce() {
			s.emitLog("server healthy")
			s.emitStatus()
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	s.emitLog("health-check timed out")
}

func (s *LlamaSupervisor) pump(stream string, r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		s.emitLog(fmt.Sprintf("[%s] %s", stream, sc.Text()))
	}
}

func (s *LlamaSupervisor) emitLog(msg string) {
	if s.ctx == nil {
		fmt.Println("llama:", msg)
		return
	}
	wruntime.EventsEmit(s.ctx, "llama:log", msg)
}

func (s *LlamaSupervisor) emitStatus() {
	if s.ctx == nil {
		return
	}
	wruntime.EventsEmit(s.ctx, "llama:status", s.Status())
}
