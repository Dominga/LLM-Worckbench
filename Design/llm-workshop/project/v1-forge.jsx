// V1 — "Forge". Classic VS Code-style dev-tools dark.
// Activity bar (icons) → contextual sidebar → chat → optional bottom panel.
// Comfortable density, blue accent, soft separators.

const V1 = (() => {
  const c = {
    bg: '#1e1f22', surface: '#2b2d31', surface2: '#232428',
    panel: '#1a1b1e', border: '#33353b', borderSoft: '#2a2c30',
    text: '#dcddde', textMuted: '#8e9298', textDim: '#5f6268',
    accent: '#3b82f6', accentSoft: 'rgba(59,130,246,.12)',
    ok: '#22c55e', warn: '#f59e0b', danger: '#ef4444',
    activity: '#181a1d',
    chip: '#373a40',
    code: '#1a1b1e',
  };
  return c;
})();

function V1Window({ children, accent }) {
  const palette = { ...V1, accent: accent || V1.accent, accentSoft: accent ? `${accent}1f` : V1.accentSoft };
  return (
    <div style={{
      width: '100%', height: '100%', background: palette.bg, color: palette.text,
      fontFamily: 'ui-sans-serif, "Segoe UI", system-ui, -apple-system, sans-serif',
      fontSize: 13, lineHeight: 1.45, display: 'flex', flexDirection: 'column',
      ['--accent']: palette.accent, ['--accent-soft']: palette.accentSoft,
    }}>
      <V1TitleBar palette={palette}/>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {children(palette)}
      </div>
    </div>
  );
}

