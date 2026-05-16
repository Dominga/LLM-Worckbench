import katex from 'katex';

// Renders all <span class="math-inline|math-display"> nodes inside `root`
// in place, using their textContent as the LaTeX source. The Go markdown
// renderer (render.go + mathext.go) emits those spans; this pass converts
// them into typeset HTML on the client.
export function renderMathIn(root: HTMLElement | null): void {
  if (!root) return;
  const nodes = root.querySelectorAll<HTMLElement>('.math-inline, .math-display');
  nodes.forEach((node) => {
    if (node.dataset.katexRendered === '1') return;
    const src = node.textContent ?? '';
    if (!src) return;
    const display = node.classList.contains('math-display');
    try {
      katex.render(src, node, {
        displayMode: display,
        throwOnError: false,
        output: 'html',
      });
      node.dataset.katexRendered = '1';
    } catch {
      // leave raw LaTeX source as visible fallback
    }
  });
}
