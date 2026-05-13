import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { notifications } from '@mantine/notifications';
import {
  TextInput,
  Textarea,
  Select,
  TagsInput,
  ColorInput,
  Switch,
  ActionIcon,
  Button,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconPlayerPlay,
  IconDeviceFloppy,
  IconTrash,
  IconPlus,
  IconRefresh,
  IconCode,
  IconLayoutSidebar,
  IconX,
} from '@tabler/icons-react';
import { V5 } from '../theme';
import { Mode, ModeParam, Project } from '../shell/types';
import {
  ListScripts,
  LoadScript,
  SaveScript,
  DeleteScript,
  RunScript,
  ListModes,
  LoadModeTemplate,
  SaveMode,
  PreviewModeTemplate,
  RemoveProjectModeOverride,
} from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';

// ── {{placeholder}} highlighting for the mode-template editor ──
const modePlaceholderRe = /\{\{[^}]*\}\}/g;
const modePlaceholderMark = Decoration.mark({ class: 'cm-mode-ph' });
const modePlaceholderTheme = EditorView.theme({
  '.cm-mode-ph': { color: '#fbbf24', fontWeight: '600' },
});
function buildPlaceholderDecos(view: EditorView): DecorationSet {
  try {
    const b = new RangeSetBuilder<Decoration>();
    const text = view.state.doc.toString();
    modePlaceholderRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = modePlaceholderRe.exec(text))) {
      if (m[0].length === 0) break;
      b.add(m.index, m.index + m[0].length, modePlaceholderMark);
    }
    return b.finish();
  } catch {
    return Decoration.none;
  }
}
const modePlaceholderHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildPlaceholderDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = buildPlaceholderDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

type ModeDef = {
  name: string;
  color: string;
  desc: string;
  approval: string;
  context: string;
  toolWhitelist: string[];
  params: ModeParam[];
};
const emptyModeDef = (): ModeDef => ({
  name: '',
  color: '#3b82f6',
  desc: '',
  approval: 'always',
  context: 'rag-explicit',
  toolWhitelist: [],
  params: [],
});
const KNOWN_TOOLS = ['search_semantic', 'read_file', 'list_files', 'edit_file'];
function coerceParamDefault(type: string, v: any): any {
  if (type === 'int' || type === 'number') {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? (type === 'int' ? Math.trunc(n) : n) : 0;
  }
  if (type === 'bool') return v === true || v === 'true' || v === '1';
  return v == null ? '' : String(v);
}

type SubTab = 'modes' | 'scripts';

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
  const [sub, setSub] = useState<SubTab>('modes');

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: V5.bg }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderBottom: `1px solid ${V5.borderSoft}`,
          background: V5.surface2,
          flex: 'none',
        }}
      >
        <SegmentButton active={sub === 'modes'} onClick={() => setSub('modes')} icon={<IconLayoutSidebar size={11} />}>
          Modes
        </SegmentButton>
        <SegmentButton active={sub === 'scripts'} onClick={() => setSub('scripts')} icon={<IconCode size={11} />}>
          Scripts
        </SegmentButton>
      </div>
      {sub === 'modes' ? (
        <ModesPanel activeProject={activeProject} />
      ) : (
        <ScriptsPanel activeProject={activeProject} />
      )}
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? V5.surface : 'transparent',
        color: active ? V5.text : V5.textMuted,
        border: `1px solid ${active ? V5.borderSoft : 'transparent'}`,
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 11,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'inherit',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ─────────────────────────── Modes panel ───────────────────────────

