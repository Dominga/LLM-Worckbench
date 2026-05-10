import { CSSProperties, useState } from 'react';
import {
  IconSearch,
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconEdit,
  IconTrash,
  IconPencil,
} from '@tabler/icons-react';
import { V5 } from '../theme';
import {
  SidebarSegment,
  Profile,
  InstanceStatus,
  InstanceMetrics,
  FileNode,
  Session,
  MODE_BY_ID,
  MODES,
} from './types';
import { FileTree } from './FileTree';
import { RagPanel } from './RagPanel';

export type SidebarProps = {
  segment: SidebarSegment;
  onSegmentChange: (s: SidebarSegment) => void;
  profiles: Profile[];
  statusByProfile: Record<string, InstanceStatus>;
  metricsByProfile: Record<string, InstanceMetrics>;
  activeProfileId: string;
  onSelectProfile: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onCreateProfile: () => void;
  onEditProfile: (p: Profile) => void;
  fileTree: FileNode[];
  activeFilePath: string;
  onSelectFile: (n: FileNode) => void;
  activeProjectName?: string;
  activeProjectId?: string;
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (s: Session) => void;
  onDeleteSession: (s: Session) => void;
};

export function Sidebar(props: SidebarProps) {
  const { segment, onSegmentChange } = props;
  const [query, setQuery] = useState('');

  return (
    <div style={sidebarStyle}>
      {/* Segment switcher */}
      <div style={{ padding: '12px 12px 0' }}>
        <div style={{ display: 'flex', background: V5.bg, borderRadius: 6, padding: 3 }}>
          {(['sessions', 'files', 'servers'] as SidebarSegment[]).map((k) => {
            const active = segment === k;
            return (
              <button
                key={k}
                onClick={() => onSegmentChange(k)}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: active ? V5.surface : 'transparent',
                  color: active ? V5.text : V5.textMuted,
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: 500,
                  textTransform: 'capitalize',
                }}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search + new */}
      <div style={{ padding: '10px 10px 4px', display: 'flex', gap: 8 }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: V5.bg,
            border: `1px solid ${V5.borderSoft}`,
            borderRadius: 6,
          }}
        >
          <IconSearch size={12} color={V5.textMuted} />
          <input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={
              segment === 'files' ? 'Find file…' : segment === 'sessions' ? 'Search…' : 'Filter profiles…'
            }
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: V5.text,
              fontFamily: 'inherit',
              fontSize: 12,
            }}
          />
        </div>
        <button
          title={
            segment === 'files' ? 'New file' : segment === 'sessions' ? 'New chat' : 'New profile'
          }
          onClick={() => {
            if (segment === 'servers') props.onCreateProfile();
            else if (segment === 'sessions') props.onCreateSession();
          }}
          disabled={segment === 'files'}
          style={{
            width: 28,
            height: 28,
            background: V5.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: segment === 'files' ? 'not-allowed' : 'pointer',
            opacity: segment === 'files' ? 0.4 : 1,
          }}
        >
          <IconPlus size={14} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px 12px' }}>
        {segment === 'sessions' && (
          <SessionsPane
            sessions={props.sessions}
            activeSessionId={props.activeSessionId}
            activeProjectName={props.activeProjectName}
            onSelect={props.onSelectSession}
            onRename={props.onRenameSession}
            onDelete={props.onDeleteSession}
            query={query}
          />
        )}
        {segment === 'files' && (
          <FilesPane
            tree={props.fileTree}
            activeFilePath={props.activeFilePath}
            onSelectFile={props.onSelectFile}
            activeProjectName={props.activeProjectName}
            activeProjectId={props.activeProjectId}
            profiles={props.profiles}
            statusByProfile={props.statusByProfile}
            query={query}
          />
        )}
        {segment === 'servers' && <ServersPane {...props} query={query} />}
      </div>
    </div>
  );
}

