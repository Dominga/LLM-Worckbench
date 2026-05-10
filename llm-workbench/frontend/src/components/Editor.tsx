import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

export type EditorHandle = {
  getValue: () => string;
  appendText: (s: string) => void;
  setValue: (s: string) => void;
};

type Props = {
  initialDoc?: string;
  onReady?: (h: EditorHandle) => void;
  // Fires after the user (or programmatic dispatch) mutates the doc. The
  // callback receives the current full text.
  onChange?: (value: string) => void;
};

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
