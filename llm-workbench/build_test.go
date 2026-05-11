package main

import (
	"testing"
)

// newTestBuildManager points the config dir at a temp dir so builds.toml
// is isolated per test, then returns a fresh manager.
func newTestBuildManager(t *testing.T) *BuildManager {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	bm, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	return bm
}

func TestBuildBackendValid(t *testing.T) {
	for _, b := range []BuildBackend{BackendCPU, BackendCUDA11, BackendCUDA12, BackendROCm, BackendVulkan, BackendMetal} {
		if !b.Valid() {
			t.Errorf("%q should be valid", b)
		}
	}
	for _, b := range []BuildBackend{"", "cuda", "opencl", "CUDA12"} {
		if b.Valid() {
			t.Errorf("%q should be invalid", b)
		}
	}
}

func TestBuildRecipeValidate(t *testing.T) {
	cases := []struct {
		name    string
		r       BuildRecipe
		wantErr bool
	}{
		{"ok", BuildRecipe{ID: "r1", SourceDir: "/src/llama.cpp"}, false},
		{"ok with backend+jobs", BuildRecipe{ID: "r1", SourceDir: "/s", Backend: BackendCUDA12, Jobs: 8}, false},
		{"blank id", BuildRecipe{ID: "  ", SourceDir: "/s"}, true},
		{"blank source_dir", BuildRecipe{ID: "r1", SourceDir: ""}, true},
		{"bad backend", BuildRecipe{ID: "r1", SourceDir: "/s", Backend: "opencl"}, true},
		{"negative jobs", BuildRecipe{ID: "r1", SourceDir: "/s", Jobs: -1}, true},
	}
	for _, c := range cases {
		err := c.r.Validate()
		if (err != nil) != c.wantErr {
			t.Errorf("%s: Validate() err=%v, wantErr=%v", c.name, err, c.wantErr)
		}
	}
}

func TestBuildRecipeBuildDirOrDefault(t *testing.T) {
	if got := (&BuildRecipe{}).BuildDirOrDefault(); got != "build" {
		t.Errorf("default = %q, want build", got)
	}
	if got := (&BuildRecipe{BuildDir: "   "}).BuildDirOrDefault(); got != "build" {
		t.Errorf("blank = %q, want build", got)
	}
	if got := (&BuildRecipe{BuildDir: "out"}).BuildDirOrDefault(); got != "out" {
		t.Errorf("explicit = %q, want out", got)
	}
}

func TestBuildValidate(t *testing.T) {
	if err := (&Build{ID: "b1", BinaryPath: "/x/llama-server"}).Validate(); err != nil {
		t.Errorf("valid build rejected: %v", err)
	}
	if err := (&Build{ID: "", BinaryPath: "/x"}).Validate(); err == nil {
		t.Error("blank id accepted")
	}
	if err := (&Build{ID: "b1", BinaryPath: " "}).Validate(); err == nil {
		t.Error("blank binary_path accepted")
	}
}

func TestRecipeCRUD(t *testing.T) {
	bm := newTestBuildManager(t)

	r, err := bm.CreateRecipe(BuildRecipe{ID: "cuda12-default", SourceDir: "/src/llama.cpp", SourceRepo: "https://github.com/ggml-org/llama.cpp", Backend: BackendCUDA12, CMakeFlags: []string{"-DGGML_CUDA=ON"}})
	if err != nil {
		t.Fatalf("CreateRecipe: %v", err)
	}
	if r.CreatedAt.IsZero() || r.UpdatedAt.IsZero() {
		t.Error("timestamps not set on create")
	}

	if _, err := bm.CreateRecipe(BuildRecipe{ID: "ik-default", SourceDir: "/src/ik_llama.cpp"}); err != nil {
		t.Fatalf("CreateRecipe (ik): %v", err)
	}

	// Generated ID when blank.
	gen, err := bm.CreateRecipe(BuildRecipe{SourceDir: "/src/gen"})
	if err != nil {
		t.Fatalf("CreateRecipe (blank id): %v", err)
	}
	if gen.ID == "" {
		t.Error("ID not generated")
	}
	if err := bm.DeleteRecipe(gen.ID); err != nil {
		t.Fatalf("cleanup DeleteRecipe: %v", err)
	}

	// Duplicate ID rejected.
	if _, err := bm.CreateRecipe(BuildRecipe{ID: "cuda12-default", SourceDir: "/s"}); err == nil {
		t.Error("duplicate recipe id accepted")
	}

	// Invalid rejected.
	if _, err := bm.CreateRecipe(BuildRecipe{ID: "bad"}); err == nil {
		t.Error("recipe without source_dir accepted")
	}

	// List sorted by ID.
	list := bm.ListRecipes()
	if len(list) != 2 {
		t.Fatalf("len(list) = %d, want 2", len(list))
	}
	if list[0].ID != "cuda12-default" || list[1].ID != "ik-default" {
		t.Errorf("not sorted: %q, %q", list[0].ID, list[1].ID)
	}

	// Get.
	got, err := bm.GetRecipe("cuda12-default")
	if err != nil {
		t.Fatalf("GetRecipe: %v", err)
	}
	if len(got.CMakeFlags) != 1 || got.CMakeFlags[0] != "-DGGML_CUDA=ON" {
		t.Errorf("flags lost: %v", got.CMakeFlags)
	}
	if _, err := bm.GetRecipe("nope"); err == nil {
		t.Error("GetRecipe(missing) returned nil err")
	}

	// Update preserves CreatedAt, bumps UpdatedAt, applies changes.
	upd, err := bm.UpdateRecipe("cuda12-default", BuildRecipe{SourceDir: "/src/llama.cpp", Backend: BackendCUDA12, Jobs: 16, GitRef: "master"})
	if err != nil {
		t.Fatalf("UpdateRecipe: %v", err)
	}
	if !upd.CreatedAt.Equal(r.CreatedAt) {
		t.Error("CreatedAt not preserved on update")
	}
	if !upd.UpdatedAt.After(r.UpdatedAt) {
		t.Error("UpdatedAt not bumped on update")
	}
	if upd.Jobs != 16 || upd.GitRef != "master" {
		t.Errorf("update not applied: %+v", upd)
	}

	// Update missing.
	if _, err := bm.UpdateRecipe("ghost", BuildRecipe{SourceDir: "/s"}); err == nil {
		t.Error("UpdateRecipe(missing) returned nil err")
	}

	// Delete + no-op on missing.
	if err := bm.DeleteRecipe("cuda12-default"); err != nil {
		t.Fatalf("DeleteRecipe: %v", err)
	}
	if err := bm.DeleteRecipe("cuda12-default"); err != nil {
		t.Errorf("DeleteRecipe(missing) = %v, want nil", err)
	}
	if len(bm.ListRecipes()) != 1 {
		t.Errorf("after delete len = %d, want 1", len(bm.ListRecipes()))
	}
}

