package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newMockRegistryServer stands up an httptest.Server serving an
// index.json plus the artifact files referenced from it. Returns the
// server (caller closes), the index URL, and the expected sha256 for
// the worldbuilder mode (so install tests can assert tamper checks).
func newMockRegistryServer(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()

	modeTOML := `id = "worldbuilder"
name = "Worldbuilder"
desc = "narrative helper"
tool_whitelist = []
approval = "auto"
context = "none"
`
	modeMD := "You are a worldbuilder for {{project.name}}."
	famTOML := `id = "myfam"
name = "My Family"
`

	hash := func(parts ...string) string {
		h := sha256.New()
		for _, p := range parts {
			h.Write([]byte(p))
		}
		return hex.EncodeToString(h.Sum(nil))
	}
	modeSHA := hash(modeTOML, modeMD)

	mux := http.NewServeMux()
	mux.HandleFunc("/files/worldbuilder.toml", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(modeTOML))
	})
	mux.HandleFunc("/files/worldbuilder.system.md", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(modeMD))
	})
	mux.HandleFunc("/files/myfam.toml", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(famTOML))
	})

	srv := httptest.NewServer(mux)

	idx := RegistryIndex{
		SchemaVersion: 1,
		Artifacts: []RegistryArtifact{
			{
				Type: "mode", ID: "worldbuilder", Version: "1.0.0",
				SHA256:      modeSHA,
				Description: "narrative helper",
				Tags:        []string{"narrative", "rpg"},
				Files: []RegistryFile{
					{Path: "worldbuilder.toml", URL: srv.URL + "/files/worldbuilder.toml"},
					{Path: "worldbuilder.system.md", URL: srv.URL + "/files/worldbuilder.system.md"},
				},
			},
			{
				Type: "family", ID: "myfam", Version: "0.1.0",
				Description: "test family",
				Tags:        []string{"experimental"},
				Files: []RegistryFile{
					{Path: "myfam.toml", URL: srv.URL + "/files/myfam.toml"},
				},
			},
		},
	}
	mux.HandleFunc("/index.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(idx)
	})

	return srv, srv.URL + "/index.json", modeSHA
}

// TestRegistryEndToEnd exercises the full lifecycle: add source →
// refresh → browse → install (mode + family) → on-disk files land
// under modes/ and families/ → installed.toml records the entries
// → uninstall removes both files and the entry. XDG_CONFIG_HOME is
// redirected so the test never touches the real config dir.
func TestRegistryEndToEnd(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)

	srv, indexURL, modeSHA := newMockRegistryServer(t)
	defer srv.Close()
	_ = modeSHA

	rs := NewRegistryService()

	src, err := rs.AddSource("Test Source", indexURL)
	if err != nil {
		t.Fatalf("AddSource: %v", err)
	}
	if src.ID != "test-source" {
		t.Errorf("slug = %q, want test-source", src.ID)
	}
	if src.URL != indexURL {
		t.Errorf("url not stored")
	}

	if _, err := rs.AddSource("Test Source", indexURL); err == nil {
		t.Error("expected duplicate source error")
	}

	idx, err := rs.Refresh(src.ID)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if len(idx.Artifacts) != 2 {
		t.Errorf("artifacts = %d, want 2", len(idx.Artifacts))
	}

	// Cached on disk?
	cachePath := filepath.Join(registryCacheDir(src.ID), "index.json")
	if _, err := os.Stat(cachePath); err != nil {
		t.Errorf("cache not written: %v", err)
	}

	// Browse with filter.
	hits, err := rs.Browse(BrowseFilter{Type: "mode", Query: "world"})
	if err != nil {
		t.Fatalf("Browse: %v", err)
	}
	if len(hits) != 1 || hits[0].ID != "worldbuilder" {
		t.Errorf("browse mode hits = %+v", hits)
	}
	if hits[0].Source != src.ID || hits[0].SourceName != src.Name {
		t.Errorf("source attribution not stamped: %+v", hits[0])
	}

	tagHits, _ := rs.Browse(BrowseFilter{Tags: []string{"narrative"}})
	if len(tagHits) != 1 {
		t.Errorf("tag filter hits = %d", len(tagHits))
	}

	// Install mode.
	installed, err := rs.Install(src.ID, "worldbuilder", "1.0.0")
	if err != nil {
		t.Fatalf("Install mode: %v", err)
	}
	if installed.Type != "mode" || installed.ID != "worldbuilder" {
		t.Errorf("installed = %+v", installed)
	}
	if len(installed.Files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(installed.Files))
	}
	for _, f := range installed.Files {
		if _, err := os.Stat(f); err != nil {
			t.Errorf("installed file missing: %v", err)
		}
	}
	// Mode files land under the global modes dir.
	if !strings.HasPrefix(installed.Files[0], globalModesDir()) {
		t.Errorf("mode file not under modes dir: %q (want prefix %q)", installed.Files[0], globalModesDir())
	}

	// Install family.
	famInstalled, err := rs.Install(src.ID, "myfam", "0.1.0")
	if err != nil {
		t.Fatalf("Install family: %v", err)
	}
	if !strings.HasPrefix(famInstalled.Files[0], globalFamiliesDir()) {
		t.Errorf("family file not under families dir: %q", famInstalled.Files[0])
	}

	items, _ := rs.ListInstalled()
	if len(items) != 2 {
		t.Errorf("installed ledger size = %d, want 2", len(items))
	}

	// Uninstall mode → files gone + ledger shrinks.
	if err := rs.Uninstall("mode", "worldbuilder"); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	for _, f := range installed.Files {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Errorf("file %q still present after uninstall: %v", f, err)
		}
	}
	items, _ = rs.ListInstalled()
	if len(items) != 1 || items[0].ID != "myfam" {
		t.Errorf("ledger after uninstall = %+v", items)
	}

	// Idempotent — second uninstall is a no-op.
	if err := rs.Uninstall("mode", "worldbuilder"); err != nil {
		t.Errorf("second uninstall errored: %v", err)
	}
}

