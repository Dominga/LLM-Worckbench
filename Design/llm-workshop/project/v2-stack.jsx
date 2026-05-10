// V2 — "Stack". Compact dense IDE feel. Green accent, monospace-leaning.
// Same activity-bar structure as V1, tighter density, terminal vibe.

const V2 = {
  bg: '#0e1116', surface: '#161b22', surface2: '#0d1117',
  panel: '#010409', border: '#21262d', borderSoft: '#1a1f24',
  text: '#e6edf3', textMuted: '#7d8590', textDim: '#484f58',
  accent: '#3fb950', accentSoft: 'rgba(63,185,80,.15)',
  ok: '#3fb950', warn: '#d29922', danger: '#f85149',
  activity: '#010409', chip: '#21262d', code: '#010409',
};

function V2App() {
  const [tab, setTab] = React.useState('chat');
  const [expanded, setExpanded] = React.useState({ 2: true, 7: true });
  const toggle = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }));
  const p = V2;
  const monoFont = 'ui-monospace, "JetBrains Mono", "SF Mono", monospace';

  return (
    <div style={{
      width: '100%', height: '100%', background: p.bg, color: p.text,
      fontFamily: 'ui-sans-serif, "Inter", system-ui, sans-serif',
      fontSize: 12, lineHeight: 1.4, display: 'flex', flexDirection: 'column',
    }}>
      {/* Title bar */}
      <div style={{ height: 28, background: p.activity, borderBottom: `1px solid ${p.border}`,
        display: 'flex', alignItems: 'center', fontSize: 11, color: p.textMuted, flex: 'none' }}>
        <div style={{ width: 36, display: 'flex', justifyContent: 'center' }}>
          <I.Bolt size={12} style={{ color: p.accent }}/>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {['File', 'Edit', 'Project', 'Run', 'View', 'Help'].map((m) => <span key={m}>{m}</span>)}
        </div>
        <div style={{ flex: 1, textAlign: 'center', fontFamily: monoFont, color: p.textDim }}>crimson-tide ~ workbench</div>
        <div style={{ display: 'flex' }}>
          {[I.Min, I.Max, I.Close].map((Ic, i) => (
            <div key={i} style={{ width: 36, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: p.textMuted }}>
              <Ic size={11}/>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Activity bar — narrower, denser */}
        <div style={{ width: 36, background: p.activity, borderRight: `1px solid ${p.border}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 0', flex: 'none' }}>
          {[['chat', I.Chat], ['files', I.Files], ['servers', I.Servers], ['search', I.Search], ['lab', I.Beaker], ['git', I.Git]].map(([k, Ic]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              width: 36, height: 32, background: 'transparent', border: 'none', cursor: 'pointer',
              color: tab === k ? p.text : p.textMuted,
              borderLeft: tab === k ? `2px solid ${p.accent}` : '2px solid transparent',
            }}><Ic size={16}/></button>
          ))}
        </div>

        {/* Sidebar — tighter */}
        <div style={{ width: 240, background: p.surface2, borderRight: `1px solid ${p.border}`,
          display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0 }}>
          <div style={{ height: 28, padding: '0 10px', display: 'flex', alignItems: 'center',
            fontSize: 10, letterSpacing: 0.6, color: p.textMuted, fontWeight: 600, textTransform: 'uppercase',
            borderBottom: `1px solid ${p.borderSoft}` }}>
            {tab === 'chat' ? '6 sessions' : tab === 'files' ? 'crimson-tide' : tab === 'servers' ? '4 profiles · 2 up' : tab}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
            {tab === 'chat' && SESSIONS.map((s) => (
              <div key={s.id} style={{
                padding: '5px 8px', borderRadius: 2, cursor: 'pointer',
                background: s.active ? p.accentSoft : 'transparent',
                borderLeft: s.active ? `2px solid ${p.accent}` : '2px solid transparent',
                marginLeft: s.active ? 0 : 2,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span style={{ fontSize: 10, color: p.textDim, fontFamily: monoFont, flex: 'none' }}>{s.updated}</span>
                </div>
                <div style={{ fontSize: 10, color: p.textMuted, fontFamily: monoFont, marginTop: 1 }}>{s.mode}</div>
              </div>
            ))}
            {tab === 'files' && (
              <div style={{ fontFamily: monoFont, fontSize: 11.5 }}>
                {FILE_TREE.map((n, i) => (
                  <div key={i}>
                    <div style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4, color: p.text }}>
                      {n.type === 'dir' ? (
                        <>
                          <I.ChevR size={9} style={{ color: p.textMuted, transform: n.open ? 'rotate(90deg)' : 'none' }}/>
                          <span style={{ color: '#dcb67a' }}>{n.name}/</span>
                        </>
                      ) : (
                        <span style={{ paddingLeft: 13 }}>{n.name}</span>
                      )}
                    </div>
                    {n.children && n.open && n.children.map((c, j) => (
                      <div key={j} style={{
                        padding: '2px 6px 2px 26px', display: 'flex', justifyContent: 'space-between',
                        background: c.active ? p.accentSoft : 'transparent',
                        color: c.dirty ? p.warn : p.text,
                      }}>
                        <span>{c.name}{c.dirty && ' ●'}</span>
                        <span style={{ color: p.textDim, fontSize: 10 }}>{c.kb}K</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {tab === 'servers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, fontFamily: monoFont, fontSize: 11 }}>
                {PROFILES.map((pr) => {
                  const dot = pr.status === 'running' ? p.ok : pr.status === 'idle' ? p.warn : p.textDim;
                  return (
                    <div key={pr.id} style={{ padding: '6px 8px', borderRadius: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <I.Dot color={dot} size={6}/>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.id}</span>
                        <span style={{ color: p.textDim, fontSize: 10 }}>:{pr.port}</span>
                      </div>
                      <div style={{ marginLeft: 12, color: p.textMuted, fontSize: 10, marginTop: 1 }}>
                        {pr.kind} · {pr.status === 'running' ? `${pr.vram.toFixed(1)}G${pr.tps ? ` · ${pr.tps.toFixed(0)}t/s` : ''}` : pr.status}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Tabs row */}
          <div style={{ height: 28, background: p.surface2, borderBottom: `1px solid ${p.border}`, display: 'flex', flex: 'none', fontFamily: monoFont, fontSize: 11 }}>
            {[
              { name: '~/marek-weapon-tag', active: true, icon: I.Chat },
              { name: 'characters/marek.md', icon: I.File, dirty: true },
              { name: 'narrative/ch3-marek.md', icon: I.File },
            ].map((t, i) => (
              <div key={i} style={{
                height: 28, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 5,
                background: t.active ? p.bg : 'transparent', borderRight: `1px solid ${p.border}`,
                borderTop: t.active ? `1px solid ${p.accent}` : 'none',
                color: t.active ? p.text : p.textMuted,
              }}>
                <t.icon size={11} style={{ color: t.active ? p.accent : p.textMuted }}/>
                {t.name}{t.dirty && ' ●'}
                <I.X size={10} style={{ color: p.textDim, marginLeft: 3 }}/>
              </div>
            ))}
            <div style={{ flex: 1 }}/>
          </div>

          {/* Header strip — compact session info */}
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${p.borderSoft}`, background: p.bg,
            display: 'flex', alignItems: 'center', gap: 10, flex: 'none', fontFamily: monoFont, fontSize: 11 }}>
            <span style={{ color: p.accent }}>narrative-coauthor</span>
            <span style={{ color: p.textDim }}>$</span>
            <span style={{ color: p.text }}>qwen-32b-cuda-prod</span>
            <span style={{ color: p.textDim }}>·</span>
            <span style={{ color: p.textMuted }}>ctx 4128/16384</span>
            <span style={{ color: p.textDim }}>·</span>
            <span style={{ color: p.textMuted }}>tools 9</span>
            <span style={{ color: p.textDim }}>·</span>
            <span style={{ color: p.textMuted }}>iter 4/8</span>
            <div style={{ flex: 1 }}/>
            <span style={{ color: p.warn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <I.Pin size={10}/> pre-agent snap @ 7f2a91c
            </span>
          </div>

          {/* Chat — compact rows, tighter gap */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
            {TOOL_LOG.map((m, i) => {
              if (m.kind === 'user') return (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: p.accent, fontFamily: monoFont, fontSize: 12, flex: 'none', fontWeight: 600 }}>›</span>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{m.text}</div>
                </div>
              );
              if (m.kind === 'assistant_thought') return (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: p.textDim, fontFamily: monoFont, fontSize: 12, flex: 'none' }}>·</span>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: p.textMuted, fontStyle: 'italic' }}>{m.text}</div>
                </div>
              );
              return (
                <div key={i} style={{
                  marginLeft: 16, background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 3,
                  fontFamily: monoFont, fontSize: 11.5, overflow: 'hidden',
                }}>
                  <button onClick={() => toggle(i)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                    background: 'transparent', border: 'none', color: p.text, cursor: 'pointer', textAlign: 'left',
                  }}>
                    <I.ChevR size={9} style={{ color: p.textMuted, transform: expanded[i] ? 'rotate(90deg)' : 'none' }}/>
                    <span style={{ color: m.name === 'edit_file' ? p.warn : p.accent }}>tool</span>
                    <span style={{ color: p.text }}>{m.name}</span>
                    <span style={{ color: p.textDim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      ({m.args && Object.entries(m.args).map(([k, v], i2) => (i2 ? ', ' : '') + `${k}=${typeof v === 'string' ? `"${v}"` : v}`).join('')})
                    </span>
                    {m.dur != null && <span style={{ color: p.textDim, fontSize: 10 }}>{m.dur}ms</span>}
                    {m.awaiting_approval && <span style={{ fontSize: 9, padding: '1px 5px', background: 'rgba(210,153,34,.15)', color: p.warn, borderRadius: 2, letterSpacing: 0.5 }}>APPROVE</span>}
                  </button>
                  {expanded[i] && (
                    <div style={{ padding: '6px 10px', borderTop: `1px solid ${p.borderSoft}`, background: p.code, fontSize: 11, lineHeight: 1.55 }}>
                      {m.diff && (
                        <>
                          {m.diff.map((d, k) => (
                            <div key={k} style={{
                              background: d.type === 'add' ? 'rgba(63,185,80,.1)' : 'transparent',
                              color: d.type === 'add' ? '#7ee787' : p.textMuted,
                            }}>{d.type === 'add' ? '+ ' : '  '}{d.text}</div>
                          ))}
                          <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                            <button style={{ padding: '3px 10px', background: p.accent, color: '#000', border: 'none', borderRadius: 2, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>y</button>
                            <button style={{ padding: '3px 10px', background: 'transparent', color: p.text, border: `1px solid ${p.border}`, borderRadius: 2, fontSize: 11, cursor: 'pointer' }}>n</button>
                            <button style={{ padding: '3px 10px', background: 'transparent', color: p.textMuted, border: `1px solid ${p.border}`, borderRadius: 2, fontSize: 11, cursor: 'pointer' }}>edit</button>
                          </div>
                        </>
                      )}
                      {m.result && m.result.preview && (
                        <pre style={{ margin: 0, color: p.text, whiteSpace: 'pre-wrap' }}>{m.result.preview}</pre>
                      )}
                      {m.result && m.result.hits && m.result.hits.map((h, k) => (
                        <div key={k} style={{ display: 'flex', gap: 6 }}>
                          <span style={{ color: p.accent }}>{h.path}</span>
                          <span style={{ color: p.textMuted }}>{h.heading}</span>
                          <span style={{ marginLeft: 'auto', color: p.textDim }}>{h.score.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Final message */}
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: p.accent, fontFamily: monoFont, fontSize: 12, flex: 'none' }}>‹</span>
              <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                The blade Marek draws on the bridge is a <em>sahir</em> from <code style={{ background: p.code, padding: '0 4px', fontSize: 11 }}>lore/weapons.md</code>. Knuckle-guard from a memorial coin matches canon. Edit staged on <code style={{ background: p.code, padding: '0 4px', fontSize: 11 }}>characters/marek.md</code>.
                <div style={{ marginTop: 6, padding: '4px 8px', background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 2, fontFamily: monoFont, fontSize: 10.5 }}>
                  <span style={{ color: p.textMuted, marginRight: 8 }}>sources:</span>
                  {SOURCES.map((s, i) => (
                    <span key={i} style={{ marginRight: 10 }}>
                      <span style={{ color: p.accent }}>{s.path}</span>
                      <span style={{ color: p.textDim }}>:{s.score.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ borderTop: `1px solid ${p.border}`, background: p.bg, padding: '8px 14px', flex: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontFamily: monoFont }}>
              <span style={{ color: p.accent, fontSize: 12, paddingTop: 2, fontWeight: 600 }}>›</span>
              <div style={{ flex: 1 }}>
                <div style={{ minHeight: 22, color: p.textDim, fontSize: 12 }}>continue, or @-mention a file…</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, color: p.textMuted, fontSize: 10 }}>
                  <span>narrative-coauthor</span>
                  <span>·</span><span>9 tools</span>
                  <span>·</span><span style={{ color: p.warn }}>approval: on</span>
                  <div style={{ flex: 1 }}/>
                  <span>⌘⏎</span>
                </div>
              </div>
            </div>
          </div>

          {/* Status bar with live server strip */}
          <div style={{ height: 22, background: p.surface2, borderTop: `1px solid ${p.border}`,
            display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 10.5, gap: 12, color: p.textMuted, flex: 'none', fontFamily: monoFont }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><I.Dot color={p.ok} size={6}/> chat</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><I.Dot color={p.ok} size={6}/> embed</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><I.Dot color={p.warn} size={6}/> rerank idle</span>
            <span style={{ color: p.textDim }}>│</span>
            <span>41.2 t/s</span>
            <span style={{ color: p.textDim }}>│</span>
            <span>VRAM 23.5/24.0</span>
            <span style={{ color: p.textDim }}>│</span>
            <span>RAM 18.2/64</span>
            <span style={{ color: p.textDim }}>│</span>
            <span>idx 12,418</span>
            <div style={{ flex: 1 }}/>
            <span><I.Branch size={9} style={{ display: 'inline', verticalAlign: '-1px' }}/> main · 3</span>
            <span style={{ color: p.textDim }}>│</span>
            <span>UTF-8 LF md</span>
          </div>
        </div>
      </div>
    </div>
  );
}

window.V2App = V2App;