function V1TitleBar({ palette }) {
  return (
    <div style={{
      height: 32, background: palette.activity, color: palette.textMuted,
      display: 'flex', alignItems: 'center', borderBottom: `1px solid ${palette.border}`,
      fontSize: 12, userSelect: 'none', flex: 'none',
    }}>
      <div style={{ width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I.Bolt size={14} style={{ color: palette.accent }}/>
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        {['File', 'Edit', 'Project', 'Run', 'View', 'Help'].map((m) => (
          <span key={m} style={{ cursor: 'default' }}>{m}</span>
        ))}
      </div>
      <div style={{ flex: 1, textAlign: 'center', color: palette.textDim }}>
        Crimson Tide — LLM Workbench
      </div>
      <div style={{ display: 'flex' }}>
        {[I.Min, I.Max, I.Close].map((Ic, i) => (
          <div key={i} style={{ width: 44, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: i === 2 ? palette.text : palette.textMuted, cursor: 'default' }}>
            <Ic size={12}/>
          </div>
        ))}
      </div>
    </div>
  );
}

function V1ActivityBar({ active, onChange, palette }) {
  const items = [
    ['chat', I.Chat, 'Chat'],
    ['files', I.Files, 'Files'],
    ['servers', I.Servers, 'Servers'],
    ['search', I.Search, 'Search'],
    ['lab', I.Beaker, 'Prompt Lab'],
    ['git', I.Git, 'Source Control'],
  ];
  return (
    <div style={{ width: 48, background: palette.activity, borderRight: `1px solid ${palette.border}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', flex: 'none' }}>
      {items.map(([k, Ic, title]) => (
        <button key={k} onClick={() => onChange(k)} title={title} style={{
          width: 48, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', color: active === k ? palette.text : palette.textMuted,
          borderLeft: active === k ? `2px solid ${palette.accent}` : '2px solid transparent',
          cursor: 'pointer',
        }}>
          <Ic size={20}/>
        </button>
      ))}
      <div style={{ flex: 1 }}/>
      <button title="Settings" style={{ width: 48, height: 44, background: 'transparent', border: 'none', color: palette.textMuted, cursor: 'pointer' }}>
        <I.Settings size={18}/>
      </button>
    </div>
  );
}

function V1Sidebar({ tab, palette }) {
  return (
    <div style={{ width: 280, background: palette.surface2, borderRight: `1px solid ${palette.border}`,
      display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0 }}>
      <div style={{ height: 36, padding: '0 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5, color: palette.textMuted, fontWeight: 600 }}>
        {tab === 'chat' ? 'Sessions' : tab === 'files' ? 'Project' : tab === 'servers' ? 'Profiles' : tab}
        <I.Plus size={14} style={{ color: palette.textMuted, cursor: 'pointer' }}/>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 6px 8px' }}>
        {tab === 'chat' && <V1Sessions palette={palette}/>}
        {tab === 'files' && <V1Files palette={palette}/>}
        {tab === 'servers' && <V1ProfilesList palette={palette}/>}
        {tab === 'search' && <V1SearchPane palette={palette}/>}
        {tab === 'lab' && <V1LabPane palette={palette}/>}
        {tab === 'git' && <V1GitPane palette={palette}/>}
      </div>
    </div>
  );
}

function V1Sessions({ palette }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {SESSIONS.map((s) => (
        <div key={s.id} style={{
          padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
          background: s.active ? palette.accentSoft : 'transparent',
          color: s.active ? palette.text : palette.text,
          borderLeft: s.active ? `2px solid ${palette.accent}` : '2px solid transparent',
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
            <span style={{ color: palette.textDim, fontSize: 11, flex: 'none' }}>{s.updated}</span>
          </div>
          <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>{s.mode}</div>
        </div>
      ))}
    </div>
  );
}

function V1Files({ palette }) {
  const Tree = ({ nodes, depth = 0 }) => (
    <div>
      {nodes.map((n, i) => (
        <div key={i}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: `3px 6px 3px ${6 + depth * 12}px`,
            background: n.active ? palette.accentSoft : 'transparent', borderRadius: 3,
            fontSize: 13, color: palette.text, cursor: 'pointer',
          }}>
            {n.type === 'dir'
              ? <I.ChevR size={10} style={{ transform: n.open ? 'rotate(90deg)' : 'none', color: palette.textMuted, transition: 'transform .12s' }}/>
              : <span style={{ width: 10, display: 'inline-block' }}/>}
            {n.type === 'dir' ? <I.Folder size={14} style={{ color: '#dcb67a' }}/> : <I.File size={14} style={{ color: palette.textMuted }}/>}
            <span style={{ flex: 1, color: n.dirty ? palette.warn : 'inherit' }}>{n.name}{n.dirty && <span style={{ marginLeft: 4 }}>●</span>}</span>
            {n.kb != null && <span style={{ color: palette.textDim, fontSize: 11 }}>{n.kb}KB</span>}
          </div>
          {n.children && n.open && <Tree nodes={n.children} depth={depth + 1}/>}
        </div>
      ))}
    </div>
  );
  return <Tree nodes={FILE_TREE}/>;
}

function V1ProfilesList({ palette }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 4px' }}>
      {PROFILES.map((p) => {
        const isOn = p.status === 'running';
        const dot = isOn ? palette.ok : p.status === 'idle' ? palette.warn : palette.textDim;
        return (
          <div key={p.id} style={{
            background: palette.surface, borderRadius: 6, padding: 10, border: `1px solid ${palette.borderSoft}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <I.Dot color={dot} size={6}/>
                <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.id}</span>
              </div>
              <span style={{ fontSize: 10, padding: '1px 6px', background: palette.chip, color: palette.textMuted, borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>{p.kind}</span>
            </div>
            <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
              :{p.port} · {p.model.length > 24 ? p.model.slice(0, 24) + '…' : p.model}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11, color: palette.textDim, fontVariantNumeric: 'tabular-nums' }}>
              {isOn ? (
                <>
                  <span>{p.vram.toFixed(1)} GB VRAM</span>
                  {p.tps != null && <span>{p.tps.toFixed(1)} t/s</span>}
                </>
              ) : <span>{p.status === 'idle' ? 'idle (warm)' : 'stopped'}</span>}
            </div>
          </div>
        );
      })}
      <button style={{ marginTop: 4, padding: '7px 10px', background: 'transparent', border: `1px dashed ${palette.border}`,
        color: palette.textMuted, borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>+ New profile</button>
    </div>
  );
}

function V1SearchPane({ palette }) {
  return (
    <div style={{ padding: '4px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 4, padding: '6px 8px' }}>
        <I.Search size={12} style={{ color: palette.textMuted }}/>
        <input placeholder="Semantic + lexical" defaultValue="memorial coin"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: palette.text, fontSize: 12, fontFamily: 'inherit' }}/>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: palette.textMuted }}>3 hits · hybrid · reranked</div>
      {SOURCES.map((s, i) => (
        <div key={i} style={{ marginTop: 8, padding: 8, background: palette.surface, borderRadius: 4, fontSize: 12 }}>
          <div style={{ color: palette.accent, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{s.path}</div>
          <div style={{ marginTop: 2, color: palette.text }}>{s.heading}</div>
          <div style={{ marginTop: 4, color: palette.textDim, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>score {s.score.toFixed(2)}</div>
        </div>
      ))}
    </div>
  );
}

function V1LabPane({ palette }) {
  const items = [
    { name: 'generate-tts-prompts.js', updated: 'today' },
    { name: 'sweep-character-cards.js', updated: 'yesterday' },
    { name: 'rerank-eval.js', updated: '3 days' },
  ];
  return (
    <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((s) => (
        <div key={s.name} style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{s.name}</span>
          <span style={{ color: palette.textDim, fontSize: 11 }}>{s.updated}</span>
        </div>
      ))}
    </div>
  );
}

function V1GitPane({ palette }) {
  const ch = [
    { path: 'characters/marek.md', kind: 'M' },
    { path: 'narrative/ch3-marek.md', kind: 'M' },
    { path: 'chats/2026-05-09-marek.jsonl', kind: 'A' },
  ];
  return (
    <div style={{ padding: '4px 6px' }}>
      <div style={{ fontSize: 11, color: palette.textMuted, padding: '4px 4px 8px' }}>3 changes · main</div>
      {ch.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', fontSize: 12 }}>
          <span style={{ width: 16, color: f.kind === 'A' ? palette.ok : palette.warn, textAlign: 'center', fontFamily: 'ui-monospace, monospace' }}>{f.kind}</span>
          <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main column ─────────────────────────────────────────────────
function V1Tabs({ palette }) {
  const tabs = [
    { id: 't1', name: 'Marek — weapon tag', icon: I.Chat, active: true },
    { id: 't2', name: 'characters/marek.md', icon: I.File, dirty: true },
    { id: 't3', name: 'narrative/ch3-marek.md', icon: I.File },
    { id: 't4', name: 'Servers', icon: I.Servers },
  ];
  return (
    <div style={{ height: 36, background: palette.surface2, borderBottom: `1px solid ${palette.border}`,
      display: 'flex', flex: 'none' }}>
      {tabs.map((t) => (
        <div key={t.id} style={{
          height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
          background: t.active ? palette.bg : 'transparent',
          borderRight: `1px solid ${palette.border}`, borderTop: t.active ? `1px solid ${palette.accent}` : 'none',
          color: t.active ? palette.text : palette.textMuted, fontSize: 12, cursor: 'pointer',
        }}>
          <t.icon size={13} style={{ color: t.active ? palette.accent : palette.textMuted }}/>
          <span>{t.name}{t.dirty && ' ●'}</span>
          <I.X size={11} style={{ color: palette.textDim, marginLeft: 4 }}/>
        </div>
      ))}
      <div style={{ flex: 1 }}/>
    </div>
  );
}

function V1ChatHeader({ palette }) {
  return (
    <div style={{
      padding: '12px 18px', borderBottom: `1px solid ${palette.borderSoft}`, background: palette.bg,
      display: 'flex', alignItems: 'center', gap: 12, flex: 'none',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: palette.text }}>Marek's first weapon — consistency pass</div>
        <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2, display: 'flex', gap: 10, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Sparkle size={11} style={{ color: palette.accent }}/> narrative-coauthor</span>
          <span>·</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>qwen-32b-cuda-prod</span>
          <span>·</span>
          <span>4,128 / 16,384 ctx</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <V1Pill palette={palette} icon={I.Tool}>4 tools</V1Pill>
        <V1Pill palette={palette} icon={I.Branch}>main · pre-agent snap</V1Pill>
      </div>
    </div>
  );
}

function V1Pill({ children, icon: Ic, palette }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px',
      background: palette.surface, border: `1px solid ${palette.borderSoft}`, borderRadius: 4,
      fontSize: 11, color: palette.textMuted, fontVariantNumeric: 'tabular-nums',
    }}>
      <Ic size={11}/>
      {children}
    </div>
  );
}

function V1Chat({ palette, expanded, toggle }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      {TOOL_LOG.map((m, i) => {
        if (m.kind === 'user') return <V1UserMsg palette={palette} key={i} text={m.text}/>;
        if (m.kind === 'assistant_thought') return <V1Thought palette={palette} key={i} text={m.text}/>;
        if (m.kind === 'tool') return <V1ToolCard palette={palette} key={i} step={m} expanded={expanded[i]} onToggle={() => toggle(i)} idx={i}/>;
        return null;
      })}
      <V1FinalAnswer palette={palette}/>
    </div>
  );
}

function V1UserMsg({ text, palette }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 28, height: 28, borderRadius: 14, background: palette.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', color: palette.textMuted, flex: 'none' }}>
        <I.User size={14}/>
      </div>
      <div style={{ flex: 1, paddingTop: 4 }}>
        <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 4 }}>You</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: palette.text }}>{text}</div>
      </div>
    </div>
  );
}

