package main

import (
	"encoding/base64"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// AttachmentRef points at a file persisted alongside a session. The Path
// is always project-relative (so the ref survives the project moving on
// disk) and is sandboxed under the session's attachments directory at
// load time.
type AttachmentRef struct {
	Path string `json:"path"`           // project-relative, e.g. ".llm-workshop/sessions/<sid>/attachments/<uuid>.png"
	Mime string `json:"mime"`           // e.g. "image/png"
	Kind string `json:"kind"`           // "image" for now; future: "audio", "pdf"
	Bytes int64 `json:"bytes"`          // file size, for UI display
	Name  string `json:"name,omitempty"` // original filename, best-effort
}

// AttachmentService writes uploaded blobs into a session's attachments
// directory and reads them back, with a sandbox check on every load so a
// malformed ref can't escape the project tree.
type AttachmentService struct {
	projects *ProjectService
}

func NewAttachmentService(ps *ProjectService) *AttachmentService {
	return &AttachmentService{projects: ps}
}

// Save copies `data` into a fresh file under
// <project>/.llm-workshop/sessions/<sid>/attachments/<uuid>.<ext> and
// returns a ref the caller can drop into SessionMessage.Attachments.
// Extension comes from the MIME type when possible, falling back to the
// supplied original name's extension, then ".bin".
func (as *AttachmentService) Save(projectID, sessionID, origName, mimeType string, data []byte) (AttachmentRef, error) {
	if as.projects == nil {
		return AttachmentRef{}, fmt.Errorf("project service unavailable")
	}
	p, err := as.projects.Get(projectID)
	if err != nil {
		return AttachmentRef{}, err
	}
	if sessionID == "" {
		return AttachmentRef{}, fmt.Errorf("sessionID required")
	}
	kind := kindFromMime(mimeType)
	if kind == "" {
		return AttachmentRef{}, fmt.Errorf("unsupported mime type: %q", mimeType)
	}
	ext := extFromMime(mimeType)
	if ext == "" {
		ext = strings.ToLower(filepath.Ext(origName))
	}
	if ext == "" {
		ext = ".bin"
	}

	relDir := filepath.Join(ProjectDirName, "sessions", sessionID, "attachments")
	absDir := filepath.Join(p.Path, relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return AttachmentRef{}, err
	}
	name := uuid.NewString() + ext
	absPath := filepath.Join(absDir, name)
	if err := os.WriteFile(absPath, data, 0o644); err != nil {
		return AttachmentRef{}, err
	}
	return AttachmentRef{
		Path:  filepath.ToSlash(filepath.Join(relDir, name)),
		Mime:  mimeType,
		Kind:  kind,
		Bytes: int64(len(data)),
		Name:  origName,
	}, nil
}

// ReadBytes resolves the project-relative path against the project root
// and returns the file contents. Rejects refs that escape the sessions
// attachments tree.
func (as *AttachmentService) ReadBytes(projectID string, ref AttachmentRef) ([]byte, error) {
	if as.projects == nil {
		return nil, fmt.Errorf("project service unavailable")
	}
	p, err := as.projects.Get(projectID)
	if err != nil {
		return nil, err
	}
	abs, err := as.resolvePath(p.Path, ref.Path)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(abs)
}

// DataURL returns "data:<mime>;base64,<b64>" — the form expected by
// llama-server's OpenAI-compat /v1/chat/completions endpoint inside an
// `image_url` content part.
func (as *AttachmentService) DataURL(projectID string, ref AttachmentRef) (string, error) {
	b, err := as.ReadBytes(projectID, ref)
	if err != nil {
		return "", err
	}
	return "data:" + ref.Mime + ";base64," + base64.StdEncoding.EncodeToString(b), nil
}

// resolvePath joins root + rel and confirms the result stays inside the
// project's sessions/<sid>/attachments tree. Without this a crafted ref
// like "../../../../etc/passwd" would leak filesystem access through a
// chat message.
func (as *AttachmentService) resolvePath(projectRoot, rel string) (string, error) {
	if rel == "" {
		return "", fmt.Errorf("empty attachment path")
	}
	allowedPrefix := filepath.ToSlash(filepath.Join(ProjectDirName, "sessions"))
	cleaned := filepath.ToSlash(filepath.Clean(rel))
	if !strings.HasPrefix(cleaned, allowedPrefix+"/") {
		return "", fmt.Errorf("attachment path escapes sessions tree: %q", rel)
	}
	abs := filepath.Join(projectRoot, cleaned)
	// Belt-and-braces: the join above already prevents `..` traversal
	// because filepath.Clean above strips it, but verify the final
	// absolute path still lives under projectRoot.
	rootAbs, err := filepath.Abs(projectRoot)
	if err != nil {
		return "", err
	}
	finalAbs, err := filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(finalAbs, rootAbs+string(filepath.Separator)) {
		return "", fmt.Errorf("attachment path escapes project root")
	}
	return finalAbs, nil
}

// kindFromMime classifies the MIME into a coarse bucket the rest of the
// app can branch on. Only "image" is supported in Phase B; audio / pdf
// are reserved for future work.
func kindFromMime(m string) string {
	switch {
	case strings.HasPrefix(m, "image/"):
		return "image"
	default:
		return ""
	}
}

// extFromMime tries the stdlib first, then falls back to a small hand
// list for the codecs llama.cpp's vision encoders typically eat.
func extFromMime(m string) string {
	exts, _ := mime.ExtensionsByType(m)
	if len(exts) > 0 {
		return exts[0]
	}
	switch m {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	}
	return ""
}
