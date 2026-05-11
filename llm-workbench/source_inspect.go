package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// SourceDirInfo describes what could be learned by looking at a candidate
// llama.cpp source directory: a git remote (if it's a checkout) and the
// cmake flags from a previous `cmake -B …` run (if one happened). Used by
// the build-recipe editor to pre-fill fields after the user picks a dir.
type SourceDirInfo struct {
	Path               string   `json:"path"`
	Exists             bool     `json:"exists"`
	IsGitRepo          bool     `json:"isGitRepo"`
	GitRemote          string   `json:"gitRemote"`          // "" when no remote / not a repo
	ConfiguredBuildDir string   `json:"configuredBuildDir"` // e.g. "build"; "" when no CMakeCache found
	CMakeFlags         []string `json:"cmakeFlags"`         // reconstructed -D… flags from CMakeCache
	Backend            string   `json:"backend"`            // derived hint (cuda12/rocm/vulkan/metal); "" if unclear
}

// InspectSourceDir looks at `dir` and reports what it found. Never errors —
// a missing/empty dir just yields Exists=false.
func InspectSourceDir(dir string) SourceDirInfo {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return SourceDirInfo{}
	}
	info := SourceDirInfo{Path: absPath(dir)}
	fi, err := os.Stat(info.Path)
	if err != nil || !fi.IsDir() {
		return info
	}
	info.Exists = true

	if gitDir := filepath.Join(info.Path, ".git"); pathExists(gitDir) {
		info.IsGitRepo = true
		info.GitRemote = readGitRemote(gitDir)
	}

	for _, bd := range candidateBuildDirs(info.Path) {
		cache := filepath.Join(info.Path, bd, "CMakeCache.txt")
		if pathExists(cache) {
			info.ConfiguredBuildDir = bd
			info.CMakeFlags = parseCMakeCache(cache)
			break
		}
	}
	info.Backend = backendFromFlags(info.CMakeFlags)
	return info
}

// candidateBuildDirs returns dir names to probe for a CMakeCache.txt:
// "build" first, then any first-level subdir whose name starts with "build".
func candidateBuildDirs(root string) []string {
	out := []string{"build"}
	seen := map[string]bool{"build": true}
	if entries, err := os.ReadDir(root); err == nil {
		for _, e := range entries {
			if e.IsDir() && strings.HasPrefix(strings.ToLower(e.Name()), "build") && !seen[e.Name()] {
				seen[e.Name()] = true
				out = append(out, e.Name())
			}
		}
	}
	return out
}

var gitRemoteSectionRe = regexp.MustCompile(`^\[remote\s+"([^"]+)"\]`)

// readGitRemote parses `<gitDir>/config` (following a `.git` *file* with a
// `gitdir:` pointer when present) for remote URLs. Prefers "origin", else
// the first remote with a URL. Returns "" if none.
func readGitRemote(gitDir string) string {
	cfgPath := filepath.Join(gitDir, "config")
	if fi, err := os.Stat(gitDir); err == nil && !fi.IsDir() {
		if data, err := os.ReadFile(gitDir); err == nil {
			line := strings.TrimSpace(string(data))
			if strings.HasPrefix(line, "gitdir:") {
				p := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
				if !filepath.IsAbs(p) {
					p = filepath.Join(filepath.Dir(gitDir), p)
				}
				cfgPath = filepath.Join(p, "config")
			}
		}
	}
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return ""
	}
	remotes := map[string]string{}
	var order []string
	cur := ""
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			cur = ""
			if m := gitRemoteSectionRe.FindStringSubmatch(line); m != nil {
				cur = m[1]
				if _, ok := remotes[cur]; !ok {
					remotes[cur] = ""
					order = append(order, cur)
				}
			}
			continue
		}
		if cur == "" {
			continue
		}
		if i := strings.Index(line, "="); i > 0 {
			k := strings.TrimSpace(line[:i])
			v := strings.TrimSpace(line[i+1:])
			if strings.EqualFold(k, "url") && remotes[cur] == "" {
				remotes[cur] = v
			}
		}
	}
	if u := remotes["origin"]; u != "" {
		return u
	}
	for _, name := range order {
		if u := remotes[name]; u != "" {
			return u
		}
	}
	return ""
}

// parseCMakeCache reconstructs the interesting `-D…` flags from a
// CMakeCache.txt: GGML_*/LLAMA_* BOOLs that are ON, GGML_*/LLAMA_* string
// values, CMAKE_BUILD_TYPE, and GPU-arch knobs. Best-effort — the editor
// shows the result for the user to trim. Skips INTERNAL/STATIC entries and
// `*-ADVANCED` markers.
func parseCMakeCache(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var flags []string
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "//") || strings.HasPrefix(line, "#") {
			continue
		}
		colon := strings.Index(line, ":")
		eq := strings.Index(line, "=")
		if colon <= 0 || eq <= colon {
			continue
		}
		key := line[:colon]
		typ := line[colon+1 : eq]
		val := line[eq+1:]
		if typ == "INTERNAL" || typ == "STATIC" || strings.HasSuffix(key, "-ADVANCED") {
			continue
		}
		ku := strings.ToUpper(key)
		interesting := strings.HasPrefix(ku, "GGML_") || strings.HasPrefix(ku, "LLAMA_") ||
			ku == "CMAKE_BUILD_TYPE" || ku == "AMDGPU_TARGETS" || ku == "CMAKE_CUDA_ARCHITECTURES"
		if !interesting || seen[key] {
			continue
		}
		if typ == "BOOL" {
			switch strings.ToUpper(strings.TrimSpace(val)) {
			case "ON", "TRUE", "1", "YES", "Y":
				seen[key] = true
				flags = append(flags, "-D"+key+"=ON")
			}
			continue
		}
		v := strings.TrimSpace(val)
		if v == "" {
			continue
		}
		seen[key] = true
		flags = append(flags, "-D"+key+"="+v)
	}
	sort.Strings(flags)
	return flags
}

// backendFromFlags derives a BuildBackend hint from reconstructed cmake flags.
func backendFromFlags(flags []string) string {
	on := func(name string) bool {
		for _, f := range flags {
			if strings.EqualFold(f, "-D"+name+"=ON") {
				return true
			}
		}
		return false
	}
	switch {
	case on("GGML_CUDA"), on("LLAMA_CUBLAS"):
		return "cuda12"
	case on("GGML_HIP"), on("GGML_HIPBLAS"), on("LLAMA_HIPBLAS"):
		return "rocm"
	case on("GGML_VULKAN"):
		return "vulkan"
	case on("GGML_METAL"):
		return "metal"
	}
	return ""
}
