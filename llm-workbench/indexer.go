package main

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// IndexProgress is the synchronous result of a Walk + reindex pass.
// Fields are cumulative across the run. PR14 will turn this into a
// streaming event channel for the UI; for now Walk just returns it.
type IndexProgress struct {
	FilesProcessed int      `json:"filesProcessed"`
	FilesSkipped   int      `json:"filesSkipped"`
	ChunksAdded    int      `json:"chunksAdded"`
	ChunksRemoved  int      `json:"chunksRemoved"`
	FilesRemoved   int      `json:"filesRemoved"`
	Errors         []string `json:"errors,omitempty"`
	DurationMs     int64    `json:"durationMs"`
}

// FileIndexer walks a project tree and synchronises the per-project
// IndexDB with the on-disk content. Embedding generation is NOT done
// here — that lives in PR11 and runs as a follow-up pass after this
// one finishes inserting chunks.
type FileIndexer struct {
	projects *ProjectService
	indexes  *IndexRegistry
}

func NewFileIndexer(projects *ProjectService, indexes *IndexRegistry) *FileIndexer {
	return &FileIndexer{projects: projects, indexes: indexes}
}

// Reindex scans the project root, chunks every matching file, and
// upserts the result into chunks/chunks_fts. Per-file replace strategy:
// if any chunk's sha256 differs from what's stored for that path, the
// path's existing chunks are deleted and the new set inserted. Files
// that no longer exist on disk have their chunks removed.
func (fx *FileIndexer) Reindex(projectID string) (IndexProgress, error) {
	t0 := time.Now()
	prog := IndexProgress{}

	if fx.projects == nil || fx.indexes == nil {
		return prog, errors.New("indexer not wired up (project/index registry missing)")
	}

	p, err := fx.projects.Get(projectID)
	if err != nil {
		return prog, err
	}
	idx, err := fx.indexes.For(projectID)
	if err != nil {
		return prog, err
	}

	cfg := readIndexingConfig(p.Path)
	chunker := &Chunker{TargetChars: cfg.ChunkChars, OverlapChars: cfg.OverlapChars}
	matcher, err := newGlobMatcher(cfg.Include, cfg.Exclude)
	if err != nil {
		return prog, fmt.Errorf("compile glob: %w", err)
	}

	walked := make(map[string]struct{})

	walkErr := filepath.WalkDir(p.Path, func(absPath string, d fs.DirEntry, err error) error {
		if err != nil {
			prog.Errors = append(prog.Errors, fmt.Sprintf("walk %s: %v", absPath, err))
			return nil
		}
		rel, relErr := filepath.Rel(p.Path, absPath)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		// Skip excluded directories outright so we don't descend into
		// node_modules/ etc.
		if d.IsDir() {
			if matcher.dirExcluded(rel) {
				return filepath.SkipDir
			}
			return nil
		}
		if !matcher.fileMatches(rel) {
			return nil
		}

		walked[rel] = struct{}{}
		stat, sErr := d.Info()
		if sErr != nil {
			prog.Errors = append(prog.Errors, fmt.Sprintf("stat %s: %v", rel, sErr))
			return nil
		}
		mtime := stat.ModTime().Unix()

		content, rErr := os.ReadFile(absPath)
		if rErr != nil {
			prog.Errors = append(prog.Errors, fmt.Sprintf("read %s: %v", rel, rErr))
			return nil
		}
		newChunks := chunker.Chunk(rel, string(content))

		added, removed, upErr := upsertFileChunks(idx, rel, mtime, newChunks)
		if upErr != nil {
			prog.Errors = append(prog.Errors, fmt.Sprintf("upsert %s: %v", rel, upErr))
			return nil
		}
		if added == 0 && removed == 0 {
			prog.FilesSkipped++
		} else {
			prog.FilesProcessed++
		}
		prog.ChunksAdded += added
		prog.ChunksRemoved += removed
		return nil
	})
	if walkErr != nil {
		prog.Errors = append(prog.Errors, fmt.Sprintf("walk root: %v", walkErr))
	}

	// GC: delete chunks for paths that disappeared from disk.
	gone, removed, gcErr := gcMissingPaths(idx, walked)
	if gcErr != nil {
		prog.Errors = append(prog.Errors, fmt.Sprintf("gc: %v", gcErr))
	}
	prog.FilesRemoved = gone
	prog.ChunksRemoved += removed

	prog.DurationMs = time.Since(t0).Milliseconds()
	return prog, nil
}

