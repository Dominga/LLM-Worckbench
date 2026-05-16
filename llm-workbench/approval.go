package main

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// writeTools enumerates tools whose calls must pass the approval gate
// when the active mode's policy is `always`. Hard-coded for now —
// when more writes land, extend this set (or add a Tool.IsWrite()
// method if the count keeps growing).
var writeTools = map[string]bool{
	"edit_file":      true,
	"make_directory": true,
	"append_memory":  true,
}

// IsWriteTool reports whether a tool name corresponds to a write
// operation that should run through the approval gate.
func IsWriteTool(name string) bool { return writeTools[name] }

// writeArgsLookValid is a cheap pre-check the approval gate uses to
// avoid bothering the user with a modal for a tool call the tool itself
// will reject anyway. Returns true when args look like they could
// plausibly produce a write; false when they're obviously malformed
// (missing required fields). Not a full validation — the tool still
// runs its own check, this just decides whether to ask the human.
func writeArgsLookValid(toolName string, rawArgs json.RawMessage) bool {
	switch toolName {
	case "edit_file", "make_directory":
		var a struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(rawArgs, &a); err != nil {
			return false
		}
		return a.Path != ""
	case "append_memory":
		var a struct {
			Scope string `json:"scope"`
			Entry string `json:"entry"`
		}
		if err := json.Unmarshal(rawArgs, &a); err != nil {
			return false
		}
		return a.Scope != "" && a.Entry != ""
	}
	// Unknown write tools default to "ask" — safer than silently skipping.
	return true
}

// ApprovalRequest is what the agent loop emits to the UI when a write
// tool needs user confirmation under `approval=always`.
type ApprovalRequest struct {
	ID         string          `json:"id"`
	StreamID   string          `json:"streamId"`
	Tool       string          `json:"tool"`
	Args       json.RawMessage `json:"args"`
	Path       string          `json:"path,omitempty"`       // edit_file convenience
	OldContent string          `json:"oldContent,omitempty"` // edit_file convenience
	NewContent string          `json:"newContent,omitempty"` // edit_file convenience
	CreatedAt  time.Time       `json:"createdAt"`
}

// ApprovalDecision is the user's response. Reason is optional and
// surfaced back to the model as part of the rejection observation so
// it can adjust strategy.
type ApprovalDecision struct {
	Accept bool   `json:"accept"`
	Reason string `json:"reason,omitempty"`
}

// ApprovalManager tracks pending approval requests. Each request is
// keyed by a fresh UUID; the agent loop blocks on the response
// channel until the UI calls Respond. Stale requests can be timed
// out by the loop's own ctx.
type ApprovalManager struct {
	mu      sync.Mutex
	pending map[string]chan ApprovalDecision
}

func NewApprovalManager() *ApprovalManager {
	return &ApprovalManager{pending: map[string]chan ApprovalDecision{}}
}

// Open registers a new pending approval and returns the request id and
// the channel the caller should select on. Caller is responsible for
// emitting the UI event with the same id.
func (am *ApprovalManager) Open() (string, <-chan ApprovalDecision) {
	id := uuid.NewString()
	ch := make(chan ApprovalDecision, 1)
	am.mu.Lock()
	am.pending[id] = ch
	am.mu.Unlock()
	return id, ch
}

// Respond delivers the user's decision to the waiting goroutine.
// Returns an error if the id has already been consumed (double-click,
// stale modal) so the UI can surface a notice.
func (am *ApprovalManager) Respond(id string, dec ApprovalDecision) error {
	am.mu.Lock()
	ch, ok := am.pending[id]
	delete(am.pending, id)
	am.mu.Unlock()
	if !ok {
		return errors.New("no such pending approval (already responded?)")
	}
	ch <- dec
	close(ch)
	return nil
}

// Cancel discards a pending approval (e.g. agent loop ctx done) and
// closes the channel without a decision. The waiting select must
// handle a closed channel as a rejection.
func (am *ApprovalManager) Cancel(id string) {
	am.mu.Lock()
	ch, ok := am.pending[id]
	delete(am.pending, id)
	am.mu.Unlock()
	if ok {
		close(ch)
	}
}
