import type { main } from '../../wailsjs/go/models';

export type Tab = 'chat' | 'servers' | 'project' | 'lab' | 'runs';
export type SidebarSegment = 'sessions' | 'files' | 'servers';

export type Profile = main.Profile;
export type InstanceStatus = main.InstanceStatus;
export type InstanceMetrics = main.InstanceMetrics;
export type LegacyStatus = main.Status;
export type Project = main.Project;
export type FileContent = main.FileContent;
export type Session = main.Session;
export type SessionMessageBackend = main.SessionMessage;
export type SystemMetricsRAM = main.SystemMetrics;
export type GPUMetricsBundle = main.GPUMetrics;
export type GPUInfo = main.GPUInfo;

export type SysMetricsPayload = {
  ram: SystemMetricsRAM;
  gpu: GPUMetricsBundle;
};

// FileNode is intentionally a structural interface (not the Wails-generated
// class) so we can build/transform tree nodes in JS without juggling the
// `convertValues` method that the class carries.
export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
  children?: FileNode[];
}

// Stable empty status used as default while real status hasn't arrived yet.
export const emptyInstanceStatus = (id: string): InstanceStatus =>
  ({
    profileId: id,
    state: 'stopped',
    running: false,
    healthy: false,
    pid: 0,
    baseUrl: '',
    uptimeSec: 0,
  }) as unknown as InstanceStatus;

export const emptyInstanceMetrics = (id: string): InstanceMetrics =>
  ({
    profileId: id,
    lastTps: 0,
    tpsSpark: [],
    reqs: 0,
  }) as unknown as InstanceMetrics;

// Session-mode metadata. Hardcoded mirror of mode.go for offline UI use.
// Backend mode registry → M3.
export type Mode = {
  id: string;
  name: string;
  color: string;
  source: 'builtin' | 'plugin';
  desc: string;
  plugin?: string;
};

export const MODES: Mode[] = [
  { id: 'narrative-coauthor', name: 'Narrative co-author', color: '#3b82f6', source: 'builtin',
    desc: 'Long-form prose. Edits stage as diffs, never silent rewrites.' },
  { id: 'dialogue-writer',    name: 'Dialogue writer',    color: '#a78bfa', source: 'builtin',
    desc: 'Voice-first. Stays in character; never narrates around the line.' },
  { id: 'game-designer',      name: 'Game designer',      color: '#f59e0b', source: 'builtin',
    desc: 'Numbers, tables, balance. Cites lore before suggesting changes.' },
  { id: 'lore-keeper',        name: 'Lore keeper',        color: '#22c55e', source: 'builtin',
    desc: 'Read-only by default. Cross-references and consistency sweeps.' },
];

export const MODE_BY_ID: Record<string, Mode> = Object.fromEntries(MODES.map((m) => [m.id, m]));

// Legacy ServerStatus shape (M0) — still used by parts of the UI that
// haven't moved to per-profile InstanceStatus yet.
export type ServerStatus = {
  running: boolean;
  pid: number;
  baseUrl: string;
  healthy: boolean;
};
