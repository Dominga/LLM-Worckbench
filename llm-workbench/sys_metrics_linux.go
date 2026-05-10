//go:build linux

package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// readSystemMetricsImpl parses /proc/meminfo. The file is human-readable
// with `Key:   value kB` lines. We need MemTotal and MemAvailable
// (kernel-reported, accounts for reclaimable caches — a better "really
// free" estimate than MemFree).
func readSystemMetricsImpl() SystemMetrics {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return SystemMetrics{}
	}
	defer f.Close()

	var totalKb, availKb uint64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			totalKb = parseMeminfoKb(line)
		case strings.HasPrefix(line, "MemAvailable:"):
			availKb = parseMeminfoKb(line)
		}
		if totalKb != 0 && availKb != 0 {
			break
		}
	}
	if totalKb == 0 {
		return SystemMetrics{}
	}
	total := totalKb * 1024
	free := availKb * 1024
	used := total
	if free <= total {
		used = total - free
	}
	return SystemMetrics{
		Available:  true,
		TotalBytes: total,
		UsedBytes:  used,
		FreeBytes:  free,
	}
}

// parseMeminfoKb pulls the numeric kB column out of one /proc/meminfo
// line. Format is `Label:    1234567 kB`.
func parseMeminfoKb(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	n, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return 0
	}
	return n
}
