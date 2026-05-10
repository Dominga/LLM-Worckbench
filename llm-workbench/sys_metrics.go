package main

// SystemMetrics is a snapshot of host RAM utilisation. Per-platform
// implementations live in sys_metrics_{linux,windows,other}.go and only
// fill in the fields they can compute.
type SystemMetrics struct {
	// Available indicates whether the platform layer was able to read
	// real values. UI uses this to render a "—" placeholder gracefully.
	Available    bool   `json:"available"`
	TotalBytes   uint64 `json:"totalBytes"`
	UsedBytes    uint64 `json:"usedBytes"`
	FreeBytes    uint64 `json:"freeBytes"`
}

// ReadSystemMetrics returns the current host memory snapshot. It is
// intentionally called on demand (no caching) — the caller (App) will
// throttle invocations through its event ticker.
func ReadSystemMetrics() SystemMetrics {
	return readSystemMetricsImpl()
}
