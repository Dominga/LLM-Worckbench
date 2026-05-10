import { useEffect, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  TextInput,
  NumberInput,
  Select,
  Switch,
  Button,
  ActionIcon,
  TagsInput,
  Divider,
  Text,
  Box,
} from '@mantine/core';
import { IconFolder, IconFile } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  CreateProfile,
  UpdateProfile,
  PickFile,
  PickDirectory,
} from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';
import { Profile } from '../shell/types';

type Mode = 'create' | 'edit';

export type ProfileFormProps = {
  opened: boolean;
  mode: Mode;
  initial?: Profile;
  // All known profiles — needed to populate the embed-profile sidecar
  // selector with kind=embed candidates only.
  profiles: Profile[];
  onClose: () => void;
  onSaved: (p: Profile) => void;
};

type FormState = {
  ID: string;
  Kind: 'chat' | 'embed' | 'rerank';
  BinPath: string;
  BinCwd: string;
  ModelPath: string;
  MMProjPath: string;
  LaunchEmbedding: boolean;
  EmbedProfileID: string;
  Host: string;
  Port: number;
  CtxSize: number;
  NGL: number;
  ExtraArgs: string[];
  Autostart: boolean;
  HealthTimeoutSec: number;
  SamplingTemperature: number;
  SamplingTopP: number;
  SamplingMinP: number;
  SamplingRepeatPenalty: number;
};

function emptyForm(): FormState {
  return {
    ID: '',
    Kind: 'chat',
    BinPath: '',
    BinCwd: '',
    ModelPath: '',
    MMProjPath: '',
    LaunchEmbedding: false,
    EmbedProfileID: '',
    Host: '127.0.0.1',
    Port: 18080,
    CtxSize: 0,
    NGL: 0,
    ExtraArgs: [],
    Autostart: false,
    HealthTimeoutSec: 120,
    SamplingTemperature: 0.7,
    SamplingTopP: 0.95,
    SamplingMinP: 0.05,
    SamplingRepeatPenalty: 1.1,
  };
}

function fromProfile(p: Profile): FormState {
  return {
    ID: p.ID,
    Kind: (p.Kind as FormState['Kind']) || 'chat',
    BinPath: p.BinPath || '',
    BinCwd: p.BinCwd || '',
    ModelPath: p.ModelPath || '',
    MMProjPath: (p as any).MMProjPath || '',
    LaunchEmbedding: (p as any).LaunchEmbedding || false,
    EmbedProfileID: (p as any).EmbedProfileID || '',
    Host: p.Host || '127.0.0.1',
    Port: p.Port || 18080,
    CtxSize: p.CtxSize || 0,
    NGL: p.NGL || 0,
    ExtraArgs: p.ExtraArgs || [],
    Autostart: p.Autostart || false,
    HealthTimeoutSec: p.HealthTimeoutSec || 120,
    SamplingTemperature: p.Sampling?.Temperature ?? 0.7,
    SamplingTopP: p.Sampling?.TopP ?? 0.95,
    SamplingMinP: p.Sampling?.MinP ?? 0.05,
    SamplingRepeatPenalty: p.Sampling?.RepeatPenalty ?? 1.1,
  };
}

function toProfile(f: FormState): Profile {
  // Use the generated class so Wails serializes via convertValues correctly.
  const p = new main.Profile({
    ID: f.ID.trim(),
    Kind: f.Kind,
    BinPath: f.BinPath.trim(),
    BinCwd: f.BinCwd.trim(),
    ModelPath: f.ModelPath.trim(),
    MMProjPath: f.MMProjPath.trim(),
    LaunchEmbedding: f.LaunchEmbedding,
    EmbedProfileID: f.LaunchEmbedding ? f.EmbedProfileID : '',
    Host: f.Host.trim() || '127.0.0.1',
    Port: f.Port,
    CtxSize: f.CtxSize,
    NGL: f.NGL,
    ExtraArgs: f.ExtraArgs,
    Autostart: f.Autostart,
    HealthTimeoutSec: f.HealthTimeoutSec,
    Sampling: new main.Sampling({
      Temperature: f.SamplingTemperature,
      TopP: f.SamplingTopP,
      MinP: f.SamplingMinP,
      RepeatPenalty: f.SamplingRepeatPenalty,
    }),
  });
  return p;
}

function validate(f: FormState, mode: Mode): string | null {
  if (mode === 'create') {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(f.ID)) {
      return 'ID must be alphanumeric (dash/underscore allowed) and start with a letter or digit.';
    }
  }
  if (!f.BinPath) return 'Binary path is required.';
  if (!f.ModelPath) return 'Model path is required.';
  if (f.Port < 1 || f.Port > 65535) return 'Port must be between 1 and 65535.';
  return null;
}

