package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type ChatMessage struct {
	Role        string          `json:"role"`
	Content     string          `json:"content"`
	Attachments []AttachmentRef `json:"attachments,omitempty"`
}

// ChatStats mirrors the `timings` block emitted by llama-server (and the
// ik_llama.cpp fork). All fields are optional — non-llama backends won't
// supply them, so the frontend must treat the event as best-effort.
type ChatStats struct {
	PromptN            int     `json:"prompt_n"`
	PromptMS           float64 `json:"prompt_ms"`
	PromptPerSecond    float64 `json:"prompt_per_second"`
	PredictedN         int     `json:"predicted_n"`
	PredictedMS        float64 `json:"predicted_ms"`
	PredictedPerSecond float64 `json:"predicted_per_second"`
}

// reliableTimings filters out per-token timing samples that produce wildly
// inflated t/s. llama-server with timings_per_token=true emits cumulative
// timings on every chunk; at predicted_n=1 predicted_ms can round to ~0,
// yielding values like 1e6 t/s. Wait until enough tokens have accumulated.
func reliableTimings(s *ChatStats) bool {
	if s == nil {
		return false
	}
	if s.PredictedN >= 4 && s.PredictedMS >= 50 {
		return true
	}
	return false
}

type ChatService struct {
	registry    *ServerRegistry
	pm          *ProfileManager
	sessions    *SessionService
	attachments *AttachmentService

	// Optional agent-loop deps. When non-nil and the active mode has a
	// non-empty ToolWhitelist, StartSessionStream routes through the
	// tool-using loop instead of the plain SSE drain.
	tools     *ToolRegistry
	modes     *ModeService
	approvals *ApprovalManager
	snapshots *SnapshotService
	agentX    func(projectID string) *AgentContext // builds AgentContext on demand

	ctx context.Context

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewChatService(registry *ServerRegistry, pm *ProfileManager, sessions *SessionService, attachments *AttachmentService) *ChatService {
	return &ChatService{
		registry:    registry,
		pm:          pm,
		sessions:    sessions,
		attachments: attachments,
		cancels:     make(map[string]context.CancelFunc),
	}
}

// AttachAgent wires the optional agent-loop dependencies. Safe to call
// after NewChatService — keeps the constructor signature stable while
// M3 services come online.
func (c *ChatService) AttachAgent(
	tools *ToolRegistry,
	modes *ModeService,
	approvals *ApprovalManager,
	snapshots *SnapshotService,
	agentX func(projectID string) *AgentContext,
) {
	c.tools = tools
	c.modes = modes
	c.approvals = approvals
	c.snapshots = snapshots
	c.agentX = agentX
}

func (c *ChatService) Attach(ctx context.Context) {
	c.ctx = ctx
}

// toAPIMessage shapes one in-flight message for the OpenAI-compat
// request body. Plain-text turns keep `content` as a string (cheapest
// to serialise and what older llama.cpp builds accept). Turns with
// image attachments switch to the multimodal array form, one
// `image_url` part per attached image with a `data:` URL.
//
// `projectID` is required to resolve attachment refs to bytes; the
// caller passes "" when there is no project context, in which case
// attachments are silently dropped (no caller without a project ever
// produces attachments in practice).
func (c *ChatService) toAPIMessage(projectID string, m ChatMessage) (map[string]any, error) {
	if len(m.Attachments) == 0 || c.attachments == nil || projectID == "" {
		return map[string]any{"role": m.Role, "content": m.Content}, nil
	}
	parts := make([]map[string]any, 0, len(m.Attachments)+1)
	if m.Content != "" {
		parts = append(parts, map[string]any{"type": "text", "text": m.Content})
	}
	for _, a := range m.Attachments {
		if a.Kind != "image" {
			continue
		}
		url, err := c.attachments.DataURL(projectID, a)
		if err != nil {
			return nil, fmt.Errorf("load attachment %s: %w", a.Path, err)
		}
		parts = append(parts, map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": url},
		})
	}
	return map[string]any{"role": m.Role, "content": parts}, nil
}

func (c *ChatService) toAPIMessages(projectID string, msgs []ChatMessage) ([]map[string]any, error) {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		am, err := c.toAPIMessage(projectID, m)
		if err != nil {
			return nil, err
		}
		out = append(out, am)
	}
	return out, nil
}

// profileSupportsVision returns the best-effort capability answer for a
// profile: the live /props probe if available, then the profile's
// configured mmproj as a static fallback. Used to gate image
// attachments at request-build time.
func (c *ChatService) profileSupportsVision(profileID string) bool {
	if c.registry != nil {
		st := c.registry.Status(profileID)
		if st.Caps.Source == "props" || st.Caps.Source == "mmproj" {
			return st.Caps.Vision
		}
	}
	if c.pm != nil {
		if p, err := c.pm.Get(profileID); err == nil && p.MMProjPath != "" {
			return true
		}
	}
	return false
}

