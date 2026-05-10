package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
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
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatService struct {
	registry *ServerRegistry
	pm       *ProfileManager
	sessions *SessionService
	ctx      context.Context

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewChatService(registry *ServerRegistry, pm *ProfileManager, sessions *SessionService) *ChatService {
	return &ChatService{
		registry: registry,
		pm:       pm,
		sessions: sessions,
		cancels:  make(map[string]context.CancelFunc),
	}
}

func (c *ChatService) Attach(ctx context.Context) {
	c.ctx = ctx
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
func (c *ChatService) StartStream(profileID string, messages []ChatMessage, temperature float64) (StreamHandle, error) {
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
		full, err := c.runStream(streamCtx, streamID, baseURL, messages, temperature)
		c.finalize(streamID, full, err)
	}()
	return StreamHandle{StreamID: streamID}, nil
}

// StartSessionStream is the session-bound variant: it appends the user
// message to the session's JSONL, streams a reply, and persists the
// assistant response on completion. Mode and profile come from the
// session header.
func (c *ChatService) StartSessionStream(projectID, sessionID, userText string, temperature float64) (StreamHandle, error) {
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
	if err := c.sessions.AppendMessage(projectID, sessionID, SessionMessage{
		Role:    "user",
		Content: userText,
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
			msgs = append(msgs, ChatMessage{Role: m.Role, Content: m.Content})
		}
	}

	streamID := uuid.NewString()
	streamCtx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.cancels[streamID] = cancel
	c.mu.Unlock()

	go func() {
		full, err := c.runStream(streamCtx, streamID, baseURL, msgs, temperature)
		if err == nil && full != "" {
			persistErr := c.sessions.AppendMessage(projectID, sessionID, SessionMessage{
				Role:      "assistant",
				Content:   full,
				ProfileID: sess.ProfileID,
				Timestamp: time.Now().UTC(),
			})
			if persistErr != nil {
				wruntime.LogErrorf(c.ctx, "persist assistant msg: %v", persistErr)
			}
		}
		c.finalize(streamID, full, err)
	}()
	return StreamHandle{StreamID: streamID}, nil
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
func (c *ChatService) runStream(ctx context.Context, streamID, baseURL string, messages []ChatMessage, temperature float64) (string, error) {
	defer func() {
		c.mu.Lock()
		delete(c.cancels, streamID)
		c.mu.Unlock()
	}()

	body := map[string]any{
		"messages": messages,
		"stream":   true,
	}
	if temperature > 0 {
		body["temperature"] = temperature
	}
	buf, _ := json.Marshal(body)

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
	return c.parseSSE(streamID, resp.Body)
}

// parseSSE drains the SSE stream, emitting deltas, and returns the full
// accumulated text on a clean finish.
func (c *ChatService) parseSSE(streamID string, body io.Reader) (string, error) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 128*1024), 4*1024*1024)
	var full strings.Builder

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
		}
		if err := json.Unmarshal([]byte(payload), &ev); err != nil {
			continue
		}
		for _, ch := range ev.Choices {
			if ch.Delta.Content != "" {
				full.WriteString(ch.Delta.Content)
				c.emit("chat:delta:"+streamID, ch.Delta.Content)
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
