package main

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/google/uuid"
)

// BuildBackend names the compute backend a llama.cpp build targets.
// DESIGN.md §4.1.
type BuildBackend string

const (
	BackendCPU    BuildBackend = "cpu"
	BackendCUDA11 BuildBackend = "cuda11"
	BackendCUDA12 BuildBackend = "cuda12"
	BackendROCm   BuildBackend = "rocm"
	BackendVulkan BuildBackend = "vulkan"
	BackendMetal  BuildBackend = "metal"
)

func (b BuildBackend) Valid() bool {
	switch b {
	case BackendCPU, BackendCUDA11, BackendCUDA12, BackendROCm, BackendVulkan, BackendMetal:
		return true
	}
	return false
}

// BuildRecipe is a declarative description of how to compile a llama.cpp
// fork into a `llama-server` binary. DESIGN.md §4.2, extended so the recipe
// also names where the source lives and (optionally) where to fetch it
// from — matching the Servers-tab "manage builds" flow: the user either
// points at an existing checkout, or supplies a folder + a git remote to
// clone into it. Stored as a `[[recipe]]` element in builds.toml.
type BuildRecipe struct {
	ID          string `toml:"id"`
	DisplayName string `toml:"display_name,omitempty"`
	// SourceDir is the local llama.cpp checkout. Required. If SourceRepo
	// is also set and the dir is empty or missing, the orchestrator (PR30)
	// clones into it; otherwise it fetches and checks out GitRef.
	SourceDir string `toml:"source_dir"`
	// SourceRepo is an optional git remote URL. Empty means "use SourceDir
	// as-is" — no clone/pull, build whatever is currently checked out.
	SourceRepo string `toml:"source_repo,omitempty"`
	// GitRef is a branch, tag, or commit to check out before building.
	// Empty leaves the working tree on its current ref.
	GitRef string `toml:"git_ref,omitempty"`
	// Backend is informational here (drives capability hints and the
	// suggested CMakeFlags); the actual backend is whatever the flags
	// enable. Empty is allowed for "unspecified / CPU".
	Backend BuildBackend `toml:"backend,omitempty"`
	// CMakeFlags are passed verbatim to `cmake -B <BuildDir> -S <SourceDir>`.
	// Backend-specific switches (e.g. -DGGML_CUDA=ON) live here;
	// SuggestRecipes (PR29) pre-fills them per detected GPU.
	CMakeFlags []string `toml:"cmake_flags,omitempty"`
	// BuildDir is the cmake build directory, relative to SourceDir.
	// Empty defaults to "build".
	BuildDir string `toml:"build_dir,omitempty"`
	// Jobs caps `cmake --build … -j N`. 0 lets the generator decide.
	Jobs      int       `toml:"jobs,omitempty"`
	CreatedAt time.Time `toml:"created_at"`
	UpdatedAt time.Time `toml:"updated_at"`
}

// Validate checks invariants that must hold before persisting a recipe.
func (r *BuildRecipe) Validate() error {
	if strings.TrimSpace(r.ID) == "" {
		return errors.New("id is required")
	}
	if strings.TrimSpace(r.SourceDir) == "" {
		return errors.New("source_dir is required")
	}
	if r.Backend != "" && !r.Backend.Valid() {
		return fmt.Errorf("invalid backend %q (cpu|cuda11|cuda12|rocm|vulkan|metal)", r.Backend)
	}
	if r.Jobs < 0 {
		return errors.New("jobs must be >= 0")
	}
	return nil
}

// BuildDirOrDefault returns BuildDir, or "build" when it is unset.
func (r *BuildRecipe) BuildDirOrDefault() string {
	if strings.TrimSpace(r.BuildDir) == "" {
		return "build"
	}
	return r.BuildDir
}

// Build is a compiled `llama-server` artifact produced from a BuildRecipe.
// DESIGN.md §4.1. Created by the BuildOrchestrator (PR30); profiles
// reference it by ID (PR31). Stored as a `[[build]]` element in builds.toml.
type Build struct {
	ID          string `toml:"id"`
	RecipeID    string `toml:"recipe_id"`
	DisplayName string `toml:"display_name,omitempty"`
	SourceRepo  string `toml:"source_repo,omitempty"`
	// Commit is the resolved SHA the source tree was on when this binary
	// was built. May be empty when the source dir isn't a git checkout.
	Commit  string       `toml:"commit,omitempty"`
	Backend BuildBackend `toml:"backend,omitempty"`
	// BinaryPath is the absolute path to the produced llama-server binary.
	BinaryPath string `toml:"binary_path"`
	// Capabilities lists the endpoints this binary supports (chat / embed
	// / rerank / mmproj). Informational — used by the profile picker.
	Capabilities []string  `toml:"capabilities,omitempty"`
	BuiltAt      time.Time `toml:"built_at"`
}

// Validate checks invariants that must hold before persisting a build.
func (b *Build) Validate() error {
	if strings.TrimSpace(b.ID) == "" {
		return errors.New("id is required")
	}
	if strings.TrimSpace(b.BinaryPath) == "" {
		return errors.New("binary_path is required")
	}
	return nil
}

// buildsFile is the TOML root document for builds.toml.
type buildsFile struct {
	Version int           `toml:"version"`
	Recipes []BuildRecipe `toml:"recipe"`
	Builds  []Build       `toml:"build"`
}

// BuildManager owns the in-memory recipe + build registries and persists
// changes to builds.toml. Safe for concurrent use. Mirrors ProfileManager.
type BuildManager struct {
	mu      sync.RWMutex
	path    string
	recipes []BuildRecipe
	builds  []Build
}