// StreamID for client to subscribe to "chat:delta:<id>", "chat:done:<id>", "chat:error:<id>".
type StreamHandle struct {
	StreamID string `json:"streamId"`
}

func (c *ChatService) resolveBaseURL(profileID string) (string, error) {
	if profileID == "" && c.registry != nil {
		profileID = c.registry.DefaultProfileID()
	}
	if profileID == "" {
		return "", fmt.Errorf("no chat profile available")
	}
	if c.pm == nil {
		return "", fmt.Errorf("profile manager unavailable")
	}
	p, err := c.pm.Get(profileID)
	if err != nil {
		return "", err
	}
	if p.Kind != KindChat {
		return "", fmt.Errorf("profile %q is %s, not chat", profileID, p.Kind)
	}
	return p.BaseURL(), nil
}

// StartStream begins a one-shot streaming completion. profileID may be
// empty to use the default chat profile. No persistence — caller manages
// message history.
func (c *ChatService) StartStream(profileID string, messages []ChatMessage, temperature float64, debug bool) (StreamHandle, error) {
	baseURL, err := c.resolveBaseURL(profileID)
	if err != nil {
		return StreamHandle{}, err
	}
	streamID := uuid.NewString()
	streamCtx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.cancels[streamID] = cancel
	c.mu.Unlock()

	go func() {
		full, err := c.runStream(streamCtx, streamID, baseURL, "", messages, temperature, debug)
		// User-initiated cancel = clean stop. Keep partial content,
		// drop the canceled error so frontend gets chat:done not chat:error.
		if err != nil && errors.Is(err, context.Canceled) {
			err = nil
		}
		c.finalize(streamID, full, err)
	}()
	return StreamHandle{StreamID: streamID}, nil
}

