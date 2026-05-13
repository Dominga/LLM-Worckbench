package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// buildGGUF assembles a minimal GGUF v3 byte buffer with the given
// metadata kv-pairs. Tensor count is 0 — we never read past the
// metadata section in the parser. Only string + int32 values are
// supported here, which is all the tests need.
func buildGGUF(t *testing.T, kvs []kv) []byte {
	t.Helper()
	var b bytes.Buffer
	b.WriteString("GGUF")
	binary.Write(&b, binary.LittleEndian, uint32(3))            // version
	binary.Write(&b, binary.LittleEndian, uint64(0))            // tensor_count
	binary.Write(&b, binary.LittleEndian, uint64(len(kvs)))     // kv_count
	for _, p := range kvs {
		writeGGUFString(&b, p.key)
		switch v := p.val.(type) {
		case string:
			binary.Write(&b, binary.LittleEndian, ggufTypeString)
			writeGGUFString(&b, v)
		case int32:
			binary.Write(&b, binary.LittleEndian, ggufTypeInt32)
			binary.Write(&b, binary.LittleEndian, v)
		case bool:
			binary.Write(&b, binary.LittleEndian, ggufTypeBool)
			if v {
				b.WriteByte(1)
			} else {
				b.WriteByte(0)
			}
		default:
			t.Fatalf("unsupported test value %T", p.val)
		}
	}
	return b.Bytes()
}

type kv struct {
	key string
	val any
}

func writeGGUFString(b *bytes.Buffer, s string) {
	binary.Write(b, binary.LittleEndian, uint64(len(s)))
	b.WriteString(s)
}

// TestParseGGUFHeaderRoundTrip writes a synthetic GGUF with mixed
// types and ensures the parser pulls out the architecture + name
// while skipping unrelated keys cleanly.
func TestParseGGUFHeaderRoundTrip(t *testing.T) {
	data := buildGGUF(t, []kv{
		{"general.quantization_version", int32(2)}, // skipped
		{"general.architecture", "qwen3"},
		{"some.flag", true}, // skipped
		{"general.name", "Qwen3-7B-Instruct"},
	})
	path := filepath.Join(t.TempDir(), "model.gguf")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	info, err := ParseGGUFHeader(path)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if info.Architecture != "qwen3" {
		t.Errorf("architecture = %q", info.Architecture)
	}
	if info.Name != "Qwen3-7B-Instruct" {
		t.Errorf("name = %q", info.Name)
	}
}

// TestParseGGUFHeaderMissingFile makes sure autodetect of a path
// that doesn't exist degrades to empty info without error so the UI
// can prompt for manual entry.
func TestParseGGUFHeaderMissingFile(t *testing.T) {
	info, err := ParseGGUFHeader(filepath.Join(t.TempDir(), "nope.gguf"))
	if err != nil {
		t.Errorf("missing file should not error, got %v", err)
	}
	if info != (GGUFInfo{}) {
		t.Errorf("expected empty info, got %+v", info)
	}
}

// TestParseGGUFHeaderBadMagic ensures non-GGUF files silently return
// nothing — we don't want autodetect to error on every text/image
// file the user might accidentally point us at.
func TestParseGGUFHeaderBadMagic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fake.gguf")
	if err := os.WriteFile(path, []byte("NOPE just some bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := ParseGGUFHeader(path)
	if err != nil {
		t.Errorf("bad magic should not error, got %v", err)
	}
	if info != (GGUFInfo{}) {
		t.Errorf("expected empty info on bad magic, got %+v", info)
	}
}

// TestParseGGUFHeaderUnsupportedVersion errors on v1 / future
// versions so we don't silently misparse offsets.
func TestParseGGUFHeaderUnsupportedVersion(t *testing.T) {
	var b bytes.Buffer
	b.WriteString("GGUF")
	binary.Write(&b, binary.LittleEndian, uint32(1)) // v1 — unsupported
	binary.Write(&b, binary.LittleEndian, uint64(0))
	binary.Write(&b, binary.LittleEndian, uint64(0))
	path := filepath.Join(t.TempDir(), "v1.gguf")
	os.WriteFile(path, b.Bytes(), 0o644)
	if _, err := ParseGGUFHeader(path); err == nil {
		t.Error("expected error on unsupported version")
	}
}

// TestGuessFamilyFromArch exercises the architecture-string heuristic
// against the names the bundled families ship under.
func TestGuessFamilyFromArch(t *testing.T) {
	cases := []struct {
		arch, name string
		wantFam    string
		wantVer    string
	}{
		{"qwen3", "Qwen3-7B-Instruct", "qwen3", "3"},
		{"qwen2", "Qwen2.5-7B-Instruct", "qwen3", "2.5"},
		{"gemma3", "Gemma-3-12B-IT", "gemma3", "3"},
		{"gemma", "Gemma-2-9B-IT", "gemma3", "2"},
		{"llama", "Llama-3.1-8B-Instruct", "llama3", "3.1"},
		{"mistral", "Mistral-7B-Instruct", "mistral", ""},
		{"mixtral", "Mixtral-8x7B", "mistral", ""},
		{"deepseek2", "DeepSeek-R1-Distill-Qwen-7B", "deepseek-r1", ""},
		{"deepseek2", "DeepSeek-V3-Chat", "", ""},
		{"unknown-arch", "Mystery-1B", "", ""},
	}
	for _, c := range cases {
		got := GuessFamilyFromArch(c.arch, c.name)
		if got.Family != c.wantFam {
			t.Errorf("arch=%q name=%q family = %q, want %q", c.arch, c.name, got.Family, c.wantFam)
		}
		if got.FamilyVersion != c.wantVer {
			t.Errorf("arch=%q name=%q version = %q, want %q", c.arch, c.name, got.FamilyVersion, c.wantVer)
		}
	}
}
