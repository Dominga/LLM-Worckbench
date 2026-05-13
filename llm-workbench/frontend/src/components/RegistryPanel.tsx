import { useEffect, useMemo, useState } from 'react';
import {
  Group,
  Stack,
  Text,
  TextInput,
  Select,
  Button,
  ActionIcon,
  Loader,
  Code,
  Divider,
  ScrollArea,
  Badge,
  Tooltip,
} from '@mantine/core';
import {
  IconRefresh,
  IconPlus,
  IconTrash,
  IconDownload,
  IconCircleCheck,
  IconExternalLink,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  ListRegistrySources,
  AddRegistrySource,
  RemoveRegistrySource,
  RefreshRegistrySource,
  RefreshAllRegistrySources,
  BrowseRegistry,
  InstallRegistryArtifact,
  UninstallRegistryArtifact,
  ListInstalledArtifacts,
} from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';
import { V5 } from '../theme';

// Single installed-id key used to detect "already installed" + drive
// the uninstall/update labels. Combination of type+id is unique in
// the ledger.
const itemKey = (typ: string, id: string) => `${typ}:${id}`;

export function RegistryPanel() {
  const [sources, setSources] = useState<main.RegistrySource[]>([]);
  const [installed, setInstalled] = useState<main.InstalledArtifact[]>([]);
  const [artifacts, setArtifacts] = useState<main.RegistryArtifact[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'mode' | 'family'>('all');
  const [selectedId, setSelectedId] = useState<string>('');
  // Add-source inline form.
  const [newName, setNewName] = useState('');
  const [newURL, setNewURL] = useState('');

  const refreshAll = async () => {
    const [srcs, ins, arts] = await Promise.all([
      ListRegistrySources(),
      ListInstalledArtifacts(),
      BrowseRegistry(
        new main.BrowseFilter({
          type: typeFilter === 'all' ? '' : typeFilter,
          query,
        }),
      ),
    ]);
    setSources(srcs ?? []);
    setInstalled(ins ?? []);
    setArtifacts(arts ?? []);
  };

  useEffect(() => {
    refreshAll().catch((e) =>
      notifications.show({
        color: 'red',
        title: 'Load registry failed',
        message: String(e?.message ?? e),
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-browse on filter changes (cheap — no network).
  useEffect(() => {
    BrowseRegistry(
      new main.BrowseFilter({
        type: typeFilter === 'all' ? '' : typeFilter,
        query,
      }),
    )
      .then((arts) => setArtifacts(arts ?? []))
      .catch(() => {});
  }, [typeFilter, query]);

  const installedMap = useMemo(() => {
    const m = new Map<string, main.InstalledArtifact>();
    for (const it of installed) m.set(itemKey(it.type, it.id), it);
    return m;
  }, [installed]);

  const onRefreshAll = async () => {
    setBusy(true);
    try {
      const errs = await RefreshAllRegistrySources();
      const failed = Object.entries(errs).filter(([, v]) => v);
      if (failed.length > 0) {
        notifications.show({
          color: 'yellow',
          title: 'Some sources failed to refresh',
          message: failed.map(([k, v]) => `${k}: ${v}`).join('\n'),
        });
      }
      await refreshAll();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Refresh failed', message: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const onAddSource = async () => {
    if (!newName.trim() || !newURL.trim()) return;
    setBusy(true);
    try {
      await AddRegistrySource(newName.trim(), newURL.trim());
      setNewName('');
      setNewURL('');
      await refreshAll();
      notifications.show({ color: 'teal', title: 'Source added', message: 'Click Refresh to fetch its index.' });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Add failed', message: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const onRemoveSource = async (id: string) => {
    if (!window.confirm(`Remove source "${id}"? Already-installed artifacts stay on disk.`)) return;
    setBusy(true);
    try {
      await RemoveRegistrySource(id);
      await refreshAll();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Remove failed', message: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const onRefreshSource = async (id: string) => {
    setBusy(true);
    try {
      await RefreshRegistrySource(id);
      await refreshAll();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Refresh failed', message: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const onInstall = async (a: main.RegistryArtifact) => {
    setBusy(true);
    try {
      await InstallRegistryArtifact(a.source ?? '', a.id, a.version);
      await refreshAll();
      notifications.show({
        color: 'teal',
        title: 'Installed',
        message: `${a.type} ${a.id} ${a.version}`,
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Install failed', message: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const onUninstall = async (typ: string, id: string) => {
    if (!window.confirm(`Uninstall ${typ} "${id}"? The files will be removed.`)) return;
    setBusy(true);
    try {
      await UninstallRegistryArtifact(typ, id);
      await refreshAll();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Uninstall failed', message: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const selected = artifacts.find((a) => itemKey(a.type, a.id) === selectedId);

  return (
    <Stack gap="md" style={{ minHeight: 540 }}>
      {/* Sources strip */}
      <div>
        <Group justify="space-between" mb={6}>
          <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
            Sources
          </Text>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconRefresh size={12} />}
            onClick={onRefreshAll}
            loading={busy}
          >
            Refresh all
          </Button>
        </Group>
        <Stack gap={4}>
          {sources.length === 0 && (
            <Text size="xs" c="dimmed" fs="italic">
              No subscribed sources. Add one below to start.
            </Text>
          )}
          {sources.map((s) => (
            <Group key={s.id} gap={6} wrap="nowrap">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {s.name}{' '}
                  <Text span size="xs" c="dimmed" ff="ui-monospace, monospace">
                    {s.id}
                  </Text>
                </Text>
                <Text size="xs" c="dimmed" ff="ui-monospace, monospace" truncate>
                  {s.url}
                </Text>
              </div>
              <Tooltip label="Refresh this source">
                <ActionIcon variant="subtle" onClick={() => onRefreshSource(s.id)} disabled={busy}>
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Open in browser">
                <ActionIcon variant="subtle" component="a" href={s.url} target="_blank">
                  <IconExternalLink size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Remove source">
                <ActionIcon variant="subtle" color="red" onClick={() => onRemoveSource(s.id)} disabled={busy}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))}
        </Stack>
        <Group gap={6} mt={8} wrap="nowrap">
          <TextInput
            size="xs"
            placeholder="Name (e.g. Community Mods)"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <TextInput
            size="xs"
            placeholder="https://raw.../index.json"
            value={newURL}
            onChange={(e) => setNewURL(e.currentTarget.value)}
            style={{ flex: 2 }}
          />
          <Button
            size="compact-xs"
            leftSection={<IconPlus size={12} />}
            onClick={onAddSource}
            disabled={!newName.trim() || !newURL.trim() || busy}
          >
            Add
          </Button>
        </Group>
      </div>

      <Divider />

      {/* Browse */}
      <div>
        <Group justify="space-between" mb={6}>
          <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
            Available
          </Text>
          {busy && <Loader size="xs" />}
        </Group>
        <Group gap={6} mb={6}>
          <TextInput
            size="xs"
            placeholder="Search id or description…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Select
            size="xs"
            data={[
              { value: 'all', label: 'All types' },
              { value: 'mode', label: 'Modes' },
              { value: 'family', label: 'Families' },
            ]}
            value={typeFilter}
            onChange={(v) => setTypeFilter((v as 'all' | 'mode' | 'family') ?? 'all')}
            allowDeselect={false}
            w={140}
          />
        </Group>
        <Group align="flex-start" gap="md" wrap="nowrap">
          <ScrollArea h={260} style={{ flex: 1, minWidth: 0, border: `1px solid ${V5.border}`, borderRadius: 6 }}>
            {artifacts.length === 0 && (
              <Text size="xs" c="dimmed" fs="italic" p="sm">
                No artifacts. Refresh sources to populate the index.
              </Text>
            )}
            {artifacts.map((a) => {
              const key = itemKey(a.type, a.id);
              const inst = installedMap.get(key);
              const updateAvailable = inst && inst.version !== a.version;
              return (
                <button
                  key={`${a.source}-${key}`}
                  onClick={() => setSelectedId(key)}
                  style={{
                    width: '100%',
                    display: 'block',
                    textAlign: 'left',
                    padding: '6px 10px',
                    background: selectedId === key ? V5.surface : 'transparent',
                    border: 'none',
                    borderBottom: `1px solid ${V5.borderSoft}`,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <Group gap={6} wrap="nowrap">
                    <Badge size="xs" variant="light" color={a.type === 'mode' ? 'violet' : 'cyan'}>
                      {a.type}
                    </Badge>
                    <Text size="sm" fw={500} ff="ui-monospace, monospace" style={{ flex: 1 }} truncate>
                      {a.id}
                    </Text>
                    <Text size="xs" c="dimmed">
                      v{a.version}
                    </Text>
                    {inst && !updateAvailable && (
                      <IconCircleCheck size={12} color={V5.ok} aria-label="installed" />
                    )}
                    {updateAvailable && (
                      <Badge size="xs" color="orange">
                        update
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    {a.description || '—'}
                  </Text>
                </button>
              );
            })}
          </ScrollArea>
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selected && (
              <Text size="xs" c="dimmed" fs="italic">
                Pick an artifact to see details.
              </Text>
            )}
            {selected && <ArtifactDetail artifact={selected} installed={installedMap.get(itemKey(selected.type, selected.id))} onInstall={onInstall} onUninstall={onUninstall} busy={busy} />}
          </div>
        </Group>
      </div>

      <Divider />

      {/* Installed list */}
      <div>
        <Text size="xs" tt="uppercase" c="dimmed" fw={600} mb={6}>
          Installed
        </Text>
        {installed.length === 0 && (
          <Text size="xs" c="dimmed" fs="italic">
            Nothing installed yet.
          </Text>
        )}
        {installed.map((it) => (
          <Group key={itemKey(it.type, it.id)} gap={6} mb={2} wrap="nowrap">
            <Badge size="xs" variant="light" color={it.type === 'mode' ? 'violet' : 'cyan'}>
              {it.type}
            </Badge>
            <Text size="sm" ff="ui-monospace, monospace" fw={500} style={{ flex: 1 }} truncate>
              {it.id}
            </Text>
            <Text size="xs" c="dimmed">
              v{it.version}
            </Text>
            <Text size="xs" c="dimmed">
              {it.sourceId}
            </Text>
            <ActionIcon variant="subtle" color="red" onClick={() => onUninstall(it.type, it.id)} disabled={busy}>
              <IconTrash size={13} />
            </ActionIcon>
          </Group>
        ))}
      </div>
    </Stack>
  );
}

function ArtifactDetail({
  artifact,
  installed,
  onInstall,
  onUninstall,
  busy,
}: {
  artifact: main.RegistryArtifact;
  installed?: main.InstalledArtifact;
  onInstall: (a: main.RegistryArtifact) => void;
  onUninstall: (typ: string, id: string) => void;
  busy: boolean;
}) {
  const updateAvailable = !!installed && installed.version !== artifact.version;
  return (
    <Stack gap={6}>
      <Group gap={6}>
        <Text size="md" fw={600}>
          {artifact.id}
        </Text>
        <Badge size="xs" variant="light" color={artifact.type === 'mode' ? 'violet' : 'cyan'}>
          {artifact.type}
        </Badge>
        <Text size="xs" c="dimmed">
          v{artifact.version}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        from {artifact.sourceName || artifact.source}
        {artifact.author ? ` · ${artifact.author}` : ''}
      </Text>
      {artifact.description && <Text size="sm">{artifact.description}</Text>}
      <Group gap={4}>
        {(artifact.tags || []).map((t) => (
          <Badge key={t} size="xs" variant="default">
            {t}
          </Badge>
        ))}
      </Group>
      {(artifact.recommended_for || []).length > 0 && (
        <Text size="xs" c="dimmed">
          Recommended for: {(artifact.recommended_for || []).join(', ')}
        </Text>
      )}
      {artifact.preview && (
        <Code block style={{ maxHeight: 140, overflow: 'auto', fontSize: 11 }}>
          {artifact.preview}
        </Code>
      )}
      <Group gap={6}>
        {!installed && (
          <Button size="compact-xs" leftSection={<IconDownload size={12} />} onClick={() => onInstall(artifact)} disabled={busy}>
            Install
          </Button>
        )}
        {installed && updateAvailable && (
          <Button size="compact-xs" color="orange" leftSection={<IconDownload size={12} />} onClick={() => onInstall(artifact)} disabled={busy}>
            Update to v{artifact.version}
          </Button>
        )}
        {installed && (
          <Button size="compact-xs" variant="default" color="red" leftSection={<IconTrash size={12} />} onClick={() => onUninstall(artifact.type, artifact.id)} disabled={busy}>
            Uninstall
          </Button>
        )}
      </Group>
    </Stack>
  );
}