// StartSessionStream is the session-bound variant: it appends the user
// message to the session's JSONL, streams a reply, and persists the
// assistant response on completion. Mode and profile come from the
// session header. `attachments` are uploaded files (currently images
// only) that should ride along with this turn; rejected up-front if the
// active profile lacks vision support.
func (c *ChatService) StartSessionStream(projectID, sessionID, userText string, temperature float64, debug bool, attachments []AttachmentRef) (StreamHandle, error) {
	if c.sessions == nil {
		return StreamHandle{}, fmt.Errorf("session service unavailable")
	}
	sess, err := c.sessions.Get(projectID, sessionID)
	if err != nil {
		return StreamHandle{}, err
	}
	baseURL, err := c.resolveBaseURL(sess.ProfileID)
	if err != nil {
		return StreamHandle{}, err
	}
	if len(attachments) > 0 && !c.profileSupportsVision(sess.ProfileID) {
		return StreamHandle{}, fmt.Errorf("profile %q does not support image inputs", sess.ProfileID)
	}
	if err := c.sessions.AppendMessage(projectID, sessionID, SessionMessage{
		Role:        "user",
		Content:     userText,
		Attachments: attachments,
	}); err != nil {
		return StreamHandle{}, fmt.Errorf("persist user msg: %w", err)
	}
	history, err := c.sessions.LoadMessages(projectID, sessionID)
	if err != nil {
		return StreamHandle{}, fmt.Errorf("load history: %w", err)
	}
	msgs := make([]ChatMessage, 0, len(history))
	for _, m := range history {
		if m.Role == "user" || m.Role == "assistant" || m.Role == "system" {
			msgs = append(msgs, ChatMessage{
				Role:        m.Role,
				Content:     m.Content,
				Attachments: m.Attachments,
			})
		}
	}

	streamID := uuid.NewString()
	streamCtx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.cancels[streamID] = cancel
	c.mu.Unlock()

	// Decide path: if the session's mode has tools enabled and the
	// agent-loop deps are wired, run the tool-using loop. Otherwise
	// fall back to the plain SSE stream. The profile's ToolMode picks
	// the wire protocol (native function calling vs ReAct text).
	useAgent := false
	var resolved Mode
	if c.modes != nil && c.tools != nil && c.agentX != nil {
		resolved = c.modes.Resolve(projectID, sess.ModeID)
		if len(resolved.ToolWhitelist) != 0 || resolved.ToolWhitelist == nil {
			useAgent = true
		}
	}
	// Profile ToolMode of "none" overrides the mode and forces plain chat.
	wireMode := "native"
	if c.pm != nil {
		if p, gErr := c.pm.Get(sess.ProfileID); gErr == nil {
			switch strings.ToLower(strings.TrimSpace(p.ToolMode)) {
			case "react":
				wireMode = "react"
			case "none":
				useAgent = false
			case "", "native":
				wireMode = "native"
			}
		}
	}

	go func() {
		var (
			fullContent string
			toolCalls   []ToolCallRecord
			err         error
		)
		// finalize MUST fire so the frontend's chat:done / chat:error
		// listener clears the streaming flag. defer + closure-capture
		// of the latest err/fullContent means a panic, an early
		// return, or any unexpected exit still releases the UI.
		defer func() {
			if r := recover(); r != nil {
				if err == nil {
					err = fmt.Errorf("internal panic: %v", r)
				}
				if c.ctx != nil {
					wruntime.LogErrorf(c.ctx, "chat goroutine panic: %v", r)
				}
			}
			c.finalize(streamID, fullContent, err)
		}()
		if useAgent {
			ac := c.agentX(projectID)
			ac.ProjectID = projectID
			ac.Mode = resolved
			ac.Params = sess.Params
			// Carry the active chat profile's family hint so
			// ModeService.ResolveSystemPrompt can pick a family-specific
			// `<id>.<family>.system.md` variant when the author shipped
			// one. Unknown profile (e.g. project-unbound session) leaves
			// the hint blank — resolver falls back to the default file.
			if c.pm != nil {
				if p, gErr := c.pm.Get(sess.ProfileID); gErr == nil {
					ac.FamilyID = p.Family
					ac.FamilyVersion = p.FamilyVersion
				}
			}
			// Pre-loop git snapshot for `approval = "snapshot"` modes.
			// Failures are non-fatal — we still let the loop run, but
			// emit an event so the UI can warn the user that revert
			// won't be possible.
			if resolved.Approval == ApprovalSnapshot && c.snapshots != nil {
				snap, sErr := c.snapshots.Take(streamCtx, projectID, resolved.ID, streamID)
				if sErr != nil {
					if c.ctx != nil {
						wruntime.EventsEmit(c.ctx, "agent:snapshot:failed:"+streamID, sErr.Error())
					}
				} else if c.ctx != nil {
					wruntime.EventsEmit(c.ctx, "agent:snapshot:taken:"+streamID, snap)
					wruntime.EventsEmit(c.ctx, "agent:snapshot:taken", snap)
				}
			}
			var res AgentLoopResult
			var e error
			if wireMode == "react" {
				res, e = c.streamWithReAct(streamCtx, streamID, baseURL, msgs, resolved, c.tools, ac, debug)
			} else {
				res, e = c.streamWithTools(streamCtx, streamID, baseURL, msgs, resolved, c.tools, ac, debug)
			}
			fullContent = res.FinalContent
			toolCalls = res.ToolCalls
			err = e
		} else {
			fullContent, err = c.runStream(streamCtx, streamID, baseURL, projectID, msgs, temperature, debug)
		}
		// User-initiated cancel = clean stop. Persist whatever the
		// model produced so far, and emit chat:done (not chat:error)
		// so the frontend keeps the partial bubble visible.
		if err != nil && errors.Is(err, context.Canceled) {
			err = nil
		}
		// Persist even when the final iteration emitted no text — tool
		// calls alone are still real work the user wants to see on reload
		// (e.g. gemma4 sometimes runs two tools then stops with an empty
		// closing turn; without this guard the whole bubble disappears
		// after hydrate from JSONL).
		if err == nil && (fullContent != "" || len(toolCalls) > 0) {
			msg := SessionMessage{
				Role:      "assistant",
				Content:   fullContent,
				ProfileID: sess.ProfileID,
				Timestamp: time.Now().UTC(),
			}
			if len(toolCalls) > 0 {
				if encoded, mErr := json.Marshal(toolCalls); mErr == nil {
					msg.ToolCalls = encoded
				}
			}
			persistErr := c.sessions.AppendMessage(projectID, sessionID, msg)
			if persistErr != nil {
				wruntime.LogErrorf(c.ctx, "persist assistant msg: %v", persistErr)
			}
		}
		// finalize is invoked by the defer above so we don't double-emit.
	}()
	return StreamHandle{StreamID: streamID}, nil
}

// complete is the one-shot non-streaming wrapper used by the M4
// scripting layer (`app.chat.complete`). Returns the full assistant
// content as one string. Reuses the SSE drain but accumulates without
// emitting deltas to the frontend, so the JS caller blocks until the
// reply lands.
func (c *ChatService) complete(profileID string, messages []ChatMessage, temperature float64) (string, error) {
	baseURL, err := c.resolveBaseURL(profileID)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	streamID := uuid.NewString() // unused over the wire; just a unique marker
	c.mu.Lock()
	c.cancels[streamID] = cancel
	c.mu.Unlock()
	return c.runStream(ctx, streamID, baseURL, "", messages, temperature, false)
}

