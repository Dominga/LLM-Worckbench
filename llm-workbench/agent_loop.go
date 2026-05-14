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
	"regexp"
	"strings"
	"time"

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
	sysPrompt := resolveSystemPromptFor(c, ac, mode)
	if strings.TrimSpace(sysPrompt) != "" {
		convo = append(convo, map[string]any{
			"role":    "system",
			"content": sysPrompt,
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
			"messages":          convo,
			"stream":            true,
			"tools":             tools,
			"tool_choice":       "auto",
			"timings_per_token": true,
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
		// Append partial content BEFORE error short-circuit so a mid-stream
		// cancel still carries the tokens the user already saw.
		if content != "" {
			out.FinalContent += content
		}
		if err != nil {
			return out, err
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
			rawArgs := json.RawMessage(tc.Function.Arguments)
			rec := ToolCallRecord{Name: tc.Function.Name, Args: rawArgs}
			if c.ctx != nil {
				wruntime.EventsEmit(c.ctx, "agent:tool:request:"+streamID, map[string]any{
					"name": tc.Function.Name,
					"args": tc.Function.Arguments,
				})
			}
			var result any
			var runErr error
			if appErr := c.requestApprovalIfWrite(ctx, streamID, mode, ac, tc.Function.Name, rawArgs); appErr != nil {
				runErr = appErr
			} else {
				result, runErr = registry.Invoke(ctx, ac, tc.Function.Name, rawArgs)
			}
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

// ─────────────────────────── ReAct fallback ──────────────────────────

// reactActionRe matches ` Action: <name>` followed (eventually) by
// ` Args: <json>` on the next non-blank line(s). Tool names are
// snake_case. Args may span multiple lines.
//
// Example expected emit:
//
//	I should look up the file first.
//	Action: read_file
//	Args: {"path": "README.md"}
//
// We deliberately keep the surface minimal — the prompt explains the
// exact format the model should produce.
var (
	reactActionRe = regexp.MustCompile(`(?m)^Action:\s*([a-z_][a-z0-9_]*)\s*$`)
	reactArgsRe   = regexp.MustCompile(`(?m)^Args:\s*(\{.*\})\s*$`)
	reactFinalRe  = regexp.MustCompile(`(?m)^Final Answer:\s*(.*)$`)
)

// buildReActPrompt renders the system prompt for a ReAct-mode loop.
// Lists allowed tools as a JSON-Schema block plus the strict
// Action/Args/Observation format the parser understands.
func buildReActPrompt(modePrompt string, tools []Tool) string {
	var b strings.Builder
	if strings.TrimSpace(modePrompt) != "" {
		b.WriteString(modePrompt)
		b.WriteString("\n\n")
	}
	b.WriteString("You have access to the following tools. To call one, write exactly:\n\n")
	b.WriteString("Action: <tool_name>\n")
	b.WriteString("Args: <single-line JSON object>\n\n")
	b.WriteString("Then STOP and wait. The system will run the tool and reply with:\n\n")
	b.WriteString("Observation: <result>\n\n")
	b.WriteString("Repeat the Action/Args/Observation cycle as needed. When you have the final reply for the user, write:\n\n")
	b.WriteString("Final Answer: <your reply>\n\n")
	b.WriteString("Tools:\n")
	for _, t := range tools {
		schema, _ := json.Marshal(t.InputSchema())
		fmt.Fprintf(&b, "- %s: %s\n  args schema: %s\n", t.Name(), t.Description(), string(schema))
	}
	return b.String()
}

// streamWithReAct is the text-prompting equivalent of streamWithTools.
// llama-server is asked to produce a normal completion (no tools[]
// param); the loop scans the streamed text for `Action:` / `Args:`
// blocks, runs the corresponding tool, appends an `Observation: …`
// turn to the convo, and re-streams. Stops on `Final Answer:` or
// when the model produces a turn without an Action.
func (c *ChatService) streamWithReAct(
	ctx context.Context,
	streamID string,
	baseURL string,
	messages []ChatMessage,
	mode Mode,
	registry *ToolRegistry,
	ac *AgentContext,
) (AgentLoopResult, error) {
	tools := registry.Filter(mode.ToolWhitelist)
	out := AgentLoopResult{}

	convo := []map[string]any{
		{"role": "system", "content": buildReActPrompt(resolveSystemPromptFor(c, ac, mode), tools)},
	}
	for _, m := range messages {
		convo = append(convo, map[string]any{"role": m.Role, "content": m.Content})
	}

	for iter := 0; iter < maxAgentIterations; iter++ {
		out.Iterations = iter + 1
		body := map[string]any{
			"messages":          convo,
			"stream":            true,
			"timings_per_token": true,
			// Stop sequences keep the model from continuing past Args:
			// into a hallucinated Observation. Some servers ignore stop
			// outright, so we also detect Action+Args after the fact.
			"stop": []string{"\nObservation:"},
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
		// Reuse the plain SSE drain — ReAct runs without tools[].
		full, sErr := c.parseSSE(streamID, resp.Body)
		resp.Body.Close()
		// Append partial content BEFORE error short-circuit so a mid-stream
		// cancel still carries the tokens the user already saw.
		out.FinalContent += full
		if sErr != nil {
			return out, sErr
		}

		// Final Answer line wins.
		if m := reactFinalRe.FindStringSubmatch(full); m != nil {
			return out, nil
		}

		// Look for an Action+Args pair. Use the LAST one in case the
		// model thought aloud and mentioned other actions earlier.
		actionMatches := reactActionRe.FindAllStringSubmatch(full, -1)
		argsMatches := reactArgsRe.FindAllStringSubmatch(full, -1)
		if len(actionMatches) == 0 || len(argsMatches) == 0 {
			// No tool call → treat the whole text as the final answer.
			return out, nil
		}
		name := actionMatches[len(actionMatches)-1][1]
		argsRaw := argsMatches[len(argsMatches)-1][1]

		rawArgs := json.RawMessage(argsRaw)
		rec := ToolCallRecord{
			Name: name,
			Args: rawArgs,
		}
		if c.ctx != nil {
			wruntime.EventsEmit(c.ctx, "agent:tool:request:"+streamID, map[string]any{
				"name": name,
				"args": argsRaw,
			})
		}
		var result any
		var runErr error
		if appErr := c.requestApprovalIfWrite(ctx, streamID, mode, ac, name, rawArgs); appErr != nil {
			runErr = appErr
		} else {
			result, runErr = registry.Invoke(ctx, ac, name, rawArgs)
		}
		if runErr != nil {
			rec.Error = runErr.Error()
		} else {
			rec.Result = result
		}
		out.ToolCalls = append(out.ToolCalls, rec)
		if c.ctx != nil {
			wruntime.EventsEmit(c.ctx, "agent:tool:result:"+streamID, map[string]any{
				"name":   name,
				"error":  rec.Error,
				"result": rec.Result,
			})
		}

		// Append the assistant turn (whatever the model said, including
		// the Action/Args lines) so the model sees its own request, then
		// add the Observation as a `user` turn — most non-OpenAI
		// servers don't support a `tool` role in plain chat templates.
		convo = append(convo, map[string]any{"role": "assistant", "content": full})
		var obs string
		if runErr != nil {
			obs = fmt.Sprintf("Observation: error: %v", runErr)
		} else {
			resJSON, _ := json.Marshal(result)
			obs = "Observation: " + string(resJSON)
		}
		convo = append(convo, map[string]any{"role": "user", "content": obs})
	}
	return out, fmt.Errorf("react loop hit %d-iteration cap without Final Answer", maxAgentIterations)
}

// resolveSystemPromptFor renders the mode's system prompt with
// template + placeholder substitution when ModeService is wired;
// otherwise falls back to the inline SystemPrompt verbatim. Errors
// from template loading degrade gracefully — the inline string (if
// any) still gets used.
func resolveSystemPromptFor(c *ChatService, ac *AgentContext, mode Mode) string {
	if c != nil && c.modes != nil {
		projectID := ""
		var params map[string]any
		family := ""
		familyVersion := ""
		if ac != nil {
			projectID = ac.ProjectID
			params = ac.Params
			family = ac.FamilyID
			familyVersion = ac.FamilyVersion
		}
		if prompt, err := c.modes.ResolveSystemPrompt(projectID, mode, family, familyVersion, params); err == nil {
			return prompt
		}
	}
	return mode.SystemPrompt
}

// requestApprovalIfWrite checks the active mode's policy and, when
// `always`, blocks until the user accepts or rejects the call via the
// UI. Returns nil (proceed), a reject reason, or an error if the
// approval channel was cancelled.
//
// `auto` is rejected at validate-time when combined with a write tool;
// `snapshot` proceeds without UI gate (PR20 owns the git-snapshot
// side). `always` opens an ApprovalRequest and waits.
func (c *ChatService) requestApprovalIfWrite(
	ctx context.Context,
	streamID string,
	mode Mode,
	ac *AgentContext,
	toolName string,
	rawArgs json.RawMessage,
) error {
	if !IsWriteTool(toolName) {
		return nil
	}
	if mode.Approval != ApprovalAlways {
		return nil
	}
	if c.approvals == nil {
		// No manager wired → fail closed: better to reject than
		// silently let writes through under approval=always.
		return errors.New("approval manager not wired")
	}
	id, ch := c.approvals.Open()
	req := ApprovalRequest{
		ID:        id,
		StreamID:  streamID,
		Tool:      toolName,
		Args:      rawArgs,
		CreatedAt: time.Now().UTC(),
	}
	// edit_file convenience: pre-fill Path, OldContent, NewContent so
	// the UI doesn't need a second roundtrip to render the diff.
	if toolName == "edit_file" && ac != nil && ac.Files != nil {
		var args struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if uErr := json.Unmarshal(rawArgs, &args); uErr == nil {
			req.Path = args.Path
			req.NewContent = args.Content
			if fc, rErr := ac.Files.ReadFile(ac.ProjectID, args.Path); rErr == nil {
				req.OldContent = fc.Content
			}
		}
	}
	// make_directory: only the path is meaningful — UI shows "create
	// directory: <path>" without a diff body.
	if toolName == "make_directory" {
		var args struct {
			Path string `json:"path"`
		}
		if uErr := json.Unmarshal(rawArgs, &args); uErr == nil {
			req.Path = args.Path
		}
	}
	// append_memory: prefill Path = "memory.md (<scope>)" and NewContent
	// with the entry body so the existing diff-style modal can render
	// the new note without a second roundtrip.
	if toolName == "append_memory" {
		var args struct {
			Scope string `json:"scope"`
			Entry string `json:"entry"`
		}
		if uErr := json.Unmarshal(rawArgs, &args); uErr == nil {
			req.Path = "memory.md (" + args.Scope + ")"
			req.NewContent = args.Entry
		}
	}
	if c.ctx != nil {
		// Per-stream channel for callers that already filter by streamId.
		wruntime.EventsEmit(c.ctx, "agent:approval:request:"+streamID, req)
		// Global channel so a single top-level Modal subscription works
		// without re-binding on every new stream.
		wruntime.EventsEmit(c.ctx, "agent:approval:request", req)
	}

	select {
	case <-ctx.Done():
		c.approvals.Cancel(id)
		return ctx.Err()
	case dec, ok := <-ch:
		if !ok {
			return errors.New("approval cancelled")
		}
		if !dec.Accept {
			reason := dec.Reason
			if reason == "" {
				reason = "user rejected the change"
			}
			return fmt.Errorf("approval rejected: %s", reason)
		}
		return nil
	}
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
