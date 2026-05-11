package main

import "testing"

func TestParseNvidiaSmiNames(t *testing.T) {
	out := "NVIDIA GeForce RTX 4090, 24564\nNVIDIA GeForce RTX 3090, 24576\n"
	gpus := parseNvidiaSmiNames(out)
	if len(gpus) != 2 {
		t.Fatalf("got %d GPUs, want 2", len(gpus))
	}
	if gpus[0].Name != "NVIDIA GeForce RTX 4090" || gpus[0].VRAMMiB != 24564 {
		t.Errorf("gpu0 = %+v", gpus[0])
	}
	if gpus[0].Vendor != GPUVendorNVIDIA || gpus[0].Backend != BackendCUDA12 || gpus[0].Source != "nvidia-smi" {
		t.Errorf("gpu0 meta = %+v", gpus[0])
	}
	if gpus[1].VRAMMiB != 24576 {
		t.Errorf("gpu1 vram = %d", gpus[1].VRAMMiB)
	}
	// Empty / garbage tolerated.
	if g := parseNvidiaSmiNames(""); len(g) != 0 {
		t.Errorf("empty input -> %d GPUs", len(g))
	}
}

func TestParseRocminfo(t *testing.T) {
	out := `=====================
HSA System Attributes
=====================
Runtime Version:         1.1

==========
HSA Agents
==========
*******
Agent 1
*******
  Name:                    AMD Ryzen 9 7950X 16-Core Processor
  Marketing Name:          AMD Ryzen 9 7950X 16-Core Processor
  Vendor Name:             CPU
  Device Type:             CPU
  Pool Info:
    Pool 1
      Size:                    65536(0x10000) KB
*******
Agent 2
*******
  Name:                    gfx1100
  Marketing Name:          AMD Radeon RX 7900 XTX
  Vendor Name:             AMD
  Device Type:             GPU
  Pool Info:
    Pool 1
      Size:                    25149440(0x17fc000) KB
*** Done ***
`
	gpus := parseRocminfo(out)
	if len(gpus) != 1 {
		t.Fatalf("got %d GPUs, want 1 (CPU agent must be skipped)", len(gpus))
	}
	if gpus[0].Name != "AMD Radeon RX 7900 XTX" {
		t.Errorf("name = %q", gpus[0].Name)
	}
	if gpus[0].Vendor != GPUVendorAMD || gpus[0].Backend != BackendROCm || gpus[0].Source != "rocminfo" {
		t.Errorf("meta = %+v", gpus[0])
	}
	if len(parseRocminfo("garbage\nno agents here\n")) != 0 {
		t.Error("no-agent input produced GPUs")
	}
}

func TestParseVulkaninfoSummary(t *testing.T) {
	out := `==========
VULKANINFO
==========

Vulkan Instance Version: 1.3.296

Devices:
========
GPU0:
	apiVersion         = 1.3.289
	driverVersion      = 565.77.0.0
	vendorID           = 0x10de
	deviceID           = 0x2684
	deviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
	deviceName         = NVIDIA GeForce RTX 4090
	driverID           = DRIVER_ID_NVIDIA_PROPRIETARY
GPU1:
	apiVersion         = 1.3.289
	driverVersion      = 0.0.1
	vendorID           = 0x10005
	deviceID           = 0x0000
	deviceType         = PHYSICAL_DEVICE_TYPE_CPU
	deviceName         = llvmpipe (LLVM 18.1.8, 256 bits)
`
	gpus := parseVulkaninfoSummary(out)
	if len(gpus) != 1 {
		t.Fatalf("got %d GPUs, want 1 (llvmpipe CPU must be skipped)", len(gpus))
	}
	if gpus[0].Name != "NVIDIA GeForce RTX 4090" || gpus[0].Vendor != GPUVendorNVIDIA {
		t.Errorf("gpu = %+v", gpus[0])
	}
	if gpus[0].Backend != BackendVulkan || gpus[0].Source != "vulkaninfo" {
		t.Errorf("meta = %+v", gpus[0])
	}

	// AMD card whose vendorID is missing -> fall back to name inference.
	amd := `Devices:
========
GPU0:
	deviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
	deviceName         = AMD Radeon RX 7900 XTX (RADV NAVI31)
`
	g := parseVulkaninfoSummary(amd)
	if len(g) != 1 || g[0].Vendor != GPUVendorAMD {
		t.Errorf("amd fallback: %+v", g)
	}
}

