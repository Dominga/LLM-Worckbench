// V5 — "Loom". V3 layout (top tabs, single sidebar, no activity bar) + V1 blue
// palette + V4 right-side status indicators. Sidebar Files tab uses a proper
// tree (V1-style), and the main pane is split: chat on the left, file
// preview/editor on the right (no editor tabs).

// Session modes — a registry. Builtins ship with the app; plugins/scripts can
// add more. Each mode is just metadata: id, display name, dot-color, source,
// and a default system-prompt blurb. Sessions store mode by id, so renaming a
// mode label doesn't orphan existing chats.
const MODES = [
  { id: 'narrative-coauthor', name: 'Narrative co-author', color: '#3b82f6', source: 'builtin',
    desc: 'Long-form prose. Edits stage as diffs, never silent rewrites.' },
  { id: 'dialogue-writer',    name: 'Dialogue writer',    color: '#a78bfa', source: 'builtin',
    desc: 'Voice-first. Stays in character; never narrates around the line.' },
  { id: 'game-designer',      name: 'Game designer',      color: '#f59e0b', source: 'builtin',
    desc: 'Numbers, tables, balance. Cites lore before suggesting changes.' },
  { id: 'lore-keeper',        name: 'Lore keeper',        color: '#22c55e', source: 'builtin',
    desc: 'Read-only by default. Cross-references and consistency sweeps.' },
  { id: 'gameplay-loops',     name: 'Gameplay loops',     color: '#ef4444', source: 'plugin',
    plugin: 'tide-mechanics@0.4', desc: 'Verb→reward loop sketches with tunable knobs.' },
  { id: 'tts-prep',           name: 'TTS prep',           color: '#06b6d4', source: 'plugin',
    plugin: 'voice-pipeline@1.2', desc: 'Phoneme review + SSML staging for monologue export.' },
];
const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

const V5 = {
  bg: '#1e1f22', surface: '#2b2d31', surface2: '#232428',
  panel: '#1a1b1e', border: '#33353b', borderSoft: '#2a2c30',
  text: '#dcddde', textMuted: '#8e9298', textDim: '#5f6268',
  accent: '#3b82f6', accentSoft: 'rgba(59,130,246,.14)',
  ok: '#22c55e', warn: '#f59e0b', danger: '#ef4444',
  chip: '#373a40', code: '#16171a',
  added: 'rgba(34,197,94,.14)', addedText: '#86efac',
};

function V5SessionCard({ s, p, modeId }) {
  const m = MODE_BY_ID[modeId || s.mode] || MODES[0];
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
      background: s.active ? p.accentSoft : 'transparent',
      borderLeft: s.active ? `2px solid ${p.accent}` : '2px solid transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: p.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
        <span style={{ fontSize: 11, color: p.textDim, flex: 'none' }}>{s.updated}</span>
      </div>
      <div style={{ fontSize: 11, color: m.color, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: m.color }}/>
        {m.name}
      </div>
    </div>
  );
}

function V5FileTree({ p }) {
  const Tree = ({ nodes, depth = 0 }) => (
    <div>
      {nodes.map((n, i) => (
        <div key={i}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: `4px 8px 4px ${8 + depth * 12}px`,
            background: n.active ? p.accentSoft : 'transparent',
            borderLeft: n.active ? `2px solid ${p.accent}` : '2px solid transparent',
            borderRadius: 3, fontSize: 12.5, color: p.text, cursor: 'pointer',
          }}>
            {n.type === 'dir'
              ? <I.ChevR size={10} style={{ transform: n.open ? 'rotate(90deg)' : 'none', color: p.textMuted, transition: 'transform .12s', flex: 'none' }}/>
              : <span style={{ width: 10, flex: 'none' }}/>}
            {n.type === 'dir'
              ? <I.Folder size={13} style={{ color: '#dcb67a', flex: 'none' }}/>
              : <I.File size={13} style={{ color: p.textMuted, flex: 'none' }}/>}
            <span style={{ flex: 1, color: n.dirty ? p.warn : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.name}{n.dirty && <span style={{ marginLeft: 4 }}>●</span>}
            </span>
            {n.kb != null && <span style={{ color: p.textDim, fontSize: 10.5, flex: 'none' }}>{n.kb} KB</span>}
          </div>
          {n.children && n.open && <Tree nodes={n.children} depth={depth + 1}/>}
        </div>
      ))}
    </div>
  );
  return <Tree nodes={FILE_TREE}/>;
}

