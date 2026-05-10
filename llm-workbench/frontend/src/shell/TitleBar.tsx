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
import { Tab, InstanceStatus, InstanceMetrics, Project } from './types';

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
  projects: Project[];
  activeProject: Project | null;
  onOpenProject: () => void;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (p: Project) => void;
};

export function TitleBar({
  tab,
  onTabChange,
  activeStatus,
  activeMetrics,
  projects,
  activeProject,
  onOpenProject,
  onCreateProject,
  onSelectProject,
  onDeleteProject,
}: TitleBarProps) {
  const dotColor =
    activeStatus.state === 'running'
      ? V5.ok
      : activeStatus.state === 'starting'
        ? V5.warn
        : activeStatus.state === 'crashed'
          ? V5.danger
          : V5.textDim;

  return (
    <div style={titleBarStyle}>
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Dot color={dotColor} /> chat
        </span>
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
        <IconSettings size={15} />
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

const titleBarStyle: CSSProperties = {
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
