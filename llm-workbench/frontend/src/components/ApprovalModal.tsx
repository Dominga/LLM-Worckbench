import { useEffect, useState } from 'react';
import { Modal, Button, Group, Text, Box, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RespondToApproval } from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

type ApprovalRequest = {
  id: string;
  streamId: string;
  tool: string;
  args: string;
  path?: string;
  oldContent?: string;
  newContent?: string;
  createdAt?: string;
};

// ApprovalModal subscribes to the global `agent:approval:request`
// event and pops a confirmation modal whenever a write tool needs
// user sign-off (mode.Approval == "always"). Currently handles one
// pending request at a time — concurrent writes from a single agent
// loop are sequential by design (the loop awaits each decision
// before requesting the next), so a queue isn't needed yet.
export function ApprovalModal() {
  const [req, setReq] = useState<ApprovalRequest | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    EventsOn('agent:approval:request', (r: ApprovalRequest) => {
      setReq(r);
      setReason('');
    });
    return () => EventsOff('agent:approval:request');
  }, []);

  const respond = async (accept: boolean) => {
    if (!req || busy) return;
    setBusy(true);
    try {
      await RespondToApproval(req.id, accept, reason);
      setReq(null);
    } catch (e: any) {
      notifications.show({
        color: 'red',
        title: 'Approval failed',
        message: String(e?.message ?? e),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!req) return null;

  return (
    <Modal
      opened
      onClose={() => respond(false)}
      title={
        <Text fw={600} size="sm" ff="ui-monospace, monospace">
          Approve {req.tool}
          {req.path ? ` · ${req.path}` : ''}
        </Text>
      }
      size="xl"
      centered
      overlayProps={{ opacity: 0.65 }}
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
    >
      {req.tool === 'edit_file' ? (
        <Box>
          <Group grow align="stretch" gap="sm">
            <Box>
              <Text size="xs" c="dimmed" mb={4}>
                old · {(req.oldContent ?? '').length} chars
              </Text>
              <Textarea
                value={req.oldContent ?? ''}
                readOnly
                autosize
                minRows={6}
                maxRows={20}
                styles={{ input: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }}
              />
            </Box>
            <Box>
              <Text size="xs" c="dimmed" mb={4}>
                new · {(req.newContent ?? '').length} chars
              </Text>
              <Textarea
                value={req.newContent ?? ''}
                readOnly
                autosize
                minRows={6}
                maxRows={20}
                styles={{ input: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }}
              />
            </Box>
          </Group>
        </Box>
      ) : (
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            arguments
          </Text>
          <Textarea
            value={req.args}
            readOnly
            autosize
            minRows={4}
            maxRows={15}
            styles={{ input: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }}
          />
        </Box>
      )}

      <Textarea
        label="Reason (optional, sent to the model on reject)"
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
        autosize
        minRows={1}
        maxRows={3}
        mt="md"
        placeholder="why reject?"
      />

      <Group justify="flex-end" mt="md">
        <Button variant="subtle" color="red" onClick={() => respond(false)} disabled={busy}>
          Reject
        </Button>
        <Button onClick={() => respond(true)} loading={busy}>
          Apply
        </Button>
      </Group>
    </Modal>
  );
}
