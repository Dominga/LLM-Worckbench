package main

import (
	"crypto/sha256"
	"encoding/hex"
)

// Chunk is one indexed slice of a source file. Byte offsets refer to the
// original file content (UTF-8, including any leading BOM) so chunk →
// citation maps exactly to the on-disk bytes.
type Chunk struct {
	Path      string
	StartByte int
	EndByte   int
	Content   string
	SHA256    string
}

// Chunker splits a file's content into overlapping chunks suitable for
// embedding. Token budgeting is approximated as 4 chars/token, which is
// the conservative default for English/Russian on most BPE tokenizers
// (BGE-M3, GPT-2-style). Real token counts are computed by the embedding
// server when needed.
type Chunker struct {
	// TargetChars is the soft size cap for one chunk. Splits prefer to
	// land on paragraph/line boundaries below this.
	TargetChars int
	// OverlapChars is how many trailing characters of the previous chunk
	// are prepended to the next, so cross-boundary semantics aren't lost.
	OverlapChars int
}

// DefaultChunker returns a chunker with the M2 baseline: 512-token
// target (~2048 chars), 64-token overlap (~256 chars). Tunable per
// project via `[indexing]` in project.toml.
func DefaultChunker() *Chunker {
	return &Chunker{TargetChars: 2048, OverlapChars: 256}
}

// Chunk splits `content` into ordered chunks. Empty input yields nil.
// Splits cascade: paragraph (\n\n) → line (\n) → hard char-split — each
// step kicks in only when the previous one produced an oversize block.
// Each emitted chunk's StartByte/EndByte point into `content` so a
// downstream reader can reopen the file and reconstruct the slice
// without re-splitting.
func (c *Chunker) Chunk(path, content string) []Chunk {
	if c.TargetChars <= 0 {
		c.TargetChars = 2048
	}
	if c.OverlapChars < 0 {
		c.OverlapChars = 0
	}
	if c.OverlapChars >= c.TargetChars {
		c.OverlapChars = c.TargetChars / 4
	}
	if len(content) == 0 {
		return nil
	}

	spans := paragraphSpans(content)
	chunks := mergeSpans(spans, content, c.TargetChars)
	chunks = applyOverlap(chunks, content, c.OverlapChars)

	out := make([]Chunk, 0, len(chunks))
	for _, sp := range chunks {
		body := content[sp.start:sp.end]
		sum := sha256.Sum256([]byte(body))
		out = append(out, Chunk{
			Path:      path,
			StartByte: sp.start,
			EndByte:   sp.end,
			Content:   body,
			SHA256:    hex.EncodeToString(sum[:]),
		})
	}
	return out
}

// span is a half-open byte range [start, end) into the source content.
type span struct{ start, end int }

// paragraphSpans walks the content and emits a span per paragraph (a
// run separated from neighbours by a blank line). Blocks larger than
// any reasonable chunk are hard-split downstream by mergeSpans.
func paragraphSpans(content string) []span {
	var out []span
	i := 0
	n := len(content)
	for i < n {
		// Skip leading blank-line separators.
		for i < n && (content[i] == '\n' || content[i] == '\r') {
			i++
		}
		if i >= n {
			break
		}
		start := i
		// Walk until we hit a blank line (\n\n or \r\n\r\n) or EOF.
		for i < n {
			if content[i] == '\n' && i+1 < n && content[i+1] == '\n' {
				break
			}
			if content[i] == '\n' && i+2 < n && content[i+1] == '\r' && content[i+2] == '\n' {
				break
			}
			i++
		}
		end := i
		if end > start {
			out = append(out, span{start, end})
		}
	}
	return out
}

// lineSpans is the second-level fallback when a paragraph alone busts
// the size budget. Splits on newline and emits one span per line.
func lineSpans(content string, base span) []span {
	var out []span
	i := base.start
	for i < base.end {
		start := i
		for i < base.end && content[i] != '\n' {
			i++
		}
		end := i
		if end > start {
			out = append(out, span{start, end})
		}
		if i < base.end {
			i++ // skip the newline itself
		}
	}
	return out
}

// hardSplit slices [base) into fixed-size pieces of at most maxChars.
// Last-resort: a single long line with no whitespace anywhere.
func hardSplit(base span, maxChars int) []span {
	var out []span
	for i := base.start; i < base.end; i += maxChars {
		end := i + maxChars
		if end > base.end {
			end = base.end
		}
		out = append(out, span{i, end})
	}
	return out
}

// mergeSpans accumulates input spans into chunks not exceeding target.
// If any single input span is itself larger than target, it cascades
// through line-split → hard-split until each piece fits.
func mergeSpans(spans []span, content string, target int) []span {
	var out []span
	cur := span{-1, -1}

	flush := func() {
		if cur.start >= 0 && cur.end > cur.start {
			out = append(out, cur)
		}
		cur = span{-1, -1}
	}

	for _, sp := range spans {
		size := sp.end - sp.start
		if size > target {
			flush()
			// Break it down.
			lines := lineSpans(content, sp)
			if len(lines) <= 1 {
				out = append(out, hardSplit(sp, target)...)
				continue
			}
			out = append(out, mergeSpans(lines, content, target)...)
			continue
		}
		if cur.start < 0 {
			cur = sp
			continue
		}
		if (cur.end - cur.start) + 1 + size <= target {
			cur.end = sp.end
		} else {
			flush()
			cur = sp
		}
	}
	flush()
	return out
}

// applyOverlap rewrites each non-first chunk to start `overlap` bytes
// earlier (clamped to 0) so adjacent chunks share context. The original
// chunk boundaries are left intact for the previous chunks; only the
// later one's StartByte moves backwards.
func applyOverlap(spans []span, content string, overlap int) []span {
	if overlap <= 0 || len(spans) <= 1 {
		return spans
	}
	out := make([]span, len(spans))
	out[0] = spans[0]
	for i := 1; i < len(spans); i++ {
		s := spans[i].start - overlap
		// Don't underflow into a previous chunk's start.
		if i > 0 && s < spans[i-1].start {
			s = spans[i-1].start
		}
		if s < 0 {
			s = 0
		}
		// Snap to a UTF-8 boundary so we never split a multibyte rune.
		for s > 0 && s < len(content) && (content[s]&0xC0) == 0x80 {
			s--
		}
		out[i] = span{s, spans[i].end}
	}
	return out
}

