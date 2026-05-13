package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// ChunkHit is one ranked search result.
type ChunkHit struct {
	ChunkID   int64   `json:"chunkId"`
	Path      string  `json:"path"`
	StartByte int     `json:"startByte"`
	EndByte   int     `json:"endByte"`
	Content   string  `json:"content"`
	Score     float64 `json:"score"`
	// Sub-scores for diagnostics. Either may be 0 if the chunk only
	// surfaced from one of the rankers.
	DenseRank int     `json:"denseRank"`
	SparseRank int    `json:"sparseRank"`
	DenseDist  float64 `json:"denseDist,omitempty"`
	SparseBM25 float64 `json:"sparseBm25,omitempty"`
}

// SearchOptions tunes a hybrid search.
type SearchOptions struct {
	K          int     // how many hits to return
	PoolSize   int     // top-N pulled from each ranker before RRF (default 50)
	RRFK       float64 // RRF smoothing constant (default 60)
	DenseOnly  bool    // skip BM25 (e.g. for non-text content later)
	SparseOnly bool    // skip dense (e.g. when no embed profile available)
	// Kinds optionally restricts which chunk sources participate. Empty
	// slice (or nil) keeps the default of ["content"] so legacy callers
	// get the same behaviour as before the source column landed.
	// Common values: "content" (project files), "history" (session
	// transcripts). Pass an explicit superset to broaden.
	Kinds []string
}

func (o *SearchOptions) defaults() {
	if o.K <= 0 {
		o.K = 8
	}
	if o.PoolSize <= 0 {
		o.PoolSize = 50
	}
	if o.RRFK <= 0 {
		o.RRFK = 60
	}
	if len(o.Kinds) == 0 {
		o.Kinds = []string{"content"}
	}
}

// RAGService runs hybrid (dense + BM25) retrieval over a project's
// IndexDB. It is stateless besides its dependency wiring; one instance
// per app is enough.
type RAGService struct {
	embedder *EmbeddingService
	indexes  *IndexRegistry
}

func NewRAGService(es *EmbeddingService, idx *IndexRegistry) *RAGService {
	return &RAGService{embedder: es, indexes: idx}
}

// Search runs the hybrid pipeline:
//
//  1. Embed the query via the chosen embed profile (skipped when
//     SparseOnly).
//  2. Pull top PoolSize from vec_chunks (dense, cosine distance).
//  3. Pull top PoolSize from chunks_fts (BM25).
//  4. Combine via Reciprocal Rank Fusion: 1/(K + rank_d) + 1/(K + rank_s).
//  5. Return top K ChunkHits, hydrated with content + offsets.
//
// embedProfileID may be empty when SparseOnly. It is required when
// dense retrieval is requested.
func (s *RAGService) Search(ctx context.Context, projectID, embedProfileID, query string, opts SearchOptions) ([]ChunkHit, error) {
	opts.defaults()
	if s.indexes == nil {
		return nil, errors.New("rag: index registry unwired")
	}
	if !opts.SparseOnly && embedProfileID == "" {
		return nil, errors.New("rag: embed profile required for dense search")
	}
	idx, err := s.indexes.For(projectID)
	if err != nil {
		return nil, err
	}

	var denseRanks map[int64]int
	var denseDists map[int64]float64
	if !opts.SparseOnly {
		denseRanks, denseDists, err = s.runDense(ctx, idx, embedProfileID, query, opts.PoolSize)
		if err != nil {
			return nil, fmt.Errorf("dense: %w", err)
		}
	}

	var sparseRanks map[int64]int
	var sparseScores map[int64]float64
	if !opts.DenseOnly {
		sparseRanks, sparseScores, err = runSparse(idx, query, opts.PoolSize)
		if err != nil {
			return nil, fmt.Errorf("sparse: %w", err)
		}
	}

	// Post-filter both rankers by source. Builds the allowed-ID set in
	// a single SELECT then drops entries that don't belong. Keeping
	// the original rank positions in RRF is fine — filtered-out items
	// just don't contribute; survivors keep their relative ordering.
	allowedIDs, fErr := allowedSourceIDs(idx, opts.Kinds)
	if fErr != nil {
		return nil, fmt.Errorf("filter sources: %w", fErr)
	}
	denseRanks = filterRanks(denseRanks, allowedIDs)
	sparseRanks = filterRanks(sparseRanks, allowedIDs)

	fused := rrfFuse(denseRanks, sparseRanks, opts.RRFK)
	if len(fused) == 0 {
		return nil, nil
	}

	// Hydrate top K with content + offsets.
	top := topK(fused, opts.K)
	hits, err := hydrate(idx, top)
	if err != nil {
		return nil, err
	}
	for i := range hits {
		id := hits[i].ChunkID
		if r, ok := denseRanks[id]; ok {
			hits[i].DenseRank = r + 1
			hits[i].DenseDist = denseDists[id]
		}
		if r, ok := sparseRanks[id]; ok {
			hits[i].SparseRank = r + 1
			hits[i].SparseBM25 = sparseScores[id]
		}
	}
	return hits, nil
}

