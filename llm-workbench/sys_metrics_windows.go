//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// kernel32!GlobalMemoryStatusEx is not exported as a typed wrapper in
// the vendored golang.org/x/sys/windows v0.30, so we resolve the proc
// once via LazyDLL and call it directly. The struct layout matches the
// Win32 definition exactly — Length must be filled with sizeof before
// the call.
//
// Docs: https://learn.microsoft.com/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex
var (
	kernel32                 = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
)

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func readSystemMetricsImpl() SystemMetrics {
	var s memoryStatusEx
	s.Length = uint32(unsafe.Sizeof(s))
	r1, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&s)))
	if r1 == 0 {
		return SystemMetrics{}
	}
	used := s.TotalPhys
	if s.AvailPhys <= s.TotalPhys {
		used = s.TotalPhys - s.AvailPhys
	}
	return SystemMetrics{
		Available:  true,
		TotalBytes: s.TotalPhys,
		UsedBytes:  used,
		FreeBytes:  s.AvailPhys,
	}
}
