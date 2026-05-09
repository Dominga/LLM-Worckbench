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

	"github.com/google/uuid"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatService struct {
	cfg *Config
	ctx context.Context

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewChatService(cfg *Config) *ChatService {
	return &ChatService{cfg: cfg, cancels: make(map[string]context.CancelFunc)}
}

func (c *ChatService) Attach(ctx context.Context) {
	c.ctx = ctx
}

// StreamID for client to subscribe to "chat:delta:<id>", "chat:done:<id>", "chat:error:<id>".
type StreamHandle struct {
	StreamID string `json:"streamId"`
}

func (c *ChatService) StartStream(messages []ChatMessage, temperature float64) (StreamHandle, error) {
	streamID := uuid.NewString()
	streamCtx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.cancels[streamID] = cancel
	c.mu.Unlock()

	go c.run(streamCtx, streamID, messages, temperature)
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

func (c *ChatService) run(ctx context.Context, streamID string, messages []ChatMessage, temperature float64) {
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

	url := c.cfg.BaseURL() + "/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(buf))
	if err != nil {
		c.emitError(streamID, err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.emitError(streamID, err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		c.emitError(streamID, fmt.Sprintf("http %d: %s", resp.StatusCode, string(b)))
		return
	}

	c.parseSSE(streamID, resp.Body)
}

func (c *ChatService) parseSSE(streamID string, body io.Reader) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 128*1024), 4*1024*1024)
	var full strings.Builder

	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			if payload == "[DONE]" {
				c.emit("chat:done:"+streamID, full.String())
				return
			}
			continue
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
				c.emit("chat:done:"+streamID, full.String())
				return
			}
		}
	}
	if err := sc.Err(); err != nil {
		c.emitError(streamID, err.Error())
		return
	}
	c.emit("chat:done:"+streamID, full.String())
}

func (c *ChatService) emit(event string, payload any) {
	if c.ctx != nil {
		wruntime.EventsEmit(c.ctx, event, payload)
	}
}

func (c *ChatService) emitError(streamID, msg string) {
	c.emit("chat:error:"+streamID, msg)
}