function V1Thought({ text, palette }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 28, height: 28, borderRadius: 14, background: palette.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', color: palette.accent, flex: 'none' }}>
        <I.Bot size={14}/>
      </div>
      <div style={{ flex: 1, paddingTop: 4 }}>
        <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 4 }}>Assistant</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: palette.text }}>{text}</div>
      </div>
    </div>
  );
}

function V1ToolCard({ step, expanded, onToggle, idx, palette }) {
  const isEdit = step.name === 'edit_file';
  const accent = isEdit ? palette.warn : palette.accent;
  return (
    <div style={{ marginLeft: 40, background: palette.surface, border: `1px solid ${palette.borderSoft}`,
      borderRadius: 6, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: 'transparent', border: 'none', color: palette.text, cursor: 'pointer', textAlign: 'left',
      }}>
        <I.ChevR size={11} style={{ color: palette.textMuted, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}/>
        <I.Tool size={13} style={{ color: accent }}/>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: palette.text }}>{step.name}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: palette.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {step.args && Object.entries(step.args).map(([k, v], i) => (
            <span key={i} style={{ marginRight: 8 }}>{k}=<span style={{ color: palette.text }}>{typeof v === 'string' ? `"${v}"` : v}</span></span>
          ))}
        </span>
        {step.dur != null && <span style={{ fontSize: 10, color: palette.textDim, fontVariantNumeric: 'tabular-nums' }}>{step.dur}ms</span>}
        {step.awaiting_approval && <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(245,158,11,.15)', color: palette.warn, borderRadius: 3, border: `1px solid ${palette.warn}33` }}>NEEDS APPROVAL</span>}
      </button>
      {expanded && (
        <div style={{ padding: 12, borderTop: `1px solid ${palette.borderSoft}`, background: palette.code, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.5 }}>
          {step.diff && (
            <div>
              {step.diff.map((d, i) => (
                <div key={i} style={{
                  background: d.type === 'add' ? 'rgba(34,197,94,.12)' : 'transparent',
                  color: d.type === 'add' ? '#86efac' : palette.textMuted,
                  padding: '0 8px',
                }}>{d.type === 'add' ? '+ ' : '  '}{d.text}</div>
              ))}
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <button style={{ padding: '5px 12px', background: palette.ok, color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Accept</button>
                <button style={{ padding: '5px 12px', background: 'transparent', color: palette.text, border: `1px solid ${palette.border}`, borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Reject</button>
                <button style={{ padding: '5px 12px', background: 'transparent', color: palette.textMuted, border: `1px solid ${palette.border}`, borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Edit diff</button>
              </div>
            </div>
          )}
          {step.result && step.result.preview && (
            <pre style={{ margin: 0, color: palette.text, whiteSpace: 'pre-wrap' }}>{step.result.preview}</pre>
          )}
          {step.result && step.result.hits && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {step.result.hits.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, color: palette.text }}>
                  <span style={{ color: palette.accent }}>{h.path}</span>
                  <span style={{ color: palette.textMuted }}>{h.heading}</span>
                  <span style={{ marginLeft: 'auto', color: palette.textDim }}>{h.score.toFixed(3)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function V1FinalAnswer({ palette }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 28, height: 28, borderRadius: 14, background: palette.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', color: palette.accent, flex: 'none' }}>
        <I.Bot size={14}/>
      </div>
      <div style={{ flex: 1, paddingTop: 4 }}>
        <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 4 }}>Assistant</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, color: palette.text }}>
          The blade Marek draws on the bridge is a <em>sahir</em> — the curved single-edged blade common to river caravans in <code style={{ background: palette.code, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>lore/weapons.md</code>. Its knuckle-guard hammered from a memorial coin matches the canonical detail. I've staged a non-prose edit to <code style={{ background: palette.code, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>characters/marek.md</code> adding the weapon and a back-reference to ch3 — review above.
        </div>
        <V1Sources palette={palette}/>
      </div>
    </div>
  );
}

function V1Sources({ palette }) {
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', background: palette.surface, border: `1px solid ${palette.borderSoft}`, borderRadius: 6 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: palette.textMuted, marginBottom: 6, fontWeight: 600 }}>Sources · 3 chunks</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {SOURCES.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <I.Doc size={12} style={{ color: palette.textMuted, flex: 'none' }}/>
            <span style={{ color: palette.accent, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{s.path}</span>
            <span style={{ color: palette.textMuted }}>· {s.heading}</span>
            <span style={{ marginLeft: 'auto', color: palette.textDim, fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>{s.score.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function V1Composer({ palette }) {
  return (
    <div style={{ borderTop: `1px solid ${palette.border}`, background: palette.bg, padding: '12px 24px 16px', flex: 'none' }}>
      <div style={{ background: palette.surface, border: `1px solid ${palette.borderSoft}`, borderRadius: 8, padding: 10 }}>
        <div style={{ minHeight: 44, color: palette.textDim, fontSize: 13.5 }}>
          Continue the thread, or <span style={{ color: palette.accent }}>@-mention</span> a file…
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, color: palette.textMuted, fontSize: 11 }}>
          <V1ChipBtn palette={palette}>narrative-coauthor ▾</V1ChipBtn>
          <V1ChipBtn palette={palette}>tools: 9 ▾</V1ChipBtn>
          <V1ChipBtn palette={palette}>require approval</V1ChipBtn>
          <div style={{ flex: 1 }}/>
          <span>⌘ ⏎ to send</span>
          <button style={{ width: 28, height: 28, background: palette.accent, color: '#fff', border: 'none', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <I.Send size={13}/>
          </button>
        </div>
      </div>
    </div>
  );
}
function V1ChipBtn({ children, palette }) {
  return (
    <span style={{ padding: '3px 8px', background: palette.bg, border: `1px solid ${palette.borderSoft}`,
      color: palette.textMuted, borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>{children}</span>
  );
}

function V1BottomPanel({ palette, panelTab, setPanelTab, open, setOpen }) {
  if (!open) return (
    <div style={{ height: 22, background: palette.surface2, borderTop: `1px solid ${palette.border}`, display: 'flex', alignItems: 'center', padding: '0 10px', flex: 'none', fontSize: 11, color: palette.textMuted, gap: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Dot color={palette.ok} size={6}/> 2 servers up</span>
      <span>·</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>41.2 t/s</span>
      <span>·</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>23.5 GB / 24 GB VRAM</span>
      <div style={{ flex: 1 }}/>
      <span style={{ cursor: 'pointer' }} onClick={() => setOpen(true)}>Show panel ▴</span>
    </div>
  );
  const tabs = ['logs', 'metrics', 'problems'];
  return (
    <div style={{ height: 200, background: palette.panel, borderTop: `1px solid ${palette.border}`, display: 'flex', flexDirection: 'column', flex: 'none' }}>
      <div style={{ height: 30, display: 'flex', alignItems: 'center', borderBottom: `1px solid ${palette.borderSoft}`, paddingRight: 8 }}>
        {tabs.map((t) => (
          <button key={t} onClick={() => setPanelTab(t)} style={{
            height: 30, padding: '0 14px', background: 'transparent', border: 'none', cursor: 'pointer',
            color: panelTab === t ? palette.text : palette.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
            borderBottom: panelTab === t ? `2px solid ${palette.accent}` : '2px solid transparent',
          }}>{t}</button>
        ))}
        <div style={{ flex: 1 }}/>
        <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: palette.textMuted, cursor: 'pointer', padding: 4 }}>
          <I.X size={12}/>
        </button>
      </div>
      <div style={{ flex: 1, padding: 10, overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.6 }}>
        {panelTab === 'logs' && SERVER_LOG_TAIL.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, color: palette.textMuted }}>
            <span style={{ color: palette.textDim }}>{l.t}</span>
            <span style={{ color: l.lvl === 'W' ? palette.warn : palette.accent, width: 12 }}>{l.lvl}</span>
            <span style={{ color: palette.textMuted, width: 50 }}>[{l.src}]</span>
            <span style={{ color: palette.text, flex: 1 }}>{l.msg}</span>
          </div>
        ))}
        {panelTab === 'metrics' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, color: palette.text }}>
            {[['VRAM', '23.5/24 GB'], ['Tokens/s', '41.2'], ['Ctx used', '4,128'], ['Cache hit', '92%']].map(([k, v]) => (
              <div key={k} style={{ background: palette.surface, padding: 10, borderRadius: 4 }}>
                <div style={{ fontSize: 10, color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</div>
                <div style={{ fontSize: 18, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {panelTab === 'problems' && <div style={{ color: palette.textDim }}>No problems detected.</div>}
      </div>
    </div>
  );
}

function V1StatusBar({ palette }) {
  return (
    <div style={{ height: 22, background: palette.accent, color: '#fff', display: 'flex', alignItems: 'center',
      padding: '0 10px', fontSize: 11, gap: 14, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Branch size={11}/> main · 3 pending</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Cpu size={11}/> qwen-32b-cuda-prod</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Db size={11}/> 12,418 chunks indexed</span>
      <div style={{ flex: 1 }}/>
      <span>UTF-8 · LF · Markdown</span>
    </div>
  );
}

function V1App() {
  const [tab, setTab] = React.useState('chat');
  const [expanded, setExpanded] = React.useState({ 7: true });
  const toggle = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }));
  const [panelTab, setPanelTab] = React.useState('logs');
  const [panelOpen, setPanelOpen] = React.useState(true);

  return (
    <V1Window>
      {(palette) => (
        <>
          <V1ActivityBar active={tab} onChange={setTab} palette={palette}/>
          <V1Sidebar tab={tab} palette={palette}/>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <V1Tabs palette={palette}/>
            <V1ChatHeader palette={palette}/>
            <V1Chat palette={palette} expanded={expanded} toggle={toggle}/>
            <V1Composer palette={palette}/>
            <V1BottomPanel palette={palette} panelTab={panelTab} setPanelTab={setPanelTab} open={panelOpen} setOpen={setPanelOpen}/>
            <V1StatusBar palette={palette}/>
          </div>
        </>
      )}
    </V1Window>
  );
}

window.V1App = V1App;