func (c *ChatService) CancelStream(streamID string) {
	c.mu.Lock()
	cancel, ok := c.cancels[streamID]
	delete(c.cancels, streamID)
	c.mu.Unlock()
	if ok {
		cancel()
	}
}

// runStream POSTs to the OpenAI-compat completions endpoint and pushes
// each delta to the frontend as `chat:delta:<id>`. Returns the full
// accumulated content and any terminal error. Does NOT emit chat:done /
// chat:error itself; finalize() handles that.
func (c *ChatService) runStream(ctx context.Context, streamID, baseURL, projectID string, messages []ChatMessage, temperature float64, debug bool) (string, error) {
	defer func() {
		c.mu.Lock()
		delete(c.cancels, streamID)
		c.mu.Unlock()
	}()

	apiMsgs, err := c.toAPIMessages(projectID, messages)
	if err != nil {
		return "", err
	}
	body := map[string]any{
		"messages":          apiMsgs,
		"stream":            true,
		"timings_per_token": true,
	}
	if temperature > 0 {
		body["temperature"] = temperature
	}
	buf, _ := json.Marshal(body)

	if debug {
		c.emitDebugRequest(streamID, 0, baseURL, body)
	}

	url := baseURL + "/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("http %d: %s", resp.StatusCode, string(b))
	}
	full, pErr := c.parseSSE(streamID, resp.Body, debug, 0)
	if debug {
		c.emitDebugRaw(streamID, 0, full, "", nil)
	}
	return full, pErr
}

// parseSSE drains the SSE stream, emitting deltas, and returns the full
// accumulated text on a clean finish. When debug is on, periodically
// emits chat:debug:raw with the accumulated content so the panel updates
// live while the model is still thinking.
func (c *ChatService) parseSSE(streamID string, body io.Reader, debug bool, iter int) (string, error) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 128*1024), 4*1024*1024)
	var full strings.Builder
	lastDebugEmit := time.Now()

	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" {
			continue
		}
		if payload == "[DONE]" {
			return full.String(), nil
		}

		var ev struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Timings *ChatStats `json:"timings"`
		}
		if err := json.Unmarshal([]byte(payload), &ev); err != nil {
			continue
		}
		if ev.Timings != nil && reliableTimings(ev.Timings) {
			c.emit("chat:stats:"+streamID, ev.Timings)
		}
		for _, ch := range ev.Choices {
			if ch.Delta.Content != "" {
				full.WriteString(ch.Delta.Content)
				c.emit("chat:delta:"+streamID, ch.Delta.Content)
				if debug && time.Since(lastDebugEmit) >= 150*time.Millisecond {
					c.emitDebugRaw(streamID, iter, full.String(), "", nil)
					lastDebugEmit = time.Now()
				}
			}
			if ch.FinishReason != nil {
				return full.String(), nil
			}
		}
	}
	if err := sc.Err(); err != nil {
		return full.String(), err
	}
	return full.String(), nil
}

// DebugRequest is the payload sent to the frontend for `chat:debug:request:<id>`
// when debug mode is on. Captures the exact body shipped to llama-server so
// the user can inspect templating, tool schemas, and ordering.
type DebugRequest struct {
	Iteration int            `json:"iteration"`
	BaseURL   string         `json:"baseURL"`
	Body      map[string]any `json:"body"`
}

// DebugRaw mirrors the model's raw response before any frontend
// post-processing (splitThinking / markdown / sanitize). For the
// native-tools wire mode, ToolCalls carries the parsed structured calls
// since they don't appear in Content.
type DebugRaw struct {
	Iteration    int                 `json:"iteration"`
	Content      string              `json:"content"`
	FinishReason string              `json:"finishReason,omitempty"`
	ToolCalls    []map[string]string `json:"toolCalls,omitempty"`
}

func (c *ChatService) emitDebugRequest(streamID string, iter int, baseURL string, body map[string]any) {
	c.emit("chat:debug:request:"+streamID, DebugRequest{
		Iteration: iter,
		BaseURL:   baseURL,
		Body:      body,
	})
}

func (c *ChatService) emitDebugRaw(streamID string, iter int, content, finish string, toolCalls []map[string]string) {
	c.emit("chat:debug:raw:"+streamID, DebugRaw{
		Iteration:    iter,
		Content:      content,
		FinishReason: finish,
		ToolCalls:    toolCalls,
	})
}

// finalize emits the terminal event for the stream.
func (c *ChatService) finalize(streamID, full string, err error) {
	if err != nil {
		c.emit("chat:error:"+streamID, err.Error())
		return
	}
	c.emit("chat:done:"+streamID, full)
}

func (c *ChatService) emit(event string, payload any) {
	if c.ctx != nil {
		wruntime.EventsEmit(c.ctx, event, payload)
	}
}
