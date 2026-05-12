import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import {
  IconGitBranch,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconLayoutSidebarLeftCollapse,
  IconSend,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { V5 } from '../theme';
import {
  MODES,
  MODE_BY_ID,
  Mode,
  InstanceStatus,
  Profile,
  Project,
  Session,
  SessionMessageBackend,
} from '../shell/types';
import { main } from '../../wailsjs/go/models';
import { MarkdownEditor, EditorHandle } from '../components/Editor';
import { MarkdownPreview } from '../components/Preview';
import {
  SessionChatStream,
  ChatStream,
  ChatCancel,
  WriteProjectFile,
  SearchProject,
  ListModes,
} from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

type ChatRole = 'user' | 'assistant';
type ToolCallChip = {
  name: string;
  args?: string;
  // result is left as-is (any JSON shape) for hover tooltips; chip
  // itself only shows a tiny summary derived from the args.
  result?: any;
  error?: string;
};
type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls?: ToolCallChip[];
};

export type ChatTabProps = {
  activeProfileId: string;
  activeStatus: InstanceStatus;
  modelLabel?: string;
  activeFilePath: string;
  activeFileContent: string;
  activeProject: Project | null;
  activeSession: Session | null;
  activeSessionMessages: SessionMessageBackend[];
  // All profiles + their statuses are needed so /search can pick a
  // running embed profile (or fall back to BM25-only).
  profiles: Profile[];
  statusByProfile: Record<string, InstanceStatus>;
  onChangeSessionMode: (modeId: string) => void;
  onAfterChat: () => Promise<void>;
  onCreateSession: () => void;
  ensureSession: () => Promise<Session | null>;
  onOpenFilePath: (path: string) => void;
};

