package main

import (
	"bytes"
	"regexp"
	"strings"
	"time"

	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
)

type Renderer struct {
	md       goldmark.Markdown
	policy   *bluemonday.Policy
}

func NewRenderer() *Renderer {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM, extension.Strikethrough, extension.Table, extension.TaskList, MathExt),
		goldmark.WithParserOptions(parser.WithAutoHeadingID()),
		goldmark.WithRendererOptions(html.WithUnsafe()),
	)
	policy := bluemonday.UGCPolicy()
	// Allow the math span markers produced by MathExt through the sanitizer
	// so the frontend KaTeX pass can find and replace them.
	policy.AllowAttrs("class").Matching(regexp.MustCompile(`^math-(inline|display)$`)).OnElements("span")
	return &Renderer{
		md:     md,
		policy: policy,
	}
}

type RenderResult struct {
	HTML     string `json:"html"`
	ParseMs  int64  `json:"parseMs"`
	Bytes    int    `json:"bytes"`
	HTMLSize int    `json:"htmlSize"`
}

func (r *Renderer) Render(src string) RenderResult {
	t0 := time.Now()
	var buf bytes.Buffer
	buf.Grow(len(src) * 2)
	if err := r.md.Convert([]byte(src), &buf); err != nil {
		return RenderResult{HTML: "<pre>render error: " + err.Error() + "</pre>"}
	}
	clean := r.policy.SanitizeReader(&buf)
	out := strings.Builder{}
	out.Grow(buf.Len())
	clean.WriteTo(&out)
	parseMs := time.Since(t0).Milliseconds()
	return RenderResult{
		HTML:     out.String(),
		ParseMs:  parseMs,
		Bytes:    len(src),
		HTMLSize: out.Len(),
	}
}
