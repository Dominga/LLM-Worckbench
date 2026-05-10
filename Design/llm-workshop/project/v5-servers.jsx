// V5 — Servers tab. llama.cpp orchestrator dashboard.
// Renders inside the main column when V5App's tab === 'servers'.
// Layout: top resource bar → master list (rows) ←→ detail panel (right).

const STATUS_COLOR = (p) => ({
  running: p.ok, idle: p.warn, stopped: p.textDim, crashed: p.danger, starting: p.accent,
});

function V5Sparkline({ data, color, w = 92, h = 22 }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1 || 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  const fillPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polygon points={fillPts} fill={color} opacity="0.15"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  );
}

function V5Bar({ pct, color, bg, h = 4 }) {
  return (
    <div style={{ height: h, background: bg, borderRadius: h / 2, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, transition: 'width .25s' }}/>
    </div>
  );
}

function V5KpiCard({ p, label, value, sub, accent, pct, capLabel }) {
  return (
    <div style={{ flex: 1, padding: '12px 14px', background: p.surface, border: `1px solid ${p.borderSoft}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.6, color: p.textMuted, fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 600, color: p.text, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3 }}>{value}</span>
        {sub && <span style={{ fontSize: 11, color: p.textDim, fontFamily: 'ui-monospace, monospace' }}>{sub}</span>}
      </div>
      {pct != null && (
        <>
          <V5Bar pct={pct * 100} color={accent || p.accent} bg={p.borderSoft}/>
          {capLabel && <div style={{ fontSize: 10.5, color: p.textDim, display: 'flex', justifyContent: 'space-between' }}>
            <span>{(pct * 100).toFixed(0)}%</span><span>{capLabel}</span>
          </div>}
        </>
      )}
    </div>
  );
}

function V5StatusPill({ status, p, compact }) {
  const color = STATUS_COLOR(p)[status] || p.textDim;
  if (compact) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontSize: 11, fontWeight: 500 }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: color,
          boxShadow: status === 'running' ? `0 0 0 3px ${color}22` : 'none',
          animation: status === 'running' ? 'v5pulse 2s infinite' : 'none' }}/>
        {status}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px',
      background: `${color}1f`, color, border: `1px solid ${color}44`, borderRadius: 999,
      fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: color,
        animation: status === 'running' ? 'v5pulse 2s infinite' : 'none' }}/>
      {status}
    </span>
  );
}

function V5KindChip({ kind, p }) {
  const palette = { chat: p.accent, embed: '#22c55e', rerank: '#a78bfa' };
  const c = palette[kind] || p.textMuted;
  return (
    <span style={{ display: 'inline-block', padding: '1px 7px', fontSize: 10, borderRadius: 3,
      color: c, background: `${c}18`, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
      fontFamily: 'ui-monospace, monospace' }}>{kind}</span>
  );
}

function V5ServersScreen({ p }) {
  const [selectedId, setSelectedId] = React.useState(SERVERS.find((s) => s.selected)?.id || SERVERS[0].id);
  const [filter, setFilter] = React.useState('all'); // all | chat | embed | rerank
  const [logsTab, setLogsTab] = React.useState('logs'); // logs | config | metrics
  const selected = SERVERS.find((s) => s.id === selectedId) || SERVERS[0];
  const visible = SERVERS.filter((s) => filter === 'all' || s.kind === filter);

  const totalVram = SERVERS.reduce((a, s) => a + (s.vram || 0), 0);
  const vramCap = SERVERS[0].vramCap;
  const totalReqs = SERVERS.reduce((a, s) => a + (s.reqs || 0), 0);
  const totalRam = SERVERS.reduce((a, s) => a + (s.ramMb || 0), 0);
  const running = SERVERS.filter((s) => s.status === 'running').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: p.bg }}>
      <style>{`@keyframes v5pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>

      {/* Page header */}
      <div style={{ padding: '16px 24px 14px', borderBottom: `1px solid ${p.borderSoft}`, flex: 'none',
        display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: -0.2, color: p.text }}>Servers</h1>
          <div style={{ fontSize: 11.5, color: p.textMuted, marginTop: 3, display: 'flex', gap: 8, fontVariantNumeric: 'tabular-nums', alignItems: 'center' }}>
            <span><span style={{ color: p.ok }}>●</span> {running} running</span>
            <span style={{ color: p.textDim }}>·</span>
            <span>{SERVERS.length} profiles</span>
            <span style={{ color: p.textDim }}>·</span>
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>llama-server 0.0.5234</span>
          </div>
        </div>
        <button style={{ padding: '7px 12px', background: 'transparent', color: p.text,
          border: `1px solid ${p.border}`, borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <I.Folder size={12}/> Models…
        </button>
        <button style={{ padding: '7px 12px', background: p.accent, color: '#fff', border: 'none',
          borderRadius: 6, fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <I.Plus size={12}/> New profile
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${p.borderSoft}`, flex: 'none',
        display: 'flex', gap: 12 }}>
        <V5KpiCard p={p} label="VRAM" value={totalVram.toFixed(1)} sub={`/ ${vramCap.toFixed(1)} GB`}
          pct={totalVram / vramCap} accent={totalVram / vramCap > 0.9 ? p.warn : p.accent} capLabel="CUDA:0 · RTX 4090"/>
        <V5KpiCard p={p} label="System RAM" value={(totalRam / 1024).toFixed(1)} sub="/ 64 GB"
          pct={(totalRam / 1024) / 64} accent={p.accent} capLabel="resident"/>
        <V5KpiCard p={p} label="Throughput" value="41.2" sub="t/s · chat"/>
        <V5KpiCard p={p} label="Requests" value={totalReqs.toLocaleString()} sub="last hour"/>
      </div>

      {/* Filter row */}
      <div style={{ padding: '10px 24px 8px', flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', background: p.surface, borderRadius: 6, padding: 3, border: `1px solid ${p.borderSoft}` }}>
          {[['all', `All · ${SERVERS.length}`], ['chat', `Chat · ${SERVERS.filter(s=>s.kind==='chat').length}`], ['embed', `Embed · ${SERVERS.filter(s=>s.kind==='embed').length}`], ['rerank', `Rerank · ${SERVERS.filter(s=>s.kind==='rerank').length}`]].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} style={{
              padding: '4px 12px', border: 'none', borderRadius: 4, cursor: 'pointer',
              background: filter === k ? p.bg : 'transparent', fontFamily: 'inherit', fontSize: 12,
              color: filter === k ? p.text : p.textMuted, fontWeight: 500,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 11, color: p.textDim, fontFamily: 'ui-monospace, monospace' }}>auto-refresh · 2s</span>
      </div>

      {/* Body: master list + detail */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, padding: '0 24px 18px', gap: 14 }}>
        {/* Master list — card layout: name takes a full row, metrics row beneath */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {visible.map((s) => {
              const sel = s.id === selectedId;
              const sc = STATUS_COLOR(p)[s.status];
              const isOn = s.status === 'running';
              return (
                <div key={s.id} onClick={() => setSelectedId(s.id)} style={{
                  padding: '12px 14px', cursor: 'pointer',
                  background: sel ? p.accentSoft : 'transparent',
                  borderLeft: sel ? `3px solid ${p.accent}` : '3px solid transparent',
                  borderBottom: `1px solid ${p.borderSoft}`,
                }}>
                  {/* Row 1: name + status + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <V5KindChip kind={s.kind} p={p}/>
                    <span style={{ fontSize: 14, fontWeight: 600, color: p.text, fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{s.id}</span>
                    <V5StatusPill status={s.status} p={p} compact/>
                    <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                      {isOn ? (
                        <V5IconBtn p={p} title="Stop" color={p.danger} onClick={(e) => { e.stopPropagation(); }}><I.Stop size={11}/></V5IconBtn>
                      ) : (
                        <V5IconBtn p={p} title="Start" color={p.ok} onClick={(e) => { e.stopPropagation(); }}><I.Play size={11}/></V5IconBtn>
                      )}
                      <V5IconBtn p={p} title="Restart" onClick={(e) => { e.stopPropagation(); }}><I.Refresh size={11}/></V5IconBtn>
                      <V5IconBtn p={p} title="Edit profile" onClick={(e) => { e.stopPropagation(); }}><I.Edit size={11}/></V5IconBtn>
                    </div>
                  </div>
                  {/* Row 2: model line */}
                  <div style={{ marginTop: 4, marginLeft: 0, fontSize: 11.5, color: p.textMuted, fontFamily: 'ui-monospace, monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.model} · {s.quant} · {s.size}
                  </div>
                  {/* Row 3: metrics */}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                    fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: isOn ? p.text : p.textDim }}>
                      <span style={{ color: p.textMuted, marginRight: 4 }}>port</span>:{s.port}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
                      <span style={{ color: p.textMuted }}>vram</span>
                      {isOn || s.vram > 0 ? <>
                        <span style={{ color: p.text }}>{s.vram.toFixed(1)}<span style={{ color: p.textDim }}>/{s.vramCap.toFixed(0)}</span></span>
                        <span style={{ width: 60, display: 'inline-block' }}>
                          <V5Bar pct={(s.vram / s.vramCap) * 100} color={sc} bg={p.borderSoft}/>
                        </span>
                      </> : <span style={{ color: p.textDim }}>—</span>}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: p.textMuted }}>{s.kind === 'chat' ? 't/s' : s.kind === 'embed' ? 'lat' : 'rerank'}</span>
                      {s.tps != null ? <>
                        <V5Sparkline data={s.spark} color={sc} w={48} h={14}/>
                        <span style={{ color: p.text }}>{s.tps.toFixed(1)}</span>
                      </> : isOn && s.kind === 'embed' ? <span style={{ color: p.text }}>14<span style={{ color: p.textDim }}>ms</span></span>
                        : <span style={{ color: p.textDim }}>—</span>}
                    </span>
                    <span><span style={{ color: p.textMuted, marginRight: 4 }}>req</span><span style={{ color: s.reqs ? p.text : p.textDim }}>{s.reqs.toLocaleString()}</span></span>
                    <span><span style={{ color: p.textMuted, marginRight: 4 }}>up</span><span style={{ color: isOn ? p.text : p.textDim }}>{s.uptime}</span></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <div style={{ width: 380, display: 'flex', flexDirection: 'column',
          background: p.surface, border: `1px solid ${p.borderSoft}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${p.borderSoft}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <V5KindChip kind={selected.kind} p={p}/>
              <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' }}>{selected.id}</span>
              <V5StatusPill status={selected.status} p={p} compact/>
            </div>
            <div style={{ fontSize: 11, color: p.textMuted, marginTop: 5, fontFamily: 'ui-monospace, monospace' }}>
              {selected.model} · {selected.quant}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button style={{ flex: 1, padding: '6px 10px', background: p.accent, color: '#fff', border: 'none', borderRadius: 5, fontSize: 11.5, fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <I.Edit size={11}/> Edit profile
              </button>
              <V5IconBtn p={p} title="Duplicate"><I.Copy size={11}/></V5IconBtn>
              <V5IconBtn p={p} title="Restart"><I.Refresh size={11}/></V5IconBtn>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              {[
                ['Port', `:${selected.port}`],
                ['Host', selected.host],
                ['Slots', selected.slots],
                ['Context', `${selected.ctxUsed.toLocaleString()} / ${selected.ctxMax.toLocaleString()}`],
                ['Uptime', selected.uptime],
                ['GPU', selected.gpu],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.5, color: p.textMuted, fontWeight: 600 }}>{k}</div>
                  <div style={{ fontSize: 12, color: p.text, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
            {selected.error && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: `${p.danger}14`, border: `1px solid ${p.danger}44`, borderRadius: 6, fontSize: 11.5, color: p.danger, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', marginTop: 1 }}>⚠</span>
                <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace' }}>{selected.error}</span>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${p.borderSoft}`, flex: 'none' }}>
            {[['logs', 'Logs'], ['config', 'Config'], ['metrics', 'Metrics']].map(([k, label]) => (
              <button key={k} onClick={() => setLogsTab(k)} style={{
                flex: 1, padding: '8px 0', background: 'transparent', border: 'none', cursor: 'pointer',
                color: logsTab === k ? p.text : p.textMuted, fontSize: 11.5, fontFamily: 'inherit', fontWeight: 500,
                borderBottom: logsTab === k ? `2px solid ${p.accent}` : '2px solid transparent',
              }}>{label}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.55 }}>
            {logsTab === 'logs' && SERVER_LOG_TAIL.filter((l) => selected.kind === 'chat' ? l.src === 'chat' : l.src === selected.kind).map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: p.textDim }}>{l.t}</span>
                <span style={{ color: l.lvl === 'W' ? p.warn : p.accent, width: 10 }}>{l.lvl}</span>
                <span style={{ color: p.text, flex: 1 }}>{l.msg}</span>
              </div>
            ))}
            {logsTab === 'logs' && selected.status !== 'running' && selected.status !== 'idle' && (
              <div style={{ color: p.textDim }}># server is {selected.status}; no live output.</div>
            )}
            {logsTab === 'config' && (
              <div>
                <div style={{ color: p.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Launch command</div>
                <div style={{ background: p.bg, padding: 10, borderRadius: 4, color: p.text, whiteSpace: 'pre-wrap', wordBreak: 'break-all', border: `1px solid ${p.borderSoft}` }}>
                  $ {selected.cmd}
                </div>
                <div style={{ marginTop: 14, color: p.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Sampling defaults</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', color: p.text }}>
                  <span style={{ color: p.textMuted }}>temperature</span><span>0.7</span>
                  <span style={{ color: p.textMuted }}>top_p</span><span>0.95</span>
                  <span style={{ color: p.textMuted }}>min_p</span><span>0.05</span>
                  <span style={{ color: p.textMuted }}>repeat_penalty</span><span>1.1</span>
                </div>
              </div>
            )}
            {logsTab === 'metrics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['VRAM', `${selected.vram.toFixed(1)} / ${selected.vramCap.toFixed(1)} GB`, selected.vram / selected.vramCap, p.accent],
                  ['Context', `${selected.ctxUsed} / ${selected.ctxMax}`, selected.ctxUsed / selected.ctxMax, p.accent],
                  ['CPU', `${selected.cpu}%`, selected.cpu / 100, p.accent],
                ].map(([k, v, pct, c]) => (
                  <div key={k}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: p.textMuted }}>
                      <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</span>
                      <span style={{ color: p.text }}>{v}</span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <V5Bar pct={pct * 100} color={c} bg={p.borderSoft}/>
                    </div>
                  </div>
                ))}
                {selected.tps != null && (
                  <div>
                    <div style={{ fontSize: 11, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tokens / second · 30s</div>
                    <div style={{ marginTop: 6, padding: 8, background: p.bg, borderRadius: 4, border: `1px solid ${p.borderSoft}` }}>
                      <V5Sparkline data={selected.spark} color={p.accent} w={332} h={48}/>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function V5IconBtn({ children, p, title, color, onClick }) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 26, height: 26, background: 'transparent', border: `1px solid ${p.borderSoft}`,
      color: color || p.textMuted, borderRadius: 5, display: 'flex', alignItems: 'center',
      justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
    }}>{children}</button>
  );
}

window.V5ServersScreen = V5ServersScreen;
