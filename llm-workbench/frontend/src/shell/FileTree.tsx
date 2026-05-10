import { useState } from 'react';
import { IconChevronRight, IconFolder, IconFile } from '@tabler/icons-react';
import { V5 } from '../theme';
import { FileNode } from './types';

export type FileTreeProps = {
  nodes: FileNode[];
  activePath: string;
  onSelect: (node: FileNode) => void;
  filter?: string;
};

export function FileTree({ nodes, activePath, onSelect, filter }: FileTreeProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const toggle = (path: string) => setOpen((o) => ({ ...o, [path]: !o[path] }));

  const visibleNodes = filter
    ? filterTree(nodes, filter.toLowerCase())
    : nodes;

  return (
    <div>
      {visibleNodes.length === 0 ? (
        <div
          style={{
            fontSize: 11,
            color: V5.textDim,
            padding: '12px 10px',
            fontStyle: 'italic',
          }}
        >
          {filter ? 'No matches.' : 'Empty project.'}
        </div>
      ) : (
        visibleNodes.map((n) => (
          <Row
            key={n.path}
            node={n}
            depth={0}
            open={open}
            toggle={toggle}
            activePath={activePath}
            onSelect={onSelect}
            forceOpen={!!filter}
          />
        ))
      )}
    </div>
  );
}

function Row({
  node,
  depth,
  open,
  toggle,
  activePath,
  onSelect,
  forceOpen,
}: {
  node: FileNode;
  depth: number;
  open: Record<string, boolean>;
  toggle: (path: string) => void;
  activePath: string;
  onSelect: (node: FileNode) => void;
  forceOpen: boolean;
}) {
  const isOpen = forceOpen || !!open[node.path] || (depth === 0 && node.isDir);
  const isActive = !node.isDir && node.path === activePath;

  return (
    <div>
      <div
        onClick={() => (node.isDir ? toggle(node.path) : onSelect(node))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: `4px 8px 4px ${8 + depth * 12}px`,
          background: isActive ? V5.accentSoft : 'transparent',
          borderLeft: isActive ? `2px solid ${V5.accent}` : '2px solid transparent',
          borderRadius: 3,
          fontSize: 12.5,
          color: V5.text,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {node.isDir ? (
          <IconChevronRight
            size={10}
            style={{
              transform: isOpen ? 'rotate(90deg)' : 'none',
              color: V5.textMuted,
              transition: 'transform .12s',
              flex: 'none',
            }}
          />
        ) : (
          <span style={{ width: 10, flex: 'none' }} />
        )}
        {node.isDir ? (
          <IconFolder size={13} color="#dcb67a" style={{ flex: 'none' }} />
        ) : (
          <IconFile size={13} color={V5.textMuted} style={{ flex: 'none' }} />
        )}
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.name}
        </span>
        {!node.isDir && node.size > 0 && (
          <span style={{ color: V5.textDim, fontSize: 10.5, flex: 'none' }}>
            {formatSize(node.size)}
          </span>
        )}
      </div>
      {node.isDir && isOpen && node.children && (
        <div>
          {node.children.map((c) => (
            <Row
              key={c.path}
              node={c}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              activePath={activePath}
              onSelect={onSelect}
              forceOpen={forceOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// filterTree returns a copy of nodes where every leaf matches the
// substring query; directories with no matches are pruned.
function filterTree(nodes: FileNode[], q: string): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) {
    if (n.isDir) {
      const kids = n.children ? filterTree(n.children, q) : [];
      if (kids.length > 0 || n.name.toLowerCase().includes(q)) {
        out.push({ ...n, children: kids });
      }
    } else if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) {
      out.push(n);
    }
  }
  return out;
}
