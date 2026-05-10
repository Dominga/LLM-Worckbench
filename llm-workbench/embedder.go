package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// EmbeddingProgress is the synchronous summary of one embed pass.
type EmbeddingProgress struct {
	ChunksTotal     int      `json:"chunksTotal"`
	ChunksEmbedded  int      `json:"chunksEmbedded"`
	BatchesSent     int      `json:"batchesSent"`
	EmbedDim        int      `json:"embedDim"`
	EmbedModelID    string   `json:"embedModelId"`
	DurationMs      int64    `json:"durationMs"`
	Errors          []string `json:"errors,omitempty"`
}

// EmbeddingService binds chunks → vectors. Reads pending chunks from the
// project's IndexDB, calls the chosen embed-kind profile via HTTP, and
// writes the result into `vec_chunks`. If the profile is not running it
// is started (and stopped is left to the user — this is an interactive
// app, not a daemon).
type EmbeddingService struct {
	profiles *ProfileManager
	registry *ServerRegistry
	indexes  *IndexRegistry
	ctx      context.Context // optional; set via Attach for progress events

	// BatchSize is the number of chunks per /v1/embeddings call. 16 fits
	// comfortably under the default `-b 2048` token budget for 512-token
	// chunks; tune via SetBatchSize from tests if needed.
	BatchSize int
	// HealthWait is how long to poll for `/health` after auto-starting
	// the embed sidecar before giving up.
	HealthWait time.Duration
}

// Attach binds the Wails ctx so batch progress can be streamed via
// `rag:embed:progress:<projectID>` events.
func (es *EmbeddingService) Attach(ctx context.Context) { es.ctx = ctx }

func NewEmbeddingService(pm *ProfileManager, reg *ServerRegistry, idx *IndexRegistry) *EmbeddingService {
	return &EmbeddingService{
		profiles:   pm,
		registry:   reg,
		indexes:    idx,
		BatchSize:  16,
		HealthWait: 60 * time.Second,
	}
}

// BuildEmbeddings runs one full pass: ensure embed profile is up, find
// chunks without vectors, embed them in batches, write to vec_chunks.
// Idempotent — re-runs only touch chunks that have no embedding yet.
func (es *EmbeddingService) BuildEmbeddings(ctx context.Context, projectID, embedProfileID string) (EmbeddingProgress, error) {
	t0 := time.Now()
	prog := EmbeddingProgress{}

	if es.profiles == nil || es.registry == nil || es.indexes == nil {
		return prog, errors.New("embedding service not wired")
	}
	prof, err := es.profiles.Get(embedProfileID)
	if err != nil {
		return prog, fmt.Errorf("embed profile: %w", err)
	}
	if prof.Kind != KindEmbed {
		return prog, fmt.Errorf("profile %q is kind=%s, expected embed", embedProfileID, prof.Kind)
	}

	idx, err := es.indexes.For(projectID)
	if err != nil {
		return prog, err
	}

	// Auto-start the embed profile if it is not already up. Health-wait
	// before issuing requests so the very first batch doesn't 404.
	if !es.registry.Status(embedProfileID).Running {
		if startErr := es.registry.Start(embedProfileID); startErr != nil && !errors.Is(startErr, ErrAlreadyRunning) {
			return prog, fmt.Errorf("start embed profile: %w", startErr)
		}
	}
	if err := es.waitHealthy(ctx, embedProfileID); err != nil {
		return prog, err
	}

	client := NewEmbedClient(prof.BaseURL())

	// Probe: grab the first pending chunk and embed it solo to discover
	// the model's vector dimension. This is also where vec_chunks gets
	// created. Subsequent batches don't pay the probe cost.
	pending, err := loadPendingChunks(idx, 1)
	if err != nil {
		return prog, fmt.Errorf("scan pending: %w", err)
	}
	if len(pending) == 0 {
		prog.DurationMs = time.Since(t0).Milliseconds()
		return prog, nil // nothing to do
	}
	first, err := client.Embed(ctx, []string{pending[0].content})
	if err != nil {
		return prog, fmt.Errorf("probe embed: %w", err)
	}
	if len(first) != 1 || len(first[0]) == 0 {
		return prog, errors.New("probe embed: empty vector")
	}
	dim := len(first[0])
	prog.EmbedDim = dim
	prog.EmbedModelID = embedProfileID

	if err := idx.EnsureVecTable(embedProfileID, dim); err != nil {
		return prog, err
	}
	if err := writeVectors(idx, []pendingChunk{pending[0]}, first); err != nil {
		return prog, fmt.Errorf("write probe vector: %w", err)
	}
	prog.ChunksEmbedded++
	prog.BatchesSent++
	prog.ChunksTotal = countChunks(idx)
	es.emitProgress(projectID, prog, false)

	// Stream remaining chunks in batches.
	if err := es.streamPending(ctx, client, idx, projectID, &prog); err != nil {
		prog.Errors = append(prog.Errors, err.Error())
	}

	prog.DurationMs = time.Since(t0).Milliseconds()
	es.emitProgress(projectID, prog, true)
	return prog, nil
}

