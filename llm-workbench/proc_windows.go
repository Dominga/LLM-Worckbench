//go:build windows

package main

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

// Process-group / teardown helpers, Windows variant. See proc_unix.go for
// the Unix variant and the rationale.

// setProcGroup puts the child in a new process group so console Ctrl events
// aimed at this process don't hit it, and so terminateTree/killTree can take
// down the whole tree by PID. Windows has no Pdeathsig equivalent — an
// orphaned llama-server is cleaned up by killTree on Stop().
func setProcGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// terminateTree asks the process tree to exit. Windows has no SIGTERM;
// `taskkill` without /F posts WM_CLOSE and is largely a no-op for console
// children like llama-server — the real teardown is killTree, called after
// the grace period.
func terminateTree(p *os.Process) {
	if p != nil {
		_ = exec.Command("taskkill", "/T", "/PID", strconv.Itoa(p.Pid)).Run()
	}
}

// killTree force-kills the child and all its descendants.
func killTree(p *os.Process) {
	if p != nil {
		_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(p.Pid)).Run()
	}
}
