import { useEffect, useRef, useState } from 'react';
import { Loader, Text, Stack } from '@mantine/core';
import { RenderMarkdown } from '../../wailsjs/go/main/App';
import { renderMathIn } from '../util/katex';

type Props = {
  source: string;
  onStats?: (stats: { parseMs: number; bytes: number; htmlSize: number; totalMs: number }) => void;
};

export function MarkdownPreview({ source, onStats }: Props) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    renderMathIn(containerRef.current);
  }, [html]);

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setHtml('');
      return;
    }
    setLoading(true);
    setErr(null);
    const t0 = performance.now();
    RenderMarkdown(source)
      .then((res) => {
        if (cancelled) return;
        setHtml(res.html);
        const totalMs = Math.round(performance.now() - t0);
        onStats?.({ parseMs: res.parseMs, bytes: res.bytes, htmlSize: res.htmlSize, totalMs });
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (loading) {
    return (
      <Stack align="center" justify="center" h="100%" gap="xs">
        <Loader />
        <Text size="sm" c="dimmed">Rendering markdown…</Text>
      </Stack>
    );
  }
  if (err) {
    return <Text c="red" p="md">Render error: {err}</Text>;
  }
  return (
    <div
      ref={containerRef}
      className="md-preview"
      style={{
        height: '100%',
        overflow: 'auto',
        padding: '16px 32px',
        boxSizing: 'border-box',
        lineHeight: 1.6,
        fontSize: 14,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
