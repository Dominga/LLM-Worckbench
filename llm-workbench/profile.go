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

// ProfileKind enumerates the role a llama-server instance plays. RAG (M2)
// will route requests to the right kind. Rerank is exposed but unused until
// M2.
type ProfileKind string

const (
	KindChat   ProfileKind = "chat"
	KindEmbed  ProfileKind = "embed"
	KindRerank ProfileKind = "rerank"
)

func (k ProfileKind) Valid() bool {
	switch k {
	case KindChat, KindEmbed, KindRerank:
		return true
	}
	return false
}

// Sampling holds default decoding parameters. Mirrors llama-server flags.
type Sampling struct {
	Temperature   float64 `toml:"temperature"`
	TopP          float64 `toml:"top_p"`
	MinP          float64 `toml:"min_p"`
	RepeatPenalty float64 `toml:"repeat_penalty"`
}

// DefaultSampling matches the values shown in the V5 mockup config tab.
func DefaultSampling() Sampling {
	return Sampling{Temperature: 0.7, TopP: 0.95, MinP: 0.05, RepeatPenalty: 1.1}
}

// Profile is a launchable llama-server configuration. DESIGN.md §4.4.
// Stored as a TOML element under [[profile]] in profiles.toml.
type Profile struct {
	ID   string      `toml:"id"`
	Kind ProfileKind `toml:"kind"`
	// BuildID, when set, points at a Build artifact (M5) — the supervisor
	// resolves the launch binary from BuildManager.GetBuild(BuildID).BinaryPath
	// instead of BinPath. Mutually exclusive with BinPath in the UI; if both
	// are present in a hand-edited TOML, BuildID wins.
	BuildID     string      `toml:"build_id,omitempty"`
	BinPath     string      `toml:"bin_path,omitempty"`
	BinCwd      string      `toml:"bin_cwd,omitempty"`
	ModelPath   string      `toml:"model_path"`
	// MMProjPath is an optional vision-projector model. When set, the
	// supervisor adds `--mmproj <path>` to argv so llama-server starts in
	// multimodal mode (image input on /v1/chat/completions).
	MMProjPath  string      `toml:"mmproj_path,omitempty"`
	// LaunchEmbedding pairs this chat profile with an embedding profile.
	// On Start, the registry also starts EmbedProfileID. Stop does NOT
	// cascade — a single embed profile may be shared across multiple
	// chat profiles, so users stop it explicitly.
	LaunchEmbedding bool    `toml:"launch_embedding,omitempty"`
	EmbedProfileID  string  `toml:"embed_profile_id,omitempty"`
	Host        string      `toml:"host"`
	Port        int         `toml:"port"`
	CtxSize     int         `toml:"ctx_size,omitempty"`
	NGL         int         `toml:"ngl,omitempty"`
	ExtraArgs   []string    `toml:"extra_args,omitempty"`
	Sampling    Sampling    `toml:"sampling"`
	Autostart   bool        `toml:"autostart,omitempty"`
	HealthTimeoutSec int    `toml:"health_timeout_sec,omitempty"`
	// ToolMode controls how the agent loop talks to this profile. Values:
	//   ""        — defaults to "native" (M3 PR17 path).
	//   "native"  — OpenAI-style tools[] / tool_choice / tool_calls.
	//   "react"   — text-prompted ReAct: tools listed in the system
	//               prompt, model emits `Action:` / `Args:` lines, the
	//               parser intercepts them from the stream (PR18).
	//   "none"    — never inject tools regardless of mode whitelist;
	//               useful for fine-tunes that ignore both protocols.
	ToolMode    string      `toml:"tool_mode,omitempty"`
	// Family + FamilyVersion are advisory descriptors (TD31). The
	// supervisor doesn't read them — they drive UI grouping (Servers
	// tab) and prompt-template family-suffix resolution (TD32). Free-
	// form strings; canonical values come from the family registry
	// (~/.config/llm-workbench/families/). Empty = unclassified.
	Family        string    `toml:"family,omitempty"`
	FamilyVersion string    `toml:"family_version,omitempty"`
	CreatedAt   time.Time   `toml:"created_at"`
	UpdatedAt   time.Time   `toml:"updated_at"`
}

func (p *Profile) BaseURL() string {
	return fmt.Sprintf("http://%s:%d", p.Host, p.Port)
}

// Validate checks invariants that must hold before persisting.
func (p *Profile) Validate() error {
	if strings.TrimSpace(p.ID) == "" {
		return errors.New("id is required")
	}
	if !p.Kind.Valid() {
		return fmt.Errorf("invalid kind %q (chat|embed|rerank)", p.Kind)
	}
	if strings.TrimSpace(p.BuildID) == "" && strings.TrimSpace(p.BinPath) == "" {
		return errors.New("either build_id or bin_path is required")
	}
	if strings.TrimSpace(p.ModelPath) == "" {
		return errors.New("model_path is required")
	}
	if p.Port < 1 || p.Port > 65535 {
		return fmt.Errorf("port %d out of range", p.Port)
	}
	return nil
}

// profilesFile is the TOML root document for profiles.toml.
type profilesFile struct {
	Version  int       `toml:"version"`
	Profiles []Profile `toml:"profile"`
}

