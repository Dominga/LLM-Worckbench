package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
)

// ───────────────────────── Source registry ──────────────────────────

// RegistrySource is one subscribed source feeding the merged Browse
// view. `url` points at an `index.json` published by the source —
// typically a raw.githubusercontent.com URL of the curated repo, but
// any HTTPS endpoint serving the schema works.
type RegistrySource struct {
	ID          string    `json:"id" toml:"id"`
	Name        string    `json:"name" toml:"name"`
	URL         string    `json:"url" toml:"url"`
	AutoRefresh bool      `json:"autoRefresh" toml:"auto_refresh"`
	AddedAt     time.Time `json:"addedAt" toml:"added_at"`
}

type sourcesFileDoc struct {
	SchemaVersion int              `toml:"schema_version"`
	Source        []RegistrySource `toml:"source"`
}

// sourceIDRe constrains source IDs so the per-source cache dir name
// stays inside registryDir without escapes.
var sourceIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// ───────────────────────── Index schema ─────────────────────────────

// RegistryIndex is the on-the-wire JSON every source serves. Schema
// is intentionally small — the curated repo's CI is responsible for
// keeping it in sync with the actual `<artifact>/<id>/*` files in
// the source tree.
type RegistryIndex struct {
	SchemaVersion int                `json:"schema_version"`
	UpdatedAt     string             `json:"updated_at,omitempty"`
	Artifacts     []RegistryArtifact `json:"artifacts"`
}

// RegistryArtifact is one installable item. `Type` is "mode" or
// "family" today (TD33); future types slot in without a schema bump.
// `Files` lists every file the install pulls; `SHA256` is the
// concatenation hash for tamper detection.
type RegistryArtifact struct {
	Type           string              `json:"type"`
	ID             string              `json:"id"`
	Version        string              `json:"version"`
	SHA256         string              `json:"sha256,omitempty"`
	Files          []RegistryFile      `json:"files"`
	Description    string              `json:"description,omitempty"`
	Tags           []string            `json:"tags,omitempty"`
	RecommendedFor []string            `json:"recommended_for,omitempty"`
	Author         string              `json:"author,omitempty"`
	Preview        string              `json:"preview,omitempty"`
	// Source / SourceName get stamped at browse time so the UI can
	// show "from <source>" without joining maps. Not part of the
	// wire schema — purely a convenience for downstream callers.
	Source     string `json:"source,omitempty"`
	SourceName string `json:"sourceName,omitempty"`
}

// RegistryFile is one file in an artifact bundle. `Path` is the
// destination basename (modes use `<id>.toml` / `<id>.system.md`,
// families use `<id>.toml`); `URL` is where to fetch it.
type RegistryFile struct {
	Path string `json:"path"`
	URL  string `json:"url"`
}

// ───────────────────────── Installed tracking ──────────────────────

// InstalledArtifact records one materialised install so Uninstall
// can clean up the right files and the Browse view can flag
// "update available" + "installed".
type InstalledArtifact struct {
	Type        string    `json:"type" toml:"type"`
	ID          string    `json:"id" toml:"id"`
	Version     string    `json:"version" toml:"version"`
	SourceID    string    `json:"sourceId" toml:"source_id"`
	Files       []string  `json:"files" toml:"files"` // absolute paths on disk
	SHA256      string    `json:"sha256,omitempty" toml:"sha256,omitempty"`
	InstalledAt time.Time `json:"installedAt" toml:"installed_at"`
}

type installedFileDoc struct {
	SchemaVersion int                 `toml:"schema_version"`
	Item          []InstalledArtifact `toml:"item"`
}

// ───────────────────────── Service ──────────────────────────────────

// BrowseFilter narrows the merged Browse view by artifact type,
// free-text query, or tag membership. Empty fields disable that
// filter axis.
type BrowseFilter struct {
	Type  string   `json:"type,omitempty"`
	Query string   `json:"query,omitempty"`
	Tags  []string `json:"tags,omitempty"`
}

// RegistryService owns the subscribed-sources list, the cached index
// for each, and the installed.toml ledger. HTTP client is overridable
// for tests (the test server speaks plain HTTP, the production
// default tolerates either).
type RegistryService struct {
	httpClient *http.Client

	// mu guards both files. Sources + installed records are tiny so we
	// reload from disk on every call rather than cache in memory —
	// keeps the on-disk file the source of truth even if a second
	// process (CLI / cron) edits it.
	mu sync.Mutex
}