func TestBuildArtifactCRUD(t *testing.T) {
	bm := newTestBuildManager(t)

	b, err := bm.AddBuild(Build{RecipeID: "cuda12-default", BinaryPath: "/builds/x/llama-server", Backend: BackendCUDA12, Commit: "deadbeef", Capabilities: []string{"chat", "embed"}})
	if err != nil {
		t.Fatalf("AddBuild: %v", err)
	}
	if b.ID == "" {
		t.Error("build ID not generated")
	}
	if b.BuiltAt.IsZero() {
		t.Error("BuiltAt not set")
	}

	// Replace-on-same-ID (rebuild).
	b.Commit = "cafef00d"
	b2, err := bm.AddBuild(b)
	if err != nil {
		t.Fatalf("AddBuild (replace): %v", err)
	}
	if b2.ID != b.ID {
		t.Error("ID changed on replace")
	}
	if len(bm.ListBuilds()) != 1 {
		t.Errorf("replace created a dup: len = %d", len(bm.ListBuilds()))
	}
	got, err := bm.GetBuild(b.ID)
	if err != nil {
		t.Fatalf("GetBuild: %v", err)
	}
	if got.Commit != "cafef00d" {
		t.Errorf("replace not applied: commit = %q", got.Commit)
	}

	// Invalid rejected.
	if _, err := bm.AddBuild(Build{RecipeID: "r", BinaryPath: ""}); err == nil {
		t.Error("AddBuild without binary_path accepted")
	}

	// Delete + no-op.
	if err := bm.DeleteBuild(b.ID); err != nil {
		t.Fatalf("DeleteBuild: %v", err)
	}
	if err := bm.DeleteBuild(b.ID); err != nil {
		t.Errorf("DeleteBuild(missing) = %v, want nil", err)
	}
	if len(bm.ListBuilds()) != 0 {
		t.Errorf("after delete len = %d, want 0", len(bm.ListBuilds()))
	}
}

func TestBuildManagerPersistence(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	bm1, err := NewBuildManager()
	if err != nil {
		t.Fatalf("NewBuildManager: %v", err)
	}
	if _, err := bm1.CreateRecipe(BuildRecipe{ID: "r1", SourceDir: "/src", Backend: BackendCPU, CMakeFlags: []string{"-DGGML_NATIVE=ON"}}); err != nil {
		t.Fatalf("CreateRecipe: %v", err)
	}
	if _, err := bm1.AddBuild(Build{ID: "b1", RecipeID: "r1", BinaryPath: "/src/build/bin/llama-server", Backend: BackendCPU}); err != nil {
		t.Fatalf("AddBuild: %v", err)
	}

	// Fresh manager over the same config dir sees both.
	bm2, err := NewBuildManager()
	if err != nil {
		t.Fatalf("reload NewBuildManager: %v", err)
	}
	if len(bm2.ListRecipes()) != 1 {
		t.Fatalf("recipes not persisted: %d", len(bm2.ListRecipes()))
	}
	if len(bm2.ListBuilds()) != 1 {
		t.Fatalf("builds not persisted: %d", len(bm2.ListBuilds()))
	}
	r, _ := bm2.GetRecipe("r1")
	if len(r.CMakeFlags) != 1 || r.CMakeFlags[0] != "-DGGML_NATIVE=ON" {
		t.Errorf("recipe flags not round-tripped: %v", r.CMakeFlags)
	}
	b, _ := bm2.GetBuild("b1")
	if b.BinaryPath != "/src/build/bin/llama-server" {
		t.Errorf("build path not round-tripped: %q", b.BinaryPath)
	}
}
