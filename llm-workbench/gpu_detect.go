package main

import (
	"context"
	"encoding/csv"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// GPUVendor classifies a detected accelerator. Drives the default
// BuildBackend / cmake flags for a fresh BuildRecipe (PR29 "suggested
// recipes" feature).
type GPUVendor string

const (
	GPUVendorNVIDIA  GPUVendor = "nvidia"
	GPUVendorAMD     GPUVendor = "amd"
	GPUVendorIntel   GPUVendor = "intel"
	GPUVendorApple   GPUVendor = "apple"
	GPUVendorUnknown GPUVendor = ""
)

// DetectedGPU is one accelerator found during build-time hardware probing.
// Distinct from GPUInfo (gpu_metrics.go), which is live VRAM telemetry for
// the dashboard — this struct exists to seed a sensible BuildRecipe.
type DetectedGPU struct {
	Vendor  GPUVendor    `json:"vendor"`
	Name    string       `json:"name"`
	VRAMMiB uint64       `json:"vramMib"` // 0 = unknown
	Source  string       `json:"source"`  // probe tool: nvidia-smi | rocminfo | vulkaninfo | system_profiler
	Backend BuildBackend `json:"backend"` // suggested llama.cpp backend for this card
}

// GPUDetection is the result of DetectGPU(): zero or more accelerators plus
// the list of probe tools that actually ran.
type GPUDetection struct {
	GPUs      []DetectedGPU `json:"gpus"`
	Probed    []string      `json:"probed"`    // tools found on PATH and executed
	Available bool          `json:"available"` // true if at least one GPU was found
}

// gpuProbeTimeout caps each probe subprocess. `vulkaninfo` and `rocminfo`
// can be slow to enumerate on cold driver state.
const gpuProbeTimeout = 4 * time.Second

// DetectGPU runs every supported probe tool found on PATH and merges the
// results. Tools that are missing or error out are skipped. The probe
// order (nvidia-smi → rocminfo → vulkaninfo → system_profiler) is also the
// dedup priority: a card seen by a vendor-specific tool wins over the same
// card seen only by the generic Vulkan probe.
func DetectGPU() GPUDetection {
	probes := []struct {
		tool  string
		args  []string
		parse func(string) []DetectedGPU
	}{
		{"nvidia-smi", []string{"--query-gpu=name,memory.total", "--format=csv,noheader,nounits"}, parseNvidiaSmiNames},
		{"rocminfo", nil, parseRocminfo},
		{"vulkaninfo", []string{"--summary"}, parseVulkaninfoSummary},
		{"system_profiler", []string{"SPDisplaysDataType"}, parseSystemProfilerDisplays},
	}
	var det GPUDetection
	for _, p := range probes {
		bin, err := exec.LookPath(p.tool)
		if err != nil {
			continue
		}
		det.Probed = append(det.Probed, p.tool)
		ctx, cancel := context.WithTimeout(context.Background(), gpuProbeTimeout)
		out, err := exec.CommandContext(ctx, bin, p.args...).Output()
		cancel()
		if err != nil {
			continue
		}
		det.GPUs = append(det.GPUs, p.parse(string(out))...)
	}
	det.GPUs = dedupGPUs(det.GPUs)
	det.Available = len(det.GPUs) > 0
	return det
}

// dedupGPUs collapses entries with the same (Vendor, Name), keeping the
// first occurrence — which, given DetectGPU's probe order, is the one with
// the most specific backend.
func dedupGPUs(in []DetectedGPU) []DetectedGPU {
	seen := map[string]bool{}
	var out []DetectedGPU
	for _, g := range in {
		key := string(g.Vendor) + "\x00" + strings.ToLower(g.Name)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, g)
	}
	return out
}

// ─────────────────────────── probe parsers ──────────────────────────

// parseNvidiaSmiNames parses `nvidia-smi --query-gpu=name,memory.total
// --format=csv,noheader,nounits` — one card per line, "<name>, <MiB>".
func parseNvidiaSmiNames(out string) []DetectedGPU {
	r := csv.NewReader(strings.NewReader(out))
	r.TrimLeadingSpace = true
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return nil
	}
	var gpus []DetectedGPU
	for _, row := range rows {
		if len(row) == 0 {
			continue
		}
		name := strings.TrimSpace(row[0])
		if name == "" {
			continue
		}
		var vram uint64
		if len(row) > 1 {
			vram, _ = strconv.ParseUint(strings.TrimSpace(row[1]), 10, 64)
		}
		gpus = append(gpus, DetectedGPU{
			Vendor:  GPUVendorNVIDIA,
			Name:    name,
			VRAMMiB: vram,
			Source:  "nvidia-smi",
			Backend: BackendCUDA12,
		})
	}
	return gpus
}

