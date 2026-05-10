package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestParseToolStreamAccumulatesFragmentedArguments(t *testing.T) {
	// Two SSE chunks for the same tool call: name + id arrive on the
	// first, the JSON arguments stream as fragments. parseToolStream
	// must concatenate them into one coherent call.
	sse := strings.Join([]string{
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":""}}]}}]}`,
		``,
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":\""}}]}}]}`,
		``,
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"foo.md\"}"}}]}}]}`,
		``,
		`data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")

	c := &ChatService{}
	content, calls, finish, err := c.parseToolStream("test", strings.NewReader(sse))
	if err != nil {
		t.Fatal(err)
	}
	if content != "" {
		t.Errorf("content = %q, want empty (no delta.content in stream)", content)
	}
	if finish != "tool_calls" {
		t.Errorf("finish = %q, want tool_calls", finish)
	}
	if len(calls) != 1 {
		t.Fatalf("calls len = %d, want 1", len(calls))
	}
	if calls[0].ID != "call_1" {
		t.Errorf("call id = %q, want call_1", calls[0].ID)
	}
	if calls[0].Function.Name != "read_file" {
		t.Errorf("call name = %q", calls[0].Function.Name)
	}
	if calls[0].Function.Arguments != `{"path":"foo.md"}` {
		t.Errorf("args = %q, want assembled object", calls[0].Function.Arguments)
	}
}

func TestParseToolStreamPlainContent(t *testing.T) {
	sse := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"hello "}}]}`,
		``,
		`data: {"choices":[{"delta":{"content":"world"}}]}`,
		``,
		`data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")

	c := &ChatService{}
	content, calls, finish, err := c.parseToolStream("test", strings.NewReader(sse))
	if err != nil {
		t.Fatal(err)
	}
	if content != "hello world" {
		t.Errorf("content = %q", content)
	}
	if len(calls) != 0 {
		t.Errorf("expected no tool calls")
	}
	if finish != "stop" {
		t.Errorf("finish = %q", finish)
	}
}

func TestBuildToolSchemasFiltersByWhitelist(t *testing.T) {
	reg := NewToolRegistry()
	RegisterBuiltinTools(reg)

	all := buildToolSchemas(reg, nil)
	if len(all) != 4 {
		t.Errorf("nil whitelist len = %d, want 4 builtins", len(all))
	}
	limited := buildToolSchemas(reg, []string{"read_file"})
	if len(limited) != 1 || limited[0].Function.Name != "read_file" {
		t.Errorf("whitelist filter wrong: %+v", limited)
	}
}

// fakeAgentServer returns a /v1/chat/completions handler that:
//   - On the first call streams a tool_call requesting `list_files`.
//   - On the second call streams a plain "final answer".
type fakeAgentServer struct {
	hits int32
}

func (f *fakeAgentServer) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		flusher, _ := w.(http.Flusher)
		n := atomic.AddInt32(&f.hits, 1)
		if n == 1 {
			fmt.Fprintln(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"list_files","arguments":"{}"}}]}}]}`)
			fmt.Fprintln(w)
			fmt.Fprintln(w, `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`)
			fmt.Fprintln(w)
			fmt.Fprintln(w, `data: [DONE]`)
			fmt.Fprintln(w)
			if flusher != nil {
				flusher.Flush()
			}
			return
		}
		fmt.Fprintln(w, `data: {"choices":[{"delta":{"content":"final answer"}}]}`)
		fmt.Fprintln(w)
		fmt.Fprintln(w, `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`)
		fmt.Fprintln(w)
		fmt.Fprintln(w, `data: [DONE]`)
		fmt.Fprintln(w)
		if flusher != nil {
			flusher.Flush()
		}
	}
}

// fakeListFilesTool returns a deterministic answer so
// streamWithTools can serialise a tool result without going near the
// real filesystem.
type fakeListFilesTool struct{}

func (fakeListFilesTool) Name() string                { return "list_files" }
func (fakeListFilesTool) Description() string         { return "stub" }
func (fakeListFilesTool) InputSchema() map[string]any { return map[string]any{"type": "object"} }
func (fakeListFilesTool) Execute(_ context.Context, _ *AgentContext, _ map[string]any) (any, error) {
	return map[string]any{"files": []string{"a.md", "b.md"}}, nil
}

func TestStreamWithToolsLoopsThroughToolThenFinalAnswer(t *testing.T) {
	fake := &fakeAgentServer{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Capture last request body so we can verify it includes the
		// previous turn's tool_calls + tool result on iteration 2.
		body, _ := readAllSafe(r.Body)
		// Pre-handler hits count: 0 on first request, 1 on second.
		// The first request must NOT yet contain a tool result.
		if atomic.LoadInt32(&fake.hits) == 0 && bytes.Contains(body, []byte("tool_call_id")) {
			t.Errorf("first request should not carry tool_call_id, got: %s", body)
		}
		fake.handler()(w, r)
	}))
	defer srv.Close()

	reg := NewToolRegistry()
	reg.Register(fakeListFilesTool{})

	chat := &ChatService{}
	mode := Mode{
		ID:            "agent",
		ToolWhitelist: []string{"list_files"},
		SystemPrompt:  "You are testing.",
	}
	res, err := chat.streamWithTools(
		context.Background(),
		"test-stream",
		srv.URL,
		[]ChatMessage{{Role: "user", Content: "list project files"}},
		mode,
		reg,
		&AgentContext{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.FinalContent, "final answer") {
		t.Errorf("FinalContent = %q, want 'final answer'", res.FinalContent)
	}
	if res.Iterations != 2 {
		t.Errorf("Iterations = %d, want 2", res.Iterations)
	}
	if len(res.ToolCalls) != 1 {
		t.Fatalf("ToolCalls len = %d, want 1", len(res.ToolCalls))
	}
	if res.ToolCalls[0].Name != "list_files" {
		t.Errorf("tool name = %q", res.ToolCalls[0].Name)
	}
	resJSON, _ := json.Marshal(res.ToolCalls[0].Result)
	if !strings.Contains(string(resJSON), "a.md") {
		t.Errorf("tool result missing expected payload: %s", resJSON)
	}
}

func readAllSafe(r interface {
	Read(p []byte) (n int, err error)
}) ([]byte, error) {
	buf := bytes.NewBuffer(nil)
	tmp := make([]byte, 4096)
	for {
		n, err := r.Read(tmp)
		if n > 0 {
			buf.Write(tmp[:n])
		}
		if err != nil {
			if err.Error() == "EOF" {
				return buf.Bytes(), nil
			}
			return buf.Bytes(), err
		}
	}
}
