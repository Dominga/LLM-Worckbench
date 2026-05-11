import { useEffect, useRef, useState } from 'react';
import {
  Card,
  Collapse,
  Group,
  Stack,
  Text,
  Badge,
  Button,
  ActionIcon,
  Divider,
  Modal,
  TextInput,
  Select,
  NumberInput,
  TagsInput,
  ScrollArea,
  Code,
  Tooltip,
  Box,
  UnstyledButton,
} from '@mantine/core';
import {
  IconChevronRight,
  IconChevronDown,
  IconHammer,
  IconPlayerStop,
  IconEdit,
  IconTrash,
  IconRefresh,
  IconTerminal2,
  IconFolder,
  IconCopy,
  IconClipboard,
  IconPlus,
  IconCpu,
  IconSearch,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import {
  ListBuildRecipes,
  ListBuilds,
  DeleteBuild,
  DeleteBuildRecipe,
  CreateBuildRecipe,
  UpdateBuildRecipe,
  StartBuild,
  CancelBuild,
  GetBuildStatus,
  GetBuildLog,
  DetectGPU,
  SuggestBuildRecipes,
  PickDirectory,
  InspectSourceDir,
} from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';

const BACKEND_OPTIONS = [
  { value: '', label: '(unspecified)' },
  { value: 'cpu', label: 'cpu' },
  { value: 'cuda11', label: 'cuda11' },
  { value: 'cuda12', label: 'cuda12' },
  { value: 'rocm', label: 'rocm' },
  { value: 'vulkan', label: 'vulkan' },
  { value: 'metal', label: 'metal' },
];

type Status = main.BuildStatus;

function phaseColor(p?: string): string {
  switch (p) {
    case 'done':
      return 'teal';
    case 'failed':
      return 'red';
    case 'cancelled':
      return 'yellow';
    case 'idle':
    case undefined:
    case '':
      return 'gray';
    default:
      return 'blue'; // cloning / fetching / configuring / compiling
  }
}

export function BuildsPanel() {
  const [open, setOpen] = useState(false);
  const [recipes, setRecipes] = useState<main.BuildRecipe[]>([]);
  const [builds, setBuilds] = useState<main.Build[]>([]);
  const [gpu, setGpu] = useState<main.GPUDetection | null>(null);
  const [gpuLoading, setGpuLoading] = useState(false);
  const [statusByRecipe, setStatusByRecipe] = useState<Record<string, Status>>({});
  const [logByRecipe, setLogByRecipe] = useState<Record<string, string[]>>({});
  const [editorRecipe, setEditorRecipe] = useState<main.BuildRecipe | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [openLogRecipe, setOpenLogRecipe] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [rs, bs] = await Promise.all([ListBuildRecipes(), ListBuilds()]);
      setRecipes(rs ?? []);
      setBuilds(bs ?? []);
      const sts: Record<string, Status> = {};
      for (const r of rs ?? []) {
        try {
          sts[r.ID] = await GetBuildStatus(r.ID);
        } catch {
          /* ignore */
        }
      }
      setStatusByRecipe(sts);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Builds', message: String(e?.message ?? e) });
    }
  };

  const detectGpu = async () => {
    setGpuLoading(true);
    try {
      setGpu(await DetectGPU());
    } catch {
      setGpu(null);
    } finally {
      setGpuLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    detectGpu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Subscribe to build:status / build:log for every known recipe.
  const recipeKey = recipes.map((r) => r.ID).join(',');
  useEffect(() => {
    if (!open) return;
    const events: string[] = [];
    for (const r of recipes) {
      const sEv = `build:status:${r.ID}`;
      const lEv = `build:log:${r.ID}`;
      EventsOn(sEv, (st: Status) => {
        setStatusByRecipe((m) => ({ ...m, [r.ID]: st }));
        if (st.phase === 'done') {
          notifications.show({ color: 'teal', title: 'Build finished', message: `${r.ID}${st.message ? ' — ' + st.message : ''}` });
          ListBuilds()
            .then((bs) => setBuilds(bs ?? []))
            .catch(() => {});
        } else if (st.phase === 'failed') {
          notifications.show({ color: 'red', title: 'Build failed', message: `${r.ID}${st.message ? ' — ' + st.message : ''}` });
        } else if (st.phase === 'cancelled') {
          notifications.show({ color: 'yellow', title: 'Build cancelled', message: r.ID });
        }
      });
      EventsOn(lEv, (line: string) => {
        setLogByRecipe((m) => {
          const prev = m[r.ID] ?? [];
          const next = prev.length > 5000 ? prev.slice(prev.length - 5000) : prev.slice();
          next.push(line);
          return { ...m, [r.ID]: next };
        });
      });
      events.push(sEv, lEv);
    }
    return () => events.forEach((e) => EventsOff(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipeKey]);

  const startBuild = async (id: string) => {
    setLogByRecipe((m) => ({ ...m, [id]: [] }));
    setOpenLogRecipe(id);
    try {
      await StartBuild(id);
      setStatusByRecipe((m) => ({ ...m, [id]: { recipeId: id, phase: 'idle', running: true } as Status }));
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Build', message: String(e?.message ?? e) });
    }
  };

  const newRecipe = () => {
    setEditorRecipe(null);
    setEditorOpen(true);
  };
  const editRecipe = (r: main.BuildRecipe) => {
    setEditorRecipe(r);
    setEditorOpen(true);
  };
  const deleteRecipe = async (r: main.BuildRecipe) => {
    try {
      await DeleteBuildRecipe(r.ID);
      await refresh();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Delete recipe', message: String(e?.message ?? e) });
    }
  };
  const deleteBuild = async (b: main.Build) => {
    try {
      await DeleteBuild(b.ID);
      const bs = await ListBuilds();
      setBuilds(bs ?? []);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Delete build', message: String(e?.message ?? e) });
    }
  };

  return (
    <Box px={24} pb={18} style={{ flex: 'none' }}>
      <Card withBorder padding="xs" radius="md">
        <UnstyledButton onClick={() => setOpen((v) => !v)} style={{ width: '100%' }}>
          <Group gap={8}>
            {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            <IconHammer size={16} />
            <Text fw={600} size="sm">
              Builds
            </Text>
            <Text size="xs" c="dimmed">
              {recipes.length} recipe{recipes.length === 1 ? '' : 's'} · {builds.length} build{builds.length === 1 ? '' : 's'}
            </Text>
            {Object.values(statusByRecipe).some((s) => s.running) && (
              <Badge size="xs" color="blue" variant="light">
                building…
              </Badge>
            )}
          </Group>
        </UnstyledButton>

        <Collapse in={open}>
          <Stack gap="sm" mt="sm">
            {/* GPU detection card */}
            <Card withBorder padding="xs" radius="sm" bg="dark.6">
              <Group justify="space-between" mb={6}>
                <Group gap={6}>
                  <IconCpu size={14} />
                  <Text size="xs" fw={600}>
                    Detected accelerators
                  </Text>
                </Group>
                <Tooltip label="Re-probe (nvidia-smi / rocminfo / vulkaninfo)">
                  <ActionIcon size="sm" variant="subtle" onClick={detectGpu} loading={gpuLoading}>
                    <IconRefresh size={13} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              {gpuLoading ? (
                <Text size="xs" c="dimmed">
                  probing…
                </Text>
              ) : gpu && gpu.gpus && gpu.gpus.length > 0 ? (
                <Stack gap={2}>
                  {gpu.gpus.map((g, i) => (
                    <Text key={i} size="xs">
                      <Badge size="xs" variant="light" mr={6}>
                        {g.backend || g.vendor || 'gpu'}
                      </Badge>
                      {g.name}
                      {g.vramMib ? <Text span c="dimmed"> · {(g.vramMib / 1024).toFixed(1)} GB</Text> : null}
                      <Text span c="dimmed"> · via {g.source}</Text>
                    </Text>
                  ))}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed">
                  none found{gpu && gpu.probed && gpu.probed.length > 0 ? ` (probed: ${gpu.probed.join(', ')})` : ' — no probe tools on PATH'}
                </Text>
              )}
            </Card>

            {/* Recipes */}
            <Group justify="space-between">
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Recipes
              </Text>
              <Group gap={6}>
                <Button size="compact-xs" variant="subtle" leftSection={<IconRefresh size={12} />} onClick={refresh}>
                  Refresh
                </Button>
                <Button size="compact-xs" leftSection={<IconPlus size={12} />} onClick={newRecipe}>
                  New recipe
                </Button>
              </Group>
            </Group>
            {recipes.length === 0 && (
              <Text size="xs" c="dimmed" fs="italic">
                No build recipes yet. Create one pointing at a llama.cpp checkout (or a folder + a git remote to clone), then hit Build.
              </Text>
            )}
            {recipes.map((r) => {
              const st = statusByRecipe[r.ID];
              const running = !!st && st.running;
              return (
                <Card key={r.ID} withBorder padding="xs" radius="sm">
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Group gap={6}>
                        <Text size="sm" fw={600}>
                          {r.DisplayName || r.ID}
                        </Text>
                        {r.Backend ? (
                          <Badge size="xs" variant="light">
                            {r.Backend}
                          </Badge>
                        ) : null}
                        {st && st.phase && st.phase !== 'idle' && (
                          <Badge size="xs" color={phaseColor(st.phase)} variant="filled">
                            {st.phase}
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                        {r.SourceDir}
                        {r.SourceRepo ? ` ← ${r.SourceRepo}${r.GitRef ? ` @${r.GitRef}` : ''}` : ''}
                      </Text>
                      {r.CMakeFlags && r.CMakeFlags.length > 0 && (
                        <Text size="xs" c="dimmed" ff="monospace">
                          {r.CMakeFlags.join(' ')}
                        </Text>
                      )}
                      {st && st.message && (running || st.phase === 'failed') && (
                        <Text size="xs" c={st.phase === 'failed' ? 'red' : 'dimmed'}>
                          {st.message}
                        </Text>
                      )}
                    </Stack>
                    <Group gap={4} wrap="nowrap">
                      {running ? (
                        <Tooltip label="Cancel build">
                          <ActionIcon size="sm" color="red" variant="light" onClick={() => CancelBuild(r.ID)}>
                            <IconPlayerStop size={14} />
                          </ActionIcon>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Build now">
                          <ActionIcon size="sm" color="blue" variant="light" onClick={() => startBuild(r.ID)}>
                            <IconHammer size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Build log">
                        <ActionIcon
                          size="sm"
                          variant={openLogRecipe === r.ID ? 'filled' : 'subtle'}
                          onClick={async () => {
                            if (openLogRecipe === r.ID) {
                              setOpenLogRecipe(null);
                              return;
                            }
                            if (!(logByRecipe[r.ID]?.length)) {
                              try {
                                const ls = await GetBuildLog(r.ID);
                                if (ls && ls.length) setLogByRecipe((m) => ({ ...m, [r.ID]: ls }));
                              } catch {
                                /* ignore */
                              }
                            }
                            setOpenLogRecipe(r.ID);
                          }}
                        >
                          <IconTerminal2 size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Edit recipe">
                        <ActionIcon size="sm" variant="subtle" onClick={() => editRecipe(r)} disabled={running}>
                          <IconEdit size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete recipe">
                        <ActionIcon size="sm" color="red" variant="subtle" onClick={() => deleteRecipe(r)} disabled={running}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                  <Collapse in={openLogRecipe === r.ID}>
                    <BuildLog lines={logByRecipe[r.ID] ?? []} />
                  </Collapse>
                </Card>
              );
            })}

            {/* Build artifacts */}
            {builds.length > 0 && (
              <>
                <Divider />
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  Built binaries
                </Text>
                {builds.map((b) => (
                  <Group key={b.ID} justify="space-between" wrap="nowrap">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Group gap={6}>
                        <Text size="sm">{b.DisplayName || b.ID}</Text>
                        {b.Backend ? (
                          <Badge size="xs" variant="light">
                            {b.Backend}
                          </Badge>
                        ) : null}
                        {b.Commit ? (
                          <Text size="xs" c="dimmed" ff="monospace">
                            {b.Commit.slice(0, 8)}
                          </Text>
                        ) : null}
                      </Group>
                      <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                        {b.BinaryPath}
                      </Text>
                    </Stack>
                    <Tooltip label="Forget this build (the binary on disk is left untouched)">
                      <ActionIcon size="sm" color="red" variant="subtle" onClick={() => deleteBuild(b)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ))}
              </>
            )}
          </Stack>
        </Collapse>
      </Card>

      <RecipeEditor
        opened={editorOpen}
        recipe={editorRecipe}
        onClose={() => setEditorOpen(false)}
        onSaved={async () => {
          setEditorOpen(false);
          await refresh();
        }}
      />
    </Box>
  );
}

function BuildLog({ lines }: { lines: string[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [lines.length]);
  return (
    <ScrollArea h={200} viewportRef={viewport} mt={8} type="auto">
      <Code block style={{ fontSize: 11, lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>
        {lines.length ? lines.join('\n') : '(no output yet)'}
      </Code>
    </ScrollArea>
  );
}

// ─────────────────────────── recipe editor modal ────────────────────

type EditorState = {
  ID: string;
  DisplayName: string;
  SourceDir: string;
  SourceRepo: string;
  GitRef: string;
  Backend: string;
  CMakeFlags: string[];
  BuildDir: string;
  Jobs: number;
};

function stateFromRecipe(r: main.BuildRecipe | null): EditorState {
  if (!r) {
    return { ID: '', DisplayName: '', SourceDir: '', SourceRepo: '', GitRef: '', Backend: '', CMakeFlags: [], BuildDir: '', Jobs: 0 };
  }
  return {
    ID: r.ID,
    DisplayName: r.DisplayName || '',
    SourceDir: r.SourceDir || '',
    SourceRepo: r.SourceRepo || '',
    GitRef: r.GitRef || '',
    Backend: r.Backend || '',
    CMakeFlags: r.CMakeFlags ? [...r.CMakeFlags] : [],
    BuildDir: r.BuildDir || '',
    Jobs: r.Jobs || 0,
  };
}

function RecipeEditor({
  opened,
  recipe,
  onClose,
  onSaved,
}: {
  opened: boolean;
  recipe: main.BuildRecipe | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!recipe;
  const [s, setS] = useState<EditorState>(stateFromRecipe(recipe));
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<main.BuildRecipe[]>([]);
  const [scanInfo, setScanInfo] = useState<main.SourceDirInfo | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setS(stateFromRecipe(recipe));
    setScanInfo(null);
    SuggestBuildRecipes()
      .then((rs) => setSuggestions(rs ?? []))
      .catch(() => setSuggestions([]));
  }, [opened, recipe]);

  // Look at the source directory: pull the git remote if it's a checkout,
  // and reconstruct cmake flags if a previous `cmake -B …` left a CMakeCache.
  // Only fills *empty* fields so it never clobbers what the user typed.
  const doScan = async (path: string) => {
    const p = path.trim();
    if (!p) return;
    setScanning(true);
    try {
      const info = await InspectSourceDir(p);
      setScanInfo(info);
      setS((x) => ({
        ...x,
        SourceRepo: x.SourceRepo || (info.gitRemote ?? ''),
        BuildDir: x.BuildDir || (info.configuredBuildDir ?? ''),
        CMakeFlags: x.CMakeFlags.length ? x.CMakeFlags : (info.cmakeFlags ?? []),
        Backend: x.Backend || (info.backend ?? ''),
      }));
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Scan', message: String(e?.message ?? e) });
    } finally {
      setScanning(false);
    }
  };

  const up = <K extends keyof EditorState>(k: K, v: EditorState[K]) => setS((x) => ({ ...x, [k]: v }));

  const applySuggestion = (id: string) => {
    const sug = suggestions.find((x) => x.ID === id);
    if (!sug) return;
    setS((x) => ({
      ...x,
      DisplayName: x.DisplayName || sug.DisplayName || '',
      Backend: sug.Backend || '',
      CMakeFlags: sug.CMakeFlags ? [...sug.CMakeFlags] : [],
    }));
  };

  const pickDir = async () => {
    try {
      const p = await PickDirectory('Pick the llama.cpp source directory');
      if (p) {
        up('SourceDir', p);
        doScan(p);
      }
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Picker', message: String(e?.message ?? e) });
    }
  };

  const copyFlags = async () => {
    try {
      await navigator.clipboard.writeText(s.CMakeFlags.join(' '));
      notifications.show({ color: 'teal', title: 'Copied', message: `${s.CMakeFlags.length} flag(s)` });
    } catch {
      /* ignore */
    }
  };
  const pasteFlags = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      const parts = txt.split(/\s+/).map((x) => x.trim()).filter(Boolean);
      up('CMakeFlags', parts);
      notifications.show({ color: 'teal', title: 'Pasted', message: `${parts.length} flag(s)` });
    } catch {
      /* ignore */
    }
  };

  const submit = async () => {
    if (!isEdit && !/^[a-z0-9][a-z0-9._-]*$/i.test(s.ID)) {
      notifications.show({ color: 'red', title: 'Validation', message: 'ID must be alphanumeric (dash/underscore/dot allowed), starting with a letter or digit.' });
      return;
    }
    if (!s.SourceDir.trim()) {
      notifications.show({ color: 'red', title: 'Validation', message: 'Source directory is required.' });
      return;
    }
    const payload = new main.BuildRecipe({
      ID: s.ID.trim(),
      DisplayName: s.DisplayName.trim(),
      SourceDir: s.SourceDir.trim(),
      SourceRepo: s.SourceRepo.trim(),
      GitRef: s.GitRef.trim(),
      Backend: s.Backend,
      CMakeFlags: s.CMakeFlags,
      BuildDir: s.BuildDir.trim(),
      Jobs: s.Jobs,
    });
    setSaving(true);
    try {
      if (isEdit && recipe) {
        await UpdateBuildRecipe(recipe.ID, payload);
      } else {
        await CreateBuildRecipe(payload);
      }
      onSaved();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Save failed', message: String(e?.message ?? e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={isEdit ? `Edit recipe · ${recipe?.ID}` : 'New build recipe'} size="lg" centered>
      <Stack gap="sm">
        {suggestions.length > 0 && (
          <Select
            label="Prefill from a detected-hardware suggestion"
            description="Fills backend + cmake flags. You still set the source directory."
            placeholder="(optional)"
            data={suggestions.map((x) => ({ value: x.ID, label: x.DisplayName || x.ID }))}
            onChange={(v) => v && applySuggestion(v)}
            clearable
          />
        )}
        <Group grow align="end">
          <TextInput
            label="ID"
            description="Stable identifier — can't be changed after creation."
            placeholder="cuda12-default"
            value={s.ID}
            onChange={(e) => up('ID', e.currentTarget.value)}
            disabled={isEdit}
            required
          />
          <TextInput label="Display name (optional)" placeholder="CUDA 12 — mainline" value={s.DisplayName} onChange={(e) => up('DisplayName', e.currentTarget.value)} />
        </Group>

        <TextInput
          label="Source directory"
          description="An existing llama.cpp checkout, or where it should be cloned (if you set a git remote below)."
          placeholder="/home/me/src/llama.cpp"
          value={s.SourceDir}
          onChange={(e) => up('SourceDir', e.currentTarget.value)}
          required
          rightSectionWidth={58}
          rightSection={
            <Group gap={2} wrap="nowrap">
              <Tooltip label="Scan this directory (git remote + prior cmake flags)">
                <ActionIcon variant="subtle" onClick={() => doScan(s.SourceDir)} loading={scanning} disabled={!s.SourceDir.trim()}>
                  <IconSearch size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Browse…">
                <ActionIcon variant="subtle" onClick={pickDir}>
                  <IconFolder size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          }
        />
        {scanning && (
          <Text size="xs" c="dimmed" mt={-8}>
            scanning directory…
          </Text>
        )}
        {!scanning && scanInfo && (
          <Text size="xs" c={scanInfo.exists ? 'dimmed' : 'orange'} mt={-8} style={{ wordBreak: 'break-all' }}>
            {!scanInfo.exists
              ? 'directory not found yet — it will be created on clone if you set a git remote'
              : [
                  scanInfo.isGitRepo
                    ? scanInfo.gitRemote
                      ? `git remote: ${scanInfo.gitRemote}`
                      : 'git repo (no remote configured)'
                    : 'no .git here',
                  scanInfo.configuredBuildDir
                    ? `prior cmake build in ${scanInfo.configuredBuildDir}/ → imported ${scanInfo.cmakeFlags?.length ?? 0} flag(s)`
                    : 'no prior cmake configure found',
                ].join(' · ')}
          </Text>
        )}
        <Group grow>
          <TextInput
            label="Git remote (optional)"
            description="When set, the build clones (if the dir is empty) or fetches before building."
            placeholder="https://github.com/ggml-org/llama.cpp"
            value={s.SourceRepo}
            onChange={(e) => up('SourceRepo', e.currentTarget.value)}
          />
          <TextInput label="Git ref (optional)" placeholder="master / tag / commit" value={s.GitRef} onChange={(e) => up('GitRef', e.currentTarget.value)} />
        </Group>

        <Divider label="Compile" labelPosition="left" />
        <Group grow>
          <Select label="Backend (hint)" data={BACKEND_OPTIONS} value={s.Backend} onChange={(v) => up('Backend', v ?? '')} allowDeselect={false} />
          <TextInput label="Build subdir" description="Relative to source dir. Empty = “build”." placeholder="build" value={s.BuildDir} onChange={(e) => up('BuildDir', e.currentTarget.value)} />
          <NumberInput label="Parallel jobs" description="0 = let cmake/ninja decide." min={0} value={s.Jobs} onChange={(v) => up('Jobs', typeof v === 'number' ? v : parseInt(String(v), 10) || 0)} />
        </Group>
        <Box>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>
              CMake flags
            </Text>
            <Group gap={4}>
              <Tooltip label="Copy as a space-joined string">
                <ActionIcon size="sm" variant="subtle" onClick={copyFlags}>
                  <IconCopy size={13} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Paste a space-separated string">
                <ActionIcon size="sm" variant="subtle" onClick={pasteFlags}>
                  <IconClipboard size={13} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <TagsInput
            value={s.CMakeFlags}
            onChange={(v) => up('CMakeFlags', v)}
            placeholder="-DGGML_CUDA=ON"
            splitChars={[' ', ',']}
            styles={{ input: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }}
          />
        </Box>

        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {isEdit ? 'Save changes' : 'Create recipe'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