// countChunks reports the total number of chunks in the index. Used
// for the progress denominator. Lightweight COUNT(*) — no scan.
func countChunks(idx *IndexDB) int {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	var n int
	_ = idx.db.QueryRow(`SELECT COUNT(*) FROM chunks`).Scan(&n)
	return n
}

// emitProgress fires a Wails event so the UI can render a live
// progress indicator while embeddings stream in.
func (es *EmbeddingService) emitProgress(projectID string, prog EmbeddingProgress, done bool) {
	if es.ctx == nil {
		return
	}
	wruntime.EventsEmit(es.ctx, "rag:embed:progress:"+projectID, map[string]any{
		"projectId":      projectID,
		"chunksTotal":    prog.ChunksTotal,
		"chunksEmbedded": prog.ChunksEmbedded,
		"batchesSent":    prog.BatchesSent,
		"embedDim":       prog.EmbedDim,
		"embedModelId":   prog.EmbedModelID,
		"done":           done,
	})
}

// streamPending pulls batches of unembedded chunks until the queue
// empties or an error occurs. Error from one batch is appended to the
// progress and the loop continues — partial progress is preferable to
// rolling back the whole pass.
func (es *EmbeddingService) streamPending(ctx context.Context, client *EmbedClient, idx *IndexDB, projectID string, prog *EmbeddingProgress) error {
	for {
		batch, err := loadPendingChunks(idx, es.BatchSize)
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		texts := make([]string, len(batch))
		for i, c := range batch {
			texts[i] = c.content
		}
		vecs, err := client.Embed(ctx, texts)
		if err != nil {
			prog.Errors = append(prog.Errors, fmt.Sprintf("batch: %v", err))
			return nil // stop cleanly; user can retry
		}
		if err := writeVectors(idx, batch, vecs); err != nil {
			prog.Errors = append(prog.Errors, fmt.Sprintf("write: %v", err))
			return nil
		}
		prog.ChunksEmbedded += len(batch)
		prog.BatchesSent++
		es.emitProgress(projectID, *prog, false)
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}

// waitHealthy polls /v1/embeddings indirectly by polling the registry
// status (which already runs a /health probe). Bounded by HealthWait.
func (es *EmbeddingService) waitHealthy(ctx context.Context, profileID string) error {
	deadline := time.Now().Add(es.HealthWait)
	for {
		st := es.registry.Status(profileID)
		if st.Running && st.Healthy {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("embed profile %q not healthy after %s", profileID, es.HealthWait)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// pendingChunk is the minimal subset of a chunks row needed to embed it.
type pendingChunk struct {
	id      int64
	content string
}

// loadPendingChunks returns up to `limit` chunks that don't yet have a
// vec_chunks entry. When vec_chunks doesn't exist (first run), every
// chunk is pending.
func loadPendingChunks(idx *IndexDB, limit int) ([]pendingChunk, error) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	hasVec := false
	if dim, _ := idx.metaInt("embed_dim"); dim > 0 {
		hasVec = true
	}

	var (
		rows interface {
			Next() bool
			Scan(...any) error
			Close() error
			Err() error
		}
		err error
	)
	if hasVec {
		rows, err = idx.db.Query(`
			SELECT c.id, c.content
			FROM chunks c
			LEFT JOIN vec_chunks v ON v.rowid = c.id
			WHERE v.rowid IS NULL
			ORDER BY c.id
			LIMIT ?`, limit)
	} else {
		rows, err = idx.db.Query(`SELECT id, content FROM chunks ORDER BY id LIMIT ?`, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []pendingChunk
	for rows.Next() {
		var pc pendingChunk
		if err := rows.Scan(&pc.id, &pc.content); err != nil {
			return nil, err
		}
		out = append(out, pc)
	}
	return out, rows.Err()
}

// writeVectors inserts one vec_chunks row per (chunk, vector). Uses
// vec0's rowid binding so chunks.id ↔ vec_chunks.rowid is 1:1, which
// makes joins and per-id deletes trivial.
func writeVectors(idx *IndexDB, chunks []pendingChunk, vectors [][]float32) error {
	if len(chunks) != len(vectors) {
		return fmt.Errorf("writeVectors: chunks=%d vectors=%d", len(chunks), len(vectors))
	}
	idx.mu.Lock()
	defer idx.mu.Unlock()
	tx, err := idx.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO vec_chunks(rowid, embedding) VALUES(?, ?)`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	for i, c := range chunks {
		blob, sErr := sqlite_vec.SerializeFloat32(vectors[i])
		if sErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("serialize chunk %d: %w", c.id, sErr)
		}
		if _, iErr := stmt.Exec(c.id, blob); iErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("insert chunk %d: %w", c.id, iErr)
		}
	}
	return tx.Commit()
}