// upsertFileChunks compares the new chunk set against what's stored for
// `path` and replaces if different. Returns counts. Idempotent on
// unchanged files (sha set match → noop).
func upsertFileChunks(idx *IndexDB, path string, mtime int64, newChunks []Chunk) (added, removed int, err error) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	rows, err := idx.db.Query(`SELECT id, sha256 FROM chunks WHERE path = ?`, path)
	if err != nil {
		return 0, 0, err
	}
	type oldRow struct {
		id  int64
		sha string
	}
	var olds []oldRow
	for rows.Next() {
		var r oldRow
		if scanErr := rows.Scan(&r.id, &r.sha); scanErr != nil {
			rows.Close()
			return 0, 0, scanErr
		}
		olds = append(olds, r)
	}
	rows.Close()

	// Set comparison: same hashes (regardless of order) → noop.
	oldSet := make(map[string]struct{}, len(olds))
	for _, r := range olds {
		oldSet[r.sha] = struct{}{}
	}
	if len(olds) == len(newChunks) {
		match := true
		for _, c := range newChunks {
			if _, ok := oldSet[c.SHA256]; !ok {
				match = false
				break
			}
		}
		if match {
			return 0, 0, nil
		}
	}

	tx, err := idx.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	if len(olds) > 0 {
		// vec_chunks rows are keyed by chunks.id (rowid). Delete them
		// first so we don't orphan vectors when a file mutates. Skipped
		// if vec_chunks doesn't exist yet (PR9 schema, pre-PR11 wiring).
		if vecTableExistsTx(tx) {
			ids := make([]any, len(olds))
			for i, r := range olds {
				ids[i] = r.id
			}
			placeholders := strings.Repeat("?,", len(ids))
			placeholders = placeholders[:len(placeholders)-1]
			if _, vErr := tx.Exec(
				`DELETE FROM vec_chunks WHERE rowid IN (`+placeholders+`)`, ids...,
			); vErr != nil {
				_ = tx.Rollback()
				return 0, 0, fmt.Errorf("vec gc: %w", vErr)
			}
		}
		res, dErr := tx.Exec(`DELETE FROM chunks WHERE path = ?`, path)
		if dErr != nil {
			_ = tx.Rollback()
			return 0, 0, dErr
		}
		n, _ := res.RowsAffected()
		removed = int(n)
	}
	now := time.Now().Unix()
	stmt, err := tx.Prepare(
		`INSERT INTO chunks(path, start_byte, end_byte, content, sha256, mtime, created_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		_ = tx.Rollback()
		return 0, 0, err
	}
	for _, c := range newChunks {
		if _, iErr := stmt.Exec(c.Path, c.StartByte, c.EndByte, c.Content, c.SHA256, mtime, now); iErr != nil {
			stmt.Close()
			_ = tx.Rollback()
			return 0, 0, iErr
		}
		added++
	}
	stmt.Close()
	if cErr := tx.Commit(); cErr != nil {
		return 0, 0, cErr
	}
	return added, removed, nil
}

// gcMissingPaths deletes chunks whose `path` is no longer present on
// disk after a walk. Returns (#paths gone, #chunks removed).
func gcMissingPaths(idx *IndexDB, walked map[string]struct{}) (int, int, error) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	rows, err := idx.db.Query(`SELECT DISTINCT path FROM chunks`)
	if err != nil {
		return 0, 0, err
	}
	var stale []string
	for rows.Next() {
		var p string
		if sErr := rows.Scan(&p); sErr != nil {
			rows.Close()
			return 0, 0, sErr
		}
		if _, ok := walked[p]; !ok {
			stale = append(stale, p)
		}
	}
	rows.Close()
	if len(stale) == 0 {
		return 0, 0, nil
	}
	tx, err := idx.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	totalRemoved := 0
	hasVec := vecTableExistsTx(tx)
	for _, p := range stale {
		if hasVec {
			if _, vErr := tx.Exec(
				`DELETE FROM vec_chunks WHERE rowid IN (SELECT id FROM chunks WHERE path = ?)`, p,
			); vErr != nil {
				_ = tx.Rollback()
				return 0, 0, fmt.Errorf("vec gc: %w", vErr)
			}
		}
		res, dErr := tx.Exec(`DELETE FROM chunks WHERE path = ?`, p)
		if dErr != nil {
			_ = tx.Rollback()
			return 0, 0, dErr
		}
		n, _ := res.RowsAffected()
		totalRemoved += int(n)
	}
	if cErr := tx.Commit(); cErr != nil {
		return 0, 0, cErr
	}
	return len(stale), totalRemoved, nil
}

// vecTableExistsTx returns true when `vec_chunks` is registered.
// sqlite-vec virtual tables show up in sqlite_master with type='table'.
func vecTableExistsTx(tx *sql.Tx) bool {
	var name string
	err := tx.QueryRow(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='vec_chunks'`,
	).Scan(&name)
	return err == nil && name == "vec_chunks"
}

