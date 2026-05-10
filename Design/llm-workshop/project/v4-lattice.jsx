// V4 — "Lattice". High-contrast, purple accent. Mixed: top crumb + dual sidebars.
// Compact, opinionated; right-side inspector replaces bottom panel.

const V4 = {
  bg: '#0a0a0c', surface: '#141418', surface2: '#0f0f12',
  panel: '#080809', border: '#26262d', borderSoft: '#1c1c22',
  text: '#fafafa', textMuted: '#9d9da6', textDim: '#5a5a63',
  accent: '#a78bfa', accentSoft: 'rgba(167,139,250,.14)',
  ok: '#34d399', warn: '#fbbf24', danger: '#f87171',
  chip: '#1f1f25', code: '#080809',
};

function V4App() {
  const [side, setSide] = React.useState('chat');
  const [insp, setInsp] = React.useState('sources');
  const [expanded, setExpanded] = React.useState({ 7: true });
  const toggle = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }));
  const p = V4;

  return (
    <div style={{ width: '100%', height: '100%', background: p.bg, color: p.text,
      fontFamily: 'ui-sans-serif, "Inter", system-ui, sans-serif',
      fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column' }}>
      {/* Title bar */}
      <div style={{ height: 36, background: p.panel, borderBottom: `1px solid ${p.border}`,
        display: 'flex', alignItems: 'center', flex: 'none' }}>
        <div style={{ width: 44, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <I.Bolt size={14} style={{ color: p.accent }}/>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: p.textMuted }}>
          <I.Folder size={12}/>
          <span>Crimson Tide</span>
          <span style={{ color: p.textDim }}>/</span>
          <span style={{ color: p.text }}>Marek — weapon tag</span>
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', fontSize: 11, color: p.textMuted, fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Dot color={p.ok} size={6}/> chat</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Dot color={p.ok} size={6}/> embed</span>
          <span>VRAM 23.5/24</span>
          <span>41.2 t/s</span>
        </div>
        <div style={{ display: 'flex' }}>
          {[I.Min, I.Max, I.Close].map((Ic, i) => (
            <div key={i} style={{ width: 38, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: p.textMuted }}><Ic size={11}/></div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Activity rail */}
        <div style={{ width: 44, background: p.panel, borderRight: `1px solid ${p.border}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', flex: 'none' }}>
          {[['chat', I.Chat], ['files', I.Files], ['servers', I.Servers], ['search', I.Search], ['lab', I.Beaker]].map(([k, Ic]) => (
            <button key={k} onClick={() => setSide(k)} style={{
              width: 36, height: 36, margin: '2px 0', background: side === k ? p.accentSoft : 'transparent',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              color: side === k ? p.accent : p.textMuted,
            }}><Ic size={16}/></button>
          ))}
        </div>

        {/* Left sidebar */}
        <div style={{ width: 260, background: p.surface2, borderRight: `1px solid ${p.border}`,
          display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0 }}>
          <div style={{ padding: '10px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, color: p.textMuted }}>
              {side === 'chat' ? 'Sessions' : side === 'files' ? 'Project' : side === 'servers' ? 'Profiles' : side}
            </span>
            <I.Plus size={13} style={{ color: p.textMuted, cursor: 'pointer' }}/>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 6px 8px' }}>
            {side === 'chat' && SESSIONS.map((s) => (
              <div key={s.id} style={{
                padding: '8px 10px', borderRadius: 5, cursor: 'pointer',
                background: s.active ? p.accentSoft : 'transparent',
                borderLeft: s.active ? `2px solid ${p.accent}` : '2px solid transparent',
              }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span style={{ color: p.textDim, fontSize: 10.5 }}>{s.updated}</span>
                </div>
                <div style={{ fontSize: 10.5, color: p.textMuted, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>{s.mode}</div>
              </div>
            ))}
            {side === 'files' && FILE_TREE.flatMap((n) => n.children ? [{ ...n }, ...n.children.map((c) => ({ ...c, depth: 1 }))] : [n]).map((n, i) => (
              <div key={i} style={{ padding: `4px 8px 4px ${8 + (n.depth || 0) * 14}px`, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6,
                background: n.active ? p.accentSoft : 'transparent', borderRadius: 4 }}>
                {n.type === 'dir' ? <I.Folder size={13} style={{ color: '#fbbf24' }}/> : <I.File size={13} style={{ color: p.textMuted }}/>}
                <span style={{ flex: 1, color: n.dirty ? p.warn : p.text }}>{n.name}{n.dirty && ' ●'}</span>
                {n.kb != null && <span style={{ color: p.textDim, fontSize: 10.5 }}>{n.kb}K</span>}
              </div>
            ))}
            {side === 'servers' && PROFILES.map((pr) => {
              const isOn = pr.status === 'running';
              const dot = isOn ? p.ok : pr.status === 'idle' ? p.warn : p.textDim;
              return (
                <div key={pr.id} style={{ padding: 10, borderRadius: 6, marginBottom: 4, background: p.surface, border: `1px solid ${p.borderSoft}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <I.Dot color={dot} size={6}/>
                    <span style={{ fontSize: 12, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.id}</span>
                    <span style={{ fontSize: 9.5, padding: '1px 6px', background: p.chip, borderRadius: 3, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{pr.kind}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: p.textMuted, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>:{pr.port} · {pr.model.length > 22 ? pr.model.slice(0, 22) + '…' : pr.model}</div>
                  {isOn && <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10.5, color: p.textDim }}>
                    <span>{pr.vram.toFixed(1)} GB</span>{pr.tps != null && <span>{pr.tps.toFixed(1)} t/s</span>}
                  </div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '14px 22px 12px', borderBottom: `1px solid ${p.borderSoft}`, flex: 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>Marek's first weapon — consistency pass</div>
              <div style={{ fontSize: 11, color: p.textMuted, marginTop: 3, display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'ui-monospace, monospace' }}>
                <span style={{ color: p.accent }}>narrative-coauthor</span>
                <span style={{ color: p.textDim }}>·</span>
                <span>qwen-32b-cuda-prod</span>
                <span style={{ color: p.textDim }}>·</span>
                <span>4128/16384</span>
                <span style={{ color: p.textDim }}>·</span>
                <span>iter 4/8</span>
              </div>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', border: `1px solid ${p.border}`, borderRadius: 4, fontSize: 11, color: p.warn }}>
              <I.Pin size={11}/> snap @ 7f2a91c
            </span>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
            {TOOL_LOG.map((m, i) => {
              if (m.kind === 'user') return (
                <div key={i} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 4, alignSelf: 'stretch', background: p.text, borderRadius: 2, flex: 'none' }}/>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{m.text}</div>
                </div>
              );
              if (m.kind === 'assistant_thought') return (
                <div key={i} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 4, alignSelf: 'stretch', background: p.accent, borderRadius: 2, flex: 'none' }}/>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6, color: p.textMuted, fontStyle: 'italic' }}>{m.text}</div>
                </div>
              );
              return (
                <div key={i} style={{ marginLeft: 14, background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 6, overflow: 'hidden' }}>
                  <button onClick={() => toggle(i)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                    background: 'transparent', border: 'none', color: p.text, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}>
                    <I.ChevR size={10} style={{ color: p.textMuted, transform: expanded[i] ? 'rotate(90deg)' : 'none' }}/>
                    <span style={{ fontSize: 9.5, padding: '2px 6px', background: m.name === 'edit_file' ? 'rgba(251,191,36,.18)' : p.accentSoft, color: m.name === 'edit_file' ? p.warn : p.accent, borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>tool</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 500 }}>{m.name}</span>
                    <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: p.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {m.args && Object.entries(m.args).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`).join(', ')}
                    </span>
                    {m.dur != null && <span style={{ fontSize: 10, color: p.textDim }}>{m.dur}ms</span>}
                    {m.awaiting_approval && <span style={{ fontSize: 9.5, padding: '2px 7px', background: 'rgba(251,191,36,.18)', color: p.warn, borderRadius: 3, fontWeight: 700, letterSpacing: 0.4 }}>APPROVE</span>}
                  </button>
                  {expanded[i] && (
                    <div style={{ padding: 12, borderTop: `1px solid ${p.borderSoft}`, background: p.code, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.55 }}>
                      {m.diff && (
                        <>
                          {m.diff.map((d, k) => (
                            <div key={k} style={{
                              background: d.type === 'add' ? 'rgba(52,211,153,.12)' : 'transparent',
                              color: d.type === 'add' ? '#6ee7b7' : p.textMuted, padding: '0 6px',
                            }}>{d.type === 'add' ? '+ ' : '  '}{d.text}</div>
                          ))}
                          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                            <button style={{ padding: '5px 12px', background: p.accent, color: '#0a0a0c', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Apply</button>
                            <button style={{ padding: '5px 12px', background: 'transparent', color: p.text, border: `1px solid ${p.border}`, borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Reject</button>
                          </div>
                        </>
                      )}
                      {m.result && m.result.preview && (
                        <pre style={{ margin: 0, color: p.text, whiteSpace: 'pre-wrap' }}>{m.result.preview}</pre>
                      )}
                      {m.result && m.result.hits && m.result.hits.map((h, k) => (
                        <div key={k} style={{ display: 'flex', gap: 8 }}>
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

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 4, alignSelf: 'stretch', background: p.accent, borderRadius: 2, flex: 'none' }}/>
              <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
                The blade Marek draws is a <em>sahir</em> from <code style={{ background: p.surface, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>lore/weapons.md</code>; knuckle-guard hammered from a memorial coin matches canon. Edit staged on <code style={{ background: p.surface, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>characters/marek.md</code>.
              </div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ borderTop: `1px solid ${p.border}`, padding: '12px 22px 14px', flex: 'none', background: p.surface2 }}>
            <div style={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ minHeight: 36, color: p.textDim, fontSize: 13 }}>Continue, or <span style={{ color: p.accent }}>@-mention</span>…</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: p.textMuted }}>
                <span style={{ padding: '2px 8px', background: p.bg, border: `1px solid ${p.borderSoft}`, borderRadius: 3 }}>narrative-coauthor</span>
                <span style={{ padding: '2px 8px', background: p.bg, border: `1px solid ${p.borderSoft}`, borderRadius: 3 }}>9 tools</span>
                <span style={{ padding: '2px 8px', background: p.bg, border: `1px solid ${p.borderSoft}`, borderRadius: 3, color: p.warn }}>approval</span>
                <div style={{ flex: 1 }}/>
                <span>⌘⏎</span>
                <button style={{ width: 26, height: 26, background: p.accent, color: '#0a0a0c', border: 'none', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><I.Send size={12}/></button>
              </div>
            </div>
          </div>
        </div>

        {/* Right inspector */}
        <div style={{ width: 280, background: p.surface2, borderLeft: `1px solid ${p.border}`,
          display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0 }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${p.borderSoft}` }}>
            {[['sources', 'Sources'], ['logs', 'Logs'], ['metrics', 'Metrics']].map(([k, label]) => (
              <button key={k} onClick={() => setInsp(k)} style={{
                flex: 1, padding: '10px 0', background: 'transparent', border: 'none', cursor: 'pointer',
                color: insp === k ? p.text : p.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600,
                borderBottom: insp === k ? `2px solid ${p.accent}` : '2px solid transparent', fontFamily: 'inherit',
              }}>{label}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {insp === 'sources' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 10.5, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Retrieved · 3 chunks · reranked</div>
                {SOURCES.map((s, i) => (
                  <div key={i} style={{ padding: 9, background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 5 }}>
                    <div style={{ fontSize: 11, color: p.accent, fontFamily: 'ui-monospace, monospace' }}>{s.path}</div>
                    <div style={{ fontSize: 12, color: p.text, marginTop: 2 }}>{s.heading}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 3, background: p.borderSoft, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${s.score * 100}%`, height: '100%', background: p.accent }}/>
                      </div>
                      <span style={{ fontSize: 10.5, color: p.textDim, width: 30, textAlign: 'right' }}>{s.score.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: 10.5, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Files touched</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5 }}>
                  <div style={{ display: 'flex', gap: 6, color: p.textMuted }}><span style={{ color: p.ok, width: 10 }}>R</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>characters/marek.md</span></div>
                  <div style={{ display: 'flex', gap: 6, color: p.textMuted }}><span style={{ color: p.ok, width: 10 }}>R</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>narrative/ch3-marek.md</span></div>
                  <div style={{ display: 'flex', gap: 6, color: p.textMuted }}><span style={{ color: p.ok, width: 10 }}>R</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>lore/weapons.md</span></div>
                  <div style={{ display: 'flex', gap: 6, color: p.textMuted }}><span style={{ color: p.warn, width: 10 }}>W</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>characters/marek.md</span><span style={{ marginLeft: 'auto', color: p.warn, fontSize: 10 }}>pending</span></div>
                </div>
              </div>
            )}
            {insp === 'logs' && (
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, lineHeight: 1.6 }}>
                {SERVER_LOG_TAIL.map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, color: p.textMuted }}>
                    <span style={{ color: p.textDim }}>{l.t}</span>
                    <span style={{ color: l.lvl === 'W' ? p.warn : p.accent }}>{l.lvl}</span>
                    <span style={{ color: p.textMuted }}>[{l.src}]</span>
                    <span style={{ color: p.text }}>{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
            {insp === 'metrics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[['VRAM', '23.5 / 24.0 GB', 0.98], ['RAM', '18.2 / 64 GB', 0.28], ['Ctx used', '4128 / 16384', 0.25], ['t/s', '41.2', null], ['Cache hit', '92%', 0.92]].map(([k, v, pct]) => (
                  <div key={k}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: p.textMuted }}>
                      <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</span>
                      <span style={{ color: p.text, fontFamily: 'ui-monospace, monospace' }}>{v}</span>
                    </div>
                    {pct != null && (
                      <div style={{ marginTop: 4, height: 3, background: p.borderSoft, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct * 100}%`, height: '100%', background: pct > 0.9 ? p.warn : p.accent }}/>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
window.V4App = V4App;
