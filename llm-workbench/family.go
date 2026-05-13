package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

// FamilySource tags where a Family record was loaded from. Same idea
// as ModeSource but families have a shorter precedence chain: there
// is no per-project layer — families describe model behaviour, which
// is global to the user.
type FamilySource string

const (
	FamilySourceBuiltin FamilySource = "builtin"
	FamilySourceGlobal  FamilySource = "global"
)

// SamplingDefaults are the recommended starting points for a family.
// All fields are pointers so an absent field in the TOML stays absent
// (zero values would otherwise clobber sensible defaults at the
// llama-server side). The form is small on purpose — families are
// supposed to capture broad guidance, not pin every knob.
type SamplingDefaults struct {
	Temperature   *float64 `json:"temperature,omitempty" toml:"temperature"`
	TopP          *float64 `json:"topP,omitempty" toml:"top_p"`
	TopK          *int     `json:"topK,omitempty" toml:"top_k"`
	MinP          *float64 `json:"minP,omitempty" toml:"min_p"`
	RepeatPenalty *float64 `json:"repeatPenalty,omitempty" toml:"repeat_penalty"`
}

// Family is a coarse-grained descriptor for a model family (e.g.
// "qwen3", "gemma3"). Holds metadata that ChatService + ModeService +
// the UI use to negotiate sampling, prompt variants, and grouping in
// the Servers tab.
//
// Profiles reference a family by ID. Families are advisory — a missing
// or unknown family doesn't break anything; the agent loop just falls
// back to the model's own defaults.
type Family struct {
	ID                string           `json:"id" toml:"id"`
	Name              string           `json:"name" toml:"name"`
	Description       string           `json:"description,omitempty" toml:"description"`
	ChatTemplateHint  string           `json:"chatTemplateHint,omitempty" toml:"chat_template_hint"`
	ReasoningToken    string           `json:"reasoningToken,omitempty" toml:"reasoning_token"`
	SamplingDefaults  SamplingDefaults `json:"samplingDefaults" toml:"sampling_defaults"`
	Notes             string           `json:"notes,omitempty" toml:"notes"`
	Source            FamilySource     `json:"source" toml:"-"`
}

// familyIDRe constrains family IDs to a safe charset so loaded values
// also work as filename basenames.
var familyIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

func (f Family) validate() error {
	if !familyIDRe.MatchString(f.ID) {
		return fmt.Errorf("family %q: invalid id (lowercase alnum + . _ - only)", f.ID)
	}
	if strings.TrimSpace(f.Name) == "" {
		return fmt.Errorf("family %s: name is required", f.ID)
	}
	return nil
}

// ─────────────────────────── Loader ────────────────────────────────

// loadFamiliesDir reads `*.toml` from `dir`, parses each as a Family,
// and stamps them with the given source. Bad files emit a warning
// string rather than aborting the whole pass so one corrupt entry
// doesn't blank out the rest.
func loadFamiliesDir(dir string, source FamilySource) ([]Family, []string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}
	var fams []Family
	var warns []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".toml") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		data, rErr := os.ReadFile(path)
		if rErr != nil {
			warns = append(warns, fmt.Sprintf("read %s: %v", e.Name(), rErr))
			continue
		}
		var fam Family
		if uErr := toml.Unmarshal(data, &fam); uErr != nil {
			warns = append(warns, fmt.Sprintf("parse %s: %v", e.Name(), uErr))
			continue
		}
		if fam.ID == "" {
			fam.ID = strings.TrimSuffix(e.Name(), ".toml")
		}
		fam.Source = source
		if vErr := fam.validate(); vErr != nil {
			warns = append(warns, vErr.Error())
			continue
		}
		fams = append(fams, fam)
	}
	return fams, warns
}

// ───────────────────────── FamilyService ───────────────────────────

// FamilyService merges the bundled set (embedded via family_seed.go)
// with whatever lives in the user's global families dir. Global
// overrides bundled by ID. One instance per app.
//
// Unlike ModeService there is no per-project layer: families describe
// the model itself, which doesn't change between projects.
type FamilyService struct {
	// bundled is populated at construction time so callers without a
	// global dir (tests, missing config dir) still see something.
	bundled []Family
}

// NewFamilyService loads the bundled families from disk-on-startup
// seeding. The caller is responsible for having run
// seedGlobalFamiliesOnce() before NewFamilyService if it wants the
// global dir populated; otherwise we just read whatever's already
// there (possibly nothing — fall back to empty).
func NewFamilyService() *FamilyService {
	return &FamilyService{bundled: builtinFamiliesFromEmbedFS()}
}

// List returns the merged + sorted set of available families. Global
// entries shadow bundled entries with the same ID.
func (s *FamilyService) List() []Family {
	merged := map[string]Family{}
	for _, f := range s.bundled {
		merged[f.ID] = f
	}
	if globals, _ := loadFamiliesDir(globalFamiliesDir(), FamilySourceGlobal); globals != nil {
		for _, f := range globals {
			merged[f.ID] = f
		}
	}
	out := make([]Family, 0, len(merged))
	for _, f := range merged {
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Get fetches a family by ID. Second return is false when no such
// family is registered — callers should treat that as "unknown
// family; use model defaults" rather than an error.
func (s *FamilyService) Get(id string) (Family, bool) {
	for _, f := range s.List() {
		if f.ID == id {
			return f, true
		}
	}
	return Family{}, false
}

// builtinFamiliesFromEmbedFS reads the bundled families/*.toml files
// out of the embed.FS in family_seed.go. Errors are swallowed — a
// broken bundle is a build-time bug, but we'd rather have an empty
// list at runtime than crash the whole app.
func builtinFamiliesFromEmbedFS() []Family {
	out := []Family{}
	entries, err := bundledFamiliesFS.ReadDir("families")
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".toml") {
			continue
		}
		data, rErr := bundledFamiliesFS.ReadFile("families/" + e.Name())
		if rErr != nil {
			continue
		}
		var fam Family
		if uErr := toml.Unmarshal(data, &fam); uErr != nil {
			continue
		}
		if fam.ID == "" {
			fam.ID = strings.TrimSuffix(e.Name(), ".toml")
		}
		fam.Source = FamilySourceBuiltin
		if err := fam.validate(); err != nil {
			continue
		}
		out = append(out, fam)
	}
	return out
}

// errFamilyServiceUnwired is returned by app-level handlers when the
// FamilyService hasn't been constructed yet (during very early
// startup or in tests that don't bring up the full App).
var errFamilyServiceUnwired = errors.New("family service unavailable")