// TestRegistryInstallShaMismatch tampers with the index entry to set a
// wrong sha256 and confirms Install refuses to write the bundle.
func TestRegistryInstallShaMismatch(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)

	srv, indexURL, _ := newMockRegistryServer(t)
	defer srv.Close()

	// Wrap the upstream index handler to flip the sha for "worldbuilder".
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.json":
			resp, _ := http.Get(indexURL)
			defer resp.Body.Close()
			var idx RegistryIndex
			json.NewDecoder(resp.Body).Decode(&idx)
			for i := range idx.Artifacts {
				if idx.Artifacts[i].ID == "worldbuilder" {
					idx.Artifacts[i].SHA256 = strings.Repeat("0", 64)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(idx)
		default:
			http.Redirect(w, r, srv.URL+r.URL.Path, http.StatusFound)
		}
	}))
	defer bad.Close()

	rs := NewRegistryService()
	src, err := rs.AddSource("Bad", bad.URL+"/index.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rs.Refresh(src.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := rs.Install(src.ID, "worldbuilder", ""); err == nil {
		t.Fatal("expected sha mismatch error")
	}
	// No files should have landed in modes/.
	entries, _ := os.ReadDir(globalModesDir())
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "worldbuilder") {
			t.Errorf("install left file behind after sha mismatch: %s", e.Name())
		}
	}
	items, _ := rs.ListInstalled()
	for _, it := range items {
		if it.ID == "worldbuilder" {
			t.Errorf("installed ledger recorded a sha-failed install: %+v", it)
		}
	}
}