func TestParseSystemProfilerDisplays(t *testing.T) {
	out := `Graphics/Displays:

    Apple M2 Max:

      Chipset Model: Apple M2 Max
      Type: GPU
      Bus: Built-In
      Total Number of Cores: 38
`
	gpus := parseSystemProfilerDisplays(out)
	if len(gpus) != 1 {
		t.Fatalf("got %d GPUs, want 1", len(gpus))
	}
	if gpus[0].Name != "Apple M2 Max" || gpus[0].Vendor != GPUVendorApple || gpus[0].Backend != BackendMetal {
		t.Errorf("gpu = %+v", gpus[0])
	}
}

func TestVendorInference(t *testing.T) {
	idCases := map[string]GPUVendor{
		"0x10de": GPUVendorNVIDIA, "10de": GPUVendorNVIDIA,
		"0x1002": GPUVendorAMD, "0x8086": GPUVendorIntel, "0x106b": GPUVendorApple,
		"0xdead": GPUVendorUnknown, "": GPUVendorUnknown,
	}
	for id, want := range idCases {
		if got := vendorFromPCIID(id); got != want {
			t.Errorf("vendorFromPCIID(%q) = %q, want %q", id, got, want)
		}
	}
	nameCases := map[string]GPUVendor{
		"NVIDIA GeForce RTX 4090":       GPUVendorNVIDIA,
		"AMD Radeon RX 7900 XTX":        GPUVendorAMD,
		"gfx1100":                       GPUVendorAMD,
		"Intel Arc A770":                GPUVendorIntel,
		"Apple M3 Pro":                  GPUVendorApple,
		"Some Mystery Accelerator 9000": GPUVendorUnknown,
	}
	for name, want := range nameCases {
		if got := inferVendorFromName(name); got != want {
			t.Errorf("inferVendorFromName(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestDedupGPUs(t *testing.T) {
	in := []DetectedGPU{
		{Vendor: GPUVendorNVIDIA, Name: "NVIDIA GeForce RTX 4090", Backend: BackendCUDA12, Source: "nvidia-smi"},
		{Vendor: GPUVendorNVIDIA, Name: "NVIDIA GeForce RTX 4090", Backend: BackendVulkan, Source: "vulkaninfo"},
		{Vendor: GPUVendorAMD, Name: "AMD Radeon RX 7900 XTX", Backend: BackendROCm, Source: "rocminfo"},
	}
	out := dedupGPUs(in)
	if len(out) != 2 {
		t.Fatalf("got %d, want 2", len(out))
	}
	if out[0].Backend != BackendCUDA12 {
		t.Errorf("dedup kept the wrong entry: %+v", out[0])
	}
}

func TestSuggestRecipes(t *testing.T) {
	// No GPU: just a CPU recipe.
	r := SuggestRecipes(GPUDetection{})
	if len(r) != 1 || r[0].Backend != BackendCPU {
		t.Fatalf("empty detection -> %+v", r)
	}

	// One NVIDIA card: CPU + CUDA.
	r = SuggestRecipes(GPUDetection{GPUs: []DetectedGPU{{Vendor: GPUVendorNVIDIA, Backend: BackendCUDA12}}, Available: true})
	if len(r) != 2 {
		t.Fatalf("nvidia -> %d recipes, want 2", len(r))
	}
	cuda := r[1]
	if cuda.Backend != BackendCUDA12 || len(cuda.CMakeFlags) == 0 || cuda.CMakeFlags[0] != "-DGGML_CUDA=ON" {
		t.Errorf("cuda recipe = %+v", cuda)
	}
	if cuda.SourceDir != "" {
		t.Error("suggested recipe should leave SourceDir empty")
	}

	// NVIDIA + AMD: CPU + CUDA + ROCm, in that order.
	r = SuggestRecipes(GPUDetection{GPUs: []DetectedGPU{
		{Vendor: GPUVendorNVIDIA, Backend: BackendCUDA12},
		{Vendor: GPUVendorAMD, Backend: BackendROCm},
	}, Available: true})
	if len(r) != 3 {
		t.Fatalf("nvidia+amd -> %d recipes, want 3", len(r))
	}
	if r[0].Backend != BackendCPU || r[1].Backend != BackendCUDA12 || r[2].Backend != BackendROCm {
		t.Errorf("order/backends = %v", []BuildBackend{r[0].Backend, r[1].Backend, r[2].Backend})
	}

	// Two NVIDIA cards: still one CUDA recipe (dedup by backend).
	r = SuggestRecipes(GPUDetection{GPUs: []DetectedGPU{
		{Vendor: GPUVendorNVIDIA, Backend: BackendCUDA12},
		{Vendor: GPUVendorNVIDIA, Backend: BackendCUDA12},
	}, Available: true})
	if len(r) != 2 {
		t.Errorf("two nvidia -> %d recipes, want 2", len(r))
	}
}
