import { useState } from 'react';
import { Modal, Tabs } from '@mantine/core';
import { RegistryPanel } from './RegistryPanel';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';

// SettingsModal is the catch-all for app-wide configuration surfaces.
// General hosts AppSettings (TD23); Registry hosts the external
// registry browser (TD33). Future panels slot in alongside without
// re-architecting.
export function SettingsModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'general' | 'registry'>('general');
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="Settings" centered>
      <Tabs value={tab} onChange={(v) => setTab((v as 'general' | 'registry') ?? 'general')}>
        <Tabs.List>
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="registry">Registry</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general" pt="md">
          <GeneralSettingsPanel />
        </Tabs.Panel>
        <Tabs.Panel value="registry" pt="md">
          <RegistryPanel />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
