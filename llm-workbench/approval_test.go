package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestApprovalManagerRoundtrip(t *testing.T) {
	am := NewApprovalManager()
	id, ch := am.Open()

	go func() {
		time.Sleep(5 * time.Millisecond)
		_ = am.Respond(id, ApprovalDecision{Accept: true})
	}()

	select {
	case dec, ok := <-ch:
		if !ok {
			t.Fatal("channel closed without decision")
		}
		if !dec.Accept {
			t.Errorf("decision = %+v, want Accept=true", dec)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for response")
	}
}

func TestApprovalRespondTwiceErrors(t *testing.T) {
	am := NewApprovalManager()
	id, _ := am.Open()
	if err := am.Respond(id, ApprovalDecision{Accept: true}); err != nil {
		t.Fatal(err)
	}
	if err := am.Respond(id, ApprovalDecision{Accept: false}); err == nil {
		t.Error("second Respond should error")
	}
}

func TestApprovalCancelClosesChannel(t *testing.T) {
	am := NewApprovalManager()
	id, ch := am.Open()
	am.Cancel(id)
	if _, ok := <-ch; ok {
		t.Error("channel should be closed by Cancel")
	}
}

func TestRequestApprovalIfWriteSkipsReadTools(t *testing.T) {
	c := &ChatService{}
	err := c.requestApprovalIfWrite(
		context.Background(), "stream-1",
		Mode{Approval: ApprovalAlways},
		nil, "read_file",
		json.RawMessage(`{}`),
	)
	if err != nil {
		t.Fatalf("read_file should bypass approval: %v", err)
	}
}

func TestRequestApprovalIfWriteAcceptedProceeds(t *testing.T) {
	am := NewApprovalManager()
	c := &ChatService{approvals: am}

	go func() {
		// Wait briefly for the request to land in the manager, then
		// approve it. We can't peek without the id, so just take the
		// first pending one.
		for i := 0; i < 50; i++ {
			am.mu.Lock()
			var pendingID string
			for k := range am.pending {
				pendingID = k
			}
			am.mu.Unlock()
			if pendingID != "" {
				_ = am.Respond(pendingID, ApprovalDecision{Accept: true})
				return
			}
			time.Sleep(2 * time.Millisecond)
		}
		t.Errorf("no pending approval landed")
	}()

	err := c.requestApprovalIfWrite(
		context.Background(), "stream-1",
		Mode{Approval: ApprovalAlways},
		nil, "edit_file",
		json.RawMessage(`{"path":"x.md","content":"y"}`),
	)
	if err != nil {
		t.Errorf("expected accept to proceed, got %v", err)
	}
}

func TestRequestApprovalIfWriteRejected(t *testing.T) {
	am := NewApprovalManager()
	c := &ChatService{approvals: am}

	go func() {
		for i := 0; i < 50; i++ {
			am.mu.Lock()
			var pendingID string
			for k := range am.pending {
				pendingID = k
			}
			am.mu.Unlock()
			if pendingID != "" {
				_ = am.Respond(pendingID, ApprovalDecision{Accept: false, Reason: "nope"})
				return
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()

	err := c.requestApprovalIfWrite(
		context.Background(), "s",
		Mode{Approval: ApprovalAlways},
		nil, "edit_file",
		json.RawMessage(`{"path":"x.md","content":"y"}`),
	)
	if err == nil {
		t.Fatal("expected rejection error")
	}
}

func TestRequestApprovalIfWriteSnapshotBypasses(t *testing.T) {
	c := &ChatService{}
	err := c.requestApprovalIfWrite(
		context.Background(), "s",
		Mode{Approval: ApprovalSnapshot},
		nil, "edit_file",
		json.RawMessage(`{}`),
	)
	if err != nil {
		t.Errorf("snapshot policy should not gate, got %v", err)
	}
}

func TestRequestApprovalIfWriteFailsClosedWithoutManager(t *testing.T) {
	c := &ChatService{} // no approvals manager
	err := c.requestApprovalIfWrite(
		context.Background(), "s",
		Mode{Approval: ApprovalAlways},
		nil, "edit_file",
		json.RawMessage(`{}`),
	)
	if err == nil {
		t.Fatal("expected fail-closed error when manager missing")
	}
}
