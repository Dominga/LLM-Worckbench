import { useState } from 'react';
import { Modal, Tabs, Text } from '@mantine/core';
import { RegistryPanel } from './RegistryPanel';

// SettingsModal is the catch-all for app-wide configuration surfaces.
// First tenant is the Registry tab (TD33b). Future TDs slot in their
// own tabs (TD23 general settings, etc.) without re-architecting.
export function SettingsModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'registry' | 'general'>('registry');
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="Settings" centered>
      <Tabs value={tab} onChange={(v) => setTab((v as 'registry' | 'general') ?? 'registry')}>
        <Tabs.List>
          <Tabs.Tab value="registry">Registry</Tabs.Tab>
          <Tabs.Tab value="general">General</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="registry" pt="md">
          <RegistryPanel />
        </Tabs.Panel>
        <Tabs.Panel value="general" pt="md">
          <Text size="sm" c="dimmed">
            General app settings (theme, startup behaviour, telemetry) live
            here once TD23 lands.
          </Text>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
