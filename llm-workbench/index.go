package main

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"sync"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	_ "github.com/mattn/go-sqlite3"
)

// IndexDB is the per-project SQLite-backed RAG index. Lives at
// `<projectRoot>/.llm-workshop/index.db`. Schema:
//
//	chunks       — text chunks with sha256 dedup key, byte offsets, mtime
//	chunks_fts   — FTS5 contentless mirror of chunks.content (BM25)
//	vec_chunks   — sqlite-vec vtable, dim set by embed profile (PR11)
//	meta         — k/v config: embed_model_id, embed_dim, schema_version
//
// Connection lifecycle is per-project: opened lazily on first use, kept
// open for the session, closed on shutdown.
type IndexDB struct {
	mu        sync.Mutex
	db        *sql.DB
	path      string
	projectID string
	embedDim  int // 0 until PR11 sets it
}

// IndexStats is the small surface the UI/agent uses to display index
// state without touching the DB directly.
type IndexStats struct {
	ProjectID    string `json:"projectId"`
	Path         string `json:"path"`
	ChunkCount   int64  `json:"chunkCount"`
	EmbedModelID string `json:"embedModelId"`
	EmbedDim     int    `json:"embedDim"`
	SchemaVer    int    `json:"schemaVer"`
}

const indexSchemaVersion = 1

// sqlite-vec is auto-registered against the default mattn driver via
// the cgo bindings' init.
func init() { sqlite_vec.Auto() }

// OpenIndex opens (or creates) the index DB for a project. Safe to call
// multiple times; the registry caches by projectID.
func OpenIndex(projectID, projectRoot string) (*IndexDB, error) {
	dbPath := filepath.Join(projectRoot, ProjectDirName, "index.db")
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open index.db: %w", err)
	}
	idx := &IndexDB{db: db, path: dbPath, projectID: projectID}
	if err := idx.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if dim, _ := idx.metaInt("embed_dim"); dim > 0 {
		idx.embedDim = dim
	}
	return idx, nil
}

// Close releases the underlying DB handle. Idempotent.
func (idx *IndexDB) Close() error {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.db == nil {
		return nil
	}
	err := idx.db.Close()
	idx.db = nil
	return err
}

func (idx *IndexDB) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS meta (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS chunks (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			path       TEXT    NOT NULL,
			start_byte INTEGER NOT NULL,
			end_byte   INTEGER NOT NULL,
			content    TEXT    NOT NULL,
			sha256     TEXT    NOT NULL UNIQUE,
			mtime      INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
			content,
			content='chunks',
			content_rowid='id',
			tokenize='unicode61 remove_diacritics 2'
		)`,
		`CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
			INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
		END`,
		`CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
			INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
		END`,
		`CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
			INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
			INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
		END`,
	}
	tx, err := idx.db.Begin()
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	for _, s := range stmts {
		if _, err := tx.Exec(s); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("schema migrate: %w (stmt=%s)", err, firstLine(s))
		}
	}
	if _, err := tx.Exec(
		`INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		strconv.Itoa(indexSchemaVersion),
	); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("set schema_version: %w", err)
	}
	return tx.Commit()
}

// EnsureVecTable creates the sqlite-vec virtual table on first use.
// PR11 will call this once it knows the embedding model's dimension.
// If a table already exists with a different dim, returns an error so
// the caller can prompt the user to clear the index.
func (idx *IndexDB) EnsureVecTable(modelID string, dim int) error {
	if dim <= 0 {
		return errors.New("embed dim must be > 0")
	}
	idx.mu.Lock()
	defer idx.mu.Unlock()

	if existingDim, _ := idx.metaInt("embed_dim"); existingDim > 0 {
		if existingDim != dim {
			return fmt.Errorf("index already initialised with dim=%d, requested dim=%d (drop and re-index to switch models)", existingDim, dim)
		}
		idx.embedDim = existingDim
		return nil
	}
	stmt := fmt.Sprintf(
		`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[%d])`, dim,
	)
	if _, err := idx.db.Exec(stmt); err != nil {
		return fmt.Errorf("create vec_chunks: %w", err)
	}
	if err := idx.setMeta("embed_model_id", modelID); err != nil {
		return err
	}
	if err := idx.setMeta("embed_dim", strconv.Itoa(dim)); err != nil {
		return err
	}
	idx.embedDim = dim
	return nil
}

// Stats returns a small snapshot for UI/debug surfaces.
func (idx *IndexDB) Stats() IndexStats {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	out := IndexStats{
		ProjectID: idx.projectID,
		Path:      idx.path,
		EmbedDim:  idx.embedDim,
	}
	if v, ok := idx.metaStr("embed_model_id"); ok {
		out.EmbedModelID = v
	}
	if v, _ := idx.metaInt("schema_version"); v > 0 {
		out.SchemaVer = v
	}
	_ = idx.db.QueryRow(`SELECT COUNT(*) FROM chunks`).Scan(&out.ChunkCount)
	return out
}

func (idx *IndexDB) setMeta(k, v string) error {
	_, err := idx.db.Exec(
		`INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		k, v,
	)
	return err
}

func (idx *IndexDB) metaStr(k string) (string, bool) {
	var v string
	err := idx.db.QueryRow(`SELECT value FROM meta WHERE key = ?`, k).Scan(&v)
	if err != nil {
		return "", false
	}
	return v, true
}

func (idx *IndexDB) metaInt(k string) (int, error) {
	v, ok := idx.metaStr(k)
	if !ok {
		return 0, nil
	}
	return strconv.Atoi(v)
}

func firstLine(s string) string {
	for i, c := range s {
		if c == '\n' {
			return s[:i]
		}
	}
	return s
}

// ─────────────────────────── Registry ────────────────────────────────

// IndexRegistry caches one IndexDB per project. Concurrency-safe.
type IndexRegistry struct {
	mu       sync.Mutex
	projects *ProjectService
	open     map[string]*IndexDB
}

func NewIndexRegistry(ps *ProjectService) *IndexRegistry {
	return &IndexRegistry{projects: ps, open: make(map[string]*IndexDB)}
}

// For returns the IndexDB for a project, opening it lazily.
func (r *IndexRegistry) For(projectID string) (*IndexDB, error) {
	if r.projects == nil {
		return nil, errors.New("project service unavailable")
	}
	p, err := r.projects.Get(projectID)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if idx, ok := r.open[projectID]; ok {
		return idx, nil
	}
	idx, err := OpenIndex(projectID, p.Path)
	if err != nil {
		return nil, err
	}
	r.open[projectID] = idx
	return idx, nil
}

// CloseAll releases all open index handles. Used on app shutdown.
func (r *IndexRegistry) CloseAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, idx := range r.open {
		_ = idx.Close()
		delete(r.open, id)
	}
}

