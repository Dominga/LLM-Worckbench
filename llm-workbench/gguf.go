package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

// GGUFInfo is the subset of GGUF header metadata the family
// autodetector cares about. Both fields default to "" when the
// parser can't find them (broken file, wrong version, oversize
// metadata): callers degrade to manual entry.
type GGUFInfo struct {
	Architecture string `json:"architecture"`
	Name         string `json:"name"`
}

// gguf metadata value-type constants from the GGUF v2/v3 spec.
const (
	ggufTypeUint8   uint32 = 0
	ggufTypeInt8    uint32 = 1
	ggufTypeUint16  uint32 = 2
	ggufTypeInt16   uint32 = 3
	ggufTypeUint32  uint32 = 4
	ggufTypeInt32   uint32 = 5
	ggufTypeFloat32 uint32 = 6
	ggufTypeBool    uint32 = 7
	ggufTypeString  uint32 = 8
	ggufTypeArray   uint32 = 9
	ggufTypeUint64  uint32 = 10
	ggufTypeInt64   uint32 = 11
	ggufTypeFloat64 uint32 = 12
)

// ggufMaxMetadataKVs guards against runaway loops on a corrupt
// header. Real-world GGUFs sit well under 200 keys.
const ggufMaxMetadataKVs = 4096

// ggufMaxStringBytes caps a single string value the parser will read.
// Keeps malicious / corrupted files from making the app allocate
// gigabytes off a bogus length prefix.
const ggufMaxStringBytes = 1 << 20

// ParseGGUFHeader reads just enough of `path` to extract the
// general.architecture and general.name metadata strings. Never
// reads tensor data. Returns an empty struct without error if the
// file is missing or doesn't look like GGUF — autodetect is best-
// effort.
func ParseGGUFHeader(path string) (GGUFInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return GGUFInfo{}, nil
		}
		return GGUFInfo{}, err
	}
	defer f.Close()

	var magic [4]byte
	if _, err := io.ReadFull(f, magic[:]); err != nil {
		return GGUFInfo{}, nil
	}
	if string(magic[:]) != "GGUF" {
		return GGUFInfo{}, nil // not a GGUF file — silent
	}

	le := binary.LittleEndian
	var version uint32
	if err := binary.Read(f, le, &version); err != nil {
		return GGUFInfo{}, err
	}
	// v1 used u32 lengths; v2 / v3 use u64. We support v2 and v3
	// since v1 GGUFs are extinct in practice.
	if version != 2 && version != 3 {
		return GGUFInfo{}, fmt.Errorf("unsupported GGUF version %d", version)
	}

	var tensorCount, kvCount uint64
	if err := binary.Read(f, le, &tensorCount); err != nil {
		return GGUFInfo{}, err
	}
	if err := binary.Read(f, le, &kvCount); err != nil {
		return GGUFInfo{}, err
	}
	if kvCount > ggufMaxMetadataKVs {
		return GGUFInfo{}, fmt.Errorf("metadata kv count %d exceeds sanity cap %d", kvCount, ggufMaxMetadataKVs)
	}

	out := GGUFInfo{}
	for i := uint64(0); i < kvCount; i++ {
		key, err := readGGUFString(f, le)
		if err != nil {
			return out, err
		}
		var vtype uint32
		if err := binary.Read(f, le, &vtype); err != nil {
			return out, err
		}
		// Capture string values for the keys we care about; skip
		// everything else (including non-string values for those keys
		// — the spec is well-defined enough that this shouldn't
		// happen in practice, but defending costs nothing).
		switch key {
		case "general.architecture", "general.name":
			if vtype != ggufTypeString {
				if err := skipGGUFValue(f, le, vtype); err != nil {
					return out, err
				}
				continue
			}
			val, err := readGGUFString(f, le)
			if err != nil {
				return out, err
			}
			if key == "general.architecture" {
				out.Architecture = val
			} else {
				out.Name = val
			}
			// Early-exit when both targets are populated.
			if out.Architecture != "" && out.Name != "" {
				return out, nil
			}
		default:
			if err := skipGGUFValue(f, le, vtype); err != nil {
				return out, err
			}
		}
	}
	return out, nil
}

