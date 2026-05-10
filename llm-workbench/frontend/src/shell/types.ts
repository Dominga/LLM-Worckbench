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
  source: 'builtin' | 'project' | 'plugin';
  desc: string;
  plugin?: string;
  // Tech fields (M3+) — populated by backend ListModes; the static
  // MODES fallback below leaves them undefined.
  systemPrompt?: string;
  systemPromptTemplate?: string;
  toolWhitelist?: string[];
  approval?: 'always' | 'snapshot' | 'auto';
  context?: 'none' | 'rag-auto' | 'rag-explicit';
  // M4 PR25/26: parameter schema for the prompt template; the
  // NewSessionModal renders a form from this.
  params?: ModeParam[];
};

export type ModeParam = {
  name: string;
  type: 'string' | 'int' | 'number' | 'bool';
  default?: any;
  required?: boolean;
  description?: string;
};

// Static fallback used before the backend ListModes call resolves and
// for places that don't pass a project context. Just the builtin
// `chat` is shipped in-binary; research / agent / auto-edit are
// seeded into `~/.config/llm-workbench/modes/` on first launch.
export const MODES: Mode[] = [
  { id: 'chat', name: 'Chat', color: '#94a3b8', source: 'builtin',
    desc: 'Plain conversation. No tools, no system prompt, no RAG injection.' },
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
