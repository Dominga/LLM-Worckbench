import { CSSProperties, useMemo, useState } from 'react';
import {
  IconPlus,
  IconFolder,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconEdit,
  IconCopy,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { V5 } from '../theme';
import {
  Profile,
  InstanceStatus,
  InstanceMetrics,
  SysMetricsPayload,
  emptyInstanceStatus,
  emptyInstanceMetrics,
} from '../shell/types';
import { BuildsPanel } from '../components/BuildsPanel';

type Kind = 'chat' | 'embed' | 'rerank' | 'all';

export type ServersTabProps = {
  profiles: Profile[];
  activeProfileId: string;
  statusByProfile: Record<string, InstanceStatus>;
  metricsByProfile: Record<string, InstanceMetrics>;
  logsByProfile: Record<string, string[]>;
  sysMetrics: SysMetricsPayload | null;
  onSelectProfile: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onCreateProfile: () => void;
  onEditProfile: (p: Profile) => void;
  onDeleteProfile: (p: Profile) => void;
};

export function ServersTab({
  profiles,
  activeProfileId,
  statusByProfile,
  metricsByProfile,
  logsByProfile,
  sysMetrics,
  onSelectProfile,
  onStart,
  onStop,
  onRestart,
  onCreateProfile,
  onEditProfile,
  onDeleteProfile,
}: ServersTabProps) {
  const [filter, setFilter] = useState<Kind>('all');
  const [logsTab, setLogsTab] = useState<'logs' | 'config' | 'metrics'>('logs');
  // Per-family collapse state. Defaults to expanded; closed groups
  // persist for the session via state (localStorage is overkill for
  // such a small preference).
  const [collapsedFamilies, setCollapsedFamilies] = useState<Record<string, boolean>>({});

  const visible = filter === 'all' ? profiles : profiles.filter((p) => p.Kind === filter);

  // Group visible profiles by family. "" → "uncategorized" bucket
  // rendered last so it doesn't dominate the top when most profiles
  // are still untagged.
  const familyGroups = useMemo(() => {
    const groups = new Map<string, Profile[]>();
    for (const p of visible) {
      const key = ((p as any).Family || '').toString().trim() || '';
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    const named = Array.from(groups.entries())
      .filter(([k]) => k !== '')
      .sort(([a], [b]) => a.localeCompare(b));
    const uncategorized = groups.get('') ?? [];
    if (uncategorized.length > 0) {
      named.push(['', uncategorized]);
    }
    return named;
  }, [visible]);

  const toggleFamilyCollapse = (key: string) =>
    setCollapsedFamilies((s) => ({ ...s, [key]: !s[key] }));

  const selected = profiles.find((p) => p.ID === activeProfileId) || profiles[0];
  const selectedStatus = selected
    ? statusByProfile[selected.ID] || emptyInstanceStatus(selected.ID)
    : undefined;
  const selectedMetrics = selected
    ? metricsByProfile[selected.ID] || emptyInstanceMetrics(selected.ID)
    : undefined;
  const selectedLogs = selected ? logsByProfile[selected.ID] || [] : [];

  const running = profiles.filter((p) => statusByProfile[p.ID]?.state === 'running').length;
  const totalReqs = profiles.reduce(
    (a, p) => a + (metricsByProfile[p.ID]?.reqs || 0),
    0,
  );
  const liveTPS = profiles
    .filter((p) => p.Kind === 'chat')
    .map((p) => metricsByProfile[p.ID]?.lastTps || 0)
    .reduce((a, b) => a + b, 0);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        background: V5.bg,
      }}
    >
      <style>{`@keyframes v5pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>

      {/* Header */}
      <div
        style={{
          padding: '16px 24px 14px',
          borderBottom: `1px solid ${V5.borderSoft}`,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: -0.2,
              color: V5.text,
            }}
          >
            Servers
          </h1>
          <div
            style={{
              fontSize: 11.5,
              color: V5.textMuted,
              marginTop: 3,
              display: 'flex',
              gap: 8,
              fontVariantNumeric: 'tabular-nums',
              alignItems: 'center',
            }}
          >
            <span>
              <span style={{ color: V5.ok }}>●</span> {running} running
            </span>
            <span style={{ color: V5.textDim }}>·</span>
            <span>{profiles.length} profiles</span>
          </div>
        </div>
        <button style={ghostBtnStyle} disabled title="Model registry — M2">
          <IconFolder size={12} /> Models…
        </button>
        <button onClick={onCreateProfile} style={primaryBtnStyle}>
          <IconPlus size={12} /> New profile
        </button>
      </div>

      {/* KPI strip */}
      <div
        style={{
          padding: '14px 24px',
          borderBottom: `1px solid ${V5.borderSoft}`,
          flex: 'none',
          display: 'flex',
          gap: 12,
        }}
      >
        <KpiCard label="Running" value={running.toString()} sub={`/ ${profiles.length}`} />
        <KpiCard label="Throughput" value={liveTPS.toFixed(1)} sub="t/s · chat" />
        <KpiCard label="Requests" value={totalReqs.toLocaleString()} sub="this session" />
        {(() => {
          const gpu = sysMetrics?.gpu;
          if (gpu?.available && gpu.totalMb > 0) {
            const usedGb = gpu.usedMb / 1024;
            const totalGb = gpu.totalMb / 1024;
            const pct = gpu.usedMb / gpu.totalMb;
            const cap =
              gpu.gpus && gpu.gpus.length > 0
                ? gpu.gpus[0].name + (gpu.gpus.length > 1 ? ` +${gpu.gpus.length - 1}` : '')
                : 'GPU';
            return (
              <KpiCard
                label="VRAM"
                value={usedGb.toFixed(1)}
                sub={`/ ${totalGb.toFixed(1)} GB`}
                pct={pct}
                accent={pct > 0.9 ? V5.warn : V5.accent}
                capLabel={cap}
              />
            );
          }
          return <KpiCard label="VRAM" value="—" sub="no nvidia-smi" muted />;
        })()}
        {(() => {
          const ram = sysMetrics?.ram;
          if (ram?.available && ram.totalBytes > 0) {
            const usedGb = ram.usedBytes / (1024 * 1024 * 1024);
            const totalGb = ram.totalBytes / (1024 * 1024 * 1024);
            const pct = ram.usedBytes / ram.totalBytes;
            return (
              <KpiCard
                label="System RAM"
                value={usedGb.toFixed(1)}
                sub={`/ ${totalGb.toFixed(0)} GB`}
                pct={pct}
                accent={pct > 0.9 ? V5.warn : V5.accent}
                capLabel="resident"
              />
            );
          }
          return <KpiCard label="System RAM" value="—" sub="unavailable" muted />;
        })()}
      </div>

      {/* Filter row */}
      <div
        style={{
          padding: '10px 24px 8px',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            background: V5.surface,
            borderRadius: 6,
            padding: 3,
            border: `1px solid ${V5.borderSoft}`,
          }}
        >
          {(
            [
              ['all', `All · ${profiles.length}`],
              ['chat', `Chat · ${profiles.filter((p) => p.Kind === 'chat').length}`],
              ['embed', `Embed · ${profiles.filter((p) => p.Kind === 'embed').length}`],
              ['rerank', `Rerank · ${profiles.filter((p) => p.Kind === 'rerank').length}`],
            ] as Array<[Kind, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                padding: '4px 12px',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                background: filter === k ? V5.bg : 'transparent',
                fontFamily: 'inherit',
                fontSize: 12,
                color: filter === k ? V5.text : V5.textMuted,
                fontWeight: 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span
          title="Server metrics refresh every 2 seconds while running"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: V5.textDim,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: V5.accent,
              animation: 'v5pulse 2s infinite',
            }}
          />
          auto-refresh · 2s
        </span>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          padding: '0 24px 18px',
          gap: 14,
        }}
      >
        {/* Master list */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: V5.surface,
            border: `1px solid ${V5.borderSoft}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: 1, overflow: 'auto' }}>
            {visible.length === 0 && (
              <div
                style={{
                  padding: 40,
                  color: V5.textDim,
                  fontStyle: 'italic',
                  fontSize: 13,
                  textAlign: 'center',
                }}
              >
                No profiles match this filter.
              </div>
            )}
            {familyGroups.map(([family, group]) => {
              const collapsed = !!collapsedFamilies[family];
              const label = family === '' ? 'Uncategorized' : family;
              return (
                <div key={family || '__uncat'}>
                  <button
                    onClick={() => toggleFamilyCollapse(family)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: `1px solid ${V5.borderSoft}`,
                      cursor: 'pointer',
                      color: V5.textMuted,
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      fontFamily: 'inherit',
                    }}
                  >
                    {collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                    <span>{label}</span>
                    <span style={{ color: V5.textDim }}>· {group.length}</span>
                  </button>
                  {!collapsed &&
                    group.map((p) => (
                      <ServerRow
                        key={p.ID}
                        profile={p}
                        status={statusByProfile[p.ID]}
                        metrics={metricsByProfile[p.ID]}
                        isSelected={selected?.ID === p.ID}
                        onSelect={() => onSelectProfile(p.ID)}
                        onStart={() => onStart(p.ID)}
                        onStop={() => onStop(p.ID)}
                        onRestart={() => onRestart(p.ID)}
                        onEdit={() => onEditProfile(p)}
                      />
                    ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selected && selectedStatus && selectedMetrics && (
          <div
            style={{
              width: 380,
              display: 'flex',
              flexDirection: 'column',
              background: V5.surface,
              border: `1px solid ${V5.borderSoft}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${V5.borderSoft}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <KindChip kind={selected.Kind as 'chat' | 'embed' | 'rerank'} />
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  {selected.ID}
                </span>
                <StatusPill state={selectedStatus.state} />
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: V5.textMuted,
                  marginTop: 5,
                  fontFamily: 'ui-monospace, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selected.ModelPath}
              </div>
              {((selected as any).MMProjPath ||
                ((selected as any).LaunchEmbedding && (selected as any).EmbedProfileID)) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {(selected as any).MMProjPath && (
                    <CompanionChip
                      label="mmproj"
                      path={(selected as any).MMProjPath}
                      color={V5.accent}
                    />
                  )}
                  {(selected as any).LaunchEmbedding && (selected as any).EmbedProfileID && (
                    <button
                      title="Linked embed sidecar — click to select that profile"
                      onClick={() => onSelectProfile((selected as any).EmbedProfileID)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '2px 7px',
                        background: '#22c55e18',
                        border: '1px solid #22c55e44',
                        color: '#22c55e',
                        borderRadius: 999,
                        fontSize: 10.5,
                        fontFamily: 'ui-monospace, monospace',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        linked
                      </span>
                      <span style={{ color: V5.text }}>
                        → {(selected as any).EmbedProfileID}
                      </span>
                    </button>
                  )}
                </div>
              )}
              {selected.ID === 'm0-default' && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 10.5,
                    color: V5.textDim,
                    display: 'inline-block',
                    padding: '2px 7px',
                    background: V5.bg,
                    border: `1px dashed ${V5.borderSoft}`,
                    borderRadius: 3,
                    fontStyle: 'italic',
                  }}
                  title="This profile was migrated from your legacy .env file on first launch."
                >
                  seeded from .env
                </div>
              )}
              {selectedStatus.state === 'running' && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 10.5,
                    color: V5.warn,
                    fontStyle: 'italic',
                  }}
                >
                  Edits to a running profile take effect after Restart.
                </div>
              )}
              {selectedStatus.state === 'crashed' && (
                <CrashBanner logs={selectedLogs} />
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button onClick={() => onEditProfile(selected)} style={detailPrimaryBtnStyle}>
                  <IconEdit size={11} /> Edit profile
                </button>
                <SmallIconBtn title="Duplicate" disabled>
                  <IconCopy size={11} />
                </SmallIconBtn>
                <SmallIconBtn title="Restart" onClick={() => onRestart(selected.ID)}>
                  <IconRefresh size={11} />
                </SmallIconBtn>
                <SmallIconBtn
                  title="Delete"
                  color={V5.danger}
                  onClick={() => onDeleteProfile(selected)}
                >
                  <IconTrash size={11} />
                </SmallIconBtn>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                <DetailField label="Port" value={`:${selected.Port}`} />
                <DetailField label="Host" value={selected.Host} />
                <DetailField
                  label="Uptime"
                  value={
                    selectedStatus.uptimeSec > 0 ? formatUptime(selectedStatus.uptimeSec) : '—'
                  }
                />
                <DetailField label="PID" value={selectedStatus.pid ? String(selectedStatus.pid) : '—'} />
                <DetailField
                  label="Ctx"
                  value={selected.CtxSize > 0 ? selected.CtxSize.toLocaleString() : '—'}
                />
                <DetailField label="NGL" value={selected.NGL > 0 ? String(selected.NGL) : '—'} />
              </div>
            </div>

            {/* Tabs */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                borderBottom: `1px solid ${V5.borderSoft}`,
                flex: 'none',
              }}
            >
              {(['logs', 'config', 'metrics'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setLogsTab(k)}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: logsTab === k ? V5.text : V5.textMuted,
                    fontSize: 11.5,
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    textTransform: 'capitalize',
                    borderBottom:
                      logsTab === k ? `2px solid ${V5.accent}` : '2px solid transparent',
                  }}
                >
                  {k}
                </button>
              ))}
              {logsTab === 'logs' && (
                <button
                  onClick={async () => {
                    if (selectedLogs.length === 0) {
                      notifications.show({
                        color: 'gray',
                        title: 'Logs empty',
                        message: 'No log lines captured yet.',
                      });
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(selectedLogs.join('\n'));
                      notifications.show({
                        color: 'teal',
                        title: 'Copied',
                        message: `${selectedLogs.length} log lines on clipboard.`,
                      });
                    } catch (e: any) {
                      notifications.show({
                        color: 'red',
                        title: 'Copy failed',
                        message: String(e),
                      });
                    }
                  }}
                  title="Copy all log lines"
                  style={{
                    padding: '6px 10px',
                    marginRight: 6,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: V5.textMuted,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                  }}
                >
                  <IconCopy size={12} />
                  copy
                </button>
              )}
            </div>

            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: 12,
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11,
                lineHeight: 1.55,
              }}
            >
              {logsTab === 'logs' && (
                <div style={{ color: V5.text, whiteSpace: 'pre-wrap' }}>
                  {selectedLogs.length === 0 ? (
                    <div style={{ color: V5.textDim, fontStyle: 'italic' }}>
                      # no output yet
                    </div>
                  ) : (
                    selectedLogs.map((l, i) => <div key={i}>{l}</div>)
                  )}
                </div>
              )}
              {logsTab === 'config' && <ConfigView profile={selected} />}
              {logsTab === 'metrics' && (
                <MetricsView metrics={selectedMetrics} status={selectedStatus} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Builds (M5) — recipes + compiled binaries, below the profile list. */}
      <BuildsPanel />
    </div>
  );
}

// ─────────────────────────── sub-components ───────────────────────────

function ServerRow({
  profile,
  status,
  metrics,
  isSelected,
  onSelect,
  onStart,
  onStop,
  onRestart,
  onEdit,
}: {
  profile: Profile;
  status?: InstanceStatus;
  metrics?: InstanceMetrics;
  isSelected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onEdit: () => void;
}) {
  const state = (status?.state || 'stopped') as string;
  const isOn = state === 'running' || state === 'starting';
  const tps = metrics?.lastTps || 0;
  const reqs = metrics?.reqs || 0;
  const modelLabel = (profile.ModelPath || '').split('/').pop();

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 14px',
        cursor: 'pointer',
        background: isSelected ? V5.accentSoft : 'transparent',
        borderLeft: isSelected ? `3px solid ${V5.accent}` : '3px solid transparent',
        borderBottom: `1px solid ${V5.borderSoft}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <KindChip kind={profile.Kind as 'chat' | 'embed' | 'rerank'} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: V5.text,
            fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
        >
          {profile.ID}
        </span>
        <StatusPill state={state} />
        <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
          {isOn ? (
            <SmallIconBtn
              title="Stop"
              color={V5.danger}
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
            >
              <IconPlayerStop size={11} />
            </SmallIconBtn>
          ) : (
            <SmallIconBtn
              title="Start"
              color={V5.ok}
              onClick={(e) => {
                e.stopPropagation();
                onStart();
              }}
            >
              <IconPlayerPlay size={11} />
            </SmallIconBtn>
          )}
          <SmallIconBtn
            title="Restart"
            onClick={(e) => {
              e.stopPropagation();
              onRestart();
            }}
          >
            <IconRefresh size={11} />
          </SmallIconBtn>
          <SmallIconBtn
            title="Edit profile"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <IconEdit size={11} />
          </SmallIconBtn>
        </div>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11.5,
          color: V5.textMuted,
          fontFamily: 'ui-monospace, monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {modelLabel}
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11.5,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span style={{ color: isOn ? V5.text : V5.textDim }}>
          <span style={{ color: V5.textMuted, marginRight: 4 }}>port</span>:{profile.Port}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: V5.textMuted }}>
            {profile.Kind === 'chat' ? 't/s' : 'reqs'}
          </span>
          {profile.Kind === 'chat' && metrics?.tpsSpark && metrics.tpsSpark.length > 1 && (
            <Sparkline data={metrics.tpsSpark} color={V5.accent} w={60} h={14} />
          )}
          {profile.Kind === 'chat'
            ? <span style={{ color: tps > 0 ? V5.text : V5.textDim }}>{tps > 0 ? tps.toFixed(1) : '—'}</span>
            : <span style={{ color: reqs > 0 ? V5.text : V5.textDim }}>{reqs > 0 ? reqs : '—'}</span>}
        </span>
        <span>
          <span style={{ color: V5.textMuted, marginRight: 4 }}>req</span>
          <span style={{ color: reqs ? V5.text : V5.textDim }}>{reqs}</span>
        </span>
        <span>
          <span style={{ color: V5.textMuted, marginRight: 4 }}>up</span>
          <span style={{ color: isOn && status?.uptimeSec ? V5.text : V5.textDim }}>
            {isOn && status?.uptimeSec ? formatUptime(status.uptimeSec) : '—'}
          </span>
        </span>
      </div>
    </div>
  );
}

function ConfigView({ profile }: { profile: Profile }) {
  const argv = buildArgvPreview(profile);
  return (
    <div>
      <SectionLabel>Launch command</SectionLabel>
      <div
        style={{
          background: V5.bg,
          padding: 10,
          borderRadius: 4,
          color: V5.text,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          border: `1px solid ${V5.borderSoft}`,
        }}
      >
        $ {profile.BinPath} {argv.join(' ')}
      </div>
      <div style={{ marginTop: 14 }}>
        <SectionLabel>Sampling defaults</SectionLabel>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 14px',
          color: V5.text,
        }}
      >
        <span style={{ color: V5.textMuted }}>temperature</span>
        <span>{profile.Sampling?.Temperature ?? 0.7}</span>
        <span style={{ color: V5.textMuted }}>top_p</span>
        <span>{profile.Sampling?.TopP ?? 0.95}</span>
        <span style={{ color: V5.textMuted }}>min_p</span>
        <span>{profile.Sampling?.MinP ?? 0.05}</span>
        <span style={{ color: V5.textMuted }}>repeat_penalty</span>
        <span>{profile.Sampling?.RepeatPenalty ?? 1.1}</span>
      </div>
    </div>
  );
}

function MetricsView({
  metrics,
  status,
}: {
  metrics: InstanceMetrics;
  status: InstanceStatus;
}) {
  const spark = metrics.tpsSpark || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <MetricLine label="Throughput" value={`${metrics.lastTps.toFixed(1)} t/s`} pct={Math.min(metrics.lastTps / 60, 1)} />
      <MetricLine label="Requests" value={metrics.reqs.toLocaleString()} pct={null} />
      <MetricLine
        label="Uptime"
        value={status.uptimeSec ? formatUptime(status.uptimeSec) : '—'}
        pct={null}
      />
      {spark.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              color: V5.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            t/s history
          </div>
          <div
            style={{
              marginTop: 6,
              padding: 8,
              background: V5.bg,
              borderRadius: 4,
              border: `1px solid ${V5.borderSoft}`,
            }}
          >
            <Sparkline data={spark} color={V5.accent} w={332} h={48} />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricLine({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number | null;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: V5.textMuted,
        }}
      >
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
        <span style={{ color: V5.text }}>{value}</span>
      </div>
      {pct != null && (
        <div style={{ marginTop: 4 }}>
          <Bar pct={pct * 100} color={V5.accent} bg={V5.borderSoft} />
        </div>
      )}
    </div>
  );
}

function Sparkline({
  data,
  color,
  w = 92,
  h = 22,
}: {
  data: number[];
  color: string;
  w?: number;
  h?: number;
}) {
  if (!data?.length) return null;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1 || 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  const fillPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polygon points={fillPts} fill={color} opacity="0.15" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function Bar({ pct, color, bg, h = 4 }: { pct: number; color: string; bg: string; h?: number }) {
  return (
    <div style={{ height: h, background: bg, borderRadius: h / 2, overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.min(pct, 100)}%`,
          height: '100%',
          background: color,
          transition: 'width .25s',
        }}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  muted,
  pct,
  accent,
  capLabel,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
  pct?: number;
  accent?: string;
  capLabel?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 14px',
        background: V5.surface,
        border: `1px solid ${V5.borderSoft}`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        opacity: muted ? 0.5 : 1,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: V5.textMuted,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: V5.text,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: -0.3,
          }}
        >
          {value}
        </span>
        {sub && (
          <span
            style={{ fontSize: 11, color: V5.textDim, fontFamily: 'ui-monospace, monospace' }}
          >
            {sub}
          </span>
        )}
      </div>
      {pct != null && (
        <>
          <Bar pct={pct * 100} color={accent || V5.accent} bg={V5.borderSoft} />
          <div
            style={{
              fontSize: 10.5,
              color: V5.textDim,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{(pct * 100).toFixed(0)}%</span>
            {capLabel && (
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginLeft: 8,
                }}
              >
                {capLabel}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CrashBanner({ logs }: { logs: string[] }) {
  // Pull the last few lines that look like errors (stderr or contain
  // err/fail/abort tokens). Falls back to last 5 lines if no matches.
  const errLines = logs
    .filter((l) => {
      const lc = l.toLowerCase();
      return (
        l.startsWith('[stderr]') ||
        lc.includes('error') ||
        lc.includes('fail') ||
        lc.includes('abort')
      );
    })
    .slice(-5);
  const tail = errLines.length > 0 ? errLines : logs.slice(-5);
  return (
    <div
      style={{
        marginTop: 10,
        padding: '8px 10px',
        background: `${V5.danger}14`,
        border: `1px solid ${V5.danger}44`,
        borderRadius: 6,
        fontSize: 11,
        color: V5.danger,
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <span style={{ flex: 'none', marginTop: 1 }}>⚠</span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          color: V5.text,
          lineHeight: 1.5,
          maxHeight: 120,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {tail.length === 0 ? (
          <em style={{ color: V5.textDim }}>no log output captured</em>
        ) : (
          tail.map((l, i) => (
            <div key={i} style={{ fontSize: 10.5 }}>
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CompanionChip({
  label,
  path,
  color,
}: {
  label: string;
  path: string;
  color: string;
}) {
  const file = path.split('/').pop() || path;
  return (
    <span
      title={path}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        background: `${color}18`,
        border: `1px solid ${color}44`,
        color,
        borderRadius: 999,
        fontSize: 10.5,
        fontFamily: 'ui-monospace, monospace',
        maxWidth: '100%',
      }}
    >
      <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </span>
      <span
        style={{
          color: V5.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 220,
        }}
      >
        {file}
      </span>
    </span>
  );
}

function KindChip({ kind }: { kind: 'chat' | 'embed' | 'rerank' }) {
  const palette: Record<string, string> = {
    chat: V5.accent,
    embed: '#22c55e',
    rerank: '#a78bfa',
  };
  const c = palette[kind] || V5.textMuted;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        fontSize: 10,
        borderRadius: 3,
        color: c,
        background: `${c}18`,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {kind}
    </span>
  );
}

function StatusPill({ state }: { state: string }) {
  const color =
    state === 'running'
      ? V5.ok
      : state === 'starting'
        ? V5.warn
        : state === 'crashed'
          ? V5.danger
          : V5.textDim;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          background: color,
          boxShadow: state === 'running' ? `0 0 0 3px ${color}22` : 'none',
          animation: state === 'running' ? 'v5pulse 2s infinite' : 'none',
        }}
      />
      {state}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9.5,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: V5.textMuted,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: V5.text,
          fontFamily: 'ui-monospace, monospace',
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: V5.textMuted,
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function SmallIconBtn({
  children,
  onClick,
  title,
  color,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title: string;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 26,
        height: 26,
        background: 'transparent',
        border: `1px solid ${V5.borderSoft}`,
        color: color || V5.textMuted,
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────── helpers ───────────────────────────

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function buildArgvPreview(p: Profile): string[] {
  const out: string[] = ['-m', p.ModelPath, '--host', p.Host, '--port', String(p.Port)];
  if (p.CtxSize > 0) out.push('-c', String(p.CtxSize));
  if (p.NGL > 0) out.push('-ngl', String(p.NGL));
  const mmproj = (p as any).MMProjPath as string | undefined;
  if (mmproj) out.push('--mmproj', mmproj);
  if (p.ExtraArgs?.length) out.push(...p.ExtraArgs);
  if (p.Kind === 'embed' && !out.some((a) => a === '--embedding' || a === '--embeddings')) {
    out.push('--embedding');
  }
  if (p.Kind === 'rerank' && !out.includes('--reranking')) {
    out.push('--reranking');
  }
  return out;
}

const ghostBtnStyle: CSSProperties = {
  padding: '7px 12px',
  background: 'transparent',
  color: V5.textDim,
  border: `1px solid ${V5.border}`,
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'not-allowed',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  opacity: 0.5,
};

const primaryBtnStyle: CSSProperties = {
  padding: '7px 12px',
  background: V5.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const detailPrimaryBtnStyle: CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  background: V5.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 5,
  fontSize: 11.5,
  fontFamily: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
};