var rocminfoAgentRe = regexp.MustCompile(`^Agent\s+\d+\s*$`)

// parseRocminfo walks `rocminfo` output, tracking per-agent key:value
// fields, and emits a DetectedGPU for every agent whose "Device Type" is
// "GPU" (the host CPU shows up as an agent too).
func parseRocminfo(out string) []DetectedGPU {
	var gpus []DetectedGPU
	var cur map[string]string
	flush := func() {
		if cur == nil {
			return
		}
		if strings.EqualFold(cur["Device Type"], "GPU") {
			name := cur["Marketing Name"]
			if name == "" {
				name = cur["Name"]
			}
			if name != "" {
				gpus = append(gpus, DetectedGPU{
					Vendor:  GPUVendorAMD,
					Name:    name,
					Source:  "rocminfo",
					Backend: BackendROCm,
				})
			}
		}
		cur = nil
	}
	for _, line := range strings.Split(out, "\n") {
		t := strings.TrimSpace(line)
		if rocminfoAgentRe.MatchString(t) {
			flush()
			cur = map[string]string{}
			continue
		}
		if cur == nil {
			continue
		}
		if i := strings.Index(t, ":"); i > 0 {
			k := strings.TrimSpace(t[:i])
			v := strings.TrimSpace(t[i+1:])
			// Keep the first non-empty value for a key (later nested
			// blocks like "Pool Info" reuse generic key names).
			if _, ok := cur[k]; !ok {
				cur[k] = v
			} else if cur[k] == "" && v != "" {
				cur[k] = v
			}
		}
	}
	flush()
	return gpus
}

var vulkaninfoGPUHdrRe = regexp.MustCompile(`^GPU\d+:\s*$`)

// parseVulkaninfoSummary parses `vulkaninfo --summary` — a "Devices:"
// section with one "GPUn:" block per physical device, each carrying
// `deviceName`, `deviceType`, `vendorID` lines. Software rasterizers
// (llvmpipe / lavapipe, deviceType CPU) are skipped.
func parseVulkaninfoSummary(out string) []DetectedGPU {
	var gpus []DetectedGPU
	var name, dtype, vendorID string
	flush := func() {
		if name == "" {
			return
		}
		lname := strings.ToLower(name)
		isCPU := strings.Contains(strings.ToUpper(dtype), "CPU") ||
			strings.Contains(lname, "llvmpipe") || strings.Contains(lname, "lavapipe")
		if !isCPU {
			v := vendorFromPCIID(vendorID)
			if v == GPUVendorUnknown {
				v = inferVendorFromName(name)
			}
			gpus = append(gpus, DetectedGPU{
				Vendor:  v,
				Name:    name,
				Source:  "vulkaninfo",
				Backend: BackendVulkan,
			})
		}
		name, dtype, vendorID = "", "", ""
	}
	for _, line := range strings.Split(out, "\n") {
		t := strings.TrimSpace(line)
		if vulkaninfoGPUHdrRe.MatchString(t) {
			flush()
			continue
		}
		if eq := strings.Index(t, "="); eq > 0 {
			k := strings.TrimSpace(t[:eq])
			v := strings.TrimSpace(t[eq+1:])
			switch k {
			case "deviceName":
				name = v
			case "deviceType":
				dtype = v
			case "vendorID":
				vendorID = v
			}
		}
	}
	flush()
	return gpus
}

// parseSystemProfilerDisplays parses `system_profiler SPDisplaysDataType`
// on macOS — each GPU has a "Chipset Model:" line. On macOS the llama.cpp
// backend is always Metal regardless of the GPU vendor.
func parseSystemProfilerDisplays(out string) []DetectedGPU {
	const pfx = "Chipset Model:"
	var gpus []DetectedGPU
	for _, line := range strings.Split(out, "\n") {
		t := strings.TrimSpace(line)
		if !strings.HasPrefix(t, pfx) {
			continue
		}
		name := strings.TrimSpace(strings.TrimPrefix(t, pfx))
		if name == "" {
			continue
		}
		v := inferVendorFromName(name)
		if v == GPUVendorUnknown {
			v = GPUVendorApple
		}
		gpus = append(gpus, DetectedGPU{
			Vendor:  v,
			Name:    name,
			Source:  "system_profiler",
			Backend: BackendMetal,
		})
	}
	return gpus
}