const sidebarStyle: CSSProperties = {
  width: 280,
  background: V5.surface2,
  borderRight: `1px solid ${V5.border}`,
  display: 'flex',
  flexDirection: 'column',
  flex: 'none',
  minHeight: 0,
};

// ────────────────────────────── Sessions ──────────────────────────────────

function SessionsPane({
  sessions,
  activeSessionId,
  activeProjectName,
  onSelect,
  onRename,
  onDelete,
  query,
}: {
  sessions: Session[];
  activeSessionId: string;
  activeProjectName?: string;
  onSelect: (id: string) => void;
  onRename: (s: Session) => void;
  onDelete: (s: Session) => void;
  query: string;
}) {
  if (!activeProjectName) {
    return <EmptyHint>Open a project from the title-bar menu to view sessions.</EmptyHint>;
  }
  const filtered = query
    ? sessions.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
    : sessions;
  if (filtered.length === 0) {
    return <EmptyHint>No sessions yet. Use + to start a chat.</EmptyHint>;
  }
  const grouped = groupSessions(filtered);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {grouped.map(([label, list]) => (
        <div key={label}>
          <SectionLabel>{label}</SectionLabel>
          {list.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              onSelect={() => onSelect(s.id)}
              onRename={() => onRename(s)}
              onDelete={() => onDelete(s)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionCard({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const mode = MODE_BY_ID[session.modeId] || MODES[0];
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: active ? V5.accentSoft : 'transparent',
        borderLeft: active ? `2px solid ${V5.accent}` : '2px solid transparent',
        cursor: 'pointer',
        marginBottom: 2,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: V5.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {session.title}
        </span>
        {active ? (
          <span style={{ display: 'flex', gap: 2, flex: 'none' }}>
            <button
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              style={cardIconBtn(V5.textMuted)}
            >
              <IconPencil size={11} />
            </button>
            <button
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              style={cardIconBtn(V5.danger)}
            >
              <IconTrash size={11} />
            </button>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: V5.textDim, flex: 'none' }}>
            {formatRelative(session.updatedAt)}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          color: mode.color,
          marginTop: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 3, background: mode.color }} />
        <span style={{ flex: 1 }}>{mode.name}</span>
        <span style={{ color: V5.textDim }}>
          {session.messageCount > 0 ? `${session.messageCount} msg` : ''}
        </span>
      </div>
    </div>
  );
}

function groupSessions(list: Session[]): Array<[string, Session[]]> {
  const today: Session[] = [];
  const week: Session[] = [];
  const earlier: Session[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const s of list) {
    const t = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
    const ageDays = (now - t) / dayMs;
    if (ageDays < 1) today.push(s);
    else if (ageDays < 7) week.push(s);
    else earlier.push(s);
  }
  const out: Array<[string, Session[]]> = [];
  if (today.length) out.push(['Today', today]);
  if (week.length) out.push(['This week', week]);
  if (earlier.length) out.push(['Earlier', earlier]);
  return out;
}

function formatRelative(ts: any): string {
  if (!ts) return '';
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '';
  const diffMs = Date.now() - t;
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

// ────────────────────────────── Files ─────────────────────────────────────

function FilesPane({
  tree,
  activeFilePath,
  onSelectFile,
  activeProjectName,
  activeProjectId,
  profiles,
  statusByProfile,
  query,
}: {
  tree: FileNode[];
  activeFilePath: string;
  onSelectFile: (n: FileNode) => void;
  activeProjectName?: string;
  activeProjectId?: string;
  profiles: Profile[];
  statusByProfile: Record<string, InstanceStatus>;
  query: string;
}) {
  if (!activeProjectName) {
    return <EmptyHint>Open a project from the title-bar menu to view files.</EmptyHint>;
  }
  return (
    <div>
      <SectionLabel>{activeProjectName}</SectionLabel>
      <FileTree
        nodes={tree}
        activePath={activeFilePath}
        onSelect={onSelectFile}
        filter={query}
      />
      <RagPanel
        activeProjectId={activeProjectId}
        profiles={profiles}
        statusByProfile={statusByProfile}
      />
    </div>
  );
}

// ────────────────────────────── Servers ───────────────────────────────────

function ServersPane({
  profiles,
  statusByProfile,
  metricsByProfile,
  activeProfileId,
  onSelectProfile,
  onStart,
  onStop,
  onEditProfile,
  query,
}: SidebarProps & { query: string }) {
  const filtered = query
    ? profiles.filter(
        (p) =>
          p.ID.toLowerCase().includes(query.toLowerCase()) ||
          (p.ModelPath || '').toLowerCase().includes(query.toLowerCase()),
      )
    : profiles;

  if (profiles.length === 0) {
    return <EmptyHint>No profiles yet. Use + to create one.</EmptyHint>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 2px' }}>
      {filtered.map((p) => (
        <ProfileCard
          key={p.ID}
          profile={p}
          status={statusByProfile[p.ID]}
          metrics={metricsByProfile[p.ID]}
          isActive={p.ID === activeProfileId}
          onSelect={() => onSelectProfile(p.ID)}
          onStart={() => onStart(p.ID)}
          onStop={() => onStop(p.ID)}
          onEdit={() => onEditProfile(p)}
        />
      ))}
    </div>
  );
}

function ProfileCard({
  profile,
  status,
  metrics,
  isActive,
  onSelect,
  onStart,
  onStop,
  onEdit,
}: {
  profile: Profile;
  status?: InstanceStatus;
  metrics?: InstanceMetrics;
  isActive: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onEdit: () => void;
}) {
  const state = (status?.state || 'stopped') as string;
  const isOn = state === 'running' || state === 'starting';
  const dot =
    state === 'running'
      ? V5.ok
      : state === 'starting'
        ? V5.warn
        : state === 'crashed'
          ? V5.danger
          : V5.textDim;
  const modelLabel = (profile.ModelPath || '').split('/').pop();
  const tps = metrics?.lastTps;

  return (
    <div
      onClick={onSelect}
      style={{
        background: V5.surface,
        padding: 10,
        borderRadius: 8,
        border: `1px solid ${isActive ? V5.accent : V5.borderSoft}`,
        boxShadow: isActive ? `inset 0 0 0 1px ${V5.accent}` : 'none',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: 4,
              background: dot,
              flex: 'none',
            }}
          />
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: V5.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {profile.ID}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            padding: '2px 7px',
            background: V5.chip,
            color: V5.textMuted,
            borderRadius: 4,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          {profile.Kind}
        </span>
      </div>
      {modelLabel && (
        <div
          style={{
            fontSize: 11,
            color: V5.textMuted,
            marginTop: 4,
            fontFamily: 'ui-monospace, monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {modelLabel}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginTop: 6,
          fontSize: 11,
          color: V5.textMuted,
          alignItems: 'center',
          fontFamily: 'ui-monospace, monospace',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>:{profile.Port}</span>
        {tps != null && tps > 0 && (
          <span>
            <span style={{ color: V5.text }}>{tps.toFixed(1)}</span> t/s
          </span>
        )}
        <span style={{ color: V5.textDim }}>{state}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          style={cardIconBtn(V5.textMuted)}
          title="Edit profile"
        >
          <IconEdit size={11} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            isOn ? onStop() : onStart();
          }}
          style={cardIconBtn(isOn ? V5.danger : V5.accent)}
          title={isOn ? 'Stop' : 'Start'}
        >
          {isOn ? <IconPlayerStop size={11} /> : <IconPlayerPlay size={11} />}
        </button>
      </div>
    </div>
  );
}

function cardIconBtn(color: string): CSSProperties {
  return {
    width: 22,
    height: 22,
    background: 'transparent',
    border: 'none',
    color,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

// ────────────────────────────── helpers ───────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: V5.textMuted,
        padding: '8px 8px 4px',
      }}
    >
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: V5.textDim,
        padding: '12px 10px',
        fontStyle: 'italic',
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