func NewRegistryService() *RegistryService {
	return &RegistryService{
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// SetHTTPClient swaps the underlying http.Client. Tests use this to
// route requests at a httptest.Server.
func (s *RegistryService) SetHTTPClient(c *http.Client) {
	s.httpClient = c
}

// ──────────── Sources ────────────

// ListSources returns the persisted subscribed sources, sorted by
// AddedAt ascending so the order matches the file. Missing file =>
// empty list, no error (no sources configured yet).
func (s *RegistryService) ListSources() ([]RegistrySource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadSourcesLocked()
}

// AddSource registers a new source. ID is derived from `name` when
// empty (slug-style); we refuse duplicates by ID or URL so the UI
// can't accidentally double-add. The freshly added source is NOT
// auto-refreshed here — the caller does that explicitly.
func (s *RegistryService) AddSource(name, sourceURL string) (RegistrySource, error) {
	if strings.TrimSpace(name) == "" {
		return RegistrySource{}, errors.New("source name is required")
	}
	if _, err := url.ParseRequestURI(sourceURL); err != nil {
		return RegistrySource{}, fmt.Errorf("invalid url: %w", err)
	}
	id := slugify(name)
	if !sourceIDRe.MatchString(id) {
		return RegistrySource{}, fmt.Errorf("could not derive a safe id from name %q", name)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.loadSourcesLocked()
	if err != nil {
		return RegistrySource{}, err
	}
	for _, e := range existing {
		if e.ID == id {
			return RegistrySource{}, fmt.Errorf("source id %q already exists", id)
		}
		if e.URL == sourceURL {
			return RegistrySource{}, fmt.Errorf("source url already registered as %q", e.ID)
		}
	}
	src := RegistrySource{
		ID:          id,
		Name:        name,
		URL:         sourceURL,
		AutoRefresh: true,
		AddedAt:     time.Now().UTC(),
	}
	existing = append(existing, src)
	if err := s.saveSourcesLocked(existing); err != nil {
		return RegistrySource{}, err
	}
	return src, nil
}

// RemoveSource drops the source from sources.toml and clears its
// per-source cache. Installed artifacts that came from the source
// keep working — their files live in the modes / families dirs and
// installed.toml records the SourceID for attribution only.
func (s *RegistryService) RemoveSource(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.loadSourcesLocked()
	if err != nil {
		return err
	}
	out := make([]RegistrySource, 0, len(existing))
	found := false
	for _, e := range existing {
		if e.ID == id {
			found = true
			continue
		}
		out = append(out, e)
	}
	if !found {
		return fmt.Errorf("source %q not found", id)
	}
	if err := s.saveSourcesLocked(out); err != nil {
		return err
	}
	if cache := registryCacheDir(id); cache != "" {
		_ = os.RemoveAll(cache)
	}
	return nil
}

func (s *RegistryService) loadSourcesLocked() ([]RegistrySource, error) {
	path := registrySourcesPath()
	if path == "" {
		return nil, errors.New("registry path unresolved")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var doc sourcesFileDoc
	if err := toml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse sources.toml: %w", err)
	}
	sort.Slice(doc.Source, func(i, j int) bool {
		return doc.Source[i].AddedAt.Before(doc.Source[j].AddedAt)
	})
	return doc.Source, nil
}

func (s *RegistryService) saveSourcesLocked(srcs []RegistrySource) error {
	path := registrySourcesPath()
	if path == "" {
		return errors.New("registry path unresolved")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	doc := sourcesFileDoc{SchemaVersion: 1, Source: srcs}
	var buf bytes.Buffer
	enc := toml.NewEncoder(&buf)
	enc.Indent = "  "
	if err := enc.Encode(doc); err != nil {
		return err
	}
	return atomicWriteFile(path, buf.Bytes(), 0o644)
}

// ──────────── Refresh / cache ────────────

// Refresh fetches `sourceID`'s index.json, persists it to the
// per-source cache dir, and returns the parsed payload. Empty
// sourceID is rejected — use RefreshAll for the multi-source pass.
func (s *RegistryService) Refresh(sourceID string) (RegistryIndex, error) {
	srcs, err := s.ListSources()
	if err != nil {
		return RegistryIndex{}, err
	}
	for _, src := range srcs {
		if src.ID != sourceID {
			continue
		}
		return s.fetchAndCache(src)
	}
	return RegistryIndex{}, fmt.Errorf("source %q not found", sourceID)
}

// RefreshAll iterates every configured source and refreshes each.
// Returns a per-source error map so the caller can surface partial
// failures without aborting the whole batch.
func (s *RegistryService) RefreshAll() (map[string]error, error) {
	srcs, err := s.ListSources()
	if err != nil {
		return nil, err
	}
	out := make(map[string]error, len(srcs))
	for _, src := range srcs {
		_, err := s.fetchAndCache(src)
		out[src.ID] = err
	}
	return out, nil
}

func (s *RegistryService) fetchAndCache(src RegistrySource) (RegistryIndex, error) {
	body, err := s.httpGET(src.URL)
	if err != nil {
		return RegistryIndex{}, fmt.Errorf("fetch index: %w", err)
	}
	var idx RegistryIndex
	if err := json.Unmarshal(body, &idx); err != nil {
		return RegistryIndex{}, fmt.Errorf("parse index json: %w", err)
	}
	cacheDir := registryCacheDir(src.ID)
	if cacheDir != "" {
		_ = os.MkdirAll(cacheDir, 0o755)
		_ = os.WriteFile(filepath.Join(cacheDir, "index.json"), body, 0o644)
	}
	return idx, nil
}

// loadCachedIndex reads the last successful Refresh result for a
// source. Missing cache returns an empty index (no error) so Browse
// can degrade to "no listings yet" rather than fail.
func (s *RegistryService) loadCachedIndex(sourceID string) RegistryIndex {
	cache := registryCacheDir(sourceID)
	if cache == "" {
		return RegistryIndex{}
	}
	data, err := os.ReadFile(filepath.Join(cache, "index.json"))
	if err != nil {
		return RegistryIndex{}
	}
	var idx RegistryIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return RegistryIndex{}
	}
	return idx
}

// ──────────── Browse ────────────

// Browse returns the merged + filtered artifact view across every
// cached source. Browse never hits the network — it reads only the
// last-cached index for each source, so callers needing fresh data
// must Refresh first. Artifacts get stamped with `Source` /
// `SourceName` so the UI can render attribution without an extra
// lookup.
func (s *RegistryService) Browse(filter BrowseFilter) ([]RegistryArtifact, error) {
	srcs, err := s.ListSources()
	if err != nil {
		return nil, err
	}
	var out []RegistryArtifact
	q := strings.ToLower(strings.TrimSpace(filter.Query))
	wantTags := make(map[string]struct{}, len(filter.Tags))
	for _, t := range filter.Tags {
		wantTags[t] = struct{}{}
	}
	for _, src := range srcs {
		idx := s.loadCachedIndex(src.ID)
		for _, a := range idx.Artifacts {
			if filter.Type != "" && a.Type != filter.Type {
				continue
			}
			if q != "" &&
				!strings.Contains(strings.ToLower(a.ID), q) &&
				!strings.Contains(strings.ToLower(a.Description), q) {
				continue
			}
			if len(wantTags) > 0 {
				match := false
				for _, t := range a.Tags {
					if _, ok := wantTags[t]; ok {
						match = true
						break
					}
				}
				if !match {
					continue
				}
			}
			a.Source = src.ID
			a.SourceName = src.Name
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type < out[j].Type
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// ──────────── Install / uninstall ────────────

// Install fetches the artifact's files, verifies the optional
// sha256, writes them under the destination dir for their type, and
// records the install in installed.toml. The dest dir for
// `type=mode` is the global modes dir; for `type=family` the
// global families dir. Unknown types error.
//
// Re-installing a different version is allowed — Uninstall runs
// first to clear the old files, then the new bundle lands.
func (s *RegistryService) Install(sourceID, artifactID, version string) (InstalledArtifact, error) {
	srcs, err := s.ListSources()
	if err != nil {
		return InstalledArtifact{}, err
	}
	var src RegistrySource
	found := false
	for _, e := range srcs {
		if e.ID == sourceID {
			src = e
			found = true
			break
		}
	}
	if !found {
		return InstalledArtifact{}, fmt.Errorf("source %q not found", sourceID)
	}

	idx := s.loadCachedIndex(sourceID)
	if len(idx.Artifacts) == 0 {
		return InstalledArtifact{}, fmt.Errorf("source %q has no cached index — refresh first", sourceID)
	}
	var art RegistryArtifact
	matched := false
	for _, a := range idx.Artifacts {
		if a.ID != artifactID {
			continue
		}
		if version != "" && a.Version != version {
			continue
		}
		art = a
		matched = true
		break
	}
	if !matched {
		return InstalledArtifact{}, fmt.Errorf("artifact %q (version %q) not found in source %q", artifactID, version, sourceID)
	}

	destDir, err := destDirForType(art.Type)
	if err != nil {
		return InstalledArtifact{}, err
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return InstalledArtifact{}, err
	}

	// Download into memory first, verify aggregate sha256 if declared,
	// then write to disk. Keeps a corrupted half-install from leaving
	// junk under modes/ that the resolver might pick up.
	bodies := make([][]byte, 0, len(art.Files))
	hasher := sha256.New()
	for _, f := range art.Files {
		if filepath.Base(f.Path) != f.Path {
			return InstalledArtifact{}, fmt.Errorf("artifact %q file %q must be a basename, not a path", art.ID, f.Path)
		}
		body, err := s.httpGET(f.URL)
		if err != nil {
			return InstalledArtifact{}, fmt.Errorf("fetch %s: %w", f.Path, err)
		}
		hasher.Write(body)
		bodies = append(bodies, body)
	}
	if art.SHA256 != "" {
		got := hex.EncodeToString(hasher.Sum(nil))
		if !strings.EqualFold(got, art.SHA256) {
			return InstalledArtifact{}, fmt.Errorf("artifact %q sha256 mismatch (got %s, want %s)", art.ID, got, art.SHA256)
		}
	}

	// Remove any previous install of the same {type, id} before
	// writing the new bundle so version bumps are clean.
	if err := s.uninstallLocked(art.Type, art.ID); err != nil {
		// Not fatal — uninstall is best-effort housekeeping for
		// re-installs. A missing prior entry is the common case.
		_ = err
	}

	written := make([]string, 0, len(art.Files))
	for i, f := range art.Files {
		dst := filepath.Join(destDir, f.Path)
		if err := atomicWriteFile(dst, bodies[i], 0o644); err != nil {
			// Roll back any files we already wrote so a half-install
			// doesn't poison the dest dir.
			for _, p := range written {
				_ = os.Remove(p)
			}
			return InstalledArtifact{}, fmt.Errorf("write %s: %w", dst, err)
		}
		written = append(written, dst)
	}

	rec := InstalledArtifact{
		Type:        art.Type,
		ID:          art.ID,
		Version:     art.Version,
		SourceID:    src.ID,
		Files:       written,
		SHA256:      art.SHA256,
		InstalledAt: time.Now().UTC(),
	}
	if err := s.recordInstall(rec); err != nil {
		return InstalledArtifact{}, err
	}
	return rec, nil
}

// Uninstall removes the {type, id} entry from installed.toml and
// deletes the recorded files. Missing entry is not an error — the
// operation is idempotent so the UI's uninstall button can run
// without precondition checks.
func (s *RegistryService) Uninstall(typ, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.uninstallLocked(typ, id)
}

func (s *RegistryService) uninstallLocked(typ, id string) error {
	items, err := s.loadInstalledLocked()
	if err != nil {
		return err
	}
	out := make([]InstalledArtifact, 0, len(items))
	var gone *InstalledArtifact
	for i := range items {
		if items[i].Type == typ && items[i].ID == id {
			cp := items[i]
			gone = &cp
			continue
		}
		out = append(out, items[i])
	}
	if gone == nil {
		return nil
	}
	for _, p := range gone.Files {
		_ = os.Remove(p)
	}
	return s.saveInstalledLocked(out)
}

// ListInstalled returns the persisted install ledger.
func (s *RegistryService) ListInstalled() ([]InstalledArtifact, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadInstalledLocked()
}

func (s *RegistryService) recordInstall(rec InstalledArtifact) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.loadInstalledLocked()
	if err != nil {
		return err
	}
	items = append(items, rec)
	return s.saveInstalledLocked(items)
}

func (s *RegistryService) loadInstalledLocked() ([]InstalledArtifact, error) {
	path := registryInstalledPath()
	if path == "" {
		return nil, errors.New("registry path unresolved")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var doc installedFileDoc
	if err := toml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse installed.toml: %w", err)
	}
	return doc.Item, nil
}

func (s *RegistryService) saveInstalledLocked(items []InstalledArtifact) error {
	path := registryInstalledPath()
	if path == "" {
		return errors.New("registry path unresolved")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	doc := installedFileDoc{SchemaVersion: 1, Item: items}
	var buf bytes.Buffer
	enc := toml.NewEncoder(&buf)
	enc.Indent = "  "
	if err := enc.Encode(doc); err != nil {
		return err
	}
	return atomicWriteFile(path, buf.Bytes(), 0o644)
}

// ──────────── Helpers ────────────

// destDirForType maps an artifact type to its install destination.
// Centralised so adding a new type (e.g. "script", "tool") is one
// switch arm + a paths helper.
func destDirForType(typ string) (string, error) {
	switch typ {
	case "mode":
		d := globalModesDir()
		if d == "" {
			return "", errors.New("modes dir unresolved")
		}
		return d, nil
	case "family":
		d := globalFamiliesDir()
		if d == "" {
			return "", errors.New("families dir unresolved")
		}
		return d, nil
	default:
		return "", fmt.Errorf("unknown artifact type %q", typ)
	}
}

func (s *RegistryService) httpGET(u string) ([]byte, error) {
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return io.ReadAll(resp.Body)
}

// slugify converts a human source name into a lowercase, hyphen-
// separated id-safe slug. Anything outside `[a-z0-9_-]` collapses
// to a single `-`; leading/trailing dashes get trimmed.
var slugifyNonSafe = regexp.MustCompile(`[^a-z0-9_-]+`)

func slugify(s string) string {
	low := strings.ToLower(strings.TrimSpace(s))
	low = slugifyNonSafe.ReplaceAllString(low, "-")
	low = strings.Trim(low, "-")
	if low == "" {
		return ""
	}
	return low
}
