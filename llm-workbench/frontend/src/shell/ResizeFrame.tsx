import { CSSProperties, useEffect, useState } from 'react';
import {
  Environment,
  WindowGetPosition,
  WindowGetSize,
  WindowIsMaximised,
  WindowSetPosition,
  WindowSetSize,
} from '../../wailsjs/runtime/runtime';

// Frameless windows (TD5) keep native edge-resize on Windows (WM_NCHITTEST) and
// macOS, but GTK drops it entirely — so on Linux we recreate it with thin
// invisible drag strips along the window edges/corners that drive the Wails
// runtime's WindowSetSize/WindowSetPosition. (B: "after hiding the TitleBar the
// right/bottom edge no longer resizes".)

const EDGE = 6; // px hit area along an edge
const CORNER = 14; // px square hit area in a corner
const MIN_W = 720;
const MIN_H = 480;

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const CURSOR: Record<Handle, CSSProperties['cursor']> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export function ResizeFrame() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    Environment()
      .then((env) => {
        if (env.platform === 'linux') setEnabled(true);
      })
      .catch(() => {
        /* runtime not ready — leave disabled */
      });
  }, []);

  if (!enabled) return null;

  const begin = (h: Handle) => async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (await WindowIsMaximised()) return;
    } catch {
      /* ignore — proceed */
    }
    let size, pos;
    try {
      size = await WindowGetSize();
      pos = await WindowGetPosition();
    } catch {
      return;
    }
    const start = { mx: e.screenX, my: e.screenY, w: size.w, h: size.h, x: pos.x, y: pos.y };
    const movesEdge = h.includes('w') || h.includes('n');

    let raf = 0;
    let pending: { w: number; h: number; x: number; y: number } | null = null;
    const flush = () => {
      raf = 0;
      if (!pending) return;
      WindowSetSize(pending.w, pending.h);
      if (movesEdge) WindowSetPosition(pending.x, pending.y);
      pending = null;
    };

    const onMove = (ev: MouseEvent) => {
      const dx = ev.screenX - start.mx;
      const dy = ev.screenY - start.my;
      let w = start.w;
      let ht = start.h;
      let x = start.x;
      let y = start.y;
      if (h.includes('e')) w = Math.max(MIN_W, start.w + dx);
      if (h.includes('s')) ht = Math.max(MIN_H, start.h + dy);
      if (h.includes('w')) {
        w = Math.max(MIN_W, start.w - dx);
        x = start.x + (start.w - w);
      }
      if (h.includes('n')) {
        ht = Math.max(MIN_H, start.h - dy);
        y = start.y + (start.h - ht);
      }
      pending = { w, h: ht, x, y };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      if (raf) cancelAnimationFrame(raf);
      flush();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    document.body.style.cursor = CURSOR[h] as string;
    document.body.style.userSelect = 'none';
  };

  const strip = (h: Handle, style: CSSProperties) => (
    <div
      key={h}
      onMouseDown={begin(h)}
      style={{ position: 'absolute', pointerEvents: 'auto', cursor: CURSOR[h], ...style }}
    />
  );

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      {strip('n', { top: 0, left: CORNER, right: CORNER, height: EDGE })}
      {strip('s', { bottom: 0, left: CORNER, right: CORNER, height: EDGE })}
      {strip('w', { left: 0, top: CORNER, bottom: CORNER, width: EDGE })}
      {strip('e', { right: 0, top: CORNER, bottom: CORNER, width: EDGE })}
      {strip('nw', { top: 0, left: 0, width: CORNER, height: CORNER })}
      {strip('ne', { top: 0, right: 0, width: CORNER, height: CORNER })}
      {strip('sw', { bottom: 0, left: 0, width: CORNER, height: CORNER })}
      {strip('se', { bottom: 0, right: 0, width: CORNER, height: CORNER })}
    </div>
  );
}
