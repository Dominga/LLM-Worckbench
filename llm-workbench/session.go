package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Session is one conversation within a project. It is persisted as a
// JSONL file under <projectRoot>/.llm-workshop/sessions/<id>.jsonl.
// Layout (DESIGN.md §7.2):
//
//	line 1: header object — sessionId, projectId, modeId, profileId, ts
//	line N: message object — role, content, ts, profileId (assistant only)
type Session struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId"`
	Title     string    `json:"title"`
	ModeID    string    `json:"modeId"`
	ProfileID string    `json:"profileId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	MessageCount int    `json:"messageCount"`
}

// SessionMessage is one persisted line of the conversation. Use
// ChatMessage for in-flight stream interactions; messages are converted on
// load.
type SessionMessage struct {
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"ts"`
	ProfileID string    `json:"profileId,omitempty"`
}

// sessionHeader is line 1 of every session file.
type sessionHeader struct {
	V         int       `json:"v"`
	SessionID string    `json:"sessionId"`
	ProjectID string    `json:"projectId"`
	Title     string    `json:"title"`
	ModeID    string    `json:"modeId"`
	ProfileID string    `json:"profileId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SessionService owns session bookkeeping for the active project. It is
// stateless across projects — every call resolves through ProjectService
// to find the right .llm-workshop dir.
type SessionService struct {
	mu       sync.Mutex
	projects *ProjectService
}

func NewSessionService(ps *ProjectService) *SessionService {
	return &SessionService{projects: ps}
}

func (s *SessionService) sessionsDir(projectID string) (string, error) {
	if s.projects == nil {
		return "", fmt.Errorf("project service unavailable")
	}
	p, err := s.projects.Get(projectID)
	if err != nil {
		return "", err
	}
	return filepath.Join(p.Path, ProjectDirName, "sessions"), nil
}

func (s *SessionService) sessionPath(projectID, sessionID string) (string, error) {
	dir, err := s.sessionsDir(projectID)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, sessionID+".jsonl"), nil
}

// List returns sessions sorted by UpdatedAt descending.
func (s *SessionService) List(projectID string) ([]Session, error) {
	dir, err := s.sessionsDir(projectID)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Session, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		sess, err := s.readMeta(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		out = append(out, sess)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}

// readMeta opens a session file, parses the header, and counts message
// lines. Returns a Session populated with everything needed for the
// sidebar list.
func (s *SessionService) readMeta(path string) (Session, error) {
	f, err := os.Open(path)
	if err != nil {
		return Session{}, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	if !sc.Scan() {
		return Session{}, fmt.Errorf("empty session file")
	}
	var h sessionHeader
	if err := json.Unmarshal(sc.Bytes(), &h); err != nil {
		return Session{}, fmt.Errorf("parse header: %w", err)
	}
	count := 0
	for sc.Scan() {
		if len(sc.Bytes()) > 0 {
			count++
		}
	}
	return Session{
		ID:           h.SessionID,
		ProjectID:    h.ProjectID,
		Title:        h.Title,
		ModeID:       h.ModeID,
		ProfileID:    h.ProfileID,
		CreatedAt:    h.CreatedAt,
		UpdatedAt:    h.UpdatedAt,
		MessageCount: count,
	}, nil
}

// Get returns the session metadata.
func (s *SessionService) Get(projectID, sessionID string) (Session, error) {
	path, err := s.sessionPath(projectID, sessionID)
	if err != nil {
		return Session{}, err
	}
	return s.readMeta(path)
}

// Create writes a new session file with the supplied metadata. Returns
// the persisted Session with timestamps and a fresh UUID if `title`
// implies it.
func (s *SessionService) Create(projectID, title, modeID, profileID string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if title == "" {
		title = "New chat"
	}
	dir, err := s.sessionsDir(projectID)
	if err != nil {
		return Session{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Session{}, err
	}
	now := time.Now().UTC()
	sess := Session{
		ID:        uuid.NewString(),
		ProjectID: projectID,
		Title:     title,
		ModeID:    modeID,
		ProfileID: profileID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	path := filepath.Join(dir, sess.ID+".jsonl")
	if err := s.writeHeader(path, sess); err != nil {
		return Session{}, err
	}
	return sess, nil
}

func (s *SessionService) writeHeader(path string, sess Session) error {
	h := sessionHeader{
		V:         1,
		SessionID: sess.ID,
		ProjectID: sess.ProjectID,
		Title:     sess.Title,
		ModeID:    sess.ModeID,
		ProfileID: sess.ProfileID,
		CreatedAt: sess.CreatedAt,
		UpdatedAt: sess.UpdatedAt,
	}
	buf, err := json.Marshal(h)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(buf, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// rewriteHeaderUnsafe replaces line 1 of the session file with an
// updated header while preserving all message lines. Caller must hold
// s.mu.
func (s *SessionService) rewriteHeaderUnsafe(projectID, sessionID string, mutate func(*sessionHeader)) (Session, error) {
	path, err := s.sessionPath(projectID, sessionID)
	if err != nil {
		return Session{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Session{}, err
	}
	idx := strings.IndexByte(string(data), '\n')
	if idx < 0 {
		return Session{}, fmt.Errorf("malformed session file (no header)")
	}
	var h sessionHeader
	if err := json.Unmarshal(data[:idx], &h); err != nil {
		return Session{}, fmt.Errorf("parse header: %w", err)
	}
	mutate(&h)
	h.UpdatedAt = time.Now().UTC()

	headerLine, err := json.Marshal(h)
	if err != nil {
		return Session{}, err
	}
	tmp := path + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return Session{}, err
	}
	if _, err := out.Write(headerLine); err != nil {
		out.Close()
		os.Remove(tmp)
		return Session{}, err
	}
	if _, err := out.Write([]byte{'\n'}); err != nil {
		out.Close()
		os.Remove(tmp)
		return Session{}, err
	}
	if _, err := out.Write(data[idx+1:]); err != nil {
		out.Close()
		os.Remove(tmp)
		return Session{}, err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return Session{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return Session{}, err
	}
	return s.readMeta(path)
}

func (s *SessionService) Rename(projectID, sessionID, title string) (Session, error) {
	if strings.TrimSpace(title) == "" {
		return Session{}, fmt.Errorf("title is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rewriteHeaderUnsafe(projectID, sessionID, func(h *sessionHeader) {
		h.Title = title
	})
}

func (s *SessionService) UpdateMode(projectID, sessionID, modeID string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rewriteHeaderUnsafe(projectID, sessionID, func(h *sessionHeader) {
		h.ModeID = modeID
	})
}

func (s *SessionService) Delete(projectID, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := s.sessionPath(projectID, sessionID)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// LoadMessages returns every message in the session in insertion order.
// The header line is skipped.
func (s *SessionService) LoadMessages(projectID, sessionID string) ([]SessionMessage, error) {
	path, err := s.sessionPath(projectID, sessionID)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	out := make([]SessionMessage, 0, 32)
	first := true
	for sc.Scan() {
		if first {
			first = false
			continue // header
		}
		if len(sc.Bytes()) == 0 {
			continue
		}
		var m SessionMessage
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			continue // skip corrupt line, don't fail the whole load
		}
		out = append(out, m)
	}
	if err := sc.Err(); err != nil {
		return out, err
	}
	return out, nil
}

// AppendMessage appends one message line and bumps UpdatedAt in the
// header. Concurrent appends serialize through the service mutex.
func (s *SessionService) AppendMessage(projectID, sessionID string, msg SessionMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	path, err := s.sessionPath(projectID, sessionID)
	if err != nil {
		return err
	}
	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now().UTC()
	}
	line, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	// Bump UpdatedAt so the sidebar list re-orders.
	_, _ = s.rewriteHeaderUnsafe(projectID, sessionID, func(_ *sessionHeader) {})
	return nil
}
