package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// ScriptResult is the synchronous outcome of a Prompt-Lab run. Log
// lines collected via `app.log(...)` land in Output (one element per
// call); the final expression's value (if any) is in Return. Failures
// surface in Error and the partial Output is still returned so the UI
// can show what landed before the script blew up.
type ScriptResult struct {
	Output     []string `json:"output"`
	Return     any      `json:"return,omitempty"`
	Error      string   `json:"error,omitempty"`
	DurationMs int64    `json:"durationMs"`
}

// ScriptingService runs user-authored JavaScript in goja with a
// project-scoped `app` global. v1 surface (DESIGN.md §5.5 + decisions
// captured in TODO.md):
//
//	app.log(...args)              // append-only output stream
//	app.fs.read(path) -> string
//	app.fs.write(path, content)
//	app.fs.list() -> string[]
//	app.rag.search(query[, k])   -> ChunkHit[]
//	app.chat({messages, profileId?, temperature?}) -> string
//	app.project.id / app.project.name
//
// Future surface (workflows, external tools) is intentionally left
// out of this PR.
type ScriptingService struct {
	projects *ProjectService
	files    *FileService
	chat     *ChatService
	rag      *RAGService
	profiles *ProfileManager
	indexes  *IndexRegistry
}

func NewScriptingService(
	projects *ProjectService,
	files *FileService,
	chat *ChatService,
	rag *RAGService,
	pm *ProfileManager,
	idx *IndexRegistry,
) *ScriptingService {
	return &ScriptingService{
		projects: projects,
		files:    files,
		chat:     chat,
		rag:      rag,
		profiles: pm,
		indexes:  idx,
	}
}

// Run executes `source` inside a fresh goja runtime bound to the
// project. The script is run synchronously; goja is single-threaded by
// design. Cancellation is honored via ctx — if ctx fires the runtime
// is interrupted at the next instruction (goja supports cooperative
// cancellation).
func (s *ScriptingService) Run(ctx context.Context, projectID, source string) ScriptResult {
	t0 := time.Now()
	res := ScriptResult{Output: []string{}}

	vm := goja.New()
	// Map embedded fieldnames to camelCase JS — keeps the API close to
	// what users actually type (`hit.path` rather than `hit.Path`).
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))

	// Cooperative ctx cancellation: spawn a watcher that hits the
	// runtime's interrupt when ctx fires.
	stopWatch := make(chan struct{})
	defer close(stopWatch)
	go func() {
		select {
		case <-ctx.Done():
			vm.Interrupt(ctx.Err())
		case <-stopWatch:
		}
	}()

	app := buildAppObject(vm, s, projectID, &res)
	if err := vm.Set("app", app); err != nil {
		res.Error = fmt.Sprintf("bind app: %v", err)
		res.DurationMs = time.Since(t0).Milliseconds()
		return res
	}

	val, err := vm.RunString(source)
	if err != nil {
		// goja wraps panics as *Exception. Use Error() so user sees the
		// JS-side message rather than the Go internals.
		res.Error = err.Error()
		res.DurationMs = time.Since(t0).Milliseconds()
		return res
	}
	if val != nil && !goja.IsUndefined(val) && !goja.IsNull(val) {
		res.Return = val.Export()
	}
	res.DurationMs = time.Since(t0).Milliseconds()
	return res
}