func readGGUFString(r io.Reader, le binary.ByteOrder) (string, error) {
	var n uint64
	if err := binary.Read(r, le, &n); err != nil {
		return "", err
	}
	if n > ggufMaxStringBytes {
		return "", fmt.Errorf("gguf string len %d exceeds cap %d", n, ggufMaxStringBytes)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}

// skipGGUFValue advances the reader past one metadata value of the
// declared type without materialising it. Used for keys we don't care
// about — the spec requires we still consume the bytes exactly so the
// next key starts at the right offset.
func skipGGUFValue(r io.Reader, le binary.ByteOrder, vtype uint32) error {
	switch vtype {
	case ggufTypeUint8, ggufTypeInt8, ggufTypeBool:
		return discard(r, 1)
	case ggufTypeUint16, ggufTypeInt16:
		return discard(r, 2)
	case ggufTypeUint32, ggufTypeInt32, ggufTypeFloat32:
		return discard(r, 4)
	case ggufTypeUint64, ggufTypeInt64, ggufTypeFloat64:
		return discard(r, 8)
	case ggufTypeString:
		_, err := readGGUFString(r, le)
		return err
	case ggufTypeArray:
		var elemType uint32
		if err := binary.Read(r, le, &elemType); err != nil {
			return err
		}
		var arrLen uint64
		if err := binary.Read(r, le, &arrLen); err != nil {
			return err
		}
		if arrLen > ggufMaxStringBytes {
			return fmt.Errorf("gguf array len %d exceeds cap %d", arrLen, ggufMaxStringBytes)
		}
		for i := uint64(0); i < arrLen; i++ {
			if err := skipGGUFValue(r, le, elemType); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("unknown gguf value type %d", vtype)
	}
}

func discard(r io.Reader, n int) error {
	buf := make([]byte, n)
	_, err := io.ReadFull(r, buf)
	return err
}

// ─────────────────────── Architecture → family map ───────────────

// FamilyGuess is the outcome of DetectFamily: best-guess `family` ID
// plus an optional version pulled from general.name. Empty fields
// mean "couldn't tell" — UI prompts the user for manual entry.
type FamilyGuess struct {
	Family        string `json:"family"`
	FamilyVersion string `json:"familyVersion"`
	Architecture  string `json:"architecture"`
	Name          string `json:"name"`
}

// versionRe captures the first "<number>.<number>?" run inside a
// model name, used to suggest family_version. Examples:
//
//	"Qwen3-7B-Instruct"         → "3"
//	"Qwen2.5-7B"                → "2.5"
//	"Llama-3.1-8B-Instruct"     → "3.1"
//	"Mistral-7B-Instruct-v0.3"  → "7" (close enough; user can edit)
//
// Imperfect on purpose — autodetect is a hint, not a contract.
var versionRe = regexp.MustCompile(`\d+(?:\.\d+)?`)

// GuessFamilyFromArch maps the GGUF general.architecture string to a
// family ID known to the bundled set. Unknown architectures return
// "" so the UI falls back to manual entry.
func GuessFamilyFromArch(arch, name string) FamilyGuess {
	out := FamilyGuess{Architecture: arch, Name: name}
	low := strings.ToLower(arch)
	switch {
	case strings.HasPrefix(low, "qwen"):
		out.Family = "qwen3"
	case strings.HasPrefix(low, "gemma"):
		// gemma3 / gemma2 / gemma all map to the gemma3 entry — the
		// chat-template handling is close enough; user can switch to
		// gemma4 explicitly when those checkpoints land.
		out.Family = "gemma3"
	case strings.HasPrefix(low, "llama"):
		out.Family = "llama3"
	case strings.HasPrefix(low, "mistral"), strings.HasPrefix(low, "mixtral"):
		out.Family = "mistral"
	case strings.Contains(low, "deepseek"):
		// DeepSeek architectures cover R1 (reasoning) + V2/V3 chat.
		// Only flag R1 when the name actually says so; otherwise leave
		// family blank and let the user pick — DeepSeek-V3 chat behaves
		// quite differently from R1 reasoning models.
		if strings.Contains(strings.ToLower(name), "r1") {
			out.Family = "deepseek-r1"
		}
	}
	if out.Family != "" {
		// Pull a version hint from the name when one is obvious. Strip
		// the family prefix first so "Qwen3-7B" doesn't yield "3" via
		// the literal "3" in "Qwen3" and "7" — we want family_version
		// (e.g. 3.5), not the parameter count.
		out.FamilyVersion = extractFamilyVersion(out.Family, name)
	}
	return out
}

// extractFamilyVersion is a best-effort heuristic to pull a version
// hint out of a GGUF model name. Only runs for families whose ID
// ends with a digit (qwen3, gemma3, llama3, …) — for families like
// mistral or deepseek-r1 there's no canonical numeric version to
// surface, and trying to derive one inevitably picks up the param
// count ("7" from "Mistral-7B"). Returns "" when nothing matches.
func extractFamilyVersion(familyID, name string) string {
	if name == "" {
		return ""
	}
	// Skip families whose ID contains a hyphen — those are brand tags
	// like "deepseek-r1" where the trailing digit is part of the name
	// (R1 vs R2), not a version we can usefully parse out of the GGUF.
	if strings.Contains(familyID, "-") {
		return ""
	}
	base := strings.TrimRight(familyID, "0123456789")
	if base == familyID {
		// Family ID has no trailing digit → no numeric version to chase.
		return ""
	}
	lower := strings.ToLower(name)
	idx := strings.Index(lower, base)
	if idx < 0 {
		return ""
	}
	// Skip the base prefix in the original-case string and look for
	// the first version token that follows. Anchor on the immediate
	// remainder so "Llama-3.1-8B" gives "3.1" rather than "8".
	tail := name[idx+len(base):]
	tail = strings.TrimLeft(tail, "-_ ")
	if m := versionRe.FindString(tail); m != "" {
		return m
	}
	return ""
}

