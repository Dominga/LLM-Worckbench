import { CSSProperties } from 'react';
import {
  IconBolt,
  IconMessage,
  IconServer,
  IconFolder,
  IconFlask,
  IconBell,
  IconSettings,
  IconMinus,
  IconSquare,
  IconX,
  IconPlus,
  IconFolderOpen,
  IconChevronDown,
  IconCheck,
  IconTrash,
} from '@tabler/icons-react';
import { Menu, Divider, Text } from '@mantine/core';
import {
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from '../../wailsjs/runtime/runtime';
import { V5 } from '../theme';
import { Tab, InstanceStatus, InstanceMetrics, Project, SysMetricsPayload } from './types';

type TabDef = {
  id: Tab;
  label: string;
  Icon: typeof IconMessage;
  enabled: boolean;
};

const TABS: TabDef[] = [
  { id: 'chat',    label: 'Chat',       Icon: IconMessage, enabled: true },
  { id: 'servers', label: 'Servers',    Icon: IconServer,  enabled: true },
  { id: 'project', label: 'Project',    Icon: IconFolder,  enabled: false },
  { id: 'lab',     label: 'Prompt Lab', Icon: IconFlask,   enabled: true },
  { id: 'runs',    label: 'Runs',       Icon: IconBolt,    enabled: false },
];

export type TitleBarProps = {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  activeStatus: InstanceStatus;
  activeMetrics: InstanceMetrics;
  sysMetrics: SysMetricsPayload | null;
  projects: Project[];
  activeProject: Project | null;
  onOpenProject: () => void;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (p: Project) => void;
  onOpenSettings: () => void;
};

export function TitleBar({
  tab,
  onTabChange,
  activeStatus,
  activeMetrics,
  sysMetrics,
  projects,
  activeProject,
  onOpenProject,
  onCreateProject,
  onSelectProject,
  onDeleteProject,
  onOpenSettings,
}: TitleBarProps) {
  void activeStatus; // status dot moved out of the bar; prop kept for future reuse

  return (
    <div style={titleBarStyle}>
      {/* Frameless-window grab region (TD5): the whole bar drags the OS window,
          except interactive children which carry `noDragStyle`. */}
      {/* Brand */}
      <div style={{ width: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconBolt size={16} color={V5.accent} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', height: 44 }}>
        {TABS.map(({ id, label, Icon, enabled }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => enabled && onTabChange(id)}
              disabled={!enabled}
              title={enabled ? label : `${label} (M1+)`}
              style={{
                ...noDragStyle,
                padding: '0 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: active ? V5.bg : 'transparent',
                borderBottom: active ? `2px solid ${V5.accent}` : '2px solid transparent',
                border: 'none',
                color: !enabled ? V5.textDim : active ? V5.text : V5.textMuted,
                cursor: enabled ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
                opacity: enabled ? 1 : 0.45,
              }}
            >
              <Icon size={14} color={active ? V5.accent : 'currentColor'} />
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Status indicators */}
      <div style={statusStripStyle}>
        <SysStats sysMetrics={sysMetrics} />
        {activeMetrics.lastTps > 0 && (
          <>
            <span style={{ color: V5.textDim }}>│</span>
            <span title="tokens/sec">
              <span style={{ color: V5.text }}>{activeMetrics.lastTps.toFixed(1)}</span> t/s
            </span>
          </>
        )}
        {activeMetrics.reqs > 0 && (
          <span title="requests served">
            <span style={{ color: V5.text }}>{activeMetrics.reqs.toLocaleString()}</span>
            <span style={{ color: V5.textDim }}> req</span>
          </span>
        )}
      </div>

      {/* Project menu + bell + settings */}
      <div
        style={{
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: V5.textMuted,
          fontSize: 12,
          borderLeft: `1px solid ${V5.border}`,
          height: 28,
        }}
      >
        <ProjectMenu
          projects={projects}
          active={activeProject}
          onOpen={onOpenProject}
          onCreate={onCreateProject}
          onSelect={onSelectProject}
          onDelete={onDeleteProject}
        />
        <IconBell size={15} />
        <button
          onClick={onOpenSettings}
          title="Settings"
          style={{
            background: 'transparent',
            border: 'none',
            color: V5.textMuted,
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            ...noDragStyle,
          }}
        >
          <IconSettings size={15} />
        </button>
      </div>

      {/* Window controls */}
      <div style={{ display: 'flex' }}>
        <WinBtn onClick={() => WindowMinimise()}>
          <IconMinus size={12} />
        </WinBtn>
        <WinBtn onClick={() => WindowToggleMaximise()}>
          <IconSquare size={11} />
        </WinBtn>
        <WinBtn onClick={() => Quit()} hover={V5.danger}>
          <IconX size={12} />
        </WinBtn>
      </div>
    </div>
  );
}

function ProjectMenu({
  projects,
  active,
  onOpen,
  onCreate,
  onSelect,
  onDelete,
}: {
  projects: Project[];
  active: Project | null;
  onOpen: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (p: Project) => void;
}) {
  return (
    <Menu shadow="md" width={320} position="bottom-end" withinPortal>
      <Menu.Target>
        <button style={projectChipStyle} title={active?.Path || 'No project — click to open'}>
          <IconFolder size={12} />
          <span
            style={{
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {active?.Name || 'No project'}
          </span>
          <IconChevronDown size={10} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Project</Menu.Label>
        <Menu.Item leftSection={<IconFolderOpen size={14} />} onClick={onOpen}>
          Open project…
        </Menu.Item>
        <Menu.Item leftSection={<IconPlus size={14} />} onClick={onCreate}>
          Create project…
        </Menu.Item>
        {projects.length > 0 && (
          <>
            <Divider my="xs" />
            <Menu.Label>Recent</Menu.Label>
            {projects.slice(0, 8).map((p) => {
              const isActive = active?.ID === p.ID;
              return (
                <Menu.Item
                  key={p.ID}
                  leftSection={
                    isActive ? (
                      <IconCheck size={14} color={V5.accent} />
                    ) : (
                      <span style={{ width: 14 }} />
                    )
                  }
                  rightSection={
                    <button
                      title="Forget project"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(p);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: V5.textDim,
                        cursor: 'pointer',
                        padding: 2,
                        display: 'flex',
                      }}
                    >
                      <IconTrash size={12} />
                    </button>
                  }
                  onClick={() => !isActive && onSelect(p.ID)}
                >
                  <Text size="sm" style={{ color: V5.text }}>
                    {p.Name}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {p.Path}
                  </Text>
                </Menu.Item>
              );
            })}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

// Wails frameless drag handling (TD5): default CSSDragProperty is `--wails-draggable`.
// `drag` on the bar makes it the OS grab region; `no-drag` on a child opts it back out.
const dragRegionStyle = { '--wails-draggable': 'drag' } as unknown as CSSProperties;
const noDragStyle = { '--wails-draggable': 'no-drag' } as unknown as CSSProperties;

const titleBarStyle: CSSProperties = {
  ...dragRegionStyle,
  height: 44,
  background: V5.panel,
  borderBottom: `1px solid ${V5.border}`,
  display: 'flex',
  alignItems: 'center',
  flex: 'none',
};

const statusStripStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '0 14px',
  fontSize: 11.5,
  color: V5.textMuted,
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
};

const projectChipStyle: CSSProperties = {
  ...noDragStyle,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  background: V5.surface,
  border: `1px solid ${V5.borderSoft}`,
  borderRadius: 999,
  color: V5.textMuted,
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

// SysStats renders compact VRAM + RAM usage pills in the titlebar.
// Tinted red when usage crosses 90% so the user notices before allocs
// start failing. Hidden when the sys-metrics poll hasn't reported yet
// (first second of app startup).
function SysStats({ sysMetrics }: { sysMetrics: SysMetricsPayload | null }) {
  if (!sysMetrics) return null;
  const items: { label: string; used: number; total: number; title: string }[] = [];
  if (sysMetrics.gpu?.available && sysMetrics.gpu.totalMb > 0) {
    items.push({
      label: 'VRAM',
      used: sysMetrics.gpu.usedMb,
      total: sysMetrics.gpu.totalMb,
      title: sysMetrics.gpu.gpus?.[0]?.name
        ? `${sysMetrics.gpu.gpus[0].name} — ${sysMetrics.gpu.usedMb} / ${sysMetrics.gpu.totalMb} MiB`
        : `${sysMetrics.gpu.usedMb} / ${sysMetrics.gpu.totalMb} MiB`,
    });
  }
  if (sysMetrics.ram?.available && sysMetrics.ram.totalBytes > 0) {
    const usedMb = Math.round(sysMetrics.ram.usedBytes / (1024 * 1024));
    const totalMb = Math.round(sysMetrics.ram.totalBytes / (1024 * 1024));
    items.push({
      label: 'RAM',
      used: usedMb,
      total: totalMb,
      title: `${usedMb} / ${totalMb} MiB`,
    });
  }
  if (items.length === 0) return null;
  return (
    <>
      {items.map((it, i) => {
        const frac = it.used / it.total;
        const color = frac >= 0.9 ? V5.danger : frac >= 0.75 ? V5.warn : V5.text;
        const gb = (mb: number) => (mb / 1024).toFixed(1);
        return (
          <span key={it.label} title={it.title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: V5.textDim }}>│</span>}
            <span style={{ color: V5.textDim }}>{it.label}</span>
            <span style={{ color }}>{gb(it.used)}</span>
            <span style={{ color: V5.textDim }}>/ {gb(it.total)} GiB</span>
          </span>
        );
      })}
    </>
  );
}

function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: size,
        background: color,
        flex: 'none',
      }}
    />
  );
}

function WinBtn({
  children,
  onClick,
  hover,
}: {
  children: React.ReactNode;
  onClick: () => void;
  hover?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...noDragStyle,
        width: 44,
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: V5.textMuted,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = hover || V5.surface;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
