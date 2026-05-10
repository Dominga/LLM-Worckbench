import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import {
  ListProfiles,
  ProfileStatus as GetProfileStatus,
  ProfileMetrics as GetProfileMetrics,
  ProfileLogs as GetProfileLogs,
  StartProfile,
  StopProfile,
  RestartProfile,
  DeleteProfile,
  ListProjects,
  CurrentProject as GetCurrentProject,
  OpenProject,
  CreateProject,
  SetActiveProject,
  DeleteProject,
  ListFiles,
  ReadProjectFile,
  PickDirectory,
  ListSessions,
  CreateSession,
  CreateSessionWithParams,
  RenameSession,
  DeleteSession,
  UpdateSessionMode,
  SessionMessages,
  GetSystemMetrics,
  GetGPUMetrics,
} from '../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime';
import { TitleBar } from './shell/TitleBar';
import { Sidebar } from './shell/Sidebar';
import { MainPane } from './shell/MainPane';
import {
  Tab,
  SidebarSegment,
  Profile,
  Project,
  FileNode,
  InstanceStatus,
  InstanceMetrics,
  Session,
  SessionMessageBackend,
  SysMetricsPayload,
  emptyInstanceStatus,
  emptyInstanceMetrics,
} from './shell/types';
import { ProfileForm } from './components/ProfileForm';
import { NewSessionModal } from './components/NewSessionModal';
import { ConfirmModal } from './components/ConfirmModal';
import { ApprovalModal } from './components/ApprovalModal';
import { V5 } from './theme';

