import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { OutlineNode } from '../engine/types';
import { app, setKeyphrase, type LoadedDoc } from '../store/app';
import { sentenceTarget } from './cite';

const CHAR = 7.1; // approx. width of a 13px UI glyph
const PAD = 22;
const LEAF_H = 34;
const BRANCH_GAP = 18;

function wrap(label: string, max: number): string[] {
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  if (lines.length > 3) return [...lines.slice(0, 2), lines.slice(2).join(' ').slice(0, max - 1) + '…'];
  return lines;
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

interface Placed {
  node: OutlineNode;
  x: number; // anchor x (left edge on the right side, right edge on the left side)
  y: number;
  w: number;
  side: 1 | -1;
  color: number;
}

export function MapTab({ doc }: { doc: LoadedDoc }) {
  const { analysis: a, meta } = doc;
  const root = a.outline;

  // Two-sided "mind map" when there is room; a one-sided tree in narrow columns.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const twoSided = width >= 820;

  const layout = useMemo(() => {
    const branches = root.children;
    const half = twoSided ? Math.ceil(branches.length / 2) : branches.length;
    const sides: [OutlineNode[], 1 | -1][] = twoSided
      ? [
          [branches.slice(0, half), 1],
          [branches.slice(half), -1],
        ]
      : [[branches, 1]];
    const rootLines = wrap(root.label, twoSided ? 24 : 18);
    const rootW = Math.min(twoSided ? 250 : 190, Math.max(...rootLines.map((l) => l.length)) * 8.4 + 36);
    const rootH = rootLines.length * 20 + 26;
    const branchesPlaced: Placed[] = [];
    const leavesPlaced: (Placed & { parent: Placed })[] = [];
    let colorIdx = 0;
    const leafH = twoSided ? LEAF_H : 29;
    const gap = twoSided ? BRANCH_GAP : 12;
    for (const [list, side] of sides) {
      const heights = list.map((b) => Math.max(1, b.children.length) * leafH + gap);
      const total = heights.reduce((s, h) => s + h, 0);
      let y = -total / 2;
      const bx = side * (rootW / 2 + 56);
      const maxBW = Math.max(0, ...list.map((b) => clip(b.label, 30).length * CHAR + PAD));
      const lx = bx + side * (maxBW + 58);
      list.forEach((b, k) => {
        const h = heights[k]!;
        const cy = y + h / 2;
        const color = colorIdx++ % 8;
        const placed: Placed = { node: b, x: bx, y: cy, w: clip(b.label, 30).length * CHAR + PAD, side, color };
        branchesPlaced.push(placed);
        const n = b.children.length;
        b.children.forEach((leaf, j) => {
          const ly = cy + (j - (n - 1) / 2) * leafH;
          leavesPlaced.push({ node: leaf, x: lx, y: ly, w: clip(leaf.label, 28).length * (CHAR - 0.4) + PAD - 4, side, color, parent: placed });
        });
        y += h;
      });
    }
    const xs = [...branchesPlaced, ...leavesPlaced].flatMap((p) => [p.x, p.x + p.side * p.w]);
    const ys = [...branchesPlaced, ...leavesPlaced].map((p) => p.y);
    const minX = Math.min(-rootW / 2, ...xs) - 8;
    const maxX = Math.max(rootW / 2, ...xs) + 16;
    const minY = Math.min(-rootH / 2, ...ys) - 30;
    const maxY = Math.max(rootH / 2, ...ys) + 30;
    return { rootLines, rootW, rootH, branchesPlaced, leavesPlaced, box: [minX, minY, maxX - minX, maxY - minY] as const };
  }, [root, twoSided]);

  const openSentence = (si: number) => {
    const t = sentenceTarget(meta.id, a, doc.blocks, si);
    if (t) app.set({ focus: { ...t, nonce: Date.now() }, readerOpen: true, keyphrase: null });
  };
  const act = (n: OutlineNode) => (n.kind === 'phrase' ? setKeyphrase(n.label) : n.sentence >= 0 && openSentence(n.sentence));
  const keyAct = (n: OutlineNode) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act(n);
    }
  };

  const { rootLines, rootW, rootH, branchesPlaced, leavesPlaced, box } = layout;
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  return (
    <div className="map">
      <p className="sub">
        {root.children.some((c) => c.id.startsWith('s'))
          ? 'Sections detected from headings, each with its most characteristic key phrases. Click a section to open it, a phrase to highlight it.'
          : 'No headings found, so the map groups the top key phrases with the phrases that appear near them.'}
      </p>
      <div className="map-scroll" ref={wrapRef}>
        <svg className="mindmap" viewBox={box.join(' ')} style={{ minWidth: width < 540 ? Math.min(box[2], 560) : undefined }} role="img" aria-label={`Mind map of ${meta.title}`}>
          {branchesPlaced.map((b) => (
            <path key={`l-${b.node.id}`} className={`link c${b.color}`} d={curve(b.side * (rootW / 2), 0, b.x, b.y)} />
          ))}
          {leavesPlaced.map((l) => (
            <path key={`l-${l.node.id}`} className={`link thin c${l.color}`} d={curve(l.parent.x + l.side * l.parent.w, l.parent.y, l.x, l.y)} />
          ))}
          <g className="node root">
            <rect x={-rootW / 2} y={-rootH / 2} width={rootW} height={rootH} rx={14} />
            {rootLines.map((line, i) => (
              <text key={i} x={0} y={-((rootLines.length - 1) * 20) / 2 + i * 20 + 6} textAnchor="middle">
                {line}
              </text>
            ))}
          </g>
          {branchesPlaced.map((b) => (
            <g key={b.node.id} className={`node branch c${b.color}`} role="button" tabIndex={0} aria-label={`Section: ${b.node.label}`} onClick={() => act(b.node)} onKeyDown={keyAct(b.node)}>
              <title>{b.node.label}</title>
              <rect x={b.side === 1 ? b.x : b.x - b.w} y={b.y - 15} width={b.w} height={30} rx={15} />
              <text x={b.side === 1 ? b.x + b.w / 2 : b.x - b.w / 2} y={b.y + 4.5} textAnchor="middle">
                {clip(b.node.label, 30)}
              </text>
            </g>
          ))}
          {leavesPlaced.map((l) => (
            <g key={l.node.id} className={`node leaf c${l.color}`} role="button" tabIndex={0} aria-label={`Highlight phrase: ${l.node.label}`} onClick={() => act(l.node)} onKeyDown={keyAct(l.node)}>
              <title>{l.node.label}</title>
              <rect x={l.side === 1 ? l.x : l.x - l.w} y={l.y - 12} width={l.w} height={24} rx={12} />
              <text x={l.side === 1 ? l.x + l.w / 2 : l.x - l.w / 2} y={l.y + 4} textAnchor="middle">
                {clip(l.node.label, 28)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <h2 className="h-section">Outline</h2>
      <ol className="outline">
        {root.children.map((b) => (
          <li key={b.id}>
            <button type="button" className="link-strong" onClick={() => act(b)}>
              {b.label}
            </button>
            {b.children.length > 0 && (
              <span className="outline-kp">
                {b.children.map((c) => (
                  <button key={c.id} type="button" className="chip chip-small" onClick={() => act(c)}>
                    {c.label}
                  </button>
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