// readIndexingConfig reads <root>/project.toml. Missing or empty
// `[indexing]` section falls back to DefaultIndexingConfig().
func readIndexingConfig(root string) IndexingConfig {
	cfg := DefaultIndexingConfig()
	data, err := os.ReadFile(filepath.Join(root, "project.toml"))
	if err != nil {
		return cfg
	}
	var meta projectMeta
	if uErr := toml.Unmarshal(data, &meta); uErr != nil {
		return cfg
	}
	if len(meta.Indexing.Include) > 0 {
		cfg.Include = meta.Indexing.Include
	}
	if len(meta.Indexing.Exclude) > 0 {
		cfg.Exclude = meta.Indexing.Exclude
	}
	if meta.Indexing.ChunkChars > 0 {
		cfg.ChunkChars = meta.Indexing.ChunkChars
	}
	if meta.Indexing.OverlapChars > 0 {
		cfg.OverlapChars = meta.Indexing.OverlapChars
	}
	return cfg
}

// ─────────────────────────── Glob matcher ─────────────────────────────

// globMatcher compiles include/exclude patterns to regexps. Supports
// `**` (any depth, including zero segments) and `*` (single segment).
// Patterns are matched against forward-slash-normalised paths relative
// to the project root.
type globMatcher struct {
	include []*regexp.Regexp
	exclude []*regexp.Regexp
}

func newGlobMatcher(include, exclude []string) (*globMatcher, error) {
	m := &globMatcher{}
	for _, p := range include {
		re, err := compileGlob(p)
		if err != nil {
			return nil, fmt.Errorf("include %q: %w", p, err)
		}
		m.include = append(m.include, re)
	}
	for _, p := range exclude {
		re, err := compileGlob(p)
		if err != nil {
			return nil, fmt.Errorf("exclude %q: %w", p, err)
		}
		m.exclude = append(m.exclude, re)
	}
	return m, nil
}

func (m *globMatcher) fileMatches(rel string) bool {
	for _, re := range m.exclude {
		if re.MatchString(rel) {
			return false
		}
	}
	for _, re := range m.include {
		if re.MatchString(rel) {
			return true
		}
	}
	return false
}

// dirExcluded returns true when the directory itself is fully excluded
// (e.g. `node_modules/**` for `node_modules`). Lets WalkDir skip the
// whole subtree.
func (m *globMatcher) dirExcluded(rel string) bool {
	for _, re := range m.exclude {
		// We compiled `node_modules/**` to a regex that matches paths
		// inside the directory; to detect the directory itself, also
		// test with a synthetic trailing /x to satisfy the suffix.
		if re.MatchString(rel + "/_probe") {
			return true
		}
	}
	return false
}

// compileGlob converts a doublestar-style glob into a regexp anchored
// at both ends. Order of substitutions matters: the `**` placeholder
// is allocated first so a later `*` substitution does not eat it.
func compileGlob(pattern string) (*regexp.Regexp, error) {
	var b strings.Builder
	b.WriteString("^")
	i := 0
	for i < len(pattern) {
		ch := pattern[i]
		switch {
		case ch == '*' && i+1 < len(pattern) && pattern[i+1] == '*':
			// `**/` matches any number of segments; consume optional
			// trailing slash so `**/x` and `**x` both work.
			b.WriteString(".*")
			i += 2
			if i < len(pattern) && pattern[i] == '/' {
				i++
			}
		case ch == '*':
			b.WriteString("[^/]*")
			i++
		case ch == '?':
			b.WriteString("[^/]")
			i++
		case ch == '.', ch == '+', ch == '(', ch == ')', ch == '|',
			ch == '^', ch == '$', ch == '{', ch == '}', ch == '\\', ch == '[', ch == ']':
			b.WriteByte('\\')
			b.WriteByte(ch)
			i++
		default:
			b.WriteByte(ch)
			i++
		}
	}
	b.WriteString("$")
	return regexp.Compile(b.String())
}