// File body — single source of truth for diff/edit/preview tabs.
// `kind: 'add'` rows render as staged additions in all three views.
const V5_MAREK_DOC = [
  { ln: 1,  text: '---', kind: 'ctx' },
  { ln: 2,  text: 'name: Marek of Ostavar', kind: 'ctx' },
  { ln: 3,  text: 'age: 34', kind: 'ctx' },
  { ln: 4,  text: 'role: bridge-warden, ch3', kind: 'ctx' },
  { ln: 5,  text: '---', kind: 'ctx' },
  { ln: 6,  text: '', kind: 'ctx' },
  { ln: 7,  text: 'A sun-marked man from the lower river. Quiet,', kind: 'ctx' },
  { ln: 8,  text: 'careful with letters; not careful with debts.', kind: 'ctx' },
  { ln: 9,  text: '', kind: 'ctx' },
  { ln: 10, text: '### Equipment', kind: 'ctx' },
  { ln: 11, text: '- worn leather coat', kind: 'ctx' },
  { ln: 12, text: '- wax-sealed letter', kind: 'ctx' },
  { ln: 13, text: '- *sahir*, knuckle-guard hammered from a memorial', kind: 'add' },
  { ln: 14, text: '  coin ([lore/weapons.md](#)#curved-blades)', kind: 'add' },
  { ln: 15, text: '- first drawn: ch3 §"The bridge at dusk"', kind: 'add' },
  { ln: 16, text: '', kind: 'ctx' },
  { ln: 17, text: '### Voice', kind: 'ctx' },
  { ln: 18, text: '- low register, sparing of consonants', kind: 'ctx' },
  { ln: 19, text: '- never raises it; never apologises', kind: 'ctx' },
];