const LOG_RING_SIZE = 1000;
const FILE_TREE_POLL_MS = 3000;

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [segment, setSegment] = useState<SidebarSegment>('sessions');

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [statusByProfile, setStatusByProfile] = useState<Record<string, InstanceStatus>>({});
  const [metricsByProfile, setMetricsByProfile] = useState<Record<string, InstanceMetrics>>({});
  const [logsByProfile, setLogsByProfile] = useState<Record<string, string[]>>({});

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [activeFileContent, setActiveFileContent] = useState<string>('');
  const fileTreeIntervalRef = useRef<number | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [activeSessionMessages, setActiveSessionMessages] = useState<SessionMessageBackend[]>([]);

  const [sysMetrics, setSysMetrics] = useState<SysMetricsPayload | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formInitial, setFormInitial] = useState<Profile | undefined>(undefined);

  const [sessionModalOpen, setSessionModalOpen] = useState(false);

  // Generic confirm-modal slot — replaces window.confirm for all
  // destructive ops (delete profile / forget project / delete session).
  // The action runs async; modal stays open with a spinner until it
  // settles, then closes itself.
  const [confirm, setConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  // ───────────────────────── profiles load + subscribe ────────────────

  const reloadProfiles = useCallback(async () => {
    try {
      const list = await ListProfiles();
      setProfiles(list);
      setActiveProfileId((cur) => {
        if (cur && list.some((p) => p.ID === cur)) return cur;
        const firstChat = list.find((p) => p.Kind === 'chat') || list[0];
        return firstChat ? firstChat.ID : '';
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Profile load failed', message: String(e) });
    }
  }, []);

  useEffect(() => {
    reloadProfiles();
    EventsOn('app:fatal', (msg: string) => {
      notifications.show({ color: 'red', title: 'Fatal', message: msg, autoClose: false });
    });
    EventsOn('agent:snapshot:taken', (snap: { sha: string; modeId: string }) => {
      notifications.show({
        color: 'gray',
        title: 'Agent snapshot taken',
        message: `${snap.modeId} · ${snap.sha.slice(0, 8)} — revert via the project's Snapshots binding.`,
      });
    });
    EventsOn('sys:metrics', (payload: SysMetricsPayload) => {
      setSysMetrics(payload);
    });
    // Initial pull so KPI cards aren't empty for the first 2 s.
    Promise.all([GetSystemMetrics(), GetGPUMetrics()])
      .then(([ram, gpu]) => setSysMetrics({ ram, gpu }))
      .catch(() => {});
    return () => {
      EventsOff('app:fatal');
      EventsOff('sys:metrics');
      EventsOff('agent:snapshot:taken');
    };
  }, [reloadProfiles]);

  const profileIdsKey = profiles.map((p) => p.ID).join(',');
  useEffect(() => {
    if (profiles.length === 0) return;
    const channels: string[] = [];
    for (const p of profiles) {
      const stEv = `llama:status:${p.ID}`;
      const mEv = `llama:metrics:${p.ID}`;
      const lEv = `llama:log:${p.ID}`;
      const lcEv = `llama:log:cleared:${p.ID}`;
      channels.push(stEv, mEv, lEv, lcEv);

      EventsOn(stEv, (st: InstanceStatus) => {
        setStatusByProfile((prev) => ({ ...prev, [p.ID]: st }));
      });
      EventsOn(mEv, (m: InstanceMetrics) => {
        setMetricsByProfile((prev) => ({ ...prev, [p.ID]: m }));
      });
      EventsOn(lEv, (line: string) => {
        setLogsByProfile((prev) => {
          const cur = prev[p.ID] || [];
          const next = cur.length >= LOG_RING_SIZE ? [...cur.slice(1), line] : [...cur, line];
          return { ...prev, [p.ID]: next };
        });
      });
      EventsOn(lcEv, () => {
        setLogsByProfile((prev) => ({ ...prev, [p.ID]: [] }));
      });

      GetProfileStatus(p.ID)
        .then((st) => setStatusByProfile((prev) => ({ ...prev, [p.ID]: st })))
        .catch(() => {});
      GetProfileMetrics(p.ID)
        .then((m) => setMetricsByProfile((prev) => ({ ...prev, [p.ID]: m })))
        .catch(() => {});
      GetProfileLogs(p.ID)
        .then((logs) => setLogsByProfile((prev) => ({ ...prev, [p.ID]: logs || [] })))
        .catch(() => {});
    }
    return () => {
      for (const c of channels) EventsOff(c);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIdsKey]);

  // ───────────────────────── projects load ────────────────────────────

  const reloadProjects = useCallback(async () => {
    try {
      const list = await ListProjects();
      setProjects(list);
      const cur = await GetCurrentProject();
      setActiveProject(cur && cur.ID ? cur : null);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Project load failed', message: String(e) });
    }
  }, []);

  useEffect(() => {
    reloadProjects();
  }, [reloadProjects]);

  const refreshTree = useCallback(async (projectId: string) => {
    try {
      const t = await ListFiles(projectId);
      setFileTree(t || []);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'List files failed', message: String(e) });
    }
  }, []);

  // Polling — refresh tree every FILE_TREE_POLL_MS while a project is open.
  // Per TODO.md decision, fsnotify is intentionally avoided for cross-platform
  // simplicity; a light polling interval is good enough at the M1 scale.
  useEffect(() => {
    if (fileTreeIntervalRef.current != null) {
      window.clearInterval(fileTreeIntervalRef.current);
      fileTreeIntervalRef.current = null;
    }
    if (!activeProject) {
      setFileTree([]);
      return;
    }
    refreshTree(activeProject.ID);
    fileTreeIntervalRef.current = window.setInterval(() => {
      refreshTree(activeProject.ID);
    }, FILE_TREE_POLL_MS);
    return () => {
      if (fileTreeIntervalRef.current != null) {
        window.clearInterval(fileTreeIntervalRef.current);
        fileTreeIntervalRef.current = null;
      }
    };
  }, [activeProject, refreshTree]);

  // ───────────────────────── derived state ────────────────────────────

  const activeProfile = useMemo(
    () => profiles.find((p) => p.ID === activeProfileId),
    [profiles, activeProfileId],
  );
  const activeStatus = statusByProfile[activeProfileId] || emptyInstanceStatus(activeProfileId);
  const activeMetrics = metricsByProfile[activeProfileId] || emptyInstanceMetrics(activeProfileId);
  const activeLogs = logsByProfile[activeProfileId] || [];

  const modelLabel = useMemo(() => {
    if (!activeProfile?.ModelPath) return undefined;
    return activeProfile.ModelPath.split('/').pop();
  }, [activeProfile]);

  // ───────────────────────── server actions ───────────────────────────

  const onStart = async (id: string) => {
    try {
      await StartProfile(id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Start failed', message: String(e) });
    }
  };
  const onStop = async (id: string) => {
    try {
      await StopProfile(id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Stop failed', message: String(e) });
    }
  };
  const onRestart = async (id: string) => {
    try {
      await RestartProfile(id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Restart failed', message: String(e) });
    }
  };

  const onCreateProfile = () => {
    setFormMode('create');
    setFormInitial(undefined);
    setFormOpen(true);
  };
  const onEditProfile = (p: Profile) => {
    setFormMode('edit');
    setFormInitial(p);
    setFormOpen(true);
  };
  const onDeleteProfile = (p: Profile) => {
    setConfirm({
      title: 'Delete profile',
      message: (
        <>
          Delete profile <code>{p.ID}</code>?
          <br />
          If running it will be stopped first.
        </>
      ),
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await DeleteProfile(p.ID);
          await reloadProfiles();
          notifications.show({ color: 'gray', title: 'Profile deleted', message: p.ID });
        } catch (e: any) {
          notifications.show({ color: 'red', title: 'Delete failed', message: String(e) });
        }
      },
    });
  };

  // ───────────────────────── project actions ──────────────────────────

  const onOpenProject = async () => {
    try {
      const path = await PickDirectory('Open project');
      if (!path) return;
      const p = await OpenProject(path);
      await reloadProjects();
      setActiveProject(p);
      setActiveFilePath('');
      setActiveFileContent('');
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Open failed', message: String(e) });
    }
  };

  const onCreateProjectAction = async () => {
    try {
      const path = await PickDirectory('Pick directory for new project');
      if (!path) return;
      const name = window.prompt('Project name', path.split('/').pop() || 'project');
      if (name == null) return;
      const p = await CreateProject(path, name.trim() || path.split('/').pop() || 'project');
      await reloadProjects();
      setActiveProject(p);
      setActiveFilePath('');
      setActiveFileContent('');
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Create failed', message: String(e) });
    }
  };

  const onSelectProject = async (id: string) => {
    try {
      const p = await SetActiveProject(id);
      setActiveProject(p);
      await reloadProjects();
      setActiveFilePath('');
      setActiveFileContent('');
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Switch failed', message: String(e) });
    }
  };

  const onDeleteProjectAction = (p: Project) => {
    setConfirm({
      title: 'Forget project',
      message: (
        <>
          Forget project <strong>{p.Name}</strong>?
          <br />
          Files on disk are NOT deleted; only the registry entry goes.
        </>
      ),
      confirmLabel: 'Forget',
      onConfirm: async () => {
        try {
          await DeleteProject(p.ID);
          await reloadProjects();
          if (activeProject?.ID === p.ID) {
            setActiveProject(null);
            setActiveFilePath('');
            setActiveFileContent('');
          }
        } catch (e: any) {
          notifications.show({ color: 'red', title: 'Delete failed', message: String(e) });
        }
      },
    });
  };

  // ───────────────────────── session actions ──────────────────────────

  const reloadSessions = useCallback(
    async (proj: Project | null, preferId?: string) => {
      if (!proj) {
        setSessions([]);
        setActiveSessionId('');
        setActiveSessionMessages([]);
        return [] as Session[];
      }
      try {
        const list = await ListSessions(proj.ID);
        setSessions(list);
        const next = preferId && list.some((s) => s.id === preferId)
          ? preferId
          : list.length > 0
            ? list[0].id
            : '';
        setActiveSessionId(next);
        return list;
      } catch (e: any) {
        notifications.show({ color: 'red', title: 'Sessions load failed', message: String(e) });
        return [] as Session[];
      }
    },
    [],
  );

  // Reload sessions whenever the active project changes.
  useEffect(() => {
    reloadSessions(activeProject);
  }, [activeProject, reloadSessions]);

  // Load messages whenever the active session changes.
  useEffect(() => {
    if (!activeProject || !activeSessionId) {
      setActiveSessionMessages([]);
      return;
    }
    SessionMessages(activeProject.ID, activeSessionId)
      .then((msgs) => setActiveSessionMessages(msgs || []))
      .catch((e: any) =>
        notifications.show({ color: 'red', title: 'Load messages failed', message: String(e) }),
      );
  }, [activeProject, activeSessionId]);

  const onCreateSession = () => {
    if (!activeProject) {
      notifications.show({
        color: 'yellow',
        title: 'No project',
        message: 'Open a project before starting a chat.',
      });
      return;
    }
    setSessionModalOpen(true);
  };

  const onConfirmCreateSession = async (
    title: string,
    modeId: string,
    params: Record<string, any>,
  ) => {
    if (!activeProject) return;
    try {
      const sess = await CreateSessionWithParams(
        activeProject.ID,
        title,
        modeId,
        activeProfileId,
        params || {},
      );
      await reloadSessions(activeProject, sess.id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Create session failed', message: String(e) });
    }
  };

  // ensureSession is called from ChatTab right before Send. If a project
  // is open but no session is selected yet, create one quietly with a
  // default title so the user's first message gets persisted to JSONL.
  // Returns the resolved Session, or null when no project context exists
  // (caller falls back to one-shot ChatStream).
  const ensureSession = useCallback(async (): Promise<Session | null> => {
    const cur = sessions.find((s) => s.id === activeSessionId);
    if (cur) return cur;
    if (!activeProject) return null;
    try {
      const sess = await CreateSession(
        activeProject.ID,
        'New chat',
        'chat-only',
        activeProfileId,
      );
      const list = await ListSessions(activeProject.ID);
      setSessions(list);
      setActiveSessionId(sess.id);
      return sess;
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Create session failed', message: String(e) });
      return null;
    }
  }, [sessions, activeSessionId, activeProject, activeProfileId]);

  const onSelectSession = (id: string) => {
    setActiveSessionId(id);
  };

  const onRenameSession = async (s: Session) => {
    if (!activeProject) return;
    const title = window.prompt('Rename session', s.title);
    if (title == null) return;
    try {
      await RenameSession(activeProject.ID, s.id, title.trim() || s.title);
      await reloadSessions(activeProject, s.id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Rename failed', message: String(e) });
    }
  };

  const onDeleteSessionAction = (s: Session) => {
    if (!activeProject) return;
    setConfirm({
      title: 'Delete session',
      message: (
        <>
          Delete session <strong>{s.title}</strong>?
          <br />
          This removes the JSONL file from disk.
        </>
      ),
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await DeleteSession(activeProject.ID, s.id);
          await reloadSessions(activeProject);
        } catch (e: any) {
          notifications.show({ color: 'red', title: 'Delete failed', message: String(e) });
        }
      },
    });
  };

  const onChangeSessionMode = async (modeId: string) => {
    if (!activeProject || !activeSessionId) return;
    try {
      await UpdateSessionMode(activeProject.ID, activeSessionId, modeId);
      await reloadSessions(activeProject, activeSessionId);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Mode update failed', message: String(e) });
    }
  };

  // Backend-authoritative refresh after a chat round completes.
  // Reloads BOTH the session-list (UpdatedAt + msg count) and the active
  // session's full message history from disk. The hydrate effect in
  // ChatTab then replaces local optimistic state with whatever is in
  // JSONL — so if persistence ever drops a message we see it
  // immediately, not on next session switch.
  const refreshActiveSession = useCallback(async () => {
    if (!activeProject || !activeSessionId) return;
    try {
      const [list, msgs] = await Promise.all([
        ListSessions(activeProject.ID),
        SessionMessages(activeProject.ID, activeSessionId),
      ]);
      setSessions(list);
      setActiveSessionMessages(msgs || []);
    } catch (e: any) {
      notifications.show({
        color: 'red',
        title: 'Refresh session failed',
        message: String(e),
      });
    }
  }, [activeProject, activeSessionId]);

  const onSelectFile = async (node: FileNode) => {
    if (!activeProject || node.isDir) return;
    try {
      const fc = await ReadProjectFile(activeProject.ID, node.path);
      setActiveFilePath(node.path);
      setActiveFileContent(fc.content);
      if (fc.truncated) {
        notifications.show({
          color: 'yellow',
          title: 'File truncated',
          message: `${node.path} exceeds 5 MB; showing the head.`,
        });
      }
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Read failed', message: String(e) });
    }
  };

  // onOpenFilePath is the path-only flavour used by /search hits and
  // future ad-hoc openers. Mirrors onSelectFile but skips the FileNode
  // shape (search results don't carry isDir / size).
  const onOpenFilePath = async (path: string) => {
    if (!activeProject || !path) return;
    try {
      const fc = await ReadProjectFile(activeProject.ID, path);
      setActiveFilePath(path);
      setActiveFileContent(fc.content);
      if (fc.truncated) {
        notifications.show({
          color: 'yellow',
          title: 'File truncated',
          message: `${path} exceeds 5 MB; showing the head.`,
        });
      }
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Open failed', message: String(e) });
    }
  };

  return (
    <div
      style={{
        height: '100%',
        background: V5.bg,
        color: V5.text,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <TitleBar
        tab={tab}
        onTabChange={setTab}
        activeStatus={activeStatus}
        activeMetrics={activeMetrics}
        projects={projects}
        activeProject={activeProject}
        onOpenProject={onOpenProject}
        onCreateProject={onCreateProjectAction}
        onSelectProject={onSelectProject}
        onDeleteProject={onDeleteProjectAction}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar
          segment={segment}
          onSegmentChange={setSegment}
          profiles={profiles}
          statusByProfile={statusByProfile}
          metricsByProfile={metricsByProfile}
          activeProfileId={activeProfileId}
          onSelectProfile={setActiveProfileId}
          onStart={onStart}
          onStop={onStop}
          onCreateProfile={onCreateProfile}
          onEditProfile={onEditProfile}
          fileTree={fileTree}
          activeFilePath={activeFilePath}
          onSelectFile={onSelectFile}
          activeProjectName={activeProject?.Name}
          activeProjectId={activeProject?.ID}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
          onCreateSession={onCreateSession}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSessionAction}
        />
        <MainPane
          tab={tab}
          profiles={profiles}
          activeProfile={activeProfile}
          activeProfileId={activeProfileId}
          activeStatus={activeStatus}
          statusByProfile={statusByProfile}
          metricsByProfile={metricsByProfile}
          logsByProfile={logsByProfile}
          activeLogs={activeLogs}
          modelLabel={modelLabel}
          activeFilePath={activeFilePath}
          activeFileContent={activeFileContent}
          activeProject={activeProject}
          activeSession={sessions.find((s) => s.id === activeSessionId) || null}
          activeSessionMessages={activeSessionMessages}
          sysMetrics={sysMetrics}
          onSelectProfile={setActiveProfileId}
          onStart={onStart}
          onStop={onStop}
          onRestart={onRestart}
          onCreateProfile={onCreateProfile}
          onEditProfile={onEditProfile}
          onDeleteProfile={onDeleteProfile}
          onChangeSessionMode={onChangeSessionMode}
          onAfterChat={refreshActiveSession}
          onCreateSession={onCreateSession}
          ensureSession={ensureSession}
          onOpenFilePath={onOpenFilePath}
        />
      </div>

      <ProfileForm
        opened={formOpen}
        mode={formMode}
        initial={formInitial}
        profiles={profiles}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          reloadProfiles();
        }}
      />

      <NewSessionModal
        opened={sessionModalOpen}
        activeProjectId={activeProject?.ID}
        onClose={() => setSessionModalOpen(false)}
        onCreate={onConfirmCreateSession}
      />

      <ConfirmModal
        opened={confirm != null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) await confirm.onConfirm();
        }}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.confirmLabel}
        variant="danger"
      />

      <ApprovalModal />
    </div>
  );
}
