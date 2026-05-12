//go:build !windows

package main

import (
	"os"
	"os/exec"
	"syscall"
)

// Process-group / teardown helpers, Unix variant. The Windows variant lives
// in proc_windows.go. Build targets v1 are Linux/Windows; macOS is Future
// per DESIGN.md §9.

// setProcGroup makes the child the leader of a new process group so the
// whole tree can be signalled at once, and asks the kernel to SIGKILL the
// child if this process dies unexpectedly (crash, kill -9, IDE-forced
// reload during `wails dev`) — so we never leak a VRAM-holding subprocess.
func setProcGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid:   true,
		Pdeathsig: syscall.SIGKILL,
	}
}

// terminateTree asks the child's process group to exit (SIGTERM).
func terminateTree(p *os.Process) {
	if p != nil {
		_ = syscall.Kill(-p.Pid, syscall.SIGTERM)
	}
}

// killTree force-kills the child's process group (SIGKILL).
func killTree(p *os.Process) {
	if p != nil {
		_ = syscall.Kill(-p.Pid, syscall.SIGKILL)
	}
}