// Tiny inline markdown — handles **bold**, *italic*, `code`, [link](url).
function v5Inline(text, p) {
  // Order matters: code first (it can't nest), then bold, then italic, then link.
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]*\))/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(<code key={key++} style={{ background: p.surface, color: p.text, padding: '1px 5px', borderRadius: 3, fontFamily: 'ui-monospace, monospace', fontSize: '0.92em' }}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key++} style={{ color: p.text }}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={key++} style={{ color: p.text }}>{tok.slice(1, -1)}</em>);
    else if (m[4]) {
      const linkText = tok.match(/\[([^\]]+)\]/)[1];
      out.push(<a key={key++} href="#" onClick={(e) => e.preventDefault()} style={{ color: p.accent, textDecoration: 'none', borderBottom: `1px dashed ${p.accent}66` }}>{linkText}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function V5MarkdownPreview({ doc, p }) {
  // Group consecutive list items so we render a single <ul>; carry the
  // "added" state per-item so staged lines glow inside the rendered list.
  const blocks = [];
  let i = 0, inFM = false;
  while (i < doc.length) {
    const row = doc[i];
    // Frontmatter — skipped for the prose view.
    if (row.text === '---') { inFM = !inFM; i++; continue; }
    if (inFM) { i++; continue; }
    if (row.text === '') { i++; continue; }
    if (row.text.startsWith('### ')) {
      blocks.push({ type: 'h3', text: row.text.slice(4), added: row.kind === 'add', key: i });
      i++; continue;
    }
    if (row.text.startsWith('- ') || row.text.startsWith('  ')) {
      const items = [];
      while (i < doc.length && (doc[i].text.startsWith('- ') || (doc[i].text.startsWith('  ') && items.length))) {
        if (doc[i].text.startsWith('- ')) {
          items.push({ text: doc[i].text.slice(2), added: doc[i].kind === 'add', key: i });
        } else {
          // Continuation line — append to last item.
          if (items.length) items[items.length - 1].text += ' ' + doc[i].text.trim();
        }
        i++;
      }
      blocks.push({ type: 'ul', items, key: 'ul-' + items[0].key });
      continue;
    }
    // Default: paragraph — coalesce consecutive non-blank prose lines.
    const para = [row.text];
    let added = row.kind === 'add';
    let j = i + 1;
    while (j < doc.length && doc[j].text !== '' && !doc[j].text.startsWith('### ') && !doc[j].text.startsWith('- ') && doc[j].text !== '---') {
      para.push(doc[j].text); if (doc[j].kind === 'add') added = true; j++;
    }
    blocks.push({ type: 'p', text: para.join(' '), added, key: i });
    i = j;
  }

  const fmRow = doc.find((r) => r.text.startsWith('name: '));
  const title = fmRow ? fmRow.text.slice(6) : 'Untitled';
  const meta = doc.filter((r) => r.text.match(/^[a-z]+: /));

  return (
    <div style={{
      padding: '24px 28px 32px',
      fontFamily: 'ui-sans-serif, "Inter", "Söhne", system-ui, sans-serif',
      fontSize: 14, lineHeight: 1.65, color: p.text,
    }}>
      {/* Frontmatter as a card */}
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.3, color: p.text }}>{title}</h1>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {meta.filter((r) => !r.text.startsWith('name:')).map((r, k) => {
          const [key, ...rest] = r.text.split(':');
          return (
            <span key={k} style={{ padding: '3px 9px', background: p.surface, color: p.textMuted, borderRadius: 999, fontSize: 11.5, fontFamily: 'ui-monospace, monospace' }}>
              <span style={{ color: p.textDim }}>{key}:</span> <span style={{ color: p.text }}>{rest.join(':').trim()}</span>
            </span>
          );
        })}
      </div>
      {blocks.map((b) => {
        if (b.type === 'h3') return (
          <h3 key={b.key} style={{
            margin: '20px 0 8px', fontSize: 14, fontWeight: 600, color: p.text,
            textTransform: 'uppercase', letterSpacing: 0.6,
            paddingLeft: b.added ? 10 : 0,
            borderLeft: b.added ? `2px solid ${p.ok}` : 'none',
          }}>{b.text}</h3>
        );
        if (b.type === 'p') return (
          <p key={b.key} style={{
            margin: '0 0 14px',
            paddingLeft: b.added ? 10 : 0,
            borderLeft: b.added ? `2px solid ${p.ok}` : 'none',
            background: b.added ? p.added : 'transparent',
            borderRadius: b.added ? 3 : 0,
          }}>{v5Inline(b.text, p)}</p>
        );
        if (b.type === 'ul') return (
          <ul key={b.key} style={{ margin: '0 0 14px', paddingLeft: 22, listStyle: 'none' }}>
            {b.items.map((it) => (
              <li key={it.key} style={{
                position: 'relative', padding: it.added ? '2px 8px 2px 10px' : '2px 0 2px 0',
                marginLeft: it.added ? -10 : 0,
                background: it.added ? p.added : 'transparent',
                borderLeft: it.added ? `2px solid ${p.ok}` : 'none',
                borderRadius: it.added ? 3 : 0,
                color: p.text,
              }}>
                <span style={{ position: 'absolute', left: it.added ? -12 : -14, color: it.added ? p.ok : p.textMuted }}>•</span>
                {v5Inline(it.text, p)}
              </li>
            ))}
          </ul>
        );
        return null;
      })}
    </div>
  );
}