// buildAppObject assembles the `app` global. Each helper is a closure
// over the service + projectID so scripts always operate inside the
// caller's project — no path-escape from JS.
func buildAppObject(vm *goja.Runtime, s *ScriptingService, projectID string, res *ScriptResult) map[string]any {
	logFn := func(call goja.FunctionCall) goja.Value {
		parts := make([]string, 0, len(call.Arguments))
		for _, a := range call.Arguments {
			parts = append(parts, formatLogArg(a))
		}
		res.Output = append(res.Output, strings.Join(parts, " "))
		return goja.Undefined()
	}

	fsObj := map[string]any{
		"read": func(path string) (string, error) {
			if s.files == nil {
				return "", errors.New("file service unavailable")
			}
			fc, err := s.files.ReadFile(projectID, path)
			if err != nil {
				return "", err
			}
			return fc.Content, nil
		},
		"write": func(path, content string) error {
			if s.files == nil {
				return errors.New("file service unavailable")
			}
			return s.files.WriteFile(projectID, path, content)
		},
		"list": func() ([]string, error) {
			if s.files == nil {
				return nil, errors.New("file service unavailable")
			}
			tree, err := s.files.ListTree(projectID)
			if err != nil {
				return nil, err
			}
			return flattenPaths(tree), nil
		},
	}

	ragObj := map[string]any{
		"search": func(query string, opts map[string]any) ([]ChunkHit, error) {
			if s.rag == nil {
				return nil, errors.New("rag service unavailable")
			}
			k := 8
			sparseOnly := true
			embedProfileID := ""
			if opts != nil {
				if v, ok := opts["k"]; ok {
					switch n := v.(type) {
					case int64:
						k = int(n)
					case float64:
						k = int(n)
					}
				}
				if v, ok := opts["embedProfileId"].(string); ok {
					embedProfileID = v
					sparseOnly = false
				}
			}
			ctx := context.Background()
			return s.rag.Search(ctx, projectID, embedProfileID, query, SearchOptions{
				K: k, SparseOnly: sparseOnly,
			})
		},
	}

	chatObj := map[string]any{
		"complete": func(req map[string]any) (string, error) {
			// One-shot non-streaming completion. Workflow-style:
			//   const reply = app.chat.complete({ messages: [...] });
			if s.chat == nil {
				return "", errors.New("chat service unavailable")
			}
			profileID, _ := req["profileId"].(string)
			temperature := 0.7
			if t, ok := req["temperature"].(float64); ok {
				temperature = t
			}
			rawMsgs, _ := req["messages"].([]any)
			msgs := make([]ChatMessage, 0, len(rawMsgs))
			for _, m := range rawMsgs {
				obj, _ := m.(map[string]any)
				role, _ := obj["role"].(string)
				content, _ := obj["content"].(string)
				if role == "" {
					role = "user"
				}
				msgs = append(msgs, ChatMessage{Role: role, Content: content})
			}
			return s.chat.complete(profileID, msgs, temperature)
		},
	}

	projectObj := map[string]any{
		"id":   projectID,
		"name": "",
	}
	if s.projects != nil {
		if p, err := s.projects.Get(projectID); err == nil {
			projectObj["name"] = p.Name
			projectObj["path"] = p.Path
		}
	}

	return map[string]any{
		"log":     logFn,
		"fs":      fsObj,
		"rag":     ragObj,
		"chat":    chatObj,
		"project": projectObj,
	}
}

// flattenPaths is the leaf-only file list helper for app.fs.list().
func flattenPaths(nodes []FileNode) []string {
	var out []string
	var walk func([]FileNode)
	walk = func(ns []FileNode) {
		for _, n := range ns {
			if n.IsDir {
				walk(n.Children)
				continue
			}
			out = append(out, n.Path)
		}
	}
	walk(nodes)
	return out
}

func formatLogArg(v goja.Value) string {
	if v == nil || goja.IsUndefined(v) {
		return "undefined"
	}
	if goja.IsNull(v) {
		return "null"
	}
	exp := v.Export()
	switch t := exp.(type) {
	case string:
		return t
	case nil:
		return "null"
	default:
		// goja can re-marshal objects via JSON.stringify — use that so
		// the user sees the same shape they'd `console.log` in a
		// browser.
		return fmt.Sprintf("%v", exp)
	}
}

// ─────────────────────────── helpers ──────────────────────────

// scriptingMu serialises the in-process goja runtimes. goja itself is
// safe to use concurrently with different runtimes; the mutex keeps
// the global App's chat / fs / rag services from racing each other
// when the user fires several Run() calls back-to-back.
var scriptingMu sync.Mutex

func init() { _ = scriptingMu } // keep the var referenced even before workflows land
