package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mockEmbedServer returns vectors of the given dim, where vec[i][0] = i
// so we can assert ordering after Embed reorders by `index`. Other
// dimensions are zero — content of vector doesn't matter for this test.
func mockEmbedServer(t *testing.T, dim int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
		}
		var req embedRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode: %v", err)
			http.Error(w, "bad", 400)
			return
		}
		// Respond out of order intentionally to exercise reordering.
		data := make([]embedResponseItem, len(req.Input))
		for i := range req.Input {
			vec := make([]float32, dim)
			vec[0] = float32(i)
			data[len(req.Input)-1-i] = embedResponseItem{
				Object:    "embedding",
				Index:     i,
				Embedding: vec,
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(embedResponse{
			Object: "list", Model: "mock", Data: data,
		})
	}))
}

func TestEmbedClientReordersByIndex(t *testing.T) {
	srv := mockEmbedServer(t, 8)
	defer srv.Close()

	client := NewEmbedClient(srv.URL)
	ctx := context.Background()
	got, err := client.Embed(ctx, []string{"a", "b", "c"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	for i, v := range got {
		if len(v) != 8 {
			t.Fatalf("vec %d dim = %d, want 8", i, len(v))
		}
		if v[0] != float32(i) {
			t.Fatalf("vec %d[0] = %v, want %v (reorder broken)", i, v[0], float32(i))
		}
	}
}

func TestEmbedClientEmptyInput(t *testing.T) {
	c := NewEmbedClient("http://127.0.0.1:0")
	got, err := c.Embed(context.Background(), nil)
	if err != nil {
		t.Fatalf("err = %v, want nil for empty input", err)
	}
	if got != nil {
		t.Fatalf("got = %v, want nil for empty input", got)
	}
}

func TestEmbedClientHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "kaboom", 500)
	}))
	defer srv.Close()

	c := NewEmbedClient(srv.URL)
	if _, err := c.Embed(context.Background(), []string{"x"}); err == nil {
		t.Fatal("expected error from 500")
	}
}
