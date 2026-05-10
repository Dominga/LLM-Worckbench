package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// EmbedClient talks to a llama-server `/v1/embeddings` endpoint
// (OpenAI-compatible). Stateless — one client per request batch is fine,
// but reusing the http.Client across calls keeps connections pooled.
type EmbedClient struct {
	BaseURL string
	Client  *http.Client
}

// NewEmbedClient builds a client with sensible timeouts for local
// llama-server: the embed call itself can take seconds for large
// batches, so the read timeout is generous.
func NewEmbedClient(baseURL string) *EmbedClient {
	return &EmbedClient{
		BaseURL: baseURL,
		Client:  &http.Client{Timeout: 120 * time.Second},
	}
}

type embedRequest struct {
	Input []string `json:"input"`
	Model string   `json:"model,omitempty"`
}

type embedResponseItem struct {
	Object    string    `json:"object"`
	Embedding []float32 `json:"embedding"`
	Index     int       `json:"index"`
}

type embedResponse struct {
	Object string              `json:"object"`
	Model  string              `json:"model"`
	Data   []embedResponseItem `json:"data"`
}

// Embed sends `texts` in one HTTP call and returns vectors in input
// order. Caller is responsible for batching; llama-server has its own
// per-request limit (effective batch ≤ -b/ub flag, often 2048 tokens).
func (c *EmbedClient) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	body, err := json.Marshal(embedRequest{Input: texts})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.BaseURL+"/v1/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embed request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		buf, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embed http %d: %s", resp.StatusCode, string(buf))
	}
	var er embedResponse
	if err := json.NewDecoder(resp.Body).Decode(&er); err != nil {
		return nil, fmt.Errorf("embed decode: %w", err)
	}
	if len(er.Data) != len(texts) {
		return nil, fmt.Errorf("embed: requested %d, got %d", len(texts), len(er.Data))
	}
	out := make([][]float32, len(texts))
	for _, item := range er.Data {
		if item.Index < 0 || item.Index >= len(out) {
			return nil, fmt.Errorf("embed: bad index %d", item.Index)
		}
		out[item.Index] = item.Embedding
	}
	return out, nil
}