function ModesPanel({ activeProject }: { activeProject: Project }) {
  const [modes, setModes] = useState<Mode[]>([]);
  // baseModes is the builtin + global merged view (no project layer). Used
  // to detect "overridden in this project" rows and to know which IDs
  // would survive removing the project override.
  const [baseModes, setBaseModes] = useState<Mode[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [template, setTemplate] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [paramVals, setParamVals] = useState<Record<string, any>>({});
  const [preview, setPreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [def, setDef] = useState<ModeDef>(emptyModeDef());
  // saveScope picks the destination for the next save: "project" writes
  // an override into <project>/.llm-workshop/modes/; "global" writes
  // into <globalModesDir>/ and is visible across every project.
  const [saveScope, setSaveScope] = useState<'project' | 'global'>('project');

  const updateDef = (patch: Partial<ModeDef>) => {
    setDef((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const updateParam = (i: number, patch: Partial<ModeParam>) => {
    setDef((d) => ({ ...d, params: d.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
    setDirty(true);
  };

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const programmaticRef = useRef(false);
  const templateRef = useRef(template);
  templateRef.current = template;
  const paramRef = useRef(paramVals);
  paramRef.current = paramVals;

  const selected = useMemo(() => modes.find((m) => m.id === selectedId), [modes, selectedId]);

  const refreshModes = async () => {
    try {
      const [list, base] = await Promise.all([
        ListModes(activeProject.ID) as Promise<Mode[]>,
        // Empty projectID skips the project layer — gives us the
        // builtin+global fallback set for the override badge.
        ListModes('') as Promise<Mode[]>,
      ]);
      setModes(list || []);
      setBaseModes(base || []);
      if (!selectedId && list && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'List modes failed', message: String(e?.message ?? e) });
    }
  };

  // Map of mode IDs that have a non-project fallback layer. Used to decide
  // whether "Remove project override" is safe (mode survives the removal)
  // and to render the "overridden" badge for project-layer rows.
  const baseIds = useMemo(() => new Set(baseModes.map((m) => m.id)), [baseModes]);
  const selectedHasOverride = selected?.source === 'project';
  const selectedHasFallback = selected ? baseIds.has(selected.id) : false;
  useEffect(() => {
    refreshModes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject.ID]);

  // Load template on selection change.
  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const body = (await LoadModeTemplate(activeProject.ID, selectedId)) || '';
        setTemplate(body);
        setDirty(false);
        // Push directly into CM6 too — the [template] effect should also
        // do this, but doing it here removes any mount-order ambiguity.
        const v = editorViewRef.current;
        if (v && v.state.doc.toString() !== body) {
          programmaticRef.current = true;
          try {
            v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: body } });
          } finally {
            programmaticRef.current = false;
          }
        }
        // Seed param form from mode.params defaults.
        const m = modes.find((x) => x.id === selectedId);
        const seeded: Record<string, any> = {};
        (m?.params || []).forEach((p) => {
          seeded[p.name] = p.default ?? paramTypeDefault(p.type);
        });
        setParamVals(seeded);
        setDef(
          m
            ? {
                name: m.name ?? '',
                color: m.color ?? '#3b82f6',
                desc: (m as any).desc ?? '',
                approval: (m as any).approval ?? 'always',
                context: (m as any).context ?? 'rag-explicit',
                toolWhitelist: (((m as any).toolWhitelist ?? []) as string[]).slice(),
                params: (((m as any).params ?? []) as ModeParam[]).map((p) => ({ ...p })),
              }
            : emptyModeDef(),
        );
        // Default save destination: if the mode currently resolves from
        // the project layer, save back to project; otherwise (global,
        // builtin) save to global so edits propagate to every project.
        setSaveScope(m?.source === 'project' ? 'project' : 'global');
      } catch (e: any) {
        notifications.show({ color: 'red', title: 'Load template failed', message: String(e?.message ?? e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, modes]);

  // CM6 markdown editor.
  useEffect(() => {
    if (!editorHostRef.current) return;
    const state = EditorState.create({
      doc: template,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        modePlaceholderHighlighter,
        modePlaceholderTheme,
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          if (programmaticRef.current) return;
          const v = u.state.doc.toString();
          setTemplate(v);
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

  // External template change → push to CM6.
  useEffect(() => {
    const v = editorViewRef.current;
    if (!v) return;
    if (v.state.doc.toString() === template) return;
    programmaticRef.current = true;
    try {
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: template },
      });
    } finally {
      programmaticRef.current = false;
    }
  }, [template]);

  // Live preview, debounced.
  useEffect(() => {
    const handle = window.setTimeout(async () => {
      if (!selectedId) {
        setPreview('');
        return;
      }
      try {
        const out = await PreviewModeTemplate(
          activeProject.ID,
          selectedId,
          templateRef.current,
          paramRef.current,
        );
        setPreview(out || '');
      } catch (e: any) {
        setPreview(`# preview error: ${e?.message ?? e}`);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [template, paramVals, selectedId, activeProject.ID]);

  const onSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const m = new main.Mode({
        name: def.name.trim() || selectedId,
        color: def.color || '#3b82f6',
        desc: def.desc,
        approval: def.approval,
        context: def.context,
        toolWhitelist: def.toolWhitelist,
        params: def.params
          .filter((p) => p.name.trim() !== '')
          .map(
            (p) =>
              new main.ModeParam({
                name: p.name.trim(),
                type: p.type || 'string',
                default: coerceParamDefault(p.type || 'string', p.default),
                required: !!p.required,
                description: (p as any).description ?? '',
              }),
          ),
      });
      await SaveMode(saveScope, activeProject.ID, selectedId, m, templateRef.current);
      setDirty(false);
      await refreshModes();
      notifications.show({
        color: 'teal',
        title: 'Saved',
        message: `${selectedId} (${saveScope})`,
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Save failed', message: String(e?.message ?? e) });
    } finally {
      setSaving(false);
    }
  };

  const onRemoveOverride = async () => {
    if (!selectedId) return;
    const confirmed = window.confirm(
      `Remove project override for "${selectedId}"?\n\n` +
        (selectedHasFallback
          ? 'The mode will fall back to its global/builtin definition.'
          : 'This mode has no global/builtin fallback — it will disappear from this project.'),
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await RemoveProjectModeOverride(activeProject.ID, selectedId);
      setDirty(false);
      await refreshModes();
      notifications.show({ color: 'teal', title: 'Override removed', message: selectedId });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Remove failed', message: String(e?.message ?? e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      {/* Mode list */}
      <div
        style={{
          width: 220,
          borderRight: `1px solid ${V5.border}`,
          display: 'flex',
          flexDirection: 'column',
          flex: 'none',
        }}
      >
        <div
          style={{
            padding: '10px 12px',
            borderBottom: `1px solid ${V5.borderSoft}`,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={sectionLabelStyle()}>modes</span>
          <span style={{ flex: 1 }} />
          <button onClick={refreshModes} title="Reload" style={smallBtnStyle()}>
            <IconRefresh size={11} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
          {modes.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              style={{
                padding: '4px 6px',
                borderRadius: 4,
                cursor: 'pointer',
                background: m.id === selectedId ? V5.surface : 'transparent',
                marginBottom: 2,
                fontSize: 12,
                fontFamily: 'ui-monospace, monospace',
                color: m.id === selectedId ? V5.text : V5.textMuted,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: m.color,
                }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.id}
              </span>
              <span style={{ fontSize: 9, color: V5.textDim, textTransform: 'uppercase' }}>{m.source}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
          <span style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', color: V5.text }}>
            {selected ? selected.systemPromptTemplate || '(inline)' : '— pick a mode —'}
          </span>
          {selected && selectedHasOverride && (
            <span
              style={{
                fontSize: 9,
                color: V5.warn,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                border: `1px solid ${V5.warn}`,
                borderRadius: 3,
                padding: '1px 5px',
              }}
              title={
                selectedHasFallback
                  ? 'This project overrides the global/builtin definition.'
                  : 'Project-only mode — no global/builtin fallback exists.'
              }
            >
              project override
            </span>
          )}
          {dirty && (
            <span style={{ fontSize: 11, color: V5.warn }} title="Unsaved changes">
              ●
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Select
            size="xs"
            data={[
              { value: 'project', label: 'Save to: project' },
              { value: 'global', label: 'Save to: global' },
            ]}
            value={saveScope}
            onChange={(v) => setSaveScope((v as 'project' | 'global') || 'project')}
            allowDeselect={false}
            w={150}
          />
          {selectedHasOverride && (
            <button
              onClick={onRemoveOverride}
              disabled={!selectedId || saving}
              style={toolBtnStyle(!selectedId || saving)}
              title="Delete project-local override (.toml + .system.md)"
            >
              <IconTrash size={12} /> remove override
            </button>
          )}
          <button onClick={onSave} disabled={!selectedId || saving} style={toolBtnStyle(!selectedId || saving)}>
            <IconDeviceFloppy size={12} /> save
          </button>
        </div>
        <div
          ref={editorHostRef}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
              e.preventDefault();
              onSave();
            }
          }}
          style={{ flex: '3 1 0', overflow: 'auto', minHeight: 0 }}
        />
        {/* Mode definition form (B8) — name / color / desc / approval / context / tools / params. */}
        <div
          style={{
            flex: '2 1 0',
            overflow: 'auto',
            minHeight: 0,
            borderTop: `1px solid ${V5.border}`,
            background: V5.surface,
            padding: 12,
          }}
        >
          {!selectedId ? (
            <Text size="xs" c="dimmed">
              Pick a mode to edit its settings.
            </Text>
          ) : (
            <Stack gap="xs">
              <Group gap="xs" grow align="flex-end">
                <TextInput
                  size="xs"
                  label="Name"
                  value={def.name}
                  onChange={(e) => updateDef({ name: e.currentTarget.value })}
                />
                <ColorInput
                  size="xs"
                  label="Color"
                  value={def.color}
                  onChange={(v) => updateDef({ color: v })}
                  format="hex"
                  withEyeDropper={false}
                />
              </Group>
              <Textarea
                size="xs"
                label="Description"
                autosize
                minRows={1}
                maxRows={3}
                value={def.desc}
                onChange={(e) => updateDef({ desc: e.currentTarget.value })}
              />
              <Group gap="xs" grow>
                <Select
                  size="xs"
                  label="Approval"
                  data={['always', 'snapshot', 'auto']}
                  value={def.approval}
                  onChange={(v) => updateDef({ approval: v ?? 'always' })}
                  allowDeselect={false}
                />
                <Select
                  size="xs"
                  label="Context"
                  data={['none', 'rag-auto', 'rag-explicit']}
                  value={def.context}
                  onChange={(v) => updateDef({ context: v ?? 'rag-explicit' })}
                  allowDeselect={false}
                />
              </Group>
              <TagsInput
                size="xs"
                label="Tool whitelist"
                description={`Empty = no tools. Known: ${KNOWN_TOOLS.join(', ')}`}
                value={def.toolWhitelist}
                onChange={(v) => updateDef({ toolWhitelist: v })}
                data={KNOWN_TOOLS}
                splitChars={[' ', ',']}
              />
              <div>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" fw={600}>
                    Params
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconPlus size={11} />}
                    onClick={() => {
                      setDef((d) => ({
                        ...d,
                        params: [...d.params, { name: '', type: 'string', default: '', required: false, description: '' } as ModeParam],
                      }));
                      setDirty(true);
                    }}
                  >
                    add
                  </Button>
                </Group>
                {def.params.length === 0 && (
                  <Text size="xs" c="dimmed">
                    No params declared.
                  </Text>
                )}
                {def.params.map((p, i) => (
                  <Group key={i} gap={4} wrap="nowrap" mb={4} align="flex-end">
                    <TextInput
                      size="xs"
                      placeholder="name"
                      value={p.name}
                      onChange={(e) => updateParam(i, { name: e.currentTarget.value })}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Select
                      size="xs"
                      data={['string', 'int', 'number', 'bool']}
                      value={p.type || 'string'}
                      onChange={(v) => updateParam(i, { type: (v as ModeParam['type']) || 'string' })}
                      allowDeselect={false}
                      w={86}
                    />
                    <TextInput
                      size="xs"
                      placeholder="default"
                      value={p.default == null ? '' : String(p.default)}
                      onChange={(e) => updateParam(i, { default: e.currentTarget.value })}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Switch
                      size="xs"
                      label="req"
                      labelPosition="left"
                      checked={!!p.required}
                      onChange={(e) => updateParam(i, { required: e.currentTarget.checked })}
                    />
                    <ActionIcon
                      size="sm"
                      color="red"
                      variant="subtle"
                      onClick={() => {
                        setDef((d) => ({ ...d, params: d.params.filter((_, j) => j !== i) }));
                        setDirty(true);
                      }}
                    >
                      <IconX size={13} />
                    </ActionIcon>
                  </Group>
                ))}
              </div>
            </Stack>
          )}
        </div>
      </div>

      {/* Params + preview */}
      <div
        style={{
          width: 360,
          borderLeft: `1px solid ${V5.border}`,
          display: 'flex',
          flexDirection: 'column',
          flex: 'none',
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderBottom: `1px solid ${V5.borderSoft}`,
            background: V5.surface2,
          }}
        >
          <div style={sectionLabelStyle()}>params</div>
        </div>
        <div style={{ padding: 10, overflowY: 'auto', flex: 'none', maxHeight: '40%' }}>
          {!selected || !(selected.params && selected.params.length > 0) ? (
            <div style={{ fontSize: 11, color: V5.textDim, fontStyle: 'italic' }}>
              No params declared on this mode.
            </div>
          ) : (
            (selected.params as ModeParam[]).map((p) => (
              <ParamField
                key={p.name}
                param={p}
                value={paramVals[p.name]}
                onChange={(v) => setParamVals((cur) => ({ ...cur, [p.name]: v }))}
              />
            ))
          )}
        </div>
        <div
          style={{
            padding: '8px 12px',
            borderTop: `1px solid ${V5.borderSoft}`,
            borderBottom: `1px solid ${V5.borderSoft}`,
            background: V5.surface2,
          }}
        >
          <div style={sectionLabelStyle()}>preview</div>
        </div>
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 10,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
            lineHeight: 1.55,
            color: V5.text,
            whiteSpace: 'pre-wrap',
            background: V5.bg,
            minHeight: 0,
          }}
        >
          {preview || <span style={{ color: V5.textDim, fontStyle: 'italic' }}># empty</span>}
        </div>
      </div>
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ModeParam;
  value: any;
  onChange: (v: any) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: V5.textMuted,
          marginBottom: 2,
        }}
      >
        {param.name}
        {param.required ? ' *' : ''}{' '}
        <span style={{ color: V5.textDim, fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>
          {param.type}
        </span>
      </label>
      {param.description && (
        <div style={{ fontSize: 10, color: V5.textDim, marginBottom: 4 }}>{param.description}</div>
      )}
      {param.type === 'bool' ? (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      ) : (
        <input
          type={param.type === 'int' || param.type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            if (param.type === 'int') onChange(parseInt(raw, 10) || 0);
            else if (param.type === 'number') onChange(parseFloat(raw) || 0);
            else onChange(raw);
          }}
          style={{
            width: '100%',
            padding: '4px 6px',
            background: V5.bg,
            border: `1px solid ${V5.borderSoft}`,
            borderRadius: 3,
            color: V5.text,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
          }}
        />
      )}
    </div>
  );
}

function paramTypeDefault(t: string): any {
  switch (t) {
    case 'bool':
      return false;
    case 'int':
    case 'number':
      return 0;
    default:
      return '';
  }
}

// ─────────────────────────── Scripts panel ───────────────────────────

function ScriptsPanel({ activeProject }: { activeProject: Project }) {
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
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const refreshScripts = async () => {
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
  }, [activeProject.ID]);

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

  useEffect(() => {
    const v = editorViewRef.current;
    if (!v) return;
    if (v.state.doc.toString() === source) return;
    programmaticRef.current = true;
    try {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: source } });
    } finally {
      programmaticRef.current = false;
    }
  }, [source]);

  const onLoad = async (name: string) => {
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
    const name = nameInput.trim();
    if (!name) {
      notifications.show({ color: 'red', title: 'Name required', message: 'Pick a name.' });
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

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
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
          <span style={sectionLabelStyle()}>scripts</span>
          <span style={{ flex: 1 }} />
          <button onClick={onNew} title="New" style={smallBtnStyle()}>
            <IconPlus size={11} />
          </button>
          <button onClick={refreshScripts} title="Reload" style={smallBtnStyle()}>
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

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
            <span style={{ fontSize: 11, color: V5.warn }} title="Unsaved">
              ●
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onSave} style={toolBtnStyle()} title="Save">
            <IconDeviceFloppy size={12} /> save
          </button>
          <button onClick={onRun} disabled={running} style={toolBtnStyle(running)} title="Run (Ctrl+Enter)">
            <IconPlayerPlay size={12} /> {running ? 'running…' : 'run'}
          </button>
        </div>
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
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={sectionLabelStyle()}>output</span>
            {result && (
              <span style={{ fontSize: 11, color: V5.textDim }}>
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
            {result?.output && result.output.map((line, i) => <div key={i}>{line}</div>)}
            {result && result.return !== undefined && result.return !== null && (
              <div style={{ color: V5.accent, marginTop: 8 }}>
                ⇒ {typeof result.return === 'string' ? result.return : JSON.stringify(result.return, null, 2)}
              </div>
            )}
            {!result && (
              <div style={{ color: V5.textDim, fontStyle: 'italic' }}># run to see output</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function sectionLabelStyle() {
  return {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: V5.textMuted,
  } as const;
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
