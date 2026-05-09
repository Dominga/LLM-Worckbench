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
};

export function MarkdownEditor({ initialDoc = '', onReady }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

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
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    const handle: EditorHandle = {
      getValue: () => view.state.doc.toString(),
      appendText: (s: string) => {
        const len = view.state.doc.length;
        view.dispatch({
          changes: { from: len, insert: s },
          selection: { anchor: len + s.length },
          scrollIntoView: true,
        });
      },
      setValue: (s: string) => {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: s },
        });
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
