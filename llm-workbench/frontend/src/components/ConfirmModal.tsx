import { ReactNode, useState } from 'react';
import { Modal, Button, Group, Stack, Text } from '@mantine/core';

export type ConfirmModalProps = {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
};

// Drop-in replacement for window.confirm — Mantine-themed, dark-friendly,
// supports async onConfirm with a busy state.
export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
}: ConfirmModalProps) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="sm" centered>
      <Stack gap="md">
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {message}
        </Text>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button color={variant === 'danger' ? 'red' : 'brand'} onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
