import { useEffect, useRef, useState } from 'react';
import {
  AppShell,
  Group,
  Button,
  Text,
  Badge,
  Textarea,
  Stack,
  ScrollArea,
  Code,
  Divider,
  Loader,
  ActionIcon,
  SegmentedControl,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlayerPlay, IconPlayerStop, IconSend, IconX, IconRefresh } from '@tabler/icons-react';
import { MarkdownEditor, EditorHandle } from './components/Editor';
import { MarkdownPreview } from './components/Preview';
import {
  StartServer,
  StopServer,
  ServerStatus,
  GetConfig,
  ChatStream,
  ChatCancel,
  LoadInitialDoc,
} from '../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime';

type Status = { running: boolean; pid: number; baseUrl: string; healthy: boolean };

const INITIAL_DOC = `# llm-workbench — Milestone 0 spike

Editor pane is a CodeMirror 6 instance with markdown mode.
Use the chat box on the left to send a prompt; assistant tokens
will be appended **here** as they stream from llama-server.

---

`;

export default function App() {
  const [status, setStatus] = useState<Status>({ running: false, pid: 0, baseUrl: '', healthy: false });
  const [cfg, setCfg] = useState<Record<string, any>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const editorRef = useRef<EditorHandle | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const docLoadedRef = useRef(false);
  const [docInfo, setDocInfo] = useState<{ path: string; bytes: number; loadedMs: number; renderMs: number } | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [previewSource, setPreviewSource] = useState('');
  const [previewStats, setPreviewStats] = useState<{ parseMs: number; bytes: number; htmlSize: number; totalMs: number } | null>(null);

  const switchView = (next: 'edit' | 'preview') => {
    if (next === 'preview') {
      const src = editorRef.current?.getValue() ?? '';
      setPreviewSource(src);
      setPreviewStats(null);
    }
    setView(next);
  };

  const loadDoc = async () => {
    const t0 = performance.now();
    const res = await LoadInitialDoc();
    if (!res.content) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.setValue(res.content);
    const renderMs = Math.round(performance.now() - t0 - res.loadedMs);
    setDocInfo({ path: res.path, bytes: res.bytes, loadedMs: res.loadedMs, renderMs });
  };

  useEffect(() => {
    GetConfig().then(setCfg).catch(() => {});
    ServerStatus().then(setStatus).catch(() => {});

    EventsOn('llama:status', (s: Status) => setStatus(s));
    EventsOn('llama:log', (line: string) => {
      setLogs((prev) => {
        const next = [...prev, line];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });
    EventsOn('app:fatal', (msg: string) => {
      notifications.show({ color: 'red', title: 'Fatal', message: msg, autoClose: false });
    });

    return () => {
      EventsOff('llama:status');
      EventsOff('llama:log');
      EventsOff('app:fatal');
    };
  }, []);

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs]);

  const onStart = async () => {
    try {
      await StartServer();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Start failed', message: String(e) });
    }
  };
  const onStop = async () => {
    await StopServer();
  };

  const send = async () => {
    if (!prompt.trim() || streaming) return;
    const editor = editorRef.current;
    if (!editor) return;

    editor.appendText(`\n\n## User\n\n${prompt.trim()}\n\n## Assistant\n\n`);
    const messages = [{ role: 'user', content: prompt.trim() }];
    setPrompt('');
    setStreaming(true);

    try {
      const handle = await ChatStream(messages, 0.7);
      const id = handle.streamId;
      setStreamId(id);

      const deltaEvent = `chat:delta:${id}`;
      const doneEvent = `chat:done:${id}`;
      const errEvent = `chat:error:${id}`;

      const cleanup = () => {
        EventsOff(deltaEvent);
        EventsOff(doneEvent);
        EventsOff(errEvent);
        setStreaming(false);
        setStreamId(null);
      };

      EventsOn(deltaEvent, (delta: string) => {
        editorRef.current?.appendText(delta);
      });
      EventsOn(doneEvent, () => {
        cleanup();
      });
      EventsOn(errEvent, (msg: string) => {
        notifications.show({ color: 'red', title: 'Stream error', message: msg });
        cleanup();
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Chat failed', message: String(e) });
      setStreaming(false);
    }
  };

  const cancel = async () => {
    if (streamId) await ChatCancel(streamId);
  };

  return (
    <AppShell header={{ height: 48 }} navbar={{ width: 380, breakpoint: 'sm' }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Text fw={700}>llm-workbench</Text>
            <Badge color="gray" variant="light">M0 spike</Badge>
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => switchView(v as 'edit' | 'preview')}
              data={[
                { label: 'Edit', value: 'edit' },
                { label: 'Preview', value: 'preview' },
              ]}
            />
            {view === 'preview' && previewStats && (
              <Text size="xs" c="dimmed">
                Go {previewStats.parseMs} ms · total {previewStats.totalMs} ms · html {(previewStats.htmlSize / 1024).toFixed(0)} KB
              </Text>
            )}
          </Group>
          <Group gap="xs">
            <Badge color={status.healthy ? 'green' : status.running ? 'yellow' : 'gray'}>
              {status.healthy ? 'healthy' : status.running ? `pid ${status.pid}` : 'stopped'}
            </Badge>
            <Text size="xs" c="dimmed">{status.baseUrl || cfg.baseUrl}</Text>
            {status.running ? (
              <Button size="xs" variant="light" color="red" leftSection={<IconPlayerStop size={14} />} onClick={onStop}>
                Stop
              </Button>
            ) : (
              <Button size="xs" variant="light" color="green" leftSection={<IconPlayerPlay size={14} />} onClick={onStart}>
                Start
              </Button>
            )}
            <ActionIcon variant="subtle" onClick={() => ServerStatus().then(setStatus)}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack h="100%" gap="xs">
          <Text size="sm" fw={600}>Prompt</Text>
          <Textarea
            placeholder="Type a message…"
            autosize
            minRows={4}
            maxRows={10}
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            disabled={streaming}
          />
          <Group gap="xs">
            <Button
              leftSection={streaming ? <Loader size={14} /> : <IconSend size={14} />}
              onClick={send}
              disabled={streaming || !status.healthy}
              flex={1}
            >
              {streaming ? 'Streaming…' : 'Send'}
            </Button>
            {streaming && (
              <ActionIcon color="red" variant="light" onClick={cancel} size="lg">
                <IconX size={16} />
              </ActionIcon>
            )}
          </Group>
          {!status.healthy && (
            <Text size="xs" c="dimmed">Server not healthy yet — wait for model load.</Text>
          )}

          {docInfo && (
            <>
              <Divider label="Stress doc" labelPosition="left" />
              <Code block style={{ fontSize: 11 }}>
                {`path:    ${docInfo.path}
bytes:   ${docInfo.bytes.toLocaleString()}
read:    ${docInfo.loadedMs} ms (Go)
render:  ${docInfo.renderMs} ms (CM6)`}
              </Code>
            </>
          )}

          <Divider label="Config" labelPosition="left" />
          <Code block style={{ fontSize: 11 }}>{JSON.stringify(cfg, null, 2)}</Code>

          <Divider label="llama-server log" labelPosition="left" />
          <ScrollArea h={260} viewportRef={logScrollRef as any} type="auto">
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {logs.join('\n')}
            </Code>
          </ScrollArea>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main style={{ height: '100vh' }}>
        <div style={{ height: 'calc(100vh - 48px)', position: 'relative' }}>
          <div style={{ height: '100%', display: view === 'edit' ? 'block' : 'none' }}>
            <MarkdownEditor
              initialDoc={INITIAL_DOC}
              onReady={(h) => {
                editorRef.current = h;
                if (!docLoadedRef.current) {
                  docLoadedRef.current = true;
                  loadDoc();
                }
              }}
            />
          </div>
          <div style={{ height: '100%', display: view === 'preview' ? 'block' : 'none' }}>
            <MarkdownPreview source={previewSource} onStats={setPreviewStats} />
          </div>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
