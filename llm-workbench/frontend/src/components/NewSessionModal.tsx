import { useEffect, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  TextInput,
  NumberInput,
  Switch,
  Button,
  Text,
  Select,
  Divider,
} from '@mantine/core';
import { Mode, MODES, MODE_BY_ID } from '../shell/types';
import { ListModes } from '../../wailsjs/go/main/App';

export type NewSessionModalProps = {
  opened: boolean;
  activeProjectId?: string;
  onClose: () => void;
  // params is the captured ModeParam form values (M4 PR26). Empty
  // object when the mode declares no params.
  onCreate: (title: string, modeId: string, params: Record<string, any>) => Promise<void> | void;
};

export function NewSessionModal({ opened, activeProjectId, onClose, onCreate }: NewSessionModalProps) {
  // Modes come from the backend (builtin + global + project-local
  // merge from PR16/PR25). Falls back to the static MODES const while
  // the call is in flight or when there's no project context.
  const [modes, setModes] = useState<Mode[]>(MODES);
  const [title, setTitle] = useState('New chat');
  const [modeId, setModeId] = useState<string>(modes[0]?.id ?? 'chat-only');
  const [paramVals, setParamVals] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setTitle('New chat');
    setSubmitting(false);
    setParamVals({});
    (async () => {
      try {
        const list = (await ListModes(activeProjectId ?? '')) as Mode[];
        if (list && list.length > 0) {
          setModes(list);
          setModeId((cur) => (list.some((m) => m.id === cur) ? cur : list[0].id));
        }
      } catch {
        /* keep the static fallback */
      }
    })();
  }, [opened, activeProjectId]);

  const mode = modes.find((m) => m.id === modeId) || MODE_BY_ID[modeId] || MODES[0];
  const params = (mode as any).params || [];

  // Reset param form whenever the selected mode changes — seed each
  // field from its declared default (or a sensible empty value).
  useEffect(() => {
    if (!params || params.length === 0) {
      setParamVals({});
      return;
    }
    const seeded: Record<string, any> = {};
    for (const p of params) {
      if (p.default !== undefined && p.default !== null) {
        seeded[p.name] = p.default;
      } else {
        seeded[p.name] = paramTypeDefault(p.type);
      }
    }
    setParamVals(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeId, modes]);

  const submit = async () => {
    const t = title.trim() || 'New chat';
    // Validate required params before firing.
    for (const p of params) {
      if (p.required) {
        const v = paramVals[p.name];
        if (v === undefined || v === null || v === '') {
          return; // silent — the form already marks required fields
        }
      }
    }
    setSubmitting(true);
    try {
      await onCreate(t, modeId, paramVals);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const setParam = (name: string, v: any) => {
    setParamVals((cur) => ({ ...cur, [name]: v }));
  };

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
          description="Mode drives system prompt, tool whitelist, and approval policy."
          data={modes.map((m) => ({ value: m.id, label: m.name }))}
          value={modeId}
          onChange={(v) => setModeId(v ?? modes[0]?.id ?? 'chat-only')}
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

        {params.length > 0 && (
          <>
            <Divider label="Mode parameters" labelPosition="left" />
            {params.map((p: any) => (
              <ParamField
                key={p.name}
                param={p}
                value={paramVals[p.name]}
                onChange={(v) => setParam(p.name, v)}
              />
            ))}
          </>
        )}

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

function paramTypeDefault(t: string): any {
  switch (t) {
    case 'bool':
      return false;
    case 'int':
    case 'number':
      return 0;
    default:
      return '';
  }
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: { name: string; type: string; required?: boolean; description?: string; default?: any };
  value: any;
  onChange: (v: any) => void;
}) {
  const label = param.name + (param.required ? ' *' : '');
  switch (param.type) {
    case 'bool':
      return (
        <Switch
          label={label}
          description={param.description}
          checked={!!value}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case 'int':
    case 'number':
      return (
        <NumberInput
          label={label}
          description={param.description}
          value={value ?? 0}
          onChange={(v) => onChange(typeof v === 'number' ? v : parseFloat(String(v)) || 0)}
          required={param.required}
          decimalScale={param.type === 'int' ? 0 : undefined}
        />
      );
    default:
      return (
        <TextInput
          label={label}
          description={param.description}
          value={value ?? ''}
          onChange={(e) => onChange(e.currentTarget.value)}
          required={param.required}
        />
      );
  }
}
