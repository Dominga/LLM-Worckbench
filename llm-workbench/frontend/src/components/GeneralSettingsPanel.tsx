import { useEffect, useState } from 'react';
import { Button, Group, Select, Stack, Switch, Text, Loader } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { GetAppSettings, SaveAppSettings } from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';

// GeneralSettingsPanel hosts the app-wide preference form (TD23):
// theme, startup mode, registry refresh / auto-install policies,
// telemetry opt-in placeholder. Saves are eager — every toggle
// flushes to settings.toml so the user never has to remember a Save
// button. Theme + telemetry rows are persisted but UI-disabled in v1
// (only the dark theme renders correctly; telemetry pipeline is
// design-only per DESIGN §10.5).
export function GeneralSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<main.AppSettings | null>(null);

  useEffect(() => {
    GetAppSettings()
      .then((s) => setSettings(s))
      .catch((e) =>
        notifications.show({
          color: 'red',
          title: 'Load settings failed',
          message: String(e?.message ?? e),
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  const save = async (patch: Partial<main.AppSettings>) => {
    if (!settings) return;
    const next = new main.AppSettings({ ...settings, ...patch });
    setSettings(next);
    setSaving(true);
    try {
      await SaveAppSettings(next);
    } catch (e: any) {
      notifications.show({
        color: 'red',
        title: 'Save settings failed',
        message: String(e?.message ?? e),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) return <Loader size="sm" />;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" fw={500}>
            Startup
          </Text>
          <Text size="xs" c="dimmed">
            What the chat side shows on app launch.
          </Text>
        </div>
        <Select
          size="xs"
          w={220}
          data={[
            { value: 'blank', label: 'Blank chat (project-unbound)' },
            { value: 'reopen-last', label: 'Reopen last project' },
          ]}
          value={settings.startup}
          onChange={(v) => save({ startup: (v as 'blank' | 'reopen-last') ?? 'blank' })}
          allowDeselect={false}
        />
      </Group>

      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" fw={500}>
            Auto-refresh registry on launch
          </Text>
          <Text size="xs" c="dimmed">
            Fetches every subscribed source's index.json in the background.
          </Text>
        </div>
        <Switch
          checked={settings.autoRefreshRegistry}
          onChange={(e) => save({ autoRefreshRegistry: e.currentTarget.checked })}
        />
      </Group>

      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" fw={500}>
            Auto-install default artifacts on every launch
          </Text>
          <Text size="xs" c="dimmed">
            Reinstalls every <code>default_install</code> artifact missing from the modes / families
            dirs. Useful if you accidentally uninstall a default mode. Off by default — keep your
            install set explicit.
          </Text>
        </div>
        <Switch
          checked={settings.autoInstallDefaults}
          onChange={(e) => save({ autoInstallDefaults: e.currentTarget.checked })}
        />
      </Group>

      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" fw={500}>
            Theme
          </Text>
          <Text size="xs" c="dimmed">
            Only the dark theme is implemented in v1.
          </Text>
        </div>
        <Select
          size="xs"
          w={220}
          data={[{ value: 'dark', label: 'Dark' }]}
          value={settings.theme}
          onChange={() => {}}
          allowDeselect={false}
          disabled
        />
      </Group>

      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" fw={500}>
            Telemetry opt-in
          </Text>
          <Text size="xs" c="dimmed">
            No telemetry pipeline ships yet (DESIGN §10.5). The flag is persisted so the future
            implementation can read it.
          </Text>
        </div>
        <Switch
          checked={settings.telemetryOptIn}
          onChange={(e) => save({ telemetryOptIn: e.currentTarget.checked })}
          disabled
        />
      </Group>

      <Group justify="flex-end">
        <Button
          size="compact-xs"
          variant="default"
          loading={saving}
          onClick={() => GetAppSettings().then(setSettings)}
        >
          Reload
        </Button>
      </Group>
    </Stack>
  );
}