function V5App() {
  const ServersScreen = window.V5ServersScreen;
  const [tab, setTab] = React.useState('chat');
  const [side, setSide] = React.useState('files');
  const [expanded, setExpanded] = React.useState({ 7: true });
  const toggle = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }));
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [view, setView] = React.useState('diff'); // 'diff' | 'edit' | 'preview'
  // Per-session mode map. Seeded from SESSIONS so each session keeps its own
  // mode across switches; picker writes here so the change persists.
  const [sessionModes, setSessionModes] = React.useState(() =>
    Object.fromEntries(SESSIONS.map((s) => [s.id, s.mode]))
  );
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const activeSessionId = (SESSIONS.find((s) => s.active) || SESSIONS[0]).id;
  const modeId = sessionModes[activeSessionId] || MODES[0].id;
  const mode = MODE_BY_ID[modeId] || MODES[0];
  const setMode = (id) => { setSessionModes((m) => ({ ...m, [activeSessionId]: id })); setPickerOpen(false); };
  const p = V5;
  const font = 'ui-sans-serif, "Inter", "Segoe UI", system-ui, sans-serif';

  return (
    <div style={{ width: '100%', height: '100%', background: p.bg, color: p.text,
      fontFamily: font, fontSize: 13.5, lineHeight: 1.5, display: 'flex', flexDirection: 'column' }}>
      {/* Title bar with workspace tabs + status indicators */}
      <div style={{ height: 44, background: p.panel, borderBottom: `1px solid ${p.border}`,
        display: 'flex', alignItems: 'center', flex: 'none' }}>
        <div style={{ width: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I.Bolt size={16} style={{ color: p.accent }}/>
        </div>
        <div style={{ display: 'flex', height: 44 }}>
          {[['chat', I.Chat, 'Chat'], ['servers', I.Servers, 'Servers'], ['project', I.Folder, 'Project'], ['lab', I.Beaker, 'Prompt Lab'], ['runs', I.Bolt, 'Runs']].map(([k, Ic, name]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8,
              background: tab === k ? p.bg : 'transparent',
              borderBottom: tab === k ? `2px solid ${p.accent}` : '2px solid transparent',
              border: 'none', color: tab === k ? p.text : p.textMuted, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
            }}>
              <Ic size={14} style={{ color: tab === k ? p.accent : p.textMuted }}/>{name}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px',
          fontSize: 11.5, color: p.textMuted, fontVariantNumeric: 'tabular-nums',
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><I.Dot color={p.ok} size={6}/> chat</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><I.Dot color={p.ok} size={6}/> embed</span>
          <span style={{ color: p.textDim }}>│</span>
          <span title="VRAM">VRAM <span style={{ color: p.text }}>23.5</span><span style={{ color: p.textDim }}>/24</span></span>
          <span title="tokens/sec"><span style={{ color: p.text }}>41.2</span> t/s</span>
        </div>
        <div style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: 10, color: p.textMuted, fontSize: 12,
          borderLeft: `1px solid ${p.border}`, height: 28 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 999 }}>
            <I.Folder size={12}/> Crimson Tide
          </span>
          <I.Bell size={15}/><I.Settings size={15}/>
        </div>
        <div style={{ display: 'flex' }}>
          {[I.Min, I.Max, I.Close].map((Ic, i) => (
            <div key={i} style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: p.textMuted }}><Ic size={12}/></div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 280, background: p.surface2, borderRight: `1px solid ${p.border}`,
          display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0 }}>
          <div style={{ padding: '12px 12px 0' }}>
            <div style={{ display: 'flex', background: p.bg, borderRadius: 6, padding: 3 }}>
              {[['sessions', 'Sessions'], ['files', 'Files'], ['servers', 'Servers']].map(([k, label]) => (
                <button key={k} onClick={() => setSide(k)} style={{
                  flex: 1, padding: '5px 0', border: 'none', borderRadius: 4, cursor: 'pointer',
                  background: side === k ? p.surface : 'transparent',
                  color: side === k ? p.text : p.textMuted, fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                }}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ padding: '10px 10px 4px', display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
              background: p.bg, border: `1px solid ${p.borderSoft}`, borderRadius: 6 }}>
              <I.Search size={12} style={{ color: p.textMuted }}/>
              <input placeholder={side === 'files' ? 'Find file…' : 'Search…'} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: p.text, fontFamily: 'inherit', fontSize: 12 }}/>
            </div>
            <button title={side === 'files' ? 'New file' : side === 'sessions' ? 'New chat' : 'New profile'}
              style={{ width: 28, height: 28, background: p.accent, color: '#fff', border: 'none', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <I.Plus size={14}/>
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px 12px' }}>
            {side === 'sessions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: p.textMuted, padding: '8px 8px 4px' }}>Today</div>
                {SESSIONS.slice(0, 2).map((s) => <V5SessionCard key={s.id} s={s} p={p} modeId={sessionModes[s.id]}/>)}
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: p.textMuted, padding: '12px 8px 4px' }}>Earlier</div>
                {SESSIONS.slice(2).map((s) => <V5SessionCard key={s.id} s={s} p={p} modeId={sessionModes[s.id]}/>)}
              </div>
            )}
            {side === 'files' && <V5FileTree p={p}/>}
            {side === 'servers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 2px' }}>
                {PROFILES.map((pr) => {
                  const isOn = pr.status === 'running';
                  const dot = isOn ? p.ok : pr.status === 'idle' ? p.warn : p.textDim;
                  return (
                    <div key={pr.id} style={{ background: p.surface, padding: 10, borderRadius: 8, border: `1px solid ${p.borderSoft}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <I.Dot color={dot} size={7}/>
                          <span style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.id}</span>
                        </div>
                        <span style={{ fontSize: 10, padding: '2px 7px', background: p.chip, color: p.textMuted, borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{pr.kind}</span>
                      </div>
                      <div style={{ fontSize: 11, color: p.textMuted, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>{pr.model}</div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: p.textMuted, alignItems: 'center' }}>
                        <span>:{pr.port}</span>
                        {isOn ? <><span>{pr.vram.toFixed(1)} GB</span>{pr.tps != null && <span>{pr.tps.toFixed(1)} t/s</span>}</> : <span style={{ color: p.textDim }}>{pr.status}</span>}
                        <div style={{ flex: 1 }}/>
                        <button style={{ width: 22, height: 22, background: 'transparent', border: 'none', color: isOn ? p.danger : p.accent, cursor: 'pointer', padding: 0 }}>
                          {isOn ? <I.Stop size={11}/> : <I.Play size={11}/>}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Main: servers dashboard or chat split */}
        {tab === 'servers' ? <ServersScreen p={p}/> : (
        <div style={{ flex: 1, display: 'flex', minWidth: 0, background: p.bg }}>
          {/* LEFT: chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: `1px solid ${p.border}` }}>
            <div style={{ padding: '14px 22px 12px', borderBottom: `1px solid ${p.borderSoft}`, flex: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: -0.2, color: p.text }}>Marek's first weapon — consistency pass</h1>
                <button style={{ padding: '5px 10px', background: 'transparent', color: p.text, border: `1px solid ${p.border}`, borderRadius: 6, fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <I.Branch size={11}/> Snapshot
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, fontSize: 11.5, flexWrap: 'wrap' }}>
                <span style={{ position: 'relative' }}>
                  <button onClick={() => setPickerOpen((o) => !o)} title="Change mode for this session"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                      background: `${mode.color}22`, color: mode.color,
                      border: `1px solid ${mode.color}55`, borderRadius: 999,
                      fontWeight: 600, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: mode.color, display: 'inline-block' }}/>
                    {mode.name}
                    {mode.source === 'plugin' && <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2, padding: '0 5px', border: `1px solid ${mode.color}66`, borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>plugin</span>}
                    <I.ChevD size={9} style={{ opacity: 0.8 }}/>
                  </button>
                  {pickerOpen && (
                    <>
                      <div onClick={() => setPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }}/>
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41,
                        width: 320, background: p.surface, border: `1px solid ${p.border}`,
                        borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.5)', padding: 6,
                      }}>
                        <div style={{ padding: '6px 10px 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: p.textMuted }}>Session mode</div>
                        {MODES.map((m) => {
                          const sel = m.id === modeId;
                          return (
                            <button key={m.id} onClick={() => setMode(m.id)} style={{
                              width: '100%', display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px',
                              background: sel ? `${m.color}1f` : 'transparent', border: 'none',
                              borderRadius: 5, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                              borderLeft: sel ? `2px solid ${m.color}` : '2px solid transparent',
                            }}>
                              <span style={{ width: 8, height: 8, borderRadius: 4, background: m.color, marginTop: 5, flex: 'none' }}/>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 12.5, fontWeight: 500, color: p.text }}>{m.name}</span>
                                  {m.source === 'plugin' && <span style={{ fontSize: 9, padding: '1px 5px', border: `1px solid ${m.color}55`, color: m.color, borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>plugin</span>}
                                </div>
                                <div style={{ fontSize: 11, color: p.textMuted, marginTop: 1 }}>{m.desc}</div>
                                {m.plugin && <div style={{ fontSize: 10, color: p.textDim, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{m.plugin}</div>}
                              </div>
                            </button>
                          );
                        })}
                        <div style={{ borderTop: `1px solid ${p.borderSoft}`, marginTop: 4, padding: '6px 10px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: p.textMuted }}>
                          <span>{MODES.filter(m=>m.source==='plugin').length} from plugins</span>
                          <button style={{ background: 'transparent', border: 'none', color: p.accent, cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', padding: 0 }}>Manage modes…</button>
                        </div>
                      </div>
                    </>
                  )}
                </span>
                <span style={{ display: 'inline-flex', padding: '3px 8px', background: p.surface, color: p.textMuted, borderRadius: 999, fontFamily: 'ui-monospace, monospace', fontSize: 10.5 }}>qwen-32b-cuda-prod</span>
                <span style={{ display: 'inline-flex', padding: '3px 8px', background: p.surface, color: p.textMuted, borderRadius: 999, fontSize: 10.5 }}>4,128 / 16,384</span>
              </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <div style={{ padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {TOOL_LOG.map((m, i) => {
                  if (m.kind === 'user') return (
                    <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '90%', background: p.surface, padding: '10px 13px', borderRadius: '12px 12px 4px 12px', border: `1px solid ${p.borderSoft}` }}>
                      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{m.text}</div>
                    </div>
                  );
                  if (m.kind === 'assistant_thought') return (
                    <div key={i} style={{ display: 'flex', gap: 10 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 12, background: p.accentSoft, color: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><I.Sparkle size={11}/></div>
                      <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.6, paddingTop: 2 }}>{m.text}</div>
                    </div>
                  );
                  return (
                    <div key={i} style={{ marginLeft: 34, background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 8, overflow: 'hidden' }}>
                      <button onClick={() => toggle(i)} style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px',
                        background: 'transparent', border: 'none', color: p.text, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                      }}>
                        <I.ChevR size={10} style={{ color: p.textMuted, transform: expanded[i] ? 'rotate(90deg)' : 'none' }}/>
                        <div style={{ width: 22, height: 22, borderRadius: 5,
                          background: m.name === 'edit_file' ? 'rgba(245,158,11,.16)' : p.bg,
                          color: m.name === 'edit_file' ? p.warn : p.accent,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                          <I.Tool size={11}/>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 500 }}>{m.name}</span>
                            {m.dur != null && <span style={{ fontSize: 10, color: p.textDim }}>· {m.dur}ms</span>}
                            {m.awaiting_approval && <span style={{ fontSize: 9.5, padding: '2px 7px', background: 'rgba(245,158,11,.18)', color: p.warn, borderRadius: 999, marginLeft: 4, fontWeight: 600 }}>Approval</span>}
                          </div>
                          <div style={{ fontSize: 10.5, color: p.textMuted, fontFamily: 'ui-monospace, monospace', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.args && Object.entries(m.args).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`).join(', ')}
                          </div>
                        </div>
                      </button>
                      {expanded[i] && (
                        <div style={{ padding: 12, borderTop: `1px solid ${p.borderSoft}`, background: p.code, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.55 }}>
                          {m.diff && (
                            <>
                              {m.diff.map((d, k) => (
                                <div key={k} style={{
                                  background: d.type === 'add' ? p.added : 'transparent',
                                  color: d.type === 'add' ? p.addedText : p.textMuted, padding: '0 8px',
                                }}>{d.type === 'add' ? '+ ' : '  '}{d.text}</div>
                              ))}
                              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                                <button style={{ padding: '5px 12px', background: p.accent, color: '#fff', border: 'none', borderRadius: 5, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Apply edit</button>
                                <button style={{ padding: '5px 12px', background: 'transparent', color: p.text, border: `1px solid ${p.border}`, borderRadius: 5, fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer' }}>Reject</button>
                                <button style={{ padding: '5px 12px', background: 'transparent', color: p.textMuted, border: `1px solid ${p.border}`, borderRadius: 5, fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer' }}>Open in diff →</button>
                              </div>
                            </>
                          )}
                          {m.result && m.result.preview && (
                            <pre style={{ margin: 0, color: p.text, whiteSpace: 'pre-wrap' }}>{m.result.preview}</pre>
                          )}
                          {m.result && m.result.hits && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {m.result.hits.map((h, k) => (
                                <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                  <span style={{ color: p.accent, flex: 'none' }}>{h.path}</span>
                                  <span style={{ color: p.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.heading}</span>
                                  <div style={{ width: 50, height: 4, background: p.borderSoft, borderRadius: 2, flex: 'none', overflow: 'hidden' }}>
                                    <div style={{ width: `${h.score * 100}%`, height: '100%', background: p.accent }}/>
                                  </div>
                                  <span style={{ color: p.textDim, width: 32, textAlign: 'right' }}>{h.score.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 12, background: p.accentSoft, color: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><I.Sparkle size={11}/></div>
                  <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.65, paddingTop: 2 }}>
                    The blade Marek draws is a <em>sahir</em> from <code style={{ background: p.surface, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>lore/weapons.md</code>. The knuckle-guard hammered from a memorial coin matches canon — edit staged on <code style={{ background: p.surface, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>characters/marek.md</code> (see preview →).
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {SOURCES.map((s, i) => (
                        <div key={i} style={{ padding: '5px 9px', background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                          <I.Doc size={11} style={{ color: p.textMuted }}/>
                          <span style={{ color: p.text, fontFamily: 'ui-monospace, monospace' }}>{s.path}</span>
                          <span style={{ color: p.textDim, marginLeft: 2 }}>{s.score.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 22px 14px', flex: 'none' }}>
              <div style={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: 10, padding: 10 }}>
                <div style={{ minHeight: 38, color: p.textDim, fontSize: 13.5 }}>
                  Continue, or <span style={{ color: p.accent }}>@-mention</span> a file or character…
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: p.textMuted, marginTop: 5 }}>
                  <button onClick={() => setPickerOpen((o) => !o)} style={{ padding: '3px 9px', background: `${mode.color}1c`, border: `1px solid ${mode.color}44`, color: mode.color, borderRadius: 999, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: mode.color }}/>
                    {mode.name} <I.ChevD size={9}/>
                  </button>
                  <button style={{ padding: '3px 8px', background: p.bg, border: `1px solid ${p.borderSoft}`, color: p.text, borderRadius: 999, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}>9 tools</button>
                  <button style={{ padding: '3px 8px', background: p.bg, border: `1px solid ${p.borderSoft}`, color: p.warn, borderRadius: 999, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}>Approval: on</button>
                  <div style={{ flex: 1 }}/>
                  <span style={{ fontSize: 10.5 }}>⌘ ⏎</span>
                  <button style={{ width: 28, height: 28, background: p.accent, color: '#fff', border: 'none', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><I.Send size={12}/></button>
                </div>
              </div>
            </div>
          </div>

          {/* Collapsed-rail handle: re-opens the right panel when hidden */}
          {!panelOpen && (
            <button onClick={() => setPanelOpen(true)} title="Show preview"
              style={{
                width: 32, flex: 'none', background: p.surface2, borderLeft: `1px solid ${p.border}`,
                border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 10, padding: '14px 0', color: p.textMuted, fontFamily: 'inherit',
              }}>
              <I.ChevR size={14} style={{ transform: 'rotate(180deg)' }}/>
              <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 11, letterSpacing: 0.4, fontFamily: 'ui-monospace, monospace' }}>
                <span style={{ color: p.warn }}>●</span> characters/marek.md
              </div>
              <I.Doc size={13} style={{ color: p.warn, marginTop: 'auto' }}/>
            </button>
          )}

          {/* RIGHT: preview / editor */}
          {panelOpen && (
          <div style={{ width: 480, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0, background: p.surface2 }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${p.borderSoft}`, display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
              <I.File size={13} style={{ color: p.warn }}/>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: p.text }}>characters/marek.md</span>
              <span style={{ fontSize: 10, padding: '1px 6px', background: 'rgba(245,158,11,.16)', color: p.warn, borderRadius: 3, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>pending</span>
              <div style={{ flex: 1 }}/>
              {/* Segmented Diff / Edit / Preview */}
              <div style={{ display: 'flex', background: p.bg, border: `1px solid ${p.borderSoft}`, borderRadius: 5, padding: 2 }}>
                {[['diff', 'Diff'], ['edit', 'Edit'], ['preview', 'Preview']].map(([k, label]) => (
                  <button key={k} onClick={() => setView(k)} style={{
                    padding: '3px 9px', border: 'none', background: view === k ? p.surface : 'transparent',
                    color: view === k ? p.text : p.textMuted, borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 11, fontWeight: view === k ? 600 : 400,
                  }}>{label}</button>
                ))}
              </div>
              <button onClick={() => setPanelOpen(false)} title="Hide panel"
                style={{ width: 22, height: 22, background: 'transparent', color: p.textMuted, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I.X size={11}/>
              </button>
            </div>

            {/* Body — switches by view */}
            {view === 'preview' ? (
              <div style={{ flex: 1, overflow: 'auto', background: p.bg }}>
                <V5MarkdownPreview doc={V5_MAREK_DOC} p={p}/>
              </div>
            ) : view === 'edit' ? (
              <div style={{ flex: 1, overflow: 'auto', background: p.code, fontFamily: 'ui-monospace, "JetBrains Mono", monospace', fontSize: 12, lineHeight: 1.65, padding: '12px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {V5_MAREK_DOC.map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding: '0 10px 0 14px', color: p.textDim, textAlign: 'right', userSelect: 'none', width: 32, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' }}>{row.ln}</td>
                        <td style={{ padding: '0 14px 0 6px', color: p.text, whiteSpace: 'pre' }}>{row.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto', fontFamily: 'ui-monospace, "JetBrains Mono", monospace', fontSize: 12, lineHeight: 1.65, background: p.code }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {V5_MAREK_DOC.map((row, i) => (
                      <tr key={i} style={{ background: row.kind === 'add' ? p.added : 'transparent' }}>
                        <td style={{ padding: '0 10px 0 14px', color: p.textDim, textAlign: 'right', userSelect: 'none', width: 32, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' }}>{row.ln}</td>
                        <td style={{ padding: '0 6px', color: row.kind === 'add' ? p.ok : p.textDim, width: 14, textAlign: 'center', userSelect: 'none' }}>{row.kind === 'add' ? '+' : ''}</td>
                        <td style={{ padding: '0 14px 0 0', color: row.kind === 'add' ? p.addedText : p.text, whiteSpace: 'pre' }}>{row.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pending-edit footer */}
            <div style={{ padding: '10px 14px', borderTop: `1px solid ${p.borderSoft}`, background: p.surface2,
              display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
              <span style={{ fontSize: 11, color: p.textMuted, flex: 1 }}>
                <span style={{ color: p.ok }}>+3</span> <span style={{ color: p.textDim }}>−0</span> · awaiting approval
              </span>
              <button style={{ padding: '6px 12px', background: p.accent, color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Apply edit</button>
              <button style={{ padding: '6px 12px', background: 'transparent', color: p.text, border: `1px solid ${p.border}`, borderRadius: 5, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>Reject</button>
            </div>
          </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
window.V5App = V5App;
