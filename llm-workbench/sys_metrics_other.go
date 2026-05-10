//go:build !linux && !windows

package main

// Stub for platforms we don't yet support (notably darwin — Future per
// DESIGN.md §9.7). Returns Available=false so the UI degrades to a "—"
// placeholder instead of crashing.
func readSystemMetricsImpl() SystemMetrics {
	return SystemMetrics{}
}