export function ProfileForm({ opened, mode, initial, profiles, onClose, onSaved }: ProfileFormProps) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setForm(initial && mode === 'edit' ? fromProfile(initial) : emptyForm());
  }, [opened, mode, initial]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const browseFile = async (
    title: string,
    label: string,
    pattern: string,
    key: keyof FormState,
  ) => {
    try {
      const path = await PickFile(title, label, pattern);
      if (path) update(key, path as any);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Picker failed', message: String(e) });
    }
  };

  const browseDir = async (title: string, key: keyof FormState) => {
    try {
      const path = await PickDirectory(title);
      if (path) update(key, path as any);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Picker failed', message: String(e) });
    }
  };

  const submit = async () => {
    const err = validate(form, mode);
    if (err) {
      notifications.show({ color: 'red', title: 'Validation', message: err });
      return;
    }
    const payload = toProfile(form);
    setSaving(true);
    try {
      let saved: Profile;
      if (mode === 'create') {
        saved = await CreateProfile(payload);
      } else if (initial) {
        saved = await UpdateProfile(initial.ID, payload);
      } else {
        notifications.show({ color: 'red', title: 'Edit', message: 'No profile to update.' });
        setSaving(false);
        return;
      }
      onSaved(saved);
      onClose();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Save failed', message: String(e?.message ?? e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={mode === 'create' ? 'New profile' : `Edit profile · ${initial?.ID ?? ''}`}
      size="lg"
      centered
      overlayProps={{ opacity: 0.55 }}
    >
      <Stack gap="sm">
        <Group grow align="end">
          <TextInput
            label="ID"
            description="Stable identifier — can't be changed after creation."
            placeholder="qwen-32b-cuda-prod"
            value={form.ID}
            onChange={(e) => update('ID', e.currentTarget.value)}
            disabled={mode === 'edit'}
            required
          />
          <Select
            label="Kind"
            data={[
              { value: 'chat', label: 'chat' },
              { value: 'embed', label: 'embed' },
              { value: 'rerank', label: 'rerank' },
            ]}
            value={form.Kind}
            onChange={(v) => update('Kind', (v ?? 'chat') as FormState['Kind'])}
            allowDeselect={false}
          />
        </Group>

        <Divider label="Binary & model" labelPosition="left" />

        <PathField
          label="llama-server binary"
          value={form.BinPath}
          onChange={(v) => update('BinPath', v)}
          onBrowse={() =>
            browseFile('Pick llama-server binary', 'llama-server', '*', 'BinPath')
          }
          icon="file"
          required
        />
        <PathField
          label="Working directory (optional)"
          value={form.BinCwd}
          onChange={(v) => update('BinCwd', v)}
          onBrowse={() => browseDir('Pick working directory', 'BinCwd')}
          icon="dir"
        />
        <PathField
          label="Model file (.gguf)"
          value={form.ModelPath}
          onChange={(v) => update('ModelPath', v)}
          onBrowse={() => browseFile('Pick GGUF model', 'GGUF', '*.gguf', 'ModelPath')}
          icon="file"
          required
        />

        <Divider label="Optional companion models" labelPosition="left" />

        <PathField
          label="Vision projector (--mmproj)"
          value={form.MMProjPath}
          onChange={(v) => update('MMProjPath', v)}
          onBrowse={() =>
            browseFile('Pick mmproj model', 'GGUF mmproj', '*.gguf', 'MMProjPath')
          }
          icon="file"
        />
        <Text size="xs" c="dimmed" mt={-8}>
          When set, llama-server starts in multimodal mode (image input on
          /v1/chat/completions).
        </Text>

        {form.Kind === 'chat' && (
          <>
            <Switch
              label="Run embeddings sidecar"
              description="On Start, also launch a separate embed profile (kind=embed) so RAG / embeddings endpoint is available alongside chat."
              checked={form.LaunchEmbedding}
              onChange={(e) => update('LaunchEmbedding', e.currentTarget.checked)}
            />
            {form.LaunchEmbedding && (
              <Select
                label="Embed profile"
                description="Pick an existing kind=embed profile to launch as sidecar."
                data={profiles
                  .filter((p) => p.Kind === 'embed')
                  .map((p) => ({ value: p.ID, label: p.ID }))}
                value={form.EmbedProfileID || null}
                onChange={(v) => update('EmbedProfileID', v ?? '')}
                placeholder={
                  profiles.some((p) => p.Kind === 'embed')
                    ? 'Select…'
                    : 'No embed profiles yet — create one first.'
                }
                disabled={!profiles.some((p) => p.Kind === 'embed')}
                allowDeselect
                searchable
              />
            )}
          </>
        )}

        <Divider label="Network & runtime" labelPosition="left" />

        <Group grow>
          <TextInput
            label="Host"
            value={form.Host}
            onChange={(e) => update('Host', e.currentTarget.value)}
          />
          <NumberInput
            label="Port"
            min={1}
            max={65535}
            value={form.Port}
            onChange={(v) => update('Port', typeof v === 'number' ? v : parseInt(String(v), 10) || 0)}
          />
        </Group>

        <Group grow>
          <NumberInput
            label="Context size"
            description="-c flag. 0 = use server default."
            min={0}
            value={form.CtxSize}
            onChange={(v) => update('CtxSize', typeof v === 'number' ? v : parseInt(String(v), 10) || 0)}
          />
          <NumberInput
            label="GPU layers (NGL)"
            description="-ngl. 0 = CPU only."
            min={0}
            value={form.NGL}
            onChange={(v) => update('NGL', typeof v === 'number' ? v : parseInt(String(v), 10) || 0)}
          />
        </Group>

        <TagsInput
          label="Extra args"
          description="Space- or comma-separated CLI flags appended after the standard ones (e.g. --fit, --flash-attn)."
          value={form.ExtraArgs}
          onChange={(v) => update('ExtraArgs', v)}
          splitChars={[' ', ',']}
        />

        <Group grow>
          <NumberInput
            label="Health timeout (s)"
            min={5}
            max={3600}
            value={form.HealthTimeoutSec}
            onChange={(v) =>
              update('HealthTimeoutSec', typeof v === 'number' ? v : parseInt(String(v), 10) || 120)
            }
          />
          <Switch
            label="Autostart"
            description="Spawn this profile on app launch."
            checked={form.Autostart}
            onChange={(e) => update('Autostart', e.currentTarget.checked)}
            mt={22}
          />
        </Group>

        <Divider label="Sampling defaults" labelPosition="left" />

        <Group grow>
          <NumberInput
            label="Temperature"
            min={0}
            max={2}
            step={0.05}
            decimalScale={2}
            value={form.SamplingTemperature}
            onChange={(v) =>
              update('SamplingTemperature', typeof v === 'number' ? v : parseFloat(String(v)) || 0)
            }
          />
          <NumberInput
            label="Top-p"
            min={0}
            max={1}
            step={0.01}
            decimalScale={2}
            value={form.SamplingTopP}
            onChange={(v) =>
              update('SamplingTopP', typeof v === 'number' ? v : parseFloat(String(v)) || 0)
            }
          />
        </Group>
        <Group grow>
          <NumberInput
            label="Min-p"
            min={0}
            max={1}
            step={0.01}
            decimalScale={2}
            value={form.SamplingMinP}
            onChange={(v) =>
              update('SamplingMinP', typeof v === 'number' ? v : parseFloat(String(v)) || 0)
            }
          />
          <NumberInput
            label="Repeat penalty"
            min={0}
            max={2}
            step={0.05}
            decimalScale={2}
            value={form.SamplingRepeatPenalty}
            onChange={(v) =>
              update('SamplingRepeatPenalty', typeof v === 'number' ? v : parseFloat(String(v)) || 0)
            }
          />
        </Group>

        {form.Kind === 'embed' && (
          <Box bg="dark.6" p="xs" style={{ borderRadius: 6 }}>
            <Text size="xs" c="dimmed">
              <code>--embedding</code> is added automatically for embed profiles.
            </Text>
          </Box>
        )}
        {form.Kind === 'rerank' && (
          <Box bg="dark.6" p="xs" style={{ borderRadius: 6 }}>
            <Text size="xs" c="dimmed">
              <code>--reranking</code> is added automatically for rerank profiles.
            </Text>
          </Box>
        )}

        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {mode === 'create' ? 'Create profile' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function PathField({
  label,
  value,
  onChange,
  onBrowse,
  icon,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
  icon: 'file' | 'dir';
  required?: boolean;
}) {
  return (
    <TextInput
      label={label}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      required={required}
      placeholder={icon === 'dir' ? '/path/to/dir' : '/path/to/file'}
      rightSection={
        <ActionIcon variant="subtle" onClick={onBrowse} title="Browse…">
          {icon === 'file' ? <IconFile size={14} /> : <IconFolder size={14} />}
        </ActionIcon>
      }
    />
  );
}