// runDense embeds the query (single-element batch) and runs a top-N
// vec0 KNN. Returns rank map (rank index 0-based) plus raw distances.
func (s *RAGService) runDense(ctx context.Context, idx *IndexDB, embedProfileID, query string, pool int) (map[int64]int, map[int64]float64, error) {
	if s.embedder == nil || s.embedder.profiles == nil || s.embedder.registry == nil {
		return nil, nil, errors.New("rag: embedder unwired")
	}
	prof, err := s.embedder.profiles.Get(embedProfileID)
	if err != nil {
		return nil, nil, err
	}
	if prof.Kind != KindEmbed {
		return nil, nil, fmt.Errorf("profile %q kind=%s, want embed", embedProfileID, prof.Kind)
	}
	if !s.embedder.registry.Status(embedProfileID).Running {
		if err := s.embedder.registry.Start(embedProfileID); err != nil && !errors.Is(err, ErrAlreadyRunning) {
			return nil, nil, fmt.Errorf("start embed: %w", err)
		}
	}
	if err := s.embedder.waitHealthy(ctx, embedProfileID); err != nil {
		return nil, nil, err
	}
	client := NewEmbedClient(prof.BaseURL())
	vecs, err := client.Embed(ctx, []string{query})
	if err != nil {
		return nil, nil, err
	}
	if len(vecs) != 1 || len(vecs[0]) == 0 {
		return nil, nil, errors.New("rag: query embedding empty")
	}
	blob, err := sqlite_vec.SerializeFloat32(vecs[0])
	if err != nil {
		return nil, nil, err
	}

	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.embedDim == 0 {
		// vec table not built — dense returns empty rather than erroring,
		// so SparseOnly fallback at the caller's layer can still produce
		// results in pure-FTS mode.
		return map[int64]int{}, map[int64]float64{}, nil
	}
	rows, err := idx.db.Query(`
		SELECT rowid, distance
		FROM vec_chunks
		WHERE embedding MATCH ? AND k = ?
		ORDER BY distance ASC`, blob, pool)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	ranks := make(map[int64]int)
	dists := make(map[int64]float64)
	r := 0
	for rows.Next() {
		var id int64
		var d float64
		if err := rows.Scan(&id, &d); err != nil {
			return nil, nil, err
		}
		ranks[id] = r
		dists[id] = d
		r++
	}
	return ranks, dists, rows.Err()
}

// allowedSourceIDs returns the set of chunk IDs whose `source` is in
// the supplied kinds list. Nil/empty kinds returns an empty set (a
// guard against accidentally matching everything when the caller
// forgot to defaults() — Search applies defaults upstream).
func allowedSourceIDs(idx *IndexDB, kinds []string) (map[int64]struct{}, error) {
	if len(kinds) == 0 {
		return map[int64]struct{}{}, nil
	}
	idx.mu.Lock()
	defer idx.mu.Unlock()
	placeholders := make([]string, len(kinds))
	args := make([]any, len(kinds))
	for i, k := range kinds {
		placeholders[i] = "?"
		args[i] = k
	}
	q := `SELECT id FROM chunks WHERE source IN (` + strings.Join(placeholders, ",") + `)`
	rows, err := idx.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := make(map[int64]struct{})
	for rows.Next() {
		var id int64
		if sErr := rows.Scan(&id); sErr != nil {
			return nil, sErr
		}
		set[id] = struct{}{}
	}
	return set, rows.Err()
}

