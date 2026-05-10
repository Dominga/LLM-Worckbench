import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerPlay,
  IconDeviceFloppy,
  IconTrash,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';
import { V5 } from '../theme';
import { Project } from '../shell/types';
import {
  ListScripts,
  LoadScript,
  SaveScript,
  DeleteScript,
  RunScript,
} from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';

const STARTER_SCRIPT = `// Prompt-Lab script. Available globals:
//   app.log(...args)
//   app.fs.read(path) / app.fs.write(path, content) / app.fs.list()
//   app.rag.search(query, { k, embedProfileId })
//   app.chat.complete({ messages, profileId, temperature })
//   app.project.{ id, name, path }

const hits = app.rag.search("TODO", { k: 5 });
app.log("found", hits.length, "hits");
hits.forEach(h => app.log(h.path, "·", h.score.toFixed(4)));
`;

export type LabTabProps = {
  activeProject: Project | null;
};

export function LabTab({ activeProject }: LabTabProps) {
  const [scripts, setScripts] = useState<main.ScriptFile[]>([]);
  const [selectedName, setSelectedName] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [source, setSource] = useState<string>(STARTER_SCRIPT);
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<main.ScriptResult | null>(null);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const programmaticRef = useRef(false);
  const sourceRef = useRef<string>(source);
  sourceRef.current = source;

  const refreshScripts = async () => {
    if (!activeProject) {
      setScripts([]);
      return;
    }
    try {
      const list = (await ListScripts(activeProject.ID)) || [];
      setScripts(list);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'List scripts failed', message: String(e?.message ?? e) });
    }
  };
  useEffect(() => {
    refreshScripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.ID]);

  // CodeMirror setup. One-shot — content is driven by `source` via
  // programmatic dispatches so external loads don't fight CM's internal
  // state.
  useEffect(() => {
    if (!editorHostRef.current) return;
    const state = EditorState.create({
      doc: source,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        javascript(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          if (programmaticRef.current) return;
          const v = u.state.doc.toString();
          setSource(v);
          setDirty(true);
        }),
      ],
    });
    const view = new EditorView({ state, parent: editorHostRef.current });
    editorViewRef.current = view;
    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External source changes (Load button) → push into CM6.
  useEffect(() => {
    const v = editorViewRef.current;
    if (!v) return;
    if (v.state.doc.toString() === source) return;
    programmaticRef.current = true;
    try {
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: source },
      });
    } finally {
      programmaticRef.current = false;
    }
  }, [source]);

  const onLoad = async (name: string) => {
    if (!activeProject) return;
    try {
      const src = await LoadScript(activeProject.ID, name);
      setSelectedName(name);
      setNameInput(name);
      setSource(src);
      setDirty(false);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Load failed', message: String(e?.message ?? e) });
    }
  };

  const onSave = async () => {
    if (!activeProject) {
      notifications.show({ color: 'gray', title: 'No project', message: 'Open a project first.' });
      return;
    }
    const name = nameInput.trim();
    if (!name) {
      notifications.show({ color: 'red', title: 'Name required', message: 'Pick a name for this script.' });
      return;
    }
    try {
      await SaveScript(activeProject.ID, name, sourceRef.current);
      setSelectedName(name);
      setDirty(false);
      await refreshScripts();
      notifications.show({ color: 'teal', title: 'Saved', message: name });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Save failed', message: String(e?.message ?? e) });
    }
  };

  const onDelete = async (name: string) => {
    if (!activeProject) return;
    if (!confirm(`Delete script "${name}"?`)) return;
    try {
      await DeleteScript(activeProject.ID, name);
      if (selectedName === name) {
        setSelectedName('');
        setNameInput('');
        setSource(STARTER_SCRIPT);
        setDirty(false);
      }
      await refreshScripts();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Delete failed', message: String(e?.message ?? e) });
    }
  };

  const onNew = () => {
    setSelectedName('');
    setNameInput('');
    setSource(STARTER_SCRIPT);
    setDirty(false);
    setResult(null);
  };

  const onRun = async () => {
    if (!activeProject) {
      notifications.show({ color: 'gray', title: 'No project', message: 'Open a project first.' });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const r = await RunScript(activeProject.ID, sourceRef.current);
      setResult(r);
      if (r.error) {
        notifications.show({ color: 'red', title: 'Script error', message: r.error });
      }
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Run failed', message: String(e?.message ?? e) });
    } finally {
      setRunning(false);
    }
  };

  if (!activeProject) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: V5.textDim,
          fontStyle: 'italic',
        }}
      >
        Open a project to use Prompt Lab.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, background: V5.bg }}>
      {/* Scripts list */}
      <div
        style={{
          width: 200,
          borderRight: `1px solid ${V5.border}`,
          display: 'flex',
          flexDirection: 'column',
          flex: 'none',
        }}
      >
        <div
          style={{
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            borderBottom: `1px solid ${V5.borderSoft}`,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: V5.textMuted, flex: 1 }}>
            scripts
          </span>
          <button onClick={onNew} title="New script" style={smallBtnStyle()}>
            <IconPlus size={11} />
          </button>
          <button onClick={refreshScripts} title="Reload list" style={smallBtnStyle()}>
            <IconRefresh size={11} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
          {scripts.length === 0 ? (
            <div style={{ fontSize: 11, color: V5.textDim, fontStyle: 'italic', padding: '6px 8px' }}>
              No scripts yet. Save the current buffer to create one.
            </div>
          ) : (
            scripts.map((s) => (
              <div
                key={s.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 6px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: s.name === selectedName ? V5.surface : 'transparent',
                  marginBottom: 2,
                }}
                onClick={() => onLoad(s.name)}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontFamily: 'ui-monospace, monospace',
                    color: s.name === selectedName ? V5.text : V5.textMuted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.name);
                  }}
                  title="Delete"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: V5.textDim,
                    cursor: 'pointer',
                    padding: 2,
                  }}
                >
                  <IconTrash size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor + output */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderBottom: `1px solid ${V5.borderSoft}`,
            background: V5.surface2,
          }}
        >
          <input
            type="text"
            placeholder="script name"
            value={nameInput}
            onChange={(e) => setNameInput(e.currentTarget.value)}
            style={{
              padding: '4px 8px',
              background: V5.bg,
              border: `1px solid ${V5.borderSoft}`,
              borderRadius: 4,
              color: V5.text,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              width: 200,
            }}
          />
          {dirty && (
            <span style={{ fontSize: 11, color: V5.warn }} title="Unsaved changes">
              ●
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onSave} style={toolBtnStyle()} title="Save (overwrites)">
            <IconDeviceFloppy size={12} /> save
          </button>
          <button
            onClick={onRun}
            disabled={running}
            style={toolBtnStyle(running)}
            title="Run script (Ctrl+Enter)"
          >
            <IconPlayerPlay size={12} /> {running ? 'running…' : 'run'}
          </button>
        </div>

        {/* Editor */}
        <div
          ref={editorHostRef}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onRun();
            }
            if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
              e.preventDefault();
              onSave();
            }
          }}
          style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
        />

        {/* Output */}
        <div
          style={{
            height: 240,
            borderTop: `1px solid ${V5.border}`,
            display: 'flex',
            flexDirection: 'column',
            background: V5.surface,
            flex: 'none',
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              borderBottom: `1px solid ${V5.borderSoft}`,
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              color: V5.textMuted,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>output</span>
            {result && (
              <span style={{ fontWeight: 400, color: V5.textDim }}>
                {result.durationMs}ms
                {result.output && result.output.length > 0 ? ` · ${result.output.length} lines` : ''}
              </span>
            )}
          </div>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '8px 12px',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              lineHeight: 1.55,
              color: V5.text,
              whiteSpace: 'pre-wrap',
            }}
          >
            {result?.error && (
              <div style={{ color: V5.danger, marginBottom: 8 }}>error: {result.error}</div>
            )}
            {result?.output && result.output.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {result && (result.return !== undefined && result.return !== null) && (
              <div style={{ color: V5.accent, marginTop: 8 }}>
                ⇒ {typeof result.return === 'string' ? result.return : JSON.stringify(result.return, null, 2)}
              </div>
            )}
            {!result && (
              <div style={{ color: V5.textDim, fontStyle: 'italic' }}>
                # run to see output
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function smallBtnStyle() {
  return {
    background: 'transparent',
    border: `1px solid ${V5.borderSoft}`,
    color: V5.textMuted,
    cursor: 'pointer',
    padding: '2px 5px',
    borderRadius: 3,
    fontSize: 10,
    display: 'inline-flex',
    alignItems: 'center',
  } as const;
}

function toolBtnStyle(disabled = false) {
  return {
    padding: '4px 10px',
    background: disabled ? V5.surface2 : V5.surface,
    color: disabled ? V5.textDim : V5.text,
    border: `1px solid ${V5.borderSoft}`,
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 11,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'inherit',
  } as const;
}
