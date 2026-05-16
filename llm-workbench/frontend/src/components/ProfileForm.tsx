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
  Textarea,
  Autocomplete,
  Divider,
  Text,
  Box,
} from '@mantine/core';
import { IconFolder, IconFile, IconSparkles } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  CreateProfile,
  UpdateProfile,
  PickFile,
  PickDirectory,
  ListBuilds,
  ListFamilies,
  DetectFamily,
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
  BuildID: string;
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
  ExtraArgsRaw: string;
  Autostart: boolean;
  HealthTimeoutSec: number;
  ToolMode: '' | 'native' | 'react' | 'none';
  Family: string;
  FamilyVersion: string;
  SamplingTemperature: number;
  SamplingTopP: number;
  SamplingMinP: number;
  SamplingRepeatPenalty: number;
};

function emptyForm(): FormState {
  return {
    ID: '',
    Kind: 'chat',
    BuildID: '',
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
    ExtraArgsRaw: '',
    Autostart: false,
    HealthTimeoutSec: 120,
    ToolMode: '',
    Family: '',
    FamilyVersion: '',
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
    BuildID: (p as any).BuildID || '',
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
    ExtraArgsRaw: (p.ExtraArgs || []).join(' '),
    Autostart: p.Autostart || false,
    HealthTimeoutSec: p.HealthTimeoutSec || 120,
    ToolMode: ((p as any).ToolMode || '') as FormState['ToolMode'],
    Family: (p as any).Family || '',
    FamilyVersion: (p as any).FamilyVersion || '',
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
    BuildID: f.BuildID.trim(),
    // build_id and bin_path are mutually exclusive in the UI: when a build
    // is picked, the manual path is dropped (and vice-versa).
    BinPath: f.BuildID.trim() ? '' : f.BinPath.trim(),
    BinCwd: f.BinCwd.trim(),
    ModelPath: f.ModelPath.trim(),
    MMProjPath: f.MMProjPath.trim(),
    LaunchEmbedding: f.LaunchEmbedding,
    EmbedProfileID: f.LaunchEmbedding ? f.EmbedProfileID : '',
    Host: f.Host.trim() || '127.0.0.1',
    Port: f.Port,
    CtxSize: f.CtxSize,
    NGL: f.NGL,
    ExtraArgs: f.ExtraArgsRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    Autostart: f.Autostart,
    HealthTimeoutSec: f.HealthTimeoutSec,
    ToolMode: f.ToolMode,
    Family: f.Family.trim(),
    FamilyVersion: f.FamilyVersion.trim(),
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
  if (!f.BuildID && !f.BinPath) return 'Pick a build or set a llama-server binary path.';
  if (!f.ModelPath) return 'Model path is required.';
  if (f.Port < 1 || f.Port > 65535) return 'Port must be between 1 and 65535.';
  return null;
}

export function ProfileForm({ opened, mode, initial, profiles, onClose, onSaved }: ProfileFormProps) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [builds, setBuilds] = useState<main.Build[]>([]);
  const [families, setFamilies] = useState<main.Family[]>([]);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!opened) return;
    // `initial` is honored in both modes so a Duplicate flow can prefill
    // every field while opening the form in create mode (caller is
    // expected to blank/rename the ID and bump the port before passing
    // the seed in).
    setForm(initial ? fromProfile(initial) : emptyForm());
    ListBuilds()
      .then((bs) => setBuilds(bs ?? []))
      .catch(() => setBuilds([]));
    ListFamilies()
      .then((fs) => setFamilies(fs ?? []))
      .catch(() => setFamilies([]));
  }, [opened, mode, initial]);

  const onDetectFamily = async () => {
    if (!form.ModelPath || detecting) return;
    setDetecting(true);
    try {
      const g = await DetectFamily(form.ModelPath);
      if (!g || !g.family) {
        notifications.show({
          color: 'yellow',
          title: 'Family not detected',
          message: g?.architecture
            ? `Architecture: ${g.architecture}. Pick a family manually.`
            : 'Could not read GGUF header. Pick a family manually.',
        });
        return;
      }
      setForm((f) => ({ ...f, Family: g.family, FamilyVersion: g.familyVersion || '' }));
      notifications.show({
        color: 'teal',
        title: 'Family detected',
        message: `${g.family}${g.familyVersion ? ' ' + g.familyVersion : ''} (${g.architecture || '?'})`,
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Detect failed', message: String(e?.message ?? e) });
    } finally {
      setDetecting(false);
    }
  };

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

        <Select
          label="Build"
          description="Use a llama.cpp Build managed on this tab, or pick “manual path” to point at a binary directly."
          data={[
            { value: '', label: '— manual binary path —' },
            ...builds.map((b) => ({
              value: b.ID,
              label: b.DisplayName || b.ID,
            })),
          ]}
          value={form.BuildID}
          onChange={(v) => update('BuildID', v ?? '')}
          allowDeselect={false}
          searchable={builds.length > 6}
        />
        {form.BuildID ? (
          <Text size="xs" c="dimmed" mt={-8}>
            Launch binary resolved from build{' '}
            <code>{form.BuildID}</code>
            {(() => {
              const b = builds.find((x) => x.ID === form.BuildID);
              return b ? ` → ${b.BinaryPath}` : ' (not found — rebuild it on this tab)';
            })()}
          </Text>
        ) : (
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
        )}
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

        <Group grow align="flex-end">
          <Autocomplete
            label="Family"
            description="Advisory model-family tag. Drives Servers-tab grouping and (future) family-specific prompt variants. Free-form — pick a known value or type your own."
            data={families.map((f) => ({ value: f.id, label: f.name || f.id }))}
            value={form.Family}
            onChange={(v) => update('Family', v)}
            placeholder="qwen3 / gemma3 / llama3 / …"
          />
          <TextInput
            label="Family version (optional)"
            value={form.FamilyVersion}
            onChange={(e) => update('FamilyVersion', e.currentTarget.value)}
            placeholder="3.5"
          />
          <Button
            variant="default"
            leftSection={<IconSparkles size={14} />}
            onClick={onDetectFamily}
            loading={detecting}
            disabled={!form.ModelPath}
            title="Read general.architecture + general.name from the GGUF header"
          >
            Detect
          </Button>
        </Group>

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

        <Textarea
          label="Extra args"
          description="Raw CLI tail appended after the standard flags. Whitespace-separated; quoting not supported (paste exactly as you'd type in the terminal)."
          value={form.ExtraArgsRaw}
          onChange={(e) => update('ExtraArgsRaw', e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={6}
          placeholder="--fit -t 16 -b 2048 --cache-type-k q8_0"
          styles={{ input: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }}
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

        {form.Kind === 'chat' && (
          <Select
            label="Agent tool mode"
            description={
              "How the agent loop calls tools on this profile. " +
              "Native = OpenAI tools[]/tool_calls (Qwen2/3, Hermes, etc. with --jinja). " +
              "ReAct = text-prompted Action/Args lines (works with any chat model). " +
              "None = disable tool calls regardless of session mode."
            }
            data={[
              { value: '', label: 'auto (native)' },
              { value: 'native', label: 'native (OpenAI tools[])' },
              { value: 'react', label: 'ReAct (text fallback)' },
              { value: 'none', label: 'none (no tools)' },
            ]}
            value={form.ToolMode}
            onChange={(v) => update('ToolMode', (v ?? '') as FormState['ToolMode'])}
            allowDeselect={false}
          />
        )}

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