// TestAutoInstallDefaults wires the default-install flow end to end:
// fresh subscription → refresh + auto-install lands the marked
// artifact in the modes dir + records it in the ledger, while a
// non-default artifact is left alone. A pre-existing file at the
// destination is respected (the upgrade-from-bundled case).
func TestAutoInstallDefaults(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)

	mux := http.NewServeMux()
	defaultMode := `id = "official-agent"
name = "Official Agent"
desc = "auto"
tool_whitelist = []
approval = "auto"
context = "none"
`
	defaultSys := "official body"
	optionalMode := `id = "optional"
name = "Optional"
desc = "manual"
tool_whitelist = []
approval = "auto"
context = "none"
`
	mux.HandleFunc("/files/official-agent.toml", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(defaultMode)) })
	mux.HandleFunc("/files/official-agent.system.md", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(defaultSys)) })
	mux.HandleFunc("/files/optional.toml", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(optionalMode)) })

	srv := httptest.NewServer(mux)
	defer srv.Close()

	idx := RegistryIndex{
		SchemaVersion: 1,
		Artifacts: []RegistryArtifact{
			{
				Type: "mode", ID: "official-agent", Version: "1.0.0",
				DefaultInstall: true,
				Files: []RegistryFile{
					{Path: "official-agent.toml", URL: srv.URL + "/files/official-agent.toml"},
					{Path: "official-agent.system.md", URL: srv.URL + "/files/official-agent.system.md"},
				},
			},
			{
				Type: "mode", ID: "optional", Version: "1.0.0",
				Files: []RegistryFile{
					{Path: "optional.toml", URL: srv.URL + "/files/optional.toml"},
				},
			},
		},
	}
	mux.HandleFunc("/index.json", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(idx)
	})

	rs := NewRegistryService()
	if _, err := rs.AddSource("Test", srv.URL+"/index.json"); err != nil {
		t.Fatal(err)
	}
	if err := rs.AutoInstallDefaults(); err != nil {
		t.Fatalf("AutoInstallDefaults: %v", err)
	}

	items, _ := rs.ListInstalled()
	if len(items) != 1 || items[0].ID != "official-agent" {
		t.Fatalf("expected only official-agent installed, got %+v", items)
	}
	if _, err := os.Stat(filepath.Join(globalModesDir(), "official-agent.toml")); err != nil {
		t.Errorf("default mode not on disk: %v", err)
	}
	if _, err := os.Stat(filepath.Join(globalModesDir(), "optional.toml")); !os.IsNotExist(err) {
		t.Errorf("optional mode should NOT have auto-installed: %v", err)
	}

	// Second pass is idempotent — the ledger entry already covers it.
	if err := rs.AutoInstallDefaults(); err != nil {
		t.Errorf("second pass: %v", err)
	}
	items, _ = rs.ListInstalled()
	if len(items) != 1 {
		t.Errorf("second pass added more installs: %+v", items)
	}
}

// TestAutoInstallDefaultsRespectsExistingFile covers the upgrade
// path: a previous app build left agent.toml in modes/ via the embed
// seed (no install ledger entry). The auto-installer must NOT
// clobber it — the user's hand-edits would otherwise vanish.
func TestAutoInstallDefaultsRespectsExistingFile(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)

	mux := http.NewServeMux()
	mux.HandleFunc("/files/agent.toml", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`id = "agent"
name = "Agent FROM REGISTRY"
desc = "should not overwrite"
tool_whitelist = []
approval = "auto"
context = "none"
`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	mux.HandleFunc("/index.json", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(RegistryIndex{
			SchemaVersion: 1,
			Artifacts: []RegistryArtifact{{
				Type: "mode", ID: "agent", Version: "2.0.0", DefaultInstall: true,
				Files: []RegistryFile{{Path: "agent.toml", URL: srv.URL + "/files/agent.toml"}},
			}},
		})
	})

	// Plant a "pre-existing" agent.toml as if a previous Workbench
	// install seeded it via the (now-removed) embed FS.
	if err := os.MkdirAll(globalModesDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	pre := filepath.Join(globalModesDir(), "agent.toml")
	if err := os.WriteFile(pre, []byte(`id = "agent"
name = "User-edited Agent"
`), 0o644); err != nil {
		t.Fatal(err)
	}

	rs := NewRegistryService()
	if _, err := rs.AddSource("Test", srv.URL+"/index.json"); err != nil {
		t.Fatal(err)
	}
	if err := rs.AutoInstallDefaults(); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(pre)
	if !strings.Contains(string(body), "User-edited Agent") {
		t.Errorf("auto-install clobbered an existing file:\n%s", body)
	}
	items, _ := rs.ListInstalled()
	if len(items) != 0 {
		t.Errorf("ledger should be empty (existing file blocked install), got %+v", items)
	}
}

// TestRegistrySlugifyAddSource pins the slug shape on a handful of
// inputs the user might paste.
func TestRegistrySlugifyAddSource(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	rs := NewRegistryService()
	cases := []struct{ name, want string }{
		{"Official Registry", "official-registry"},
		{"  Trailing Space  ", "trailing-space"},
		{"weird/chars!@#", "weird-chars"},
	}
	for _, c := range cases {
		// Distinct URLs so the dedupe check doesn't trip us.
		got, err := rs.AddSource(c.name, "https://example.com/"+c.want+"/index.json")
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got.ID != c.want {
			t.Errorf("slug(%q) = %q, want %q", c.name, got.ID, c.want)
		}
	}
}
