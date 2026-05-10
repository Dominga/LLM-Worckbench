import { useEffect, useState } from 'react';
import { Modal, Stack, Group, TextInput, Button, Text, Select } from '@mantine/core';
import { MODES, MODE_BY_ID } from '../shell/types';

export type NewSessionModalProps = {
  opened: boolean;
  onClose: () => void;
  onCreate: (title: string, modeId: string) => Promise<void> | void;
};

export function NewSessionModal({ opened, onClose, onCreate }: NewSessionModalProps) {
  const [title, setTitle] = useState('New chat');
  const [modeId, setModeId] = useState(MODES[0].id);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setTitle('New chat');
    setModeId(MODES[0].id);
    setSubmitting(false);
  }, [opened]);

  const submit = async () => {
    const t = title.trim() || 'New chat';
    setSubmitting(true);
    try {
      await onCreate(t, modeId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const mode = MODE_BY_ID[modeId] || MODES[0];

  return (
    <Modal opened={opened} onClose={onClose} title="New chat" size="md" centered>
      <Stack gap="sm">
        <TextInput
          label="Title"
          placeholder="Marek's first weapon"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) submit();
          }}
          data-autofocus
          required
        />
        <Select
          label="Mode"
          description="Demo only — mode metadata is stored on the session, prompt injection lands in M3."
          data={MODES.map((m) => ({ value: m.id, label: m.name }))}
          value={modeId}
          onChange={(v) => setModeId(v ?? MODES[0].id)}
          allowDeselect={false}
          leftSection={
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: mode.color,
                display: 'inline-block',
              }}
            />
          }
        />
        <Text size="xs" c="dimmed">
          {mode.desc}
        </Text>
        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
