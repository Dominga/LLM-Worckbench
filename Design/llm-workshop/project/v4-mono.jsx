// V4 — "Mono". High-contrast minimal. Pure black, sharp 1px borders,
// monospace-leaning, electric purple accent. No surfaces, no shadows.

const V4 = {
  bg: '#000', surface: '#0a0a0a', surface2: '#000',
  border: '#fff', borderSoft: '#262626', borderDim: '#171717',
  text: '#fff', textMuted: '#a3a3a3', textDim: '#525252',
  accent: '#a78bfa', accentHi: '#c4b5fd',
  ok: '#34d399', warn: '#fbbf24', danger: '#f87171',
};

function V4App() {
  const [tab, setTab] = React.useState('chat');
  const [expanded, setExpanded] = React.useState({ 7: true });
  const toggle = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }));
  const p = V4;
  const mono = '"JetBrains Mono", ui-monospace, "SF Mono", monospace';

  return (
    <div style={{
      width: '100%', height: '100%', background: p.bg, color: p.text,
      fontFamily: mono, fontSize: 12, lineHeight: 1.5,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Title bar — single line, all caps */}
      <div style={{ height: 28, borderBottom: `1px solid ${p.borderSoft}`, display: 'flex', alignItems: 'center', flex: 'none' }}>
        <div style={{ width: 32, display: 'flex', justifyContent: 'center' }}>
          <span style={{ width: 10, height: 10, background: p.accent, transform: 'rotate(45deg)' }}/>
        </div>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: p.text, fontWeight: 700 }}>WORKBENCH</div>
        <span style={{ margin: '0 12px', color: p.textDim }}>/</span>
        <div style={{ fontSize: 11, color: p.textMuted, letterSpacing: 0.5 }}>crimson-tide</div>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', gap: 16, fontSize: 10, color: p.textMuted, padding: '0 14px', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          <span>cmd k</span><span style={{ color: p.textDim }}>·</span><span>2 srv</span><span style={{ color: p.textDim }}>·</span><span>main +3</span>
        </div>
        <div style={{ display: 'flex', borderLeft: `1px solid ${p.borderSoft}` }}>
          {[I.Min, I.Max, I.Close].map((Ic, i) => (
            <div key={i} style={{ width: 32, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: p.textMuted, borderLeft: i ? `1px solid ${p.borderDim}` : 'none' }}>
              <Ic size={11}/>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Activity bar — text labels rotated */}
        <div style={{ width: 40, borderRight: `1px solid ${p.borderSoft}`, display: 'flex', flexDirection: 'column', flex: 'none' }}>
          {[
            ['chat', 'CHAT', I.Chat],
            ['files', 'FILES', I.Files],
            ['servers', 'SRVS', I.Servers],
            ['search', 'FIND', I.Search],
            ['lab', 'LAB', I.Beaker],
            ['git', 'GIT', I.Git],
          ].map(([k, lbl, Ic]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              height: 56, background: tab === k ? p.accent : 'transparent', border: 'none', cursor: 'pointer',
              color: tab === k ? '#000' : p.textMuted, fontFamily: 'inherit',
              borderBottom: `1px solid ${p.borderDim}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 9, letterSpacing: 1, fontWeight: 700,
            }}>
              <Ic size={14}/>
              <span>{lbl}</span>
            </button>
          ))}
        </div>

        {/* Sidebar */}
        <div style={{ width: 260, borderRight: `1px solid ${p.borderSoft}`, display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0 }}>
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${p.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, color: p.accent }}>
              {tab === 'chat' ? 'sessions·6' : tab === 'files' ? 'project·tree' : tab === 'servers' ? 'profiles·4' : tab}
            </span>
            <button style={{ background: 'transparent', border: `1px solid ${p.borderSoft}`, color: p.text, fontFamily: 'inherit', fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>+ NEW</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {tab === 'chat' && SESSIONS.map((s) => (
              <div key={s.id} style={{
                padding: '10px 12px', borderBottom: `1px solid ${p.borderDim}`, cursor: 'pointer',
                background: s.active ? p.accent : 'transparent',
                color: s.active ? '#000' : p.text,
              }}>
                <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                <div style={{ fontSize: 10, marginTop: 4, letterSpacing: 0.5, color: s.active ? '#000' : p.textMuted, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{s.mode.toUpperCase()}</span><span>{s.updated}</span>
                </div>
              </div>
            ))}
            {tab === 'files' && (
              <div style={{ padding: 8, fontSize: 12 }}>
                {FILE_TREE.map((n, i) => (
                  <div key={i}>
                    <div style={{ padding: '4px 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: p.textMuted }}>{n.type === 'dir' ? (n.open ? '▾' : '▸') : ' '}</span>
                      <span style={{ color: n.type === 'dir' ? p.accent : p.text }}>{n.name}{n.type === 'dir' && '/'}</span>
                    </div>
                    {n.children && n.open && n.children.map((c, j) => (
                      <div key={j} style={{ padding: '3px 6px 3px 22px', display: 'flex', justifyContent: 'space-between',
                        background: c.active ? p.accent : 'transparent', color: c.active ? '#000' : (c.dirty ? p.warn : p.text) }}>
                        <span>{c.name}{c.dirty && ' ●'}</span>
                        <span style={{ color: c.active ? '#000' : p.textDim, fontSize: 10 }}>{c.kb}K</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {tab === 'servers' && PROFILES.map((pr) => {
              const dot = pr.status === 'running' ? p.ok : pr.status === 'idle' ? p.warn : p.textDim;
              return (
                <div key={pr.id} style={{ padding: 12, borderBottom: `1px solid ${p.borderDim}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <I.Dot color={dot} size={6}/>
                    <span style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{pr.id}</span>
                    <span style={{ fontSize: 9, color: p.textMuted, letterSpacing: 0.5 }}>{pr.kind.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 10, color: p.textMuted, marginTop: 4 }}>
                    :{pr.port} · {pr.status === 'running' ? `${pr.vram.toFixed(1)}G${pr.tps ? ` · ${pr.tps.toFixed(0)}t/s` : ''}` : pr.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Heavy session header */}
          <div style={{ borderBottom: `1px solid ${p.border}`, padding: '14px 20px', flex: 'none' }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: p.accent, textTransform: 'uppercase', fontWeight: 700 }}>SESSION · NARRATIVE-COAUTHOR</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, letterSpacing: -0.3 }}>MAREK · WEAPON CONSISTENCY PASS</div>
            <div style={{ display: 'flex', gap: 0, marginTop: 10, fontSize: 10, color: p.textMuted, letterSpacing: 0.5 }}>
              {[
                ['MODEL', 'qwen-32b-cuda-prod'],
                ['CTX', '4128/16384'],
                ['TOOLS', '9'],
                ['ITER', '4/8'],
                ['SNAP', '7f2a91c'],
              ].map(([k, v], i) => (
                <span key={k} style={{ paddingRight: 16, marginRight: 16, borderRight: i < 4 ? `1px solid ${p.borderSoft}` : 'none' }}>
                  <span style={{ color: p.textDim }}>{k} </span>
                  <span style={{ color: p.text, fontWeight: 600 }}>{v}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Chat */}
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {TOOL_LOG.map((m, i) => {
              if (m.kind === 'user') return (
                <div key={i} style={{ borderLeft: `2px solid ${p.text}`, paddingLeft: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: p.text, fontWeight: 700, marginBottom: 4 }}>USER</div>
                  <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, lineHeight: 1.55, fontWeight: 500 }}>{m.text}</div>
                </div>
              );
              if (m.kind === 'assistant_thought') return (
                <div key={i} style={{ borderLeft: `2px solid ${p.accent}`, paddingLeft: 12 }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: p.accent, fontWeight: 700, marginBottom: 4 }}>ASSISTANT · THOUGHT</div>
                  <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.55, color: p.textMuted, fontStyle: 'italic' }}>{m.text}</div>
                </div>
              );
              return (
                <div key={i} style={{ border: `1px solid ${p.borderSoft}`, fontSize: 11.5 }}>
                  <button onClick={() => toggle(i)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 0, padding: 0,
                    background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: p.text, fontFamily: 'inherit', fontSize: 'inherit',
                  }}>
                    <span style={{ width: 28, textAlign: 'center', color: p.accent, borderRight: `1px solid ${p.borderSoft}`, padding: '7px 0', fontWeight: 700 }}>
                      {expanded[i] ? '−' : '+'}
                    </span>
                    <span style={{ padding: '7px 10px', borderRight: `1px solid ${p.borderSoft}`, fontSize: 9, letterSpacing: 1.5, fontWeight: 700, color: m.name === 'edit_file' ? p.warn : p.accent }}>
                      TOOL
                    </span>
                    <span style={{ padding: '7px 10px', fontWeight: 600 }}>{m.name}</span>
                    <span style={{ padding: '7px 10px', color: p.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {m.args && Object.entries(m.args).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`).join(' ')}
                    </span>
                    {m.dur != null && <span style={{ padding: '7px 10px', color: p.textDim, borderLeft: `1px solid ${p.borderSoft}` }}>{m.dur}MS</span>}
                    {m.awaiting_approval && <span style={{ padding: '7px 10px', background: p.warn, color: '#000', fontSize: 9, letterSpacing: 1.5, fontWeight: 700 }}>APPROVE</span>}
                  </button>
                  {expanded[i] && (
                    <div style={{ borderTop: `1px solid ${p.borderSoft}`, padding: '10px 12px', fontSize: 11.5, lineHeight: 1.6, background: '#050505' }}>
                      {m.diff && (
                        <>
                          {m.diff.map((d, k) => (
                            <div key={k} style={{
                              background: d.type === 'add' ? '#1a2e1a' : 'transparent',
                              color: d.type === 'add' ? p.ok : p.textMuted,
                              padding: '0 6px',
                            }}>{d.type === 'add' ? '+ ' : '  '}{d.text}</div>
                          ))}
                          <div style={{ marginTop: 10, display: 'flex', gap: 0, borderTop: `1px solid ${p.borderSoft}`, paddingTop: 10 }}>
                            <button style={{ padding: '5px 14px', background: p.accent, color: '#000', border: 'none', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>ACCEPT</button>
                            <button style={{ padding: '5px 14px', background: 'transparent', color: p.text, border: `1px solid ${p.borderSoft}`, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer', marginLeft: -1 }}>REJECT</button>
                            <button style={{ padding: '5px 14px', background: 'transparent', color: p.textMuted, border: `1px solid ${p.borderSoft}`, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer', marginLeft: -1 }}>EDIT</button>
                          </div>
                        </>
                      )}
                      {m.result && m.result.preview && (
                        <pre style={{ margin: 0, color: p.text, whiteSpace: 'pre-wrap' }}>{m.result.preview}</pre>
                      )}
                      {m.result && m.result.hits && m.result.hits.map((h, k) => (
                        <div key={k} style={{ display: 'flex', gap: 12, padding: '2px 0' }}>
                          <span style={{ color: p.accent }}>{h.path}</span>
                          <span style={{ color: p.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.heading}</span>
                          <span style={{ color: p.textDim }}>{h.score.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Final */}
            <div style={{ borderLeft: `2px solid ${p.accent}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: p.accent, fontWeight: 700, marginBottom: 6 }}>ASSISTANT · ANSWER</div>
              <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, lineHeight: 1.6 }}>
                The blade Marek draws is a <em>sahir</em> — single-edged, common to river caravans. Knuckle-guard from a memorial coin matches canon. Edit staged on <code style={{ background: '#171717', color: p.accent, padding: '1px 5px', fontFamily: mono, fontSize: 12 }}>characters/marek.md</code>.
              </div>
              <div style={{ marginTop: 10, border: `1px solid ${p.borderSoft}` }}>
                <div style={{ padding: '6px 10px', borderBottom: `1px solid ${p.borderSoft}`, fontSize: 9, letterSpacing: 1.5, fontWeight: 700, color: p.accent, display: 'flex', justifyContent: 'space-between' }}>
                  <span>SOURCES</span><span style={{ color: p.textDim }}>3 CHUNKS</span>
                </div>
                {SOURCES.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 0, padding: 0, borderBottom: i < SOURCES.length - 1 ? `1px solid ${p.borderDim}` : 'none' }}>
                    <span style={{ width: 28, textAlign: 'center', color: p.textDim, padding: '7px 0', borderRight: `1px solid ${p.borderDim}`, fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ padding: '7px 10px', color: p.accent, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.path}</span>
                    <span style={{ padding: '7px 10px', color: p.textMuted, fontFamily: '"Inter", sans-serif', fontSize: 12, borderLeft: `1px solid ${p.borderDim}` }}>{s.heading}</span>
                    <span style={{ padding: '7px 10px', color: p.textDim, borderLeft: `1px solid ${p.borderDim}`, width: 60, textAlign: 'right' }}>{(s.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ borderTop: `1px solid ${p.border}`, padding: '12px 20px', flex: 'none' }}>
            <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', border: `1px solid ${p.borderSoft}` }}>
              <div style={{ width: 28, color: p.accent, padding: '10px 0', textAlign: 'center', borderRight: `1px solid ${p.borderSoft}`, fontWeight: 700 }}>›</div>
              <div style={{ flex: 1, padding: '10px 12px' }}>
                <div style={{ minHeight: 22, color: p.textDim, fontFamily: '"Inter", sans-serif', fontSize: 13 }}>continue · @-mention a file</div>
              </div>
              <button style={{ padding: '0 18px', background: p.accent, color: '#000', border: 'none', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>SEND</button>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10, color: p.textMuted, letterSpacing: 0.5 }}>
              <span>NARRATIVE-COAUTHOR</span><span style={{ color: p.textDim }}>·</span>
              <span>9 TOOLS</span><span style={{ color: p.textDim }}>·</span>
              <span style={{ color: p.warn }}>APPROVAL ON</span>
              <div style={{ flex: 1 }}/>
              <span>CMD ⏎</span>
            </div>
          </div>

          {/* Status bar */}
          <div style={{ height: 24, borderTop: `1px solid ${p.borderSoft}`, display: 'flex', alignItems: 'stretch', flex: 'none', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {[
              <><I.Dot color={p.ok} size={6}/> CHAT</>,
              <><I.Dot color={p.ok} size={6}/> EMBED</>,
              <><I.Dot color={p.warn} size={6}/> RERANK</>,
              <>41.2 T/S</>,
              <>VRAM 23.5/24</>,
              <>IDX 12,418</>,
            ].map((s, i) => (
              <div key={i} style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 4, borderRight: `1px solid ${p.borderDim}`, color: p.textMuted }}>{s}</div>
            ))}
            <div style={{ flex: 1 }}/>
            <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', borderLeft: `1px solid ${p.borderDim}`, color: p.textMuted }}>MAIN +3</div>
            <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', borderLeft: `1px solid ${p.borderDim}`, color: p.textMuted }}>UTF-8 · LF</div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.V4App = V4App;
