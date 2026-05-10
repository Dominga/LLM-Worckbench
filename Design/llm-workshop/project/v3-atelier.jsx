// V3 — "Atelier". Top workspace tabs, no activity bar. Cozy density, amber accent.
const V3 = {
  bg: '#1a1814', surface: '#221f1a', surface2: '#1f1c17',
  panel: '#161310', border: '#2e2a23', borderSoft: '#26221c',
  text: '#ebe5d9', textMuted: '#a39a87', textDim: '#665e4f',
  accent: '#f59e0b', accentSoft: 'rgba(245,158,11,.14)',
  ok: '#84cc16', warn: '#f59e0b', danger: '#ef4444',
  chip: '#2e2a23', code: '#161310',
};

function V3SessionCard({ s, p }) {
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
      <div style={{ fontSize: 11, color: p.textMuted, marginTop: 2 }}>{s.mode}</div>
    </div>
  );
}

function V3App() {
  const [tab, setTab] = React.useState('chat');
  const [side, setSide] = React.useState('sessions');
  const [expanded, setExpanded] = React.useState({ 7: true });
  const toggle = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }));
  const p = V3;
  const font = 'ui-sans-serif, "Inter", system-ui, sans-serif';

  return (
    <div style={{ width: '100%', height: '100%', background: p.bg, color: p.text,
      fontFamily: font, fontSize: 13.5, lineHeight: 1.5, display: 'flex', flexDirection: 'column' }}>
      {/* Title bar with workspace tabs */}
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
        <div style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: 12, color: p.textMuted, fontSize: 12 }}>
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
        <div style={{ width: 300, background: p.surface2, borderRight: `1px solid ${p.border}`,
          display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0 }}>
          <div style={{ padding: '12px 14px 0' }}>
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
              <input placeholder="Search…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: p.text, fontFamily: 'inherit', fontSize: 12 }}/>
            </div>
            <button style={{ width: 28, height: 28, background: p.accent, color: '#1a1814', border: 'none', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <I.Plus size={14}/>
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 10px 12px' }}>
            {side === 'sessions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: p.textMuted, padding: '8px 8px 4px' }}>Today</div>
                {SESSIONS.slice(0, 2).map((s) => <V3SessionCard key={s.id} s={s} p={p}/>)}
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: p.textMuted, padding: '12px 8px 4px' }}>Earlier</div>
                {SESSIONS.slice(2).map((s) => <V3SessionCard key={s.id} s={s} p={p}/>)}
              </div>
            )}
            {side === 'files' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {FILE_TREE.flatMap((n) => n.children ? n.children.map((c) => ({ ...c, dir: n.name })) : [{ ...n, dir: '' }]).map((f, i) => (
                  <div key={i} style={{ padding: '7px 9px', borderRadius: 5, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: f.active ? p.accentSoft : 'transparent' }}>
                    <I.Doc size={14} style={{ color: f.dirty ? p.warn : p.textMuted }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: p.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}{f.dirty && <span style={{ color: p.warn }}> ●</span>}</div>
                      {f.dir && <div style={{ fontSize: 10.5, color: p.textDim, fontFamily: 'ui-monospace, monospace' }}>{f.dir}/</div>}
                    </div>
                    <div style={{ fontSize: 10.5, color: p.textDim }}>{f.kb} KB</div>
                  </div>
                ))}
              </div>
            )}
            {side === 'servers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: p.bg }}>
          <div style={{ padding: '18px 28px 14px', borderBottom: `1px solid ${p.borderSoft}`, flex: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ flex: 1, margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: -0.2, color: p.text }}>Marek's first weapon — consistency pass</h1>
              <button style={{ padding: '6px 12px', background: 'transparent', color: p.text, border: `1px solid ${p.border}`, borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <I.Branch size={12}/> Snapshot
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, fontSize: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', background: p.accentSoft, color: p.accent, borderRadius: 999, fontWeight: 500 }}>
                <I.Sparkle size={11}/> narrative-coauthor
              </span>
              <span style={{ display: 'inline-flex', padding: '3px 9px', background: p.surface, color: p.textMuted, borderRadius: 999, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>qwen-32b-cuda-prod</span>
              <span style={{ display: 'inline-flex', padding: '3px 9px', background: p.surface, color: p.textMuted, borderRadius: 999, fontSize: 11 }}>4,128 / 16,384</span>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', minHeight: 0 }}>
            <div style={{ width: '100%', maxWidth: 760, padding: '24px 28px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {TOOL_LOG.map((m, i) => {
                if (m.kind === 'user') return (
                  <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: p.surface, padding: '12px 14px', borderRadius: '14px 14px 4px 14px', border: `1px solid ${p.borderSoft}` }}>
                    <div style={{ fontSize: 14, lineHeight: 1.55 }}>{m.text}</div>
                  </div>
                );
                if (m.kind === 'assistant_thought') return (
                  <div key={i} style={{ display: 'flex', gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 13, background: p.accentSoft, color: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><I.Sparkle size={12}/></div>
                    <div style={{ flex: 1, fontSize: 14, lineHeight: 1.6, paddingTop: 3 }}>{m.text}</div>
                  </div>
                );
                return (
                  <div key={i} style={{ marginLeft: 36, background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 10, overflow: 'hidden' }}>
                    <button onClick={() => toggle(i)} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      background: 'transparent', border: 'none', color: p.text, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}>
                      <I.ChevR size={11} style={{ color: p.textMuted, transform: expanded[i] ? 'rotate(90deg)' : 'none' }}/>
                      <div style={{ width: 24, height: 24, borderRadius: 6,
                        background: m.name === 'edit_file' ? 'rgba(245,158,11,.16)' : p.bg,
                        color: m.name === 'edit_file' ? p.warn : p.accent,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                        <I.Tool size={12}/>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, fontWeight: 500 }}>{m.name}</span>
                          {m.dur != null && <span style={{ fontSize: 10.5, color: p.textDim }}>· {m.dur}ms</span>}
                          {m.awaiting_approval && <span style={{ fontSize: 10, padding: '2px 7px', background: 'rgba(245,158,11,.18)', color: p.warn, borderRadius: 999, marginLeft: 4, fontWeight: 600 }}>Approval</span>}
                        </div>
                        <div style={{ fontSize: 11, color: p.textMuted, fontFamily: 'ui-monospace, monospace', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.args && Object.entries(m.args).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`).join(', ')}
                        </div>
                      </div>
                    </button>
                    {expanded[i] && (
                      <div style={{ padding: 14, borderTop: `1px solid ${p.borderSoft}`, background: p.code, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.55 }}>
                        {m.diff && (
                          <>
                            {m.diff.map((d, k) => (
                              <div key={k} style={{
                                background: d.type === 'add' ? 'rgba(132,204,22,.12)' : 'transparent',
                                color: d.type === 'add' ? '#bef264' : p.textMuted, padding: '0 8px',
                              }}>{d.type === 'add' ? '+ ' : '  '}{d.text}</div>
                            ))}
                            <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                              <button style={{ padding: '6px 14px', background: p.accent, color: '#1a1814', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Apply edit</button>
                              <button style={{ padding: '6px 14px', background: 'transparent', color: p.text, border: `1px solid ${p.border}`, borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>Reject</button>
                              <button style={{ padding: '6px 14px', background: 'transparent', color: p.textMuted, border: `1px solid ${p.border}`, borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>Open in diff</button>
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
                                <div style={{ width: 60, height: 4, background: p.borderSoft, borderRadius: 2, flex: 'none', overflow: 'hidden' }}>
                                  <div style={{ width: `${h.score * 100}%`, height: '100%', background: p.accent }}/>
                                </div>
                                <span style={{ color: p.textDim, width: 36, textAlign: 'right' }}>{h.score.toFixed(2)}</span>
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
                <div style={{ width: 26, height: 26, borderRadius: 13, background: p.accentSoft, color: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><I.Sparkle size={12}/></div>
                <div style={{ flex: 1, fontSize: 14, lineHeight: 1.65, paddingTop: 3 }}>
                  The blade Marek draws on the bridge is a <em>sahir</em> — the curved single-edged blade common to river caravans in <code style={{ background: p.surface, padding: '1px 6px', borderRadius: 4, fontSize: 12.5 }}>lore/weapons.md</code>. The knuckle-guard hammered from a memorial coin matches that canon. I've staged a non-prose edit to <code style={{ background: p.surface, padding: '1px 6px', borderRadius: 4, fontSize: 12.5 }}>characters/marek.md</code> — review above.
                  <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {SOURCES.map((s, i) => (
                      <div key={i} style={{ padding: '6px 10px', background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                        <I.Doc size={12} style={{ color: p.textMuted }}/>
                        <span style={{ color: p.text, fontFamily: 'ui-monospace, monospace' }}>{s.path}</span>
                        <span style={{ color: p.textMuted }}>· {s.heading}</span>
                        <span style={{ color: p.textDim, marginLeft: 4 }}>{s.score.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: '14px 28px 18px', flex: 'none' }}>
            <div style={{ maxWidth: 760, margin: '0 auto', background: p.surface, border: `1px solid ${p.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ minHeight: 44, color: p.textDim, fontSize: 14 }}>
                Continue, or <span style={{ color: p.accent }}>@-mention</span> a file or character…
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: p.textMuted, marginTop: 6 }}>
                <button style={{ padding: '4px 9px', background: p.bg, border: `1px solid ${p.borderSoft}`, color: p.text, borderRadius: 999, fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <I.Sparkle size={10}/> narrative-coauthor <I.ChevD size={9}/>
                </button>
                <button style={{ padding: '4px 9px', background: p.bg, border: `1px solid ${p.borderSoft}`, color: p.text, borderRadius: 999, fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer' }}>9 tools</button>
                <button style={{ padding: '4px 9px', background: p.bg, border: `1px solid ${p.borderSoft}`, color: p.warn, borderRadius: 999, fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer' }}>Approval: on</button>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11 }}>⌘ ⏎</span>
                <button style={{ width: 30, height: 30, background: p.accent, color: '#1a1814', border: 'none', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><I.Send size={13}/></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.V3App = V3App;