// vendorFromPCIID maps a PCI vendor id (as printed by vulkaninfo, e.g.
// "0x10de") to a GPUVendor. Unknown ids return GPUVendorUnknown.
func vendorFromPCIID(id string) GPUVendor {
	switch strings.ToLower(strings.TrimSpace(id)) {
	case "0x10de", "10de":
		return GPUVendorNVIDIA
	case "0x1002", "1002":
		return GPUVendorAMD
	case "0x8086", "8086":
		return GPUVendorIntel
	case "0x106b", "106b":
		return GPUVendorApple
	}
	return GPUVendorUnknown
}

// inferVendorFromName guesses a GPUVendor from a marketing name.
func inferVendorFromName(name string) GPUVendor {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "nvidia"), strings.Contains(n, "geforce"),
		strings.Contains(n, "quadro"), strings.Contains(n, "tesla"),
		strings.Contains(n, "rtx"), strings.Contains(n, "gtx"):
		return GPUVendorNVIDIA
	case strings.Contains(n, "amd"), strings.Contains(n, "radeon"),
		strings.Contains(n, "instinct"), strings.HasPrefix(n, "gfx"):
		return GPUVendorAMD
	case strings.Contains(n, "intel"), strings.Contains(n, "arc "),
		strings.Contains(n, "iris"), strings.Contains(n, "uhd graphics"):
		return GPUVendorIntel
	case strings.Contains(n, "apple"):
		return GPUVendorApple
	}
	return GPUVendorUnknown
}

// ─────────────────────────── suggested recipes ──────────────────────

// SuggestRecipes turns a GPUDetection into a set of starter BuildRecipe
// templates: always a "cpu" recipe, plus one per distinct GPU backend
// found. The templates have an empty SourceDir — the user fills in where
// the llama.cpp checkout is (or a repo to clone) before saving via
// CreateBuildRecipe. Returned recipes are NOT persisted.
func SuggestRecipes(det GPUDetection) []BuildRecipe {
	out := []BuildRecipe{recipeTemplate(BackendCPU)}
	seen := map[BuildBackend]bool{BackendCPU: true}
	for _, g := range det.GPUs {
		be := g.Backend
		if be == "" || be == BackendCPU || seen[be] {
			continue
		}
		seen[be] = true
		out = append(out, recipeTemplate(be))
	}
	return out
}

// recipeTemplate returns a starter recipe for the given backend with
// sensible default cmake flags. CreatedAt/UpdatedAt are left zero — set on
// save by BuildManager.CreateRecipe.
func recipeTemplate(be BuildBackend) BuildRecipe {
	switch be {
	case BackendCUDA12:
		return BuildRecipe{ID: "cuda-suggested", DisplayName: "CUDA (suggested)", Backend: BackendCUDA12,
			CMakeFlags: []string{"-DGGML_CUDA=ON", "-DGGML_CUDA_FA_ALL_QUANTS=ON"}}
	case BackendCUDA11:
		return BuildRecipe{ID: "cuda11-suggested", DisplayName: "CUDA 11 (suggested)", Backend: BackendCUDA11,
			CMakeFlags: []string{"-DGGML_CUDA=ON", "-DGGML_CUDA_FA_ALL_QUANTS=ON"}}
	case BackendROCm:
		return BuildRecipe{ID: "rocm-suggested", DisplayName: "ROCm/HIP (suggested)", Backend: BackendROCm,
			CMakeFlags: []string{"-DGGML_HIP=ON"}}
	case BackendVulkan:
		return BuildRecipe{ID: "vulkan-suggested", DisplayName: "Vulkan (suggested)", Backend: BackendVulkan,
			CMakeFlags: []string{"-DGGML_VULKAN=ON"}}
	case BackendMetal:
		return BuildRecipe{ID: "metal-suggested", DisplayName: "Metal (suggested)", Backend: BackendMetal}
	default:
		return BuildRecipe{ID: "cpu", DisplayName: "CPU", Backend: BackendCPU}
	}
}
