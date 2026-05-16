import { V5 } from '../theme';
import {
  Tab,
  Profile,
  Project,
  Session,
  SessionMessageBackend,
  InstanceStatus,
  InstanceMetrics,
  SysMetricsPayload,
} from './types';
import { ChatTab } from '../tabs/ChatTab';
import { ServersTab } from '../tabs/ServersTab';
import { LabTab } from '../tabs/LabTab';

export type MainPaneProps = {
  tab: Tab;
  profiles: Profile[];
  activeProfile?: Profile;
  activeProfileId: string;
  activeStatus: InstanceStatus;
  statusByProfile: Record<string, InstanceStatus>;
  metricsByProfile: Record<string, InstanceMetrics>;
  logsByProfile: Record<string, string[]>;
  activeLogs: string[];
  modelLabel?: string;
  activeFilePath: string;
  activeFileContent: string;
  activeProject: Project | null;
  activeSession: Session | null;
  activeSessionMessages: SessionMessageBackend[];
  sysMetrics: SysMetricsPayload | null;
  ensureSession: (modeId?: string) => Promise<Session | null>;
  onSelectProfile: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onCreateProfile: () => void;
  onEditProfile: (p: Profile) => void;
  onDuplicateProfile: (p: Profile) => void;
  onDeleteProfile: (p: Profile) => void;
  onChangeSessionMode: (modeId: string) => void;
  onAfterChat: () => Promise<void>;
  onCreateSession: () => void;
  onOpenFilePath: (path: string, range?: { startByte: number; endByte: number }) => void;
  revealRequest: { startByte: number; endByte: number; nonce: number } | null;
};

export function MainPane(props: MainPaneProps) {
  const { tab } = props;
  // Both Chat and Servers stay mounted simultaneously, hidden via
  // `display: none` when inactive. Reasons:
  //  • Chat keeps its in-flight stream subscription + local message
  //    state across tab switches. Unmounting would drop tokens.
  //  • Servers polling/event subscriptions are cheap and benefit from
  //    not re-priming on every visit.
  // Disabled tabs (Project / Lab / Runs) render their placeholder only
  // when active — they have no state worth preserving.
  const showChat = tab === 'chat';
  const showServers = tab === 'servers';
  const showLab = tab === 'lab';
  const showDisabled = tab === 'project' || tab === 'runs';

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, position: 'relative' }}>
      <div
        style={{
          flex: 1,
          display: showChat ? 'flex' : 'none',
          minWidth: 0,
        }}
      >
        <ChatTab
          activeProfileId={props.activeProfileId}
          activeStatus={props.activeStatus}
          modelLabel={props.modelLabel}
          activeFilePath={props.activeFilePath}
          activeFileContent={props.activeFileContent}
          activeProject={props.activeProject}
          activeSession={props.activeSession}
          activeSessionMessages={props.activeSessionMessages}
          profiles={props.profiles}
          statusByProfile={props.statusByProfile}
          onChangeSessionMode={props.onChangeSessionMode}
          onAfterChat={props.onAfterChat}
          onCreateSession={props.onCreateSession}
          ensureSession={props.ensureSession}
          onOpenFilePath={props.onOpenFilePath}
          revealRequest={props.revealRequest}
        />
      </div>
      <div
        style={{
          flex: 1,
          display: showServers ? 'flex' : 'none',
          minWidth: 0,
        }}
      >
        <ServersTab
          profiles={props.profiles}
          activeProfileId={props.activeProfileId}
          statusByProfile={props.statusByProfile}
          metricsByProfile={props.metricsByProfile}
          logsByProfile={props.logsByProfile}
          sysMetrics={props.sysMetrics}
          onSelectProfile={props.onSelectProfile}
          onStart={props.onStart}
          onStop={props.onStop}
          onRestart={props.onRestart}
          onCreateProfile={props.onCreateProfile}
          onEditProfile={props.onEditProfile}
          onDuplicateProfile={props.onDuplicateProfile}
          onDeleteProfile={props.onDeleteProfile}
        />
      </div>
      {showLab && (
        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <LabTab activeProject={props.activeProject} />
        </div>
      )}
      {showDisabled && <DisabledTab name={tab} />}
    </div>
  );
}

function DisabledTab({ name }: { name: string }) {
  const labels: Record<string, string> = {
    project: 'Project',
    lab: 'Prompt Lab',
    runs: 'Runs',
  };
  const label = labels[name] || name;
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: V5.bg,
        color: V5.textDim,
        gap: 8,
        fontStyle: 'italic',
      }}
    >
      <div style={{ fontSize: 16, color: V5.textMuted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13 }}>Not in M1 scope. See TODO.md for milestone plan.</div>
    </div>
  );
}
