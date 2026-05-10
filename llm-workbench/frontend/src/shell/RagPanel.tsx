import { useEffect, useRef, useState } from 'react';
import { IconRefresh, IconBox, IconBolt } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { V5 } from '../theme';
import { Profile, InstanceStatus } from './types';
import {
  GetIndexStats,
  RebuildIndex,
  BuildEmbeddings,
} from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

type IndexProgressEvent = {
  filesProcessed: number;
  filesSkipped: number;
  chunksAdded: number;
  chunksRemoved: number;
  filesRemoved: number;
  currentPath: string;
  done: boolean;
};

type EmbedProgressEvent = {
  chunksTotal: number;
  chunksEmbedded: number;
  batchesSent: number;
  embedDim: number;
  embedModelId: string;
  done: boolean;
};

export function RagPanel({
  activeProjectId,
  profiles,
  statusByProfile,
}: {
  activeProjectId?: string;
  profiles: Profile[];
  statusByProfile: Record<string, InstanceStatus>;
}) {
  const [stats, setStats] = useState<main.IndexStats | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [indexProgress, setIndexProgress] = useState<IndexProgressEvent | null>(null);
  const [embedProgress, setEmbedProgress] = useState<EmbedProgressEvent | null>(null);

  const refreshStatsRef = useRef<() => void>(() => {});

  // Embed-kind profiles, prefer running ones first.
  const embedProfiles = profiles
    .filter((p) => p.Kind === 'embed')
    .sort((a, b) => {
      const ar = statusByProfile[a.ID]?.running ? 0 : 1;
      const br = statusByProfile[b.ID]?.running ? 0 : 1;
      return ar - br;
    });
  const [embedProfileId, setEmbedProfileId] = useState<string>('');
  useEffect(() => {
    if (!embedProfileId && embedProfiles.length > 0) {
      setEmbedProfileId(embedProfiles[0].ID);
    }
    if (embedProfileId && !embedProfiles.some((p) => p.ID === embedProfileId)) {
      setEmbedProfileId(embedProfiles[0]?.ID ?? '');
    }
  }, [embedProfiles.map((p) => p.ID).join(','), embedProfileId]);

  // Pull initial stats whenever the project changes.
  const refreshStats = async () => {
    if (!activeProjectId) {
      setStats(null);
      return;
    }
    try {
      const s = await GetIndexStats(activeProjectId);
      setStats(s);
    } catch {
      setStats(null);
    }
  };
  refreshStatsRef.current = refreshStats;
  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Subscribe to per-project progress events.
  useEffect(() => {
    if (!activeProjectId) return;
    const idxEv = `rag:index:progress:${activeProjectId}`;
    const embEv = `rag:embed:progress:${activeProjectId}`;
    EventsOn(idxEv, (p: IndexProgressEvent) => {
      setIndexProgress(p);
      if (p.done) refreshStatsRef.current();
    });
    EventsOn(embEv, (p: EmbedProgressEvent) => {
      setEmbedProgress(p);
      if (p.done) refreshStatsRef.current();
    });
    return () => {
      EventsOff(idxEv);
      EventsOff(embEv);
    };
  }, [activeProjectId]);

  if (!activeProjectId) return null;

  const onReindex = async () => {
    if (!activeProjectId || reindexing) return;
    setReindexing(true);
    setIndexProgress(null);
    try {
      const result = await RebuildIndex(activeProjectId);
      notifications.show({
        color: result.errors?.length ? 'yellow' : 'teal',
        title: 'Reindex done',
        message: `+${result.chunksAdded} -${result.chunksRemoved} chunks · ${result.filesProcessed} files in ${result.durationMs}ms`,
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Reindex failed', message: String(e?.message ?? e) });
    } finally {
      setReindexing(false);
      refreshStats();
    }
  };

  const onBuildEmbeddings = async () => {
    if (!activeProjectId || embedding) return;
    if (!embedProfileId) {
      notifications.show({
        color: 'gray',
        title: 'No embed profile',
        message: 'Create a kind=embed profile first.',
      });
      return;
    }
    setEmbedding(true);
    setEmbedProgress(null);
    try {
      const result = await BuildEmbeddings(activeProjectId, embedProfileId);
      notifications.show({
        color: result.errors?.length ? 'yellow' : 'teal',
        title: 'Embeddings built',
        message: `${result.chunksEmbedded} chunks · ${result.batchesSent} batches · dim ${result.embedDim} · ${result.durationMs}ms`,
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Embed failed', message: String(e?.message ?? e) });
    } finally {
      setEmbedding(false);
      refreshStats();
    }
  };

  return (
    <div
      style={{
        marginTop: 12,
        padding: '8px 8px 10px',
        background: V5.bg,
        border: `1px solid ${V5.borderSoft}`,
        borderRadius: 6,
        fontSize: 11,
        color: V5.textMuted,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontWeight: 600,
          color: V5.text,
          marginBottom: 6,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        <IconBox size={11} />
        RAG index
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 6, rowGap: 2, marginBottom: 6 }}>
        <span style={{ color: V5.textDim }}>chunks</span>
        <span style={{ color: V5.text, fontFamily: 'ui-monospace, monospace' }}>
          {stats?.chunkCount ?? '—'}
        </span>
        <span style={{ color: V5.textDim }}>embed dim</span>
        <span style={{ color: V5.text, fontFamily: 'ui-monospace, monospace' }}>
          {stats?.embedDim ? stats.embedDim : '—'}
        </span>
        {stats?.embedModelId ? (
          <>
            <span style={{ color: V5.textDim }}>model</span>
            <span style={{ color: V5.text, fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={stats.embedModelId}>
              {stats.embedModelId}
            </span>
          </>
        ) : null}
      </div>

      {(reindexing || (indexProgress && !indexProgress.done)) && (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: V5.accent, marginBottom: 4 }}>
          indexing… {indexProgress?.filesProcessed ?? 0}+{indexProgress?.filesSkipped ?? 0} files,{' '}
          +{indexProgress?.chunksAdded ?? 0} chunks
          {indexProgress?.currentPath ? ` · ${truncatePath(indexProgress.currentPath)}` : ''}
        </div>
      )}
      {(embedding || (embedProgress && !embedProgress.done)) && (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: V5.accent, marginBottom: 4 }}>
          embedding… {embedProgress?.chunksEmbedded ?? 0}/{embedProgress?.chunksTotal ?? 0} ·{' '}
          {embedProgress?.batchesSent ?? 0} batches
        </div>
      )}

      {embedProfiles.length > 0 ? (
        <select
          value={embedProfileId}
          onChange={(e) => setEmbedProfileId(e.currentTarget.value)}
          style={{
            width: '100%',
            background: V5.surface,
            color: V5.text,
            border: `1px solid ${V5.borderSoft}`,
            borderRadius: 4,
            padding: '3px 6px',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            marginBottom: 6,
          }}
        >
          {embedProfiles.map((p) => (
            <option key={p.ID} value={p.ID}>
              {p.ID} {statusByProfile[p.ID]?.running ? '· up' : '· stopped'}
            </option>
          ))}
        </select>
      ) : (
        <div style={{ fontSize: 10.5, color: V5.textDim, marginBottom: 6, fontStyle: 'italic' }}>
          No embed profile yet.
        </div>
      )}

      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={onReindex}
          disabled={reindexing}
          style={btn(reindexing)}
          title="Walk project, chunk + index files"
        >
          <IconRefresh size={11} /> reindex
        </button>
        <button
          onClick={onBuildEmbeddings}
          disabled={embedding || !embedProfileId}
          style={btn(embedding || !embedProfileId)}
          title="Embed pending chunks (auto-starts embed profile)"
        >
          <IconBolt size={11} /> embed
        </button>
      </div>
    </div>
  );
}

function btn(disabled: boolean) {
  return {
    flex: 1,
    padding: '4px 6px',
    background: disabled ? V5.surface2 : V5.surface,
    color: disabled ? V5.textDim : V5.text,
    border: `1px solid ${V5.borderSoft}`,
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    fontSize: 11,
    fontFamily: 'inherit',
  } as const;
}

function truncatePath(p: string): string {
  if (p.length <= 40) return p;
  return '…' + p.slice(p.length - 39);
}
