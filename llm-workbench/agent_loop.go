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

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// maxAgentIterations bounds the tool-call loop so a misbehaving model
// can't spin forever. Eight is enough for most real "search → read →
// edit" workflows; raise via a Mode field later if needed.
const maxAgentIterations = 8

// openAITool mirrors the OpenAI-compatible `tools[]` element shape.
// llama-server (mainline + ik_llama.cpp with --jinja) accepts this
// directly when the model's chat template supports tool calls.
type openAITool struct {
	Type     string         `json:"type"`
	Function openAIFunction `json:"function"`
}

type openAIFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// openAIToolCall is the function-call slot the model emits in a
// streaming chunk's `delta.tool_calls[]` (or in the final
// `message.tool_calls[]`).
type openAIToolCall struct {
	Index    int    `json:"index"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// AgentLoopResult is the terminal summary handed back to the caller
// after the agent finishes (or aborts).
type AgentLoopResult struct {
	FinalContent string
	Iterations   int
	ToolCalls    []ToolCallRecord
}

// ToolCallRecord captures one tool invocation for persistence and UI
// attribution. Args are kept as raw JSON so the source-attribution UI
// (PR21) can show the exact payload the model produced.
type ToolCallRecord struct {
	Name   string          `json:"name"`
	Args   json.RawMessage `json:"args"`
	Result any             `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// streamWithTools runs the multi-turn agent loop.
//
// Each iteration:
//  1. POST `/v1/chat/completions` with `tools=<schema>` and the running
//     conversation. Stream deltas to the frontend (`chat:delta:<id>`)
//     for any `delta.content`; accumulate `delta.tool_calls[]` until
//     finish_reason is set.
//  2. If finish_reason == "tool_calls": dispatch each call through the
//     ToolRegistry, append the assistant tool_call message + the tool
//     result message, restart the stream.
//  3. If finish_reason == "stop" (or "length"): return the
//     accumulated content.
//
// Errors from individual tool calls are converted to `tool` messages
// containing the error text — the model then has a chance to recover
// in the next turn.
func (c *ChatService) streamWithTools(
	ctx context.Context,
	streamID string,
	baseURL string,
	messages []ChatMessage,
	mode Mode,
	registry *ToolRegistry,
	ac *AgentContext,
) (AgentLoopResult, error) {
	tools := buildToolSchemas(registry, mode.ToolWhitelist)

	out := AgentLoopResult{}
	convo := make([]map[string]any, 0, len(messages)+8)

	// Inject system prompt at the head when the mode supplies one.
	// Builtin modes (`research`, `agent`, `auto-edit`) all do; project
	// overrides may not, in which case we just send the user/assistant
	// history as-is.
	if strings.TrimSpace(mode.SystemPrompt) != "" {
		convo = append(convo, map[string]any{
			"role":    "system",
			"content": mode.SystemPrompt,
		})
	}
	for _, m := range messages {
		convo = append(convo, map[string]any{
			"role":    m.Role,
			"content": m.Content,
		})
	}

	for iter := 0; iter < maxAgentIterations; iter++ {
		out.Iterations = iter + 1
		body := map[string]any{
			"messages":    convo,
			"stream":      true,
			"tools":       tools,
			"tool_choice": "auto",
		}
		buf, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(ctx, "POST",
			baseURL+"/v1/chat/completions", bytes.NewReader(buf))
		if err != nil {
			return out, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return out, err
		}

		if resp.StatusCode != 200 {
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return out, fmt.Errorf("http %d: %s", resp.StatusCode, string(b))
		}

		content, calls, finish, err := c.parseToolStream(streamID, resp.Body)
		resp.Body.Close()
		if err != nil {
			return out, err
		}

		if content != "" {
			out.FinalContent += content
		}

		// No tool call → model produced a final answer. Done.
		if len(calls) == 0 || finish != "tool_calls" {
			return out, nil
		}

		// Append the assistant turn carrying the tool_calls to convo so
		// the next request includes the model's request side of the
		// transaction. OpenAI requires `tool_call_id` on `tool` role
		// messages to match the call's id.
		assistantTurn := map[string]any{
			"role":       "assistant",
			"content":    content,
			"tool_calls": serializeToolCallsForRequest(calls),
		}
		convo = append(convo, assistantTurn)

		// Dispatch each tool call and append a `tool` message with the
		// JSON-encoded result.
		for _, tc := range calls {
			rec := ToolCallRecord{Name: tc.Function.Name, Args: json.RawMessage(tc.Function.Arguments)}
			if c.ctx != nil {
				wruntime.EventsEmit(c.ctx, "agent:tool:request:"+streamID, map[string]any{
					"name": tc.Function.Name,
					"args": tc.Function.Arguments,
				})
			}
			result, runErr := registry.Invoke(ctx, ac, tc.Function.Name, json.RawMessage(tc.Function.Arguments))
			if runErr != nil {
				rec.Error = runErr.Error()
			} else {
				rec.Result = result
			}
			out.ToolCalls = append(out.ToolCalls, rec)

			toolMsg := map[string]any{
				"role":         "tool",
				"tool_call_id": tc.ID,
				"name":         tc.Function.Name,
			}
			if runErr != nil {
				toolMsg["content"] = fmt.Sprintf("error: %v", runErr)
			} else {
				resultJSON, mErr := json.Marshal(result)
				if mErr != nil {
					toolMsg["content"] = fmt.Sprintf("(could not serialise result: %v)", mErr)
				} else {
					toolMsg["content"] = string(resultJSON)
				}
			}
			convo = append(convo, toolMsg)
			if c.ctx != nil {
				wruntime.EventsEmit(c.ctx, "agent:tool:result:"+streamID, map[string]any{
					"name":   tc.Function.Name,
					"error":  rec.Error,
					"result": rec.Result,
				})
			}
		}
	}
	return out, fmt.Errorf("agent loop hit %d-iteration cap without final answer", maxAgentIterations)
}

// buildToolSchemas converts ToolRegistry entries into the
// `tools[]` array shape llama-server expects.
func buildToolSchemas(reg *ToolRegistry, whitelist []string) []openAITool {
	tools := reg.Filter(whitelist)
	out := make([]openAITool, 0, len(tools))
	for _, t := range tools {
		out = append(out, openAITool{
			Type: "function",
			Function: openAIFunction{
				Name:        t.Name(),
				Description: t.Description(),
				Parameters:  t.InputSchema(),
			},
		})
	}
	return out
}

// serializeToolCallsForRequest reshapes accumulated tool calls into the
// JSON form the OpenAI API expects on the next request's assistant
// message. Notably, `arguments` is always a string at request time
// (not a parsed object) — that's the spec.
func serializeToolCallsForRequest(calls []openAIToolCall) []map[string]any {
	out := make([]map[string]any, 0, len(calls))
	for _, c := range calls {
		out = append(out, map[string]any{
			"id":   c.ID,
			"type": "function",
			"function": map[string]any{
				"name":      c.Function.Name,
				"arguments": c.Function.Arguments,
			},
		})
	}
	return out
}

// parseToolStream is the SSE drain for a tool-aware stream. It is a
// superset of parseSSE: in addition to streaming text content as
// `chat:delta:<id>` events, it accumulates tool_call deltas (which the
// OpenAI streaming spec splits across many chunks — name+id arrive on
// the first chunk, arguments stream as a string fragment-by-fragment).
//
// Returns:
//
//	content      — concatenated `delta.content`
//	calls        — fully-assembled tool calls (empty when none)
//	finishReason — "stop" | "tool_calls" | "length" | ""
func (c *ChatService) parseToolStream(streamID string, body io.Reader) (string, []openAIToolCall, string, error) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 128*1024), 4*1024*1024)
	var contentBuf strings.Builder

	// Index → partial tool call, since the model streams them in pieces.
	partial := map[int]*openAIToolCall{}
	finish := ""

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
			break
		}

		var ev struct {
			Choices []struct {
				Delta struct {
					Content   string           `json:"content"`
					ToolCalls []openAIToolCall `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &ev); err != nil {
			continue
		}
		for _, ch := range ev.Choices {
			if ch.Delta.Content != "" {
				contentBuf.WriteString(ch.Delta.Content)
				c.emit("chat:delta:"+streamID, ch.Delta.Content)
			}
			for _, tc := range ch.Delta.ToolCalls {
				cur, ok := partial[tc.Index]
				if !ok {
					cp := tc
					partial[tc.Index] = &cp
					continue
				}
				if tc.ID != "" {
					cur.ID = tc.ID
				}
				if tc.Type != "" {
					cur.Type = tc.Type
				}
				if tc.Function.Name != "" {
					cur.Function.Name = tc.Function.Name
				}
				cur.Function.Arguments += tc.Function.Arguments
			}
			if ch.FinishReason != nil {
				finish = *ch.FinishReason
			}
		}
	}
	if err := sc.Err(); err != nil {
		return contentBuf.String(), nil, finish, err
	}

	// Sort accumulated tool calls by index so dispatch order is
	// deterministic (the model expects them in original index order).
	calls := make([]openAIToolCall, 0, len(partial))
	if len(partial) > 0 {
		// Find max index, walk 0..max.
		max := 0
		for k := range partial {
			if k > max {
				max = k
			}
		}
		for i := 0; i <= max; i++ {
			if v, ok := partial[i]; ok {
				calls = append(calls, *v)
			}
		}
	}
	return contentBuf.String(), calls, finish, nil
}