// filterRanks keeps only entries whose ID is in `allowed`. Returns nil
// if the input is nil (preserves "ranker disabled" signal).
func filterRanks(in map[int64]int, allowed map[int64]struct{}) map[int64]int {
	if in == nil {
		return nil
	}
	out := make(map[int64]int, len(in))
	for id, r := range in {
		if _, ok := allowed[id]; ok {
			out[id] = r
		}
	}
	return out
}

// runSparse runs FTS5 BM25. SQLite returns BM25 as a negative value
// (more negative = better match); we flip the sign for display but
// rank ordering uses the raw column.
func runSparse(idx *IndexDB, query string, pool int) (map[int64]int, map[int64]float64, error) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	rows, err := idx.db.Query(`
		SELECT rowid, bm25(chunks_fts) AS score
		FROM chunks_fts
		WHERE chunks_fts MATCH ?
		ORDER BY score ASC
		LIMIT ?`, query, pool)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	ranks := make(map[int64]int)
	scores := make(map[int64]float64)
	r := 0
	for rows.Next() {
		var id int64
		var score float64
		if err := rows.Scan(&id, &score); err != nil {
			return nil, nil, err
		}
		ranks[id] = r
		scores[id] = score
		r++
	}
	return ranks, scores, rows.Err()
}

// rrfFuse merges dense and sparse rank maps into a single
// id → score table using the Reciprocal Rank Fusion formula
// score(d) = sum_r 1 / (k + rank_r(d)).
func rrfFuse(dense, sparse map[int64]int, k float64) map[int64]float64 {
	out := make(map[int64]float64, len(dense)+len(sparse))
	for id, r := range dense {
		out[id] += 1.0 / (k + float64(r))
	}
	for id, r := range sparse {
		out[id] += 1.0 / (k + float64(r))
	}
	return out
}

// scoredID is a small flat tuple for sort.
type scoredID struct {
	id    int64
	score float64
}

// topK returns the K highest-scoring ids, breaking ties by id ascending
// for stable test output.
func topK(scores map[int64]float64, k int) []scoredID {
	all := make([]scoredID, 0, len(scores))
	for id, s := range scores {
		all = append(all, scoredID{id, s})
	}
	// Insertion-style partial sort is fine: K is small, len(all) ≤ ~100.
	for i := 1; i < len(all); i++ {
		for j := i; j > 0; j-- {
			if all[j].score > all[j-1].score ||
				(all[j].score == all[j-1].score && all[j].id < all[j-1].id) {
				all[j], all[j-1] = all[j-1], all[j]
				continue
			}
			break
		}
	}
	if len(all) > k {
		all = all[:k]
	}
	return all
}

// hydrate joins ranked ids back to chunks rows for path/offsets/content.
func hydrate(idx *IndexDB, ranked []scoredID) ([]ChunkHit, error) {
	if len(ranked) == 0 {
		return nil, nil
	}
	idx.mu.Lock()
	defer idx.mu.Unlock()
	hits := make([]ChunkHit, 0, len(ranked))
	for _, r := range ranked {
		var h ChunkHit
		err := idx.db.QueryRow(
			`SELECT id, path, start_byte, end_byte, content FROM chunks WHERE id = ?`, r.id,
		).Scan(&h.ChunkID, &h.Path, &h.StartByte, &h.EndByte, &h.Content)
		if err != nil {
			return nil, fmt.Errorf("hydrate id=%d: %w", r.id, err)
		}
		h.Score = r.score
		hits = append(hits, h)
	}
	return hits, nil
}

