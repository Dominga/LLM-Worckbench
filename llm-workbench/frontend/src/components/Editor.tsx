import { useEffect, useRef } from 'react';
import { EditorState, EditorSelection, StateEffect, StateField } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  Decoration,
  DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

export type EditorHandle = {
  getValue: () => string;
  appendText: (s: string) => void;
  setValue: (s: string) => void;
  // Scroll to (and briefly flash-highlight) a byte range — used by /search
  // hit clicks. Byte offsets are converted to char offsets here. (TD8)
  revealByteRange: (startByte: number, endByte: number) => void;
};

type Props = {
  initialDoc?: string;
  onReady?: (h: EditorHandle) => void;
  // Fires after the user (or programmatic dispatch) mutates the doc. The
  // callback receives the current full text.
  onChange?: (value: string) => void;
};

// UTF-8 byte offset → JS string (UTF-16 code-unit) offset, snapping to the
// nearest codepoint boundary if `byteTarget` lands inside one.
function byteToCharOffset(text: string, byteTarget: number): number {
  if (byteTarget <= 0) return 0;
  let byteCount = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const cpBytes = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    const cpUnits = cp > 0xffff ? 2 : 1;
    if (byteCount + cpBytes > byteTarget) return i; // target inside this codepoint
    byteCount += cpBytes;
    i += cpUnits;
    if (byteCount >= byteTarget) return i;
  }
  return text.length;
}

const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashMark = Decoration.mark({ class: 'cm-search-flash' });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlash)) {
        deco = e.value && e.value.to > e.value.from
          ? Decoration.set([flashMark.range(e.value.from, e.value.to)])
          : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function MarkdownEditor({ initialDoc = '', onReady, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Latest onChange in a ref so the editor doesn't have to be torn down
  // when the parent rerenders with a new closure.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Token guards re-entrancy: programmatic setValue/appendText must not
  // fire onChange (it would mark a freshly-loaded file dirty).
  const programmaticRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        flashField,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (programmaticRef.current) return;
          onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    const dispatchSilently = (changes: any, selection?: any) => {
      programmaticRef.current = true;
      try {
        view.dispatch({ changes, ...(selection ? { selection } : {}), scrollIntoView: true });
      } finally {
        programmaticRef.current = false;
      }
    };

    const handle: EditorHandle = {
      getValue: () => view.state.doc.toString(),
      appendText: (s: string) => {
        const len = view.state.doc.length;
        // appendText is used for streaming token deltas — those should
        // *not* count as user edits, so suppress the change event.
        dispatchSilently(
          { from: len, insert: s },
          { anchor: len + s.length },
        );
      },
      setValue: (s: string) => {
        dispatchSilently({ from: 0, to: view.state.doc.length, insert: s });
      },
      revealByteRange: (startByte: number, endByte: number) => {
        const docLen = view.state.doc.length;
        const text = view.state.doc.toString();
        let from = Math.min(byteToCharOffset(text, startByte), docLen);
        let to = Math.min(byteToCharOffset(text, endByte), docLen);
        if (to < from) to = from;
        const sel = EditorSelection.range(from, to);
        const effects: StateEffect<any>[] = [EditorView.scrollIntoView(sel, { y: 'center' })];
        if (to > from) effects.push(setFlash.of({ from, to }));
        view.dispatch({ selection: sel, effects });
        if (to > from) {
          window.setTimeout(() => {
            if (viewRef.current === view) view.dispatch({ effects: setFlash.of(null) });
          }, 1800);
        }
      },
    };
    onReady?.(handle);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
}