export function ChatTab({
  activeProfileId,
  activeStatus,
  modelLabel,
  activeFilePath,
  activeFileContent,
  activeProject,
  activeSession,
  activeSessionMessages,
  profiles,
  statusByProfile,
  onChangeSessionMode,
  onAfterChat,
  onCreateSession,
  ensureSession,
  onOpenFilePath,
}: ChatTabProps) {
  const healthy = activeStatus.healthy;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [streaming, setStreaming] = useState(false);
  const streamIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Ref-mirror of onAfterChat so the chat:done handler always invokes
  // the *latest* refreshActiveSession — the prop captured at send-time
  // closes over the old activeSessionId (empty for auto-created
  // sessions, since ensureSession sets the id mid-await). Without this
  // mirror, the post-stream reload would early-return, leave
  // activeSessionMessages as [user], and hydrate would erase the
  // streamed assistant content.
  const onAfterChatRef = useRef(onAfterChat);
  onAfterChatRef.current = onAfterChat;

  // Hydrate local message state from the persisted session whenever the
  // active session changes.
  //
  // Guarded by `!streaming`: during a live stream we hold an optimistic
  // [user, empty-assistant] tail that the backend hasn't finished
  // persisting yet. If we replayed `activeSessionMessages` here while
  // the stream is mid-flight, the empty-assistant placeholder would be
  // dropped and incoming token deltas would have nowhere to land
  // (delta handler appends to `last.role === 'assistant'`).
  // refreshActiveSession() in App.tsx fires after `chat:done`, by which
  // point streaming=false and we hydrate the canonical version.
  useEffect(() => {
    if (streaming) return;
    setMessages(
      activeSessionMessages.map((m, i) => {
        let toolCalls: ToolCallChip[] | undefined;
        const raw = (m as any).toolCalls;
        if (raw) {
          try {
            // SessionMessage.toolCalls is json.RawMessage on the
            // backend; Wails surfaces it as a string of bytes or an
            // already-parsed array depending on the encoder version.
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed)) {
              toolCalls = parsed.map((c: any) => ({
                name: c.name ?? c.Name,
                args: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? c.Args ?? {}),
                result: c.result ?? c.Result,
                error: c.error ?? c.Error,
              }));
            }
          } catch {
            /* swallow — chip section just won't render for this msg */
          }
        }
        return {
          id: `s-${i}`,
          role: (m.role as ChatRole) || 'assistant',
          content: m.content,
          toolCalls,
        };
      }),
    );
  }, [activeSession?.id, activeSessionMessages, streaming]);

  // Right pane (Edit / Preview). Mounted only when a project file is
  // selected — chat-only sessions don't get a phantom scratch pane.
  const [view, setView] = useState<'edit' | 'preview'>('preview');
  const [panelOpen, setPanelOpen] = useState(true);
  const editorRef = useRef<EditorHandle | null>(null);
  const [previewSource, setPreviewSource] = useState('');
  const lastFilePathRef = useRef<string>('');

  // Split layout (TD6): chat (left) ↔ file pane (right). Pane width is
  // drag-resizable; the chat side is collapsible (mirrors the file-pane rail).
  // Both persist per project in localStorage.
  const PANE_MIN = 280;
  const PANE_DEFAULT = 480;
  const [chatOpen, setChatOpen] = useState(true);
  const [filePaneWidth, setFilePaneWidth] = useState(PANE_DEFAULT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragWidthRef = useRef(PANE_DEFAULT);
  const layoutKey = `llmwb:chatLayout:${activeProject?.ID ?? 'default'}`;
  const clampPaneWidth = useCallback((w: number) => {
    const total = containerRef.current?.offsetWidth ?? 1280;
    return Math.max(PANE_MIN, Math.min(w, Math.max(PANE_MIN + 40, total - 360)));
  }, []);
  const persistLayout = useCallback(
    (patch: Partial<{ filePaneWidth: number; chatOpen: boolean; panelOpen: boolean }>) => {
      try {
        localStorage.setItem(
          layoutKey,
          JSON.stringify({ filePaneWidth, chatOpen, panelOpen, ...patch }),
        );
      } catch {
        /* localStorage unavailable — ignore */
      }
    },
    [layoutKey, filePaneWidth, chatOpen, panelOpen],
  );
  // Load saved layout when the project changes; reset to defaults otherwise.
  useEffect(() => {
    let next = { filePaneWidth: PANE_DEFAULT, chatOpen: true, panelOpen: true };
    try {
      const raw = localStorage.getItem(layoutKey);
      if (raw) {
        const j = JSON.parse(raw) as Partial<typeof next>;
        if (typeof j.filePaneWidth === 'number') next.filePaneWidth = j.filePaneWidth;
        if (typeof j.chatOpen === 'boolean') next.chatOpen = j.chatOpen;
        if (typeof j.panelOpen === 'boolean') next.panelOpen = j.panelOpen;
      }
    } catch {
      /* ignore corrupt entry */
    }
    const w = clampPaneWidth(next.filePaneWidth);
    setFilePaneWidth(w);
    dragWidthRef.current = w;
    setChatOpen(next.chatOpen);
    setPanelOpen(next.panelOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);
  // Divider drag → resize the file pane from the right edge of the container.
  const startPaneDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const onMove = (ev: MouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const w = clampPaneWidth(rect.right - ev.clientX);
        dragWidthRef.current = w;
        setFilePaneWidth(w);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        persistLayout({ filePaneWidth: dragWidthRef.current });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [clampPaneWidth, persistLayout],
  );
  // Collapse/restore the chat side. Collapsing forces the file pane open so
  // the user never ends up with both sides reduced to rails.
  const toggleChatPane = useCallback(
    (open: boolean) => {
      setChatOpen(open);
      if (!open) {
        setPanelOpen(true);
        persistLayout({ chatOpen: false, panelOpen: true });
      } else {
        persistLayout({ chatOpen: true });
      }
    },
    [persistLayout],
  );

  // Edit-mode persistence: localContent mirrors the editor; baseContent
  // is the on-disk value last loaded or saved. dirty = mismatch.
  const [localContent, setLocalContent] = useState('');
  const [baseContent, setBaseContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0); // re-render so "saved Xs ago" updates
  const autosaveTimerRef = useRef<number | null>(null);
  const dirty = !!activeFilePath && localContent !== baseContent;

  // Mode picker — backed by the active session's modeId. Selection
  // writes back via UpdateSessionMode (DESIGN.md M1: metadata only;
  // M3 will inject system prompts / tool whitelists from this).
  const sessionModeId = activeSession?.modeId || MODES[0].id;
  const [modeId, setModeId] = useState<string>(sessionModeId);
  useEffect(() => {
    setModeId(sessionModeId);
  }, [sessionModeId]);
  // Full mode list (builtin + global ~/.config + project-local) — the
  // static MODES const is just the bootstrap fallback. Without this the
  // picker only ever shows the builtin `chat`.
  const [modes, setModes] = useState<Mode[]>(MODES);
  useEffect(() => {
    (async () => {
      try {
        const list = (await ListModes(activeProject?.ID ?? '')) as Mode[];
        if (list && list.length > 0) setModes(list);
      } catch {
        /* keep the static fallback */
      }
    })();
  }, [activeProject?.ID]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const mode: Mode = modes.find((m) => m.id === modeId) || MODE_BY_ID[modeId] || MODES[0];

  const setMode = (id: string) => {
    setModeId(id);
    setPickerOpen(false);
    if (activeSession) onChangeSessionMode(id);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Push project-file content into the right pane.
  //  • Path change → always reload (different file).
  //  • Content change with same path → reload only if local buffer is
  //    clean (don't clobber unsaved edits).
  useEffect(() => {
    if (!activeFilePath) {
      setChatOpen(true); // no file → chat is the only pane; don't leave it railed
      if (lastFilePathRef.current) {
        lastFilePathRef.current = '';
        setLocalContent('');
        setBaseContent('');
        setLastSavedAt(null);
      }
      return;
    }
    const pathChanged = activeFilePath !== lastFilePathRef.current;
    const contentChanged = activeFileContent !== baseContent;
    const localClean = localContent === baseContent;
    if (pathChanged || (contentChanged && localClean)) {
      lastFilePathRef.current = activeFilePath;
      editorRef.current?.setValue(activeFileContent);
      setPreviewSource(activeFileContent);
      setLocalContent(activeFileContent);
      setBaseContent(activeFileContent);
      setLastSavedAt(null);
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath, activeFileContent]);

  // Re-render every 5s so the "saved Xs ago" footer label ticks forward
  // without a heavy timer in the body of every keystroke handler.
  useEffect(() => {
    if (lastSavedAt == null) return;
    const t = window.setInterval(() => forceTick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, [lastSavedAt]);

  // ─────────────────────────── /search state ───────────────────────────
  const [searchHits, setSearchHits] = useState<main.ChunkHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(true);
  const [lastSearchQuery, setLastSearchQuery] = useState<string>('');
  const [searchUsedDense, setSearchUsedDense] = useState(false);

  const runSearch = async (rawQuery: string) => {
    if (!activeProject) {
      notifications.show({
        color: 'gray',
        title: '/search needs a project',
        message: 'Open a project before searching.',
      });
      return;
    }
    const query = rawQuery.trim();
    if (!query) return;

    // Pick the first running embed profile, if any. Falls back to
    // BM25-only when none are up — caller still gets results, just
    // without the dense ranker.
    const runningEmbed = profiles.find(
      (p) => p.Kind === 'embed' && statusByProfile[p.ID]?.running,
    );
    const sparseOnly = !runningEmbed;
    setSearchUsedDense(!sparseOnly);
    setSearching(true);
    setSearchPanelOpen(true);
    try {
      const hits = await SearchProject(
        activeProject.ID,
        runningEmbed?.ID ?? '',
        query,
        8,
        sparseOnly,
        false,
      );
      setSearchHits(hits || []);
      setLastSearchQuery(query);
      if ((hits || []).length === 0) {
        notifications.show({
          color: 'gray',
          title: 'No hits',
          message: `Nothing matched "${query}". Did you Rebuild the index?`,
        });
      }
    } catch (e: any) {
      notifications.show({
        color: 'red',
        title: 'Search failed',
        message: String(e?.message ?? e),
      });
    } finally {
      setSearching(false);
    }
  };

  const switchView = (next: 'edit' | 'preview') => {
    if (next === 'preview') {
      setPreviewSource(editorRef.current?.getValue() ?? '');
    }
    setView(next);
  };

  const send = async () => {
    if (!prompt.trim() || streaming) return;
    const userText = prompt.trim();

    // /search is intercepted client-side: query the project's RAG index
    // instead of streaming to the LLM. Results render in the panel
    // above the input.
    if (userText.toLowerCase().startsWith('/search ') || userText.toLowerCase() === '/search') {
      const q = userText.replace(/^\/search\s*/i, '');
      setPrompt('');
      await runSearch(q);
      return;
    }

    // Don't pre-gate on `healthy`. /health probes can flip false while
    // llama-server is busy crunching a fat prompt (e.g. after a
    // read_file injected a big file), but the chat endpoint itself
    // still accepts requests. If something is actually wrong the
    // backend will emit chat:error and the listener clears streaming.

    // Promote ad-hoc chats into a persisted session whenever a project
    // is active. This way the very first message a user types ends up
    // in JSONL on disk — no "you forgot to click +" foot-gun.
    let sessionForSend = activeSession;
    if (activeProject && !sessionForSend) {
      sessionForSend = await ensureSession();
    }

    const userMsg: ChatMessage = { id: rid(), role: 'user', content: userText };
    const asstMsg: ChatMessage = { id: rid(), role: 'assistant', content: '' };
    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setPrompt('');
    setStreaming(true);

    try {
      const handle =
        activeProject && sessionForSend
          ? await SessionChatStream(activeProject.ID, sessionForSend.id, userText, 0.7)
          : await ChatStream(activeProfileId, [{ role: 'user', content: userText }], 0.7);
      const id = handle.streamId;
      streamIdRef.current = id;

      const deltaEvent = `chat:delta:${id}`;
      const doneEvent = `chat:done:${id}`;
      const errEvent = `chat:error:${id}`;
      const toolReqEvent = `agent:tool:request:${id}`;
      const toolResEvent = `agent:tool:result:${id}`;

      // We MUST await onAfterChat (which reloads activeSessionMessages
      // from JSONL) BEFORE flipping streaming=false. Otherwise the
      // hydrate effect in this component fires on streaming=false with
      // a stale `activeSessionMessages` (still missing the assistant
      // line that's already on disk), wipes the streamed content from
      // the bubble, and then re-hydrates a tick later when the
      // promise resolves — visible as a flash + erase + recover.
      const cleanup = async (refresh: boolean) => {
        EventsOff(deltaEvent);
        EventsOff(doneEvent);
        EventsOff(errEvent);
        EventsOff(toolReqEvent);
        EventsOff(toolResEvent);
        streamIdRef.current = null;
        if (refresh) {
          try {
            // Use the ref so we get refreshActiveSession bound to the
            // current activeSessionId (auto-created session id won't be
            // the one captured when send() ran).
            await onAfterChatRef.current();
          } catch {
            /* refresh errors are surfaced inside refreshActiveSession */
          }
        }
        setStreaming(false);
      };

      EventsOn(deltaEvent, (delta: string) => {
        setMessages((prev) => {
          const out = prev.slice();
          const last = out[out.length - 1];
          if (last && last.role === 'assistant') {
            out[out.length - 1] = { ...last, content: last.content + delta };
          }
          return out;
        });
      });
      EventsOn(doneEvent, () => cleanup(true));
      EventsOn(errEvent, (msg: string) => {
        notifications.show({ color: 'red', title: 'Stream error', message: msg });
        cleanup(false);
      });
      // Append a placeholder chip when the model requests a tool, then
      // attach the result/error to it when it finishes. Streaming UX:
      // user sees "🔧 read_file…" land before the tool call resolves,
      // updates with success/error a moment later.
      EventsOn(toolReqEvent, (req: { name: string; args?: string }) => {
        setMessages((prev) => {
          const out = prev.slice();
          const lastIdx = out.length - 1;
          const last = out[lastIdx];
          if (!last || last.role !== 'assistant') return prev;
          const next = (last.toolCalls ?? []).concat({
            name: req.name,
            args: req.args,
          });
          out[lastIdx] = { ...last, toolCalls: next };
          return out;
        });
      });
      EventsOn(toolResEvent, (res: { name: string; result?: any; error?: string }) => {
        setMessages((prev) => {
          const out = prev.slice();
          const lastIdx = out.length - 1;
          const last = out[lastIdx];
          if (!last || last.role !== 'assistant' || !last.toolCalls) return prev;
          // Patch the most recent unresolved chip for this tool name.
          const calls = last.toolCalls.slice();
          for (let i = calls.length - 1; i >= 0; i--) {
            if (calls[i].name === res.name && calls[i].result == null && !calls[i].error) {
              calls[i] = { ...calls[i], result: res.result, error: res.error };
              break;
            }
          }
          out[lastIdx] = { ...last, toolCalls: calls };
          return out;
        });
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Chat failed', message: String(e) });
      setStreaming(false);
    }
  };

  const cancel = async () => {
    const id = streamIdRef.current;
    if (id) await ChatCancel(id);
  };

  // ───────────────────────── file save/revert ───────────────────────

  const saveFile = useCallback(async () => {
    if (!activeProject || !activeFilePath || !dirty) return;
    setSaving(true);
    try {
      await WriteProjectFile(activeProject.ID, activeFilePath, localContent);
      setBaseContent(localContent);
      setLastSavedAt(Date.now());
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Save failed', message: String(e) });
    } finally {
      setSaving(false);
    }
  }, [activeProject, activeFilePath, dirty, localContent]);

  const revertFile = useCallback(() => {
    if (!editorRef.current) return;
    editorRef.current.setValue(baseContent);
    setLocalContent(baseContent);
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, [baseContent]);

  // Debounced auto-save: 1s after last keystroke, persist if dirty.
  useEffect(() => {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (!dirty) return;
    autosaveTimerRef.current = window.setTimeout(() => {
      saveFile();
    }, 1000);
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [localContent, dirty, saveFile]);

  // Cmd/Ctrl+S manual save shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveFile]);

  return (
    <div ref={containerRef} style={{ flex: 1, display: 'flex', minWidth: 0, background: V5.bg }}>
      {/* LEFT: chat — hidden (railed) only when a file is open and the user collapsed it. */}
      {(chatOpen || !activeFilePath) && (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          borderRight: activeFilePath ? `1px solid ${V5.border}` : 'none',
        }}
      >
        {/* Header */}
        <div style={chatHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1
              style={{
                flex: 1,
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: -0.2,
                color: V5.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={activeSession?.title || 'No active session'}
            >
              {activeSession?.title || (activeProject ? 'No active session' : 'Open a project')}
            </h1>
            <button style={snapshotBtnStyle} disabled title="Snapshot — M3">
              <IconGitBranch size={11} /> Snapshot
            </button>
            {activeFilePath && (
              <button
                onClick={() => toggleChatPane(false)}
                title="Collapse chat — focus the file pane"
                style={{
                  width: 24,
                  height: 24,
                  flex: 'none',
                  background: 'transparent',
                  color: V5.textMuted,
                  border: `1px solid ${V5.borderSoft}`,
                  borderRadius: 5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconLayoutSidebarLeftCollapse size={14} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, fontSize: 11.5, flexWrap: 'wrap' }}>
            <ModePill mode={mode} open={pickerOpen} onToggle={() => setPickerOpen((o) => !o)}>
              {pickerOpen && (
                <ModePicker
                  modes={modes}
                  modeId={modeId}
                  onSelect={setMode}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </ModePill>
            {modelLabel && (
              <span style={pillStyle('mono')}>{modelLabel}</span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <div
            style={{
              padding: '20px 22px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  color: V5.textDim,
                  fontSize: 13,
                  fontStyle: 'italic',
                  textAlign: 'center',
                  padding: '40px 20px',
                }}
              >
                {!activeProject ? (
                  'Open a project from the title-bar menu to start chatting.'
                ) : !activeSession ? (
                  <>
                    No active session.{' '}
                    <button
                      onClick={onCreateSession}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: V5.accent,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontFamily: 'inherit',
                        fontSize: 13,
                        padding: 0,
                      }}
                    >
                      Start a new chat.
                    </button>
                  </>
                ) : (
                  'Type a prompt below to start the conversation.'
                )}
              </div>
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} m={m} />
              ) : (
                <AssistantBubble key={m.id} m={m} onOpenFilePath={onOpenFilePath} />
              ),
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Search results — only when /search was run. */}
        {(searchHits.length > 0 || searching) && (
          <div style={{ padding: '0 22px 8px', flex: 'none' }}>
            <div
              style={{
                background: V5.surface,
                border: `1px solid ${V5.border}`,
                borderRadius: 10,
                padding: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  color: V5.textMuted,
                  marginBottom: searchPanelOpen ? 6 : 0,
                  cursor: 'pointer',
                }}
                onClick={() => setSearchPanelOpen((o) => !o)}
              >
                {searchPanelOpen ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
                <span style={{ fontWeight: 600, color: V5.text }}>
                  {searching ? 'searching…' : `${searchHits.length} hit${searchHits.length === 1 ? '' : 's'}`}
                </span>
                {lastSearchQuery && !searching && (
                  <>
                    <span style={{ color: V5.textDim }}>·</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>"{lastSearchQuery}"</span>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: searchUsedDense ? `${V5.accent}1c` : `${V5.warn}1c`,
                    color: searchUsedDense ? V5.accent : V5.warn,
                    border: `1px solid ${searchUsedDense ? V5.accent : V5.warn}44`,
                  }}
                  title={
                    searchUsedDense
                      ? 'dense (vec) + sparse (BM25), fused via RRF'
                      : 'BM25 only — no embed profile is running'
                  }
                >
                  {searchUsedDense ? 'hybrid' : 'sparse'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchHits([]);
                    setLastSearchQuery('');
                  }}
                  title="Clear"
                  style={{
                    padding: '2px 6px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: V5.textMuted,
                  }}
                >
                  <IconX size={11} />
                </button>
              </div>
              {searchPanelOpen && !searching && searchHits.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflow: 'auto' }}>
                  {searchHits.map((h, i) => (
                    <button
                      key={`${h.path}-${h.chunkId}-${i}`}
                      onClick={() => onOpenFilePath(h.path)}
                      style={{
                        textAlign: 'left',
                        background: V5.bg,
                        border: `1px solid ${V5.borderSoft}`,
                        borderRadius: 6,
                        padding: '6px 8px',
                        cursor: 'pointer',
                        color: V5.text,
                        fontFamily: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          color: V5.textMuted,
                          marginBottom: 3,
                        }}
                      >
                        <IconFile size={11} />
                        <span
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            color: V5.text,
                            fontWeight: 500,
                          }}
                        >
                          {h.path}
                        </span>
                        <span style={{ color: V5.textDim }}>
                          {h.startByte}–{h.endByte}
                        </span>
                        <span style={{ flex: 1 }} />
                        <span
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 10,
                            color: V5.textDim,
                          }}
                          title={`dense rank ${h.denseRank || '–'} · sparse rank ${h.sparseRank || '–'}`}
                        >
                          score {h.score.toFixed(4)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          lineHeight: 1.45,
                          color: V5.text,
                          whiteSpace: 'pre-wrap',
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {h.content}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <div style={{ padding: '12px 22px 14px', flex: 'none' }}>
          <div
            style={{
              background: V5.surface,
              border: `1px solid ${V5.border}`,
              borderRadius: 10,
              padding: 10,
            }}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={streaming}
              placeholder="Continue, /search to query the index, or @-mention a file…"
              rows={2}
              style={{
                width: '100%',
                minHeight: 38,
                resize: 'vertical',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: V5.text,
                fontSize: 13.5,
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11.5,
                color: V5.textMuted,
                marginTop: 5,
              }}
            >
              <button
                onClick={() => setPickerOpen((o) => !o)}
                style={{
                  padding: '3px 9px',
                  background: `${mode.color}1c`,
                  border: `1px solid ${mode.color}44`,
                  color: mode.color,
                  borderRadius: 999,
                  fontFamily: 'inherit',
                  fontSize: 11,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: mode.color,
                  }}
                />
                {mode.name} <IconChevronDown size={9} />
              </button>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5 }}>⌘ ⏎</span>
              {streaming ? (
                <button
                  onClick={cancel}
                  style={{
                    width: 28,
                    height: 28,
                    background: V5.danger,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 7,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title="Cancel"
                >
                  <IconX size={12} />
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!prompt.trim()}
                  style={{
                    width: 28,
                    height: 28,
                    background: !prompt.trim() ? V5.surface2 : V5.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 7,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: !prompt.trim() ? 'not-allowed' : 'pointer',
                    opacity: !prompt.trim() ? 0.5 : 1,
                  }}
                  title={
                    healthy
                      ? 'Send (⌘⏎)'
                      : 'Server probe is currently unhealthy — request may still succeed.'
                  }
                >
                  <IconSend size={12} />
                </button>
              )}
            </div>
          </div>
          {!healthy && (
            <div style={{ fontSize: 11, color: V5.textDim, marginTop: 6 }}>
              Server not healthy — start a profile in the Servers tab.
            </div>
          )}
        </div>
      </div>
      )}

      {/* Collapsed CHAT rail — file open AND user hid the chat side. */}
      {activeFilePath && !chatOpen && (
        <button
          onClick={() => toggleChatPane(true)}
          title="Show chat"
          style={{
            width: 32,
            flex: 'none',
            background: V5.surface2,
            border: 'none',
            borderRight: `1px solid ${V5.border}`,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '14px 0',
            color: V5.textMuted,
            fontFamily: 'inherit',
          }}
        >
          <IconChevronRight size={14} />
          <div
            style={{
              writingMode: 'vertical-rl',
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            Chat
          </div>
          <IconSparkles size={13} style={{ color: V5.textMuted, marginTop: 'auto' }} />
        </button>
      )}

      {/* Collapsed PREVIEW rail — file open AND user hid the preview pane. */}
      {activeFilePath && !panelOpen && (
        <button
          onClick={() => {
            setPanelOpen(true);
            persistLayout({ panelOpen: true });
          }}
          title="Show preview"
          style={{
            width: 32,
            flex: 'none',
            background: V5.surface2,
            borderLeft: `1px solid ${V5.border}`,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '14px 0',
            color: V5.textMuted,
            fontFamily: 'inherit',
          }}
        >
          <IconChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
          <div
            style={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              fontSize: 11,
              letterSpacing: 0.4,
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {activeFilePath || 'scratch.md'}
          </div>
          <IconFile size={13} style={{ color: V5.textMuted, marginTop: 'auto' }} />
        </button>
      )}

      {/* Drag-resize divider — only when both panes are visible. */}
      {activeFilePath && panelOpen && chatOpen && (
        <div
          onMouseDown={startPaneDrag}
          onDoubleClick={() => toggleChatPane(false)}
          title="Drag to resize · double-click to hide chat"
          style={{
            width: 5,
            flex: 'none',
            cursor: 'col-resize',
            background: V5.surface2,
            borderLeft: `1px solid ${V5.border}`,
            borderRight: `1px solid ${V5.border}`,
          }}
        />
      )}

      {/* RIGHT: edit / preview — only when a project file is open. */}
      {activeFilePath && panelOpen && (
        <div
          style={{
            width: chatOpen ? filePaneWidth : undefined,
            flex: chatOpen ? 'none' : 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: V5.surface2,
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${V5.borderSoft}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: 'none',
            }}
          >
            <IconFile size={13} color={V5.textMuted} />
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                color: V5.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 220,
              }}
              title={activeFilePath || 'scratch (no file open)'}
            >
              {activeFilePath || 'scratch.md'}
            </span>
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: 'flex',
                background: V5.bg,
                border: `1px solid ${V5.borderSoft}`,
                borderRadius: 5,
                padding: 2,
              }}
            >
              {(['edit', 'preview'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => switchView(k)}
                  style={{
                    padding: '3px 9px',
                    border: 'none',
                    background: view === k ? V5.surface : 'transparent',
                    color: view === k ? V5.text : V5.textMuted,
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11,
                    fontWeight: view === k ? 600 : 400,
                    textTransform: 'capitalize',
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setPanelOpen(false);
                setChatOpen(true);
                persistLayout({ panelOpen: false, chatOpen: true });
              }}
              title="Hide panel"
              style={{
                width: 22,
                height: 22,
                background: 'transparent',
                color: V5.textMuted,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconX size={11} />
            </button>
          </div>

          {/* Body — both mounted, hidden via display so editor doesn't unmount */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <div style={{ height: '100%', display: view === 'edit' ? 'block' : 'none' }}>
              <MarkdownEditor
                initialDoc=""
                onReady={(h) => {
                  editorRef.current = h;
                }}
                onChange={(v) => {
                  if (activeFilePath) setLocalContent(v);
                }}
              />
            </div>
            <div style={{ height: '100%', display: view === 'preview' ? 'block' : 'none' }}>
              <MarkdownPreview source={activeFilePath ? localContent : previewSource} />
            </div>
          </div>

          {activeFilePath && (
            <FilePaneFooter
              dirty={dirty}
              saving={saving}
              lastSavedAt={lastSavedAt}
              onSave={saveFile}
              onRevert={revertFile}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FilePaneFooter({
  dirty,
  saving,
  lastSavedAt,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  onSave: () => void;
  onRevert: () => void;
}) {
  let statusText: React.ReactNode;
  if (saving) {
    statusText = <span style={{ color: V5.warn }}>saving…</span>;
  } else if (dirty) {
    statusText = <span style={{ color: V5.warn }}>● modified · auto-save in 1s</span>;
  } else if (lastSavedAt != null) {
    statusText = (
      <span style={{ color: V5.textDim }}>saved {formatAge(lastSavedAt)} ago</span>
    );
  } else {
    statusText = <span style={{ color: V5.textDim }}>clean</span>;
  }
  return (
    <div
      style={{
        padding: '10px 14px',
        borderTop: `1px solid ${V5.borderSoft}`,
        background: V5.surface2,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flex: 'none',
      }}
    >
      <span style={{ fontSize: 11, flex: 1, fontFamily: 'ui-monospace, monospace' }}>
        {statusText}
      </span>
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        style={{
          padding: '6px 12px',
          background: !dirty || saving ? V5.surface : V5.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 5,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'inherit',
          cursor: !dirty || saving ? 'not-allowed' : 'pointer',
          opacity: !dirty || saving ? 0.6 : 1,
        }}
        title="Save (⌘S)"
      >
        Save
      </button>
      <button
        onClick={onRevert}
        disabled={!dirty || saving}
        style={{
          padding: '6px 12px',
          background: 'transparent',
          color: V5.text,
          border: `1px solid ${V5.border}`,
          borderRadius: 5,
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: !dirty || saving ? 'not-allowed' : 'pointer',
          opacity: !dirty || saving ? 0.5 : 1,
        }}
      >
        Revert
      </button>
    </div>
  );
}

function formatAge(ts: number): string {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

const chatHeaderStyle: CSSProperties = {
  padding: '14px 22px 12px',
  borderBottom: `1px solid ${V5.borderSoft}`,
  flex: 'none',
};

const snapshotBtnStyle: CSSProperties = {
  padding: '5px 10px',
  background: 'transparent',
  color: V5.textDim,
  border: `1px solid ${V5.border}`,
  borderRadius: 6,
  fontSize: 11.5,
  fontFamily: 'inherit',
  cursor: 'not-allowed',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  opacity: 0.5,
};

function pillStyle(variant: 'mono' | 'plain' = 'plain'): CSSProperties {
  return {
    display: 'inline-flex',
    padding: '3px 8px',
    background: V5.surface,
    color: V5.textMuted,
    borderRadius: 999,
    fontFamily: variant === 'mono' ? 'ui-monospace, monospace' : 'inherit',
    fontSize: 10.5,
  };
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─────────────────────────── Sub-components ────────────────────────────

function UserBubble({ m }: { m: ChatMessage }) {
  return (
    <div
      style={{
        alignSelf: 'flex-end',
        maxWidth: '90%',
        background: V5.surface,
        padding: '10px 13px',
        borderRadius: '12px 12px 4px 12px',
        border: `1px solid ${V5.borderSoft}`,
      }}
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{m.content}</div>
    </div>
  );
}

function AssistantBubble({
  m,
  onOpenFilePath,
}: {
  m: ChatMessage;
  onOpenFilePath: (path: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          background: V5.accentSoft,
          color: V5.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <IconSparkles size={11} />
      </div>
      <div
        style={{
          flex: 1,
          fontSize: 13.5,
          lineHeight: 1.65,
          paddingTop: 2,
          whiteSpace: 'pre-wrap',
          minHeight: 18,
        }}
      >
        {m.content || <span style={{ color: V5.textDim, fontStyle: 'italic' }}>…</span>}
        {m.toolCalls && m.toolCalls.length > 0 && (
          <ToolCallChips calls={m.toolCalls} onOpenFilePath={onOpenFilePath} />
        )}
      </div>
    </div>
  );
}

function ToolCallChips({
  calls,
  onOpenFilePath,
}: {
  calls: ToolCallChip[];
  onOpenFilePath: (path: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {calls.map((c, i) => {
        const summary = chipSummary(c);
        const path = pathFromArgs(c);
        const isErr = !!c.error;
        const isPending = c.result == null && !c.error;
        const clickable = !!path;
        const color = isErr ? V5.danger : isPending ? V5.textDim : V5.textMuted;
        const bg = isErr ? `${V5.danger}14` : V5.surface;
        const border = isErr ? `${V5.danger}55` : V5.borderSoft;
        return (
          <button
            key={i}
            onClick={() => path && onOpenFilePath(path)}
            disabled={!clickable}
            title={c.error ? c.error : isPending ? 'running…' : ''}
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 10.5,
              padding: '2px 7px',
              background: bg,
              border: `1px solid ${border}`,
              color,
              borderRadius: 999,
              cursor: clickable ? 'pointer' : 'default',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 500,
            }}
          >
            <span>{toolIcon(c.name)}</span>
            <span style={{ color: V5.text }}>{c.name}</span>
            {summary && (
              <span style={{ color: V5.textDim, fontWeight: 400 }}>· {summary}</span>
            )}
            {isPending && <span style={{ color: V5.textDim }}>…</span>}
          </button>
        );
      })}
    </div>
  );
}

function toolIcon(name: string): string {
  switch (name) {
    case 'read_file':
      return '📄';
    case 'list_files':
      return '📂';
    case 'search_semantic':
      return '🔍';
    case 'edit_file':
      return '✏️';
    default:
      return '🔧';
  }
}

function chipSummary(c: ToolCallChip): string {
  let parsed: any = {};
  if (c.args) {
    try {
      parsed = typeof c.args === 'string' ? JSON.parse(c.args) : c.args;
    } catch {
      return '';
    }
  }
  if (c.name === 'search_semantic' && parsed.query) {
    return `"${String(parsed.query).slice(0, 40)}"`;
  }
  if (c.name === 'read_file' && parsed.path) {
    return String(parsed.path);
  }
  if (c.name === 'edit_file' && parsed.path) {
    const bytes = typeof parsed.content === 'string' ? parsed.content.length : 0;
    return `${parsed.path} · ${bytes}B`;
  }
  return '';
}

function pathFromArgs(c: ToolCallChip): string | null {
  if (!c.args) return null;
  try {
    const parsed = typeof c.args === 'string' ? JSON.parse(c.args) : c.args;
    if (parsed && typeof parsed.path === 'string') return parsed.path;
  } catch {
    /* noop */
  }
  return null;
}

function ModePill({
  mode,
  open,
  onToggle,
  children,
}: {
  mode: Mode;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <span style={{ position: 'relative' }}>
      <button
        onClick={onToggle}
        title="Change mode for this session"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: `${mode.color}22`,
          color: mode.color,
          border: `1px solid ${mode.color}55`,
          borderRadius: 999,
          fontWeight: 600,
          fontSize: 11.5,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            background: mode.color,
            display: 'inline-block',
          }}
        />
        {mode.name}
        <IconChevronDown size={9} style={{ opacity: 0.8 }} />
      </button>
      {open && children}
    </span>
  );
}

function ModePicker({
  modes,
  modeId,
  onSelect,
  onClose,
}: {
  modes: Mode[];
  modeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
      />
      <div
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          zIndex: 41,
          width: 320,
          background: V5.surface,
          border: `1px solid ${V5.border}`,
          borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,.5)',
          padding: 6,
        }}
      >
        <div
          style={{
            padding: '6px 10px 4px',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: V5.textMuted,
          }}
        >
          Session mode
        </div>
        {modes.map((m) => {
          const sel = m.id === modeId;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                padding: '8px 10px',
                background: sel ? `${m.color}1f` : 'transparent',
                border: 'none',
                borderRadius: 5,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                borderLeft: sel ? `2px solid ${m.color}` : '2px solid transparent',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: m.color,
                  marginTop: 5,
                  flex: 'none',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: V5.text }}>{m.name}</span>
                </div>
                <div style={{ fontSize: 11, color: V5.textMuted, marginTop: 1 }}>{m.desc}</div>
              </div>
            </button>
          );
        })}
        <div
          style={{
            borderTop: `1px solid ${V5.borderSoft}`,
            marginTop: 4,
            padding: '6px 10px',
            fontSize: 11,
            color: V5.textDim,
            fontStyle: 'italic',
          }}
        >
          Demo only — mode does not affect prompt yet (M3).
        </div>
      </div>
    </>
  );
}