// NewBuildManager loads the registry from builds.toml. A missing file
// yields an empty manager.
func NewBuildManager() (*BuildManager, error) {
	path, err := buildsPath()
	if err != nil {
		return nil, err
	}
	bm := &BuildManager{path: path}
	if err := bm.load(); err != nil {
		return nil, err
	}
	return bm, nil
}

func (m *BuildManager) load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.path)
	if errors.Is(err, os.ErrNotExist) {
		m.recipes = nil
		m.builds = nil
		return nil
	}
	if err != nil {
		return fmt.Errorf("read %s: %w", m.path, err)
	}
	var doc buildsFile
	if err := toml.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("parse %s: %w", m.path, err)
	}
	m.recipes = doc.Recipes
	m.builds = doc.Builds
	return nil
}

// save writes the current state atomically (tmp + rename). Caller holds m.mu.
func (m *BuildManager) save() error {
	doc := buildsFile{
		Version: 1,
		Recipes: append([]BuildRecipe(nil), m.recipes...),
		Builds:  append([]Build(nil), m.builds...),
	}
	tmp := m.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("create %s: %w", tmp, err)
	}
	enc := toml.NewEncoder(f)
	enc.Indent = "  "
	if err := enc.Encode(doc); err != nil {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("encode builds: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, m.path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// ─────────────────────────── Recipes ────────────────────────────

// ListRecipes returns all recipes sorted by ID.
func (m *BuildManager) ListRecipes() []BuildRecipe {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]BuildRecipe, len(m.recipes))
	copy(out, m.recipes)
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// GetRecipe fetches a recipe by ID.
func (m *BuildManager) GetRecipe(id string) (BuildRecipe, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, r := range m.recipes {
		if r.ID == id {
			return r, nil
		}
	}
	return BuildRecipe{}, fmt.Errorf("recipe %q not found", id)
}

// CreateRecipe inserts a new recipe. Generates an ID if blank. Returns the
// stored copy (with timestamps).
func (m *BuildManager) CreateRecipe(r BuildRecipe) (BuildRecipe, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if strings.TrimSpace(r.ID) == "" {
		r.ID = uuid.NewString()
	}
	if err := r.Validate(); err != nil {
		return BuildRecipe{}, err
	}
	for _, ex := range m.recipes {
		if ex.ID == r.ID {
			return BuildRecipe{}, fmt.Errorf("recipe id %q already exists", r.ID)
		}
	}
	now := time.Now().UTC()
	r.CreatedAt = now
	r.UpdatedAt = now
	m.recipes = append(m.recipes, r)
	if err := m.save(); err != nil {
		m.recipes = m.recipes[:len(m.recipes)-1]
		return BuildRecipe{}, err
	}
	return r, nil
}

// UpdateRecipe replaces an existing recipe. ID and CreatedAt are preserved.
func (m *BuildManager) UpdateRecipe(id string, r BuildRecipe) (BuildRecipe, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := -1
	for i, ex := range m.recipes {
		if ex.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return BuildRecipe{}, fmt.Errorf("recipe %q not found", id)
	}
	r.ID = id
	r.CreatedAt = m.recipes[idx].CreatedAt
	r.UpdatedAt = time.Now().UTC()
	if err := r.Validate(); err != nil {
		return BuildRecipe{}, err
	}
	prev := m.recipes[idx]
	m.recipes[idx] = r
	if err := m.save(); err != nil {
		m.recipes[idx] = prev
		return BuildRecipe{}, err
	}
	return r, nil
}

// DeleteRecipe removes a recipe by ID. No-op if missing. Existing Build
// artifacts that were produced from it are left intact (the binary on disk
// is still usable); only the recipe definition goes away.
func (m *BuildManager) DeleteRecipe(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, r := range m.recipes {
		if r.ID == id {
			m.recipes = append(m.recipes[:i], m.recipes[i+1:]...)
			return m.save()
		}
	}
	return nil
}

// ─────────────────────────── Builds ─────────────────────────────

// ListBuilds returns all build artifacts sorted by ID.
func (m *BuildManager) ListBuilds() []Build {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Build, len(m.builds))
	copy(out, m.builds)
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// GetBuild fetches a build artifact by ID.
func (m *BuildManager) GetBuild(id string) (Build, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, b := range m.builds {
		if b.ID == id {
			return b, nil
		}
	}
	return Build{}, fmt.Errorf("build %q not found", id)
}

// AddBuild records a freshly produced build artifact. Generates an ID if
// blank. If a build with the same ID already exists (a rebuild from the
// same recipe), it is replaced in place. Used by the BuildOrchestrator
// (PR30).
func (m *BuildManager) AddBuild(b Build) (Build, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if strings.TrimSpace(b.ID) == "" {
		b.ID = uuid.NewString()
	}
	if b.BuiltAt.IsZero() {
		b.BuiltAt = time.Now().UTC()
	}
	if err := b.Validate(); err != nil {
		return Build{}, err
	}
	for i, ex := range m.builds {
		if ex.ID == b.ID {
			prev := m.builds[i]
			m.builds[i] = b
			if err := m.save(); err != nil {
				m.builds[i] = prev
				return Build{}, err
			}
			return b, nil
		}
	}
	m.builds = append(m.builds, b)
	if err := m.save(); err != nil {
		m.builds = m.builds[:len(m.builds)-1]
		return Build{}, err
	}
	return b, nil
}

// DeleteBuild removes a build artifact record by ID. No-op if missing.
// Does not touch the binary on disk — only the registry entry.
func (m *BuildManager) DeleteBuild(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, b := range m.builds {
		if b.ID == id {
			m.builds = append(m.builds[:i], m.builds[i+1:]...)
			return m.save()
		}
	}
	return nil
}
