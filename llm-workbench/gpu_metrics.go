package main

import (
	"context"
	"encoding/csv"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// GPUInfo is per-card VRAM utilisation. Multi-GPU is reported as a slice.
// nvidia-smi exposes more fields (utilisation, temp, power) but we keep
// the v1 surface narrow — VRAM is what the UI actually displays.
type GPUInfo struct {
	Index       int    `json:"index"`
	Name        string `json:"name"`
	UsedMB      uint64 `json:"usedMb"`
	TotalMB     uint64 `json:"totalMb"`
	Vendor      string `json:"vendor"` // "nvidia" | "" (unknown)
}

// GPUMetrics is the cached snapshot. `Available` is false when no
// supported tooling was found (no nvidia-smi, AMD-only system, etc.).
type GPUMetrics struct {
	Available bool      `json:"available"`
	GPUs      []GPUInfo `json:"gpus"`
	UsedMB    uint64    `json:"usedMb"`  // sum across all cards
	TotalMB   uint64    `json:"totalMb"` // sum across all cards
}

// gpuCache throttles nvidia-smi exec calls to once per cacheTTL. The
// process spawn isn't free (~50–100 ms cold) and the Servers tab pings
// metrics at 2 s, so we cache to that cadence.
var (
	gpuMu      sync.Mutex
	gpuLast    GPUMetrics
	gpuLastAt  time.Time
	gpuCacheTTL = 2 * time.Second

	// nvidiaSmiPath is resolved on first use and cached. An empty value
	// after probe means "not installed" — we stop probing thereafter.
	nvidiaProbedOnce sync.Once
	nvidiaSmiPath    string
)

// ReadGPUMetrics returns a cached snapshot, refreshing if the cache is
// older than gpuCacheTTL.
func ReadGPUMetrics() GPUMetrics {
	gpuMu.Lock()
	if time.Since(gpuLastAt) < gpuCacheTTL {
		out := gpuLast
		gpuMu.Unlock()
		return out
	}
	gpuMu.Unlock()

	fresh := computeGPUMetrics()

	gpuMu.Lock()
	gpuLast = fresh
	gpuLastAt = time.Now()
	gpuMu.Unlock()
	return fresh
}

func computeGPUMetrics() GPUMetrics {
	nvidiaProbedOnce.Do(func() {
		// `nvidia-smi.exe` resolves the same way on Windows when the
		// driver places it in System32 (default since R470).
		if p, err := exec.LookPath("nvidia-smi"); err == nil {
			nvidiaSmiPath = p
		}
	})
	if nvidiaSmiPath == "" {
		return GPUMetrics{}
	}
	gpus, err := queryNvidia(nvidiaSmiPath)
	if err != nil {
		return GPUMetrics{}
	}
	var totalUsed, totalCap uint64
	for _, g := range gpus {
		totalUsed += g.UsedMB
		totalCap += g.TotalMB
	}
	return GPUMetrics{
		Available: len(gpus) > 0,
		GPUs:      gpus,
		UsedMB:    totalUsed,
		TotalMB:   totalCap,
	}
}

// queryNvidia runs nvidia-smi with a CSV query and parses the result.
// Format: `index, name, memory.used [MiB], memory.total [MiB]` — units
// are stripped via --format=csv,noheader,nounits.
func queryNvidia(bin string) ([]GPUInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin,
		"--query-gpu=index,name,memory.used,memory.total",
		"--format=csv,noheader,nounits",
	)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	r := csv.NewReader(strings.NewReader(string(out)))
	r.TrimLeadingSpace = true
	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	gpus := make([]GPUInfo, 0, len(rows))
	for _, row := range rows {
		if len(row) < 4 {
			continue
		}
		idx, _ := strconv.Atoi(strings.TrimSpace(row[0]))
		used, _ := strconv.ParseUint(strings.TrimSpace(row[2]), 10, 64)
		total, _ := strconv.ParseUint(strings.TrimSpace(row[3]), 10, 64)
		gpus = append(gpus, GPUInfo{
			Index:   idx,
			Name:    strings.TrimSpace(row[1]),
			UsedMB:  used,
			TotalMB: total,
			Vendor:  "nvidia",
		})
	}
	return gpus, nil
}
