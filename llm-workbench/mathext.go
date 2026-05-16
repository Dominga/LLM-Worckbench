package main

import (
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Minimal LaTeX math extension for goldmark.
//
// Recognizes `$...$` (inline) and `$$...$$` (display) on a single line and
// emits `<span class="math-inline">...</span>` / `<span class="math-display">...</span>`
// containing the raw, HTML-escaped LaTeX source. The frontend (KaTeX
// auto-render or equivalent) is responsible for the actual typesetting.
//
// Multi-line display math is intentionally not supported here — extend later
// if needed.

var kindMath = ast.NewNodeKind("Math")

type mathNode struct {
	ast.BaseInline
	Source  []byte
	Display bool
}

func (n *mathNode) Kind() ast.NodeKind          { return kindMath }
func (n *mathNode) Dump(src []byte, level int) { ast.DumpHelper(n, src, level, nil, nil) }

type mathInlineParser struct{}

func (p *mathInlineParser) Trigger() []byte { return []byte{'$'} }

func (p *mathInlineParser) Parse(parent ast.Node, block text.Reader, pc parser.Context) ast.Node {
	line, _ := block.PeekLine()
	if len(line) < 2 || line[0] != '$' {
		return nil
	}
	display := len(line) >= 4 && line[1] == '$'

	var openLen int
	var closer []byte
	if display {
		openLen = 2
		closer = []byte("$$")
	} else {
		// Pandoc-style guard: opener must not be followed by whitespace.
		if line[1] == ' ' || line[1] == '\t' || line[1] == '\n' || line[1] == '$' {
			return nil
		}
		openLen = 1
		closer = []byte("$")
	}

	rest := line[openLen:]
	idx := -1
	for i := 0; i+len(closer) <= len(rest); i++ {
		if rest[i] == '\\' { // skip escaped char
			i++
			continue
		}
		if string(rest[i:i+len(closer)]) != string(closer) {
			continue
		}
		if !display {
			if i == 0 {
				return nil // empty `$$` already handled as display
			}
			if c := rest[i-1]; c == ' ' || c == '\t' || c == '\n' {
				continue
			}
			// Avoid eating the first `$` of a `$$` closer when only one `$` was expected.
			if i+1 < len(rest) && rest[i+1] == '$' {
				continue
			}
		}
		idx = i
		break
	}
	if idx < 0 {
		return nil
	}

	src := make([]byte, idx)
	copy(src, rest[:idx])
	block.Advance(openLen + idx + len(closer))
	return &mathNode{Source: src, Display: display}
}

type mathHTMLRenderer struct{}

func (r *mathHTMLRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindMath, r.render)
}

func (r *mathHTMLRenderer) render(w util.BufWriter, src []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	m := n.(*mathNode)
	if m.Display {
		_, _ = w.WriteString(`<span class="math-display">`)
	} else {
		_, _ = w.WriteString(`<span class="math-inline">`)
	}
	_, _ = w.Write(util.EscapeHTML(m.Source))
	_, _ = w.WriteString(`</span>`)
	return ast.WalkSkipChildren, nil
}

type mathExtension struct{}

// MathExt is a goldmark extension that turns `$…$` / `$$…$$` spans into
// span elements consumable by a client-side KaTeX auto-render pass.
var MathExt = &mathExtension{}

func (e *mathExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithInlineParsers(
		util.Prioritized(&mathInlineParser{}, 150),
	))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(
		util.Prioritized(&mathHTMLRenderer{}, 150),
	))
}
