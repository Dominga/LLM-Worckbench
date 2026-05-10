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

func TestBuildReActPromptListsTools(t *testing.T) {
	reg := NewToolRegistry()
	RegisterBuiltinTools(reg)
	tools := reg.Filter([]string{"read_file", "search_semantic"})
	got := buildReActPrompt("You are a helpful agent.", tools)

	for _, want := range []string{
		"You are a helpful agent.",
		"Action: <tool_name>",
		"Args: <single-line JSON object>",
		"Final Answer:",
		"read_file",
		"search_semantic",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("ReAct prompt missing %q\n%s", want, got)
		}
	}
	if strings.Contains(got, "edit_file") {
		t.Errorf("filter leaked edit_file into prompt:\n%s", got)
	}
}

func TestReActParserSkipsMidlineMentions(t *testing.T) {
	// Mid-line mentions of "Action:" must NOT match; only line-anchored
	// directives count. Picks the last line-anchored Action when many.
	full := `I'm thinking about this.
First I considered Action: list_files but rejected it.
Action: read_file
Args: {"path":"README.md"}
`
	actionMatches := reactActionRe.FindAllStringSubmatch(full, -1)
	if len(actionMatches) != 1 {
		t.Fatalf("expected 1 line-anchored Action, got %d", len(actionMatches))
	}
	if actionMatches[0][1] != "read_file" {
		t.Errorf("matched = %q, want read_file", actionMatches[0][1])
	}
	argsMatches := reactArgsRe.FindAllStringSubmatch(full, -1)
	if len(argsMatches) != 1 || !strings.Contains(argsMatches[0][1], "README.md") {
		t.Errorf("args mismatch: %+v", argsMatches)
	}
}

func TestReActParserPicksLastOfMany(t *testing.T) {
	full := `Action: list_files
Args: {}
Action: read_file
Args: {"path":"x.md"}
`
	actions := reactActionRe.FindAllStringSubmatch(full, -1)
	args := reactArgsRe.FindAllStringSubmatch(full, -1)
	if len(actions) != 2 || len(args) != 2 {
		t.Fatalf("got actions=%d args=%d", len(actions), len(args))
	}
	if actions[len(actions)-1][1] != "read_file" {
		t.Errorf("last action = %q, want read_file", actions[len(actions)-1][1])
	}
}

func TestReActParserFinalAnswerStops(t *testing.T) {
	full := "Final Answer: All done."
	if reactFinalRe.FindStringSubmatch(full) == nil {
		t.Fatal("Final Answer not detected")
	}
}

// fakeReactServer alternates: chunk-1 emits an Action+Args, chunk-2
// emits a Final Answer. Mirrors the streamWithTools mock but for the
// text-prompted protocol.
type fakeReactServer struct {
	hits int32
}

func (f *fakeReactServer) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		n := atomic.AddInt32(&f.hits, 1)
		stream := func(s string) {
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", s)
		}
		end := "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
		if n == 1 {
			stream("Looking it up.\n")
			stream("Action: list_files\n")
			stream("Args: {}\n")
			fmt.Fprint(w, end)
		} else {
			stream("Final Answer: I see two files.")
			fmt.Fprint(w, end)
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func TestStreamWithReActLoopsThroughActionThenFinalAnswer(t *testing.T) {
	fake := &fakeReactServer{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	reg := NewToolRegistry()
	reg.Register(fakeListFilesTool{})

	chat := &ChatService{}
	mode := Mode{
		ID:            "agent",
		ToolWhitelist: []string{"list_files"},
		SystemPrompt:  "You can use tools.",
	}
	res, err := chat.streamWithReAct(
		context.Background(),
		"test-react",
		srv.URL,
		[]ChatMessage{{Role: "user", Content: "list files"}},
		mode,
		reg,
		&AgentContext{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.FinalContent, "Final Answer") {
		t.Errorf("FinalContent missing Final Answer: %q", res.FinalContent)
	}
	if res.Iterations != 2 {
		t.Errorf("Iterations = %d, want 2", res.Iterations)
	}
	if len(res.ToolCalls) != 1 || res.ToolCalls[0].Name != "list_files" {
		t.Errorf("ToolCalls = %+v", res.ToolCalls)
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