// ProfileManager owns the in-memory profile registry and persists changes
// to disk. Safe for concurrent use.
type ProfileManager struct {
	mu       sync.RWMutex
	path     string
	profiles []Profile
}

// NewProfileManager loads the registry from `profiles.toml`. If the file
// does not exist, it returns an empty manager — callers should call
// SeedFromConfig once if a `.env`-derived legacy config is available, then
// Save to materialize the file.
func NewProfileManager() (*ProfileManager, error) {
	path, err := profilesPath()
	if err != nil {
		return nil, err
	}
	pm := &ProfileManager{path: path}
	if err := pm.load(); err != nil {
		return nil, err
	}
	return pm, nil
}

func (pm *ProfileManager) load() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	data, err := os.ReadFile(pm.path)
	if errors.Is(err, os.ErrNotExist) {
		pm.profiles = nil
		return nil
	}
	if err != nil {
		return fmt.Errorf("read %s: %w", pm.path, err)
	}
	var doc profilesFile
	if err := toml.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("parse %s: %w", pm.path, err)
	}
	pm.profiles = doc.Profiles
	return nil
}

func (pm *ProfileManager) save() error {
	doc := profilesFile{Version: 1, Profiles: append([]Profile(nil), pm.profiles...)}
	tmp := pm.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("create %s: %w", tmp, err)
	}
	enc := toml.NewEncoder(f)
	enc.Indent = "  "
	if err := enc.Encode(doc); err != nil {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("encode profiles: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, pm.path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// List returns all profiles sorted by ID.
func (pm *ProfileManager) List() []Profile {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	out := make([]Profile, len(pm.profiles))
	copy(out, pm.profiles)
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Get fetches a profile by ID.
func (pm *ProfileManager) Get(id string) (Profile, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	for _, p := range pm.profiles {
		if p.ID == id {
			return p, nil
		}
	}
	return Profile{}, fmt.Errorf("profile %q not found", id)
}

// Create inserts a new profile. Generates an ID if blank. Returns the
// stored copy (with timestamps).
func (pm *ProfileManager) Create(p Profile) (Profile, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	if p.Sampling == (Sampling{}) {
		p.Sampling = DefaultSampling()
	}
	if p.Host == "" {
		p.Host = "127.0.0.1"
	}
	if err := p.Validate(); err != nil {
		return Profile{}, err
	}
	for _, ex := range pm.profiles {
		if ex.ID == p.ID {
			return Profile{}, fmt.Errorf("profile id %q already exists", p.ID)
		}
	}
	now := time.Now().UTC()
	p.CreatedAt = now
	p.UpdatedAt = now
	pm.profiles = append(pm.profiles, p)
	if err := pm.save(); err != nil {
		// Rollback on save failure.
		pm.profiles = pm.profiles[:len(pm.profiles)-1]
		return Profile{}, err
	}
	return p, nil
}

// Update replaces an existing profile. ID and CreatedAt are preserved from
// the stored copy.
func (pm *ProfileManager) Update(id string, p Profile) (Profile, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	idx := -1
	for i, ex := range pm.profiles {
		if ex.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return Profile{}, fmt.Errorf("profile %q not found", id)
	}
	p.ID = id
	p.CreatedAt = pm.profiles[idx].CreatedAt
	p.UpdatedAt = time.Now().UTC()
	if p.Host == "" {
		p.Host = "127.0.0.1"
	}
	if p.Sampling == (Sampling{}) {
		p.Sampling = DefaultSampling()
	}
	if err := p.Validate(); err != nil {
		return Profile{}, err
	}
	prev := pm.profiles[idx]
	pm.profiles[idx] = p
	if err := pm.save(); err != nil {
		pm.profiles[idx] = prev
		return Profile{}, err
	}
	return p, nil
}

// Delete removes a profile by ID. No-op if missing.
func (pm *ProfileManager) Delete(id string) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	for i, p := range pm.profiles {
		if p.ID == id {
			pm.profiles = append(pm.profiles[:i], pm.profiles[i+1:]...)
			return pm.save()
		}
	}
	return nil
}

// SeedFromConfig creates a default `m0-default` chat profile from a legacy
// `.env`-derived Config when the registry is empty. No-op otherwise. The
// caller should run this once on first launch.
func (pm *ProfileManager) SeedFromConfig(cfg *Config) error {
	pm.mu.Lock()
	hasAny := len(pm.profiles) > 0
	pm.mu.Unlock()
	if hasAny {
		return nil
	}
	if cfg == nil || cfg.BinPath == "" || cfg.ModelPath == "" {
		return nil
	}
	p := Profile{
		ID:               "m0-default",
		Kind:             KindChat,
		BinPath:          cfg.BinPath,
		BinCwd:           cfg.BinCwd,
		ModelPath:        cfg.ModelPath,
		Host:             cfg.Host,
		Port:             cfg.Port,
		ExtraArgs:        cfg.ExtraArgs,
		Sampling:         DefaultSampling(),
		Autostart:        cfg.Autostart,
		HealthTimeoutSec: cfg.HealthTimeout,
	}
	if _, err := pm.Create(p); err != nil {
		return fmt.Errorf("seed m0-default: %w", err)
	}
	return nil
}
