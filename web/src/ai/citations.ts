// Maps Claude citations back to exact passages in the app's blocks.
//  - char_location (plain-text documents): exact via the recorded block offsets.
//  - page_location (PDF documents): search the cited text within that page's
//    blocks (whitespace/hyphenation-insensitive), falling back to the best
//    overlapping sentence on the page.

import type { Block } from '../engine/types';
import { anchorLabel } from '../engine/segment';
import { terms } from '../engine/text';
import type { DocMapEntry } from './request';
import type { AiCitation } from './stream';

export interface HighlightRange {
  blockId: string;
  start: number;
  end: number;
}

export interface CitationTarget {
  docId: string;
  label: string;
  quote: string;
  ranges: HighlightRange[];
}

export function resolveCitation(c: AiCitation, docMap: DocMapEntry[], blocksOf: (docId: string) => Block[] | undefined): CitationTarget | null {
  const entry = docMap[c.docIndex];
  if (!entry) return null;
  const blocks = blocksOf(entry.docId);
  if (!blocks) return null;
  const byId = new Map(blocks.map((b) => [b.id, b]));

  if (c.kind === 'char' && entry.mode === 'text') {
    const ranges: HighlightRange[] = [];
    for (const o of entry.offsets) {
      if (o.end <= c.start || o.start >= c.end) continue;
      ranges.push({ blockId: o.blockId, start: Math.max(0, c.start - o.start), end: Math.min(o.end - o.start, c.end - o.start) });
    }
    if (!ranges.length) {
      // Citation fell on a prefix (e.g. a "[Page 2]" marker): use the next block.
      const next = entry.offsets.find((o) => o.start >= c.start);
      if (next) ranges.push({ blockId: next.blockId, start: 0, end: Math.min(next.end - next.start, c.end - c.start) });
    }
    const first = ranges[0] ? byId.get(ranges[0].blockId) : undefined;
    if (!first) return null;
    return { docId: entry.docId, label: anchorLabel(first.anchor, 'source'), quote: c.citedText.trim(), ranges };
  }

  if (c.kind === 'page') {
    const endPage = Math.max(c.end, c.start + 1);
    const onPages = blocks.filter((b) => b.anchor.page && b.anchor.page >= c.start && b.anchor.page < endPage);
    const pool = onPages.length ? onPages : blocks;
    const found = findQuote(pool, c.citedText);
    const label = c.start + 1 < endPage ? `pp. ${c.start}–${endPage - 1}` : `p. ${c.start}`;
    if (found.length) return { docId: entry.docId, label, quote: c.citedText.trim(), ranges: found };
    const best = bestOverlap(pool, c.citedText);
    return best ? { docId: entry.docId, label, quote: c.citedText.trim(), ranges: [best] } : null;
  }

  // content_block_location or mismatched modes: best effort by text.
  const found = findQuote(blocks, c.citedText);
  if (found.length) {
    const b = byId.get(found[0]!.blockId)!;
    return { docId: entry.docId, label: anchorLabel(b.anchor, 'source'), quote: c.citedText.trim(), ranges: found };
  }
  return null;
}

/** Normalise for loose matching and keep a map back to original indices. */
function loose(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i]!.toLowerCase();
    if (/[\s ]/.test(ch)) {
      if (prevSpace) continue;
      ch = ' ';
      prevSpace = true;
    } else {
      prevSpace = false;
      if (/[‘’]/.test(ch)) ch = "'";
      else if (/[“”]/.test(ch)) ch = '"';
      else if (/[–—]/.test(ch)) ch = '-';
    }
    norm += ch;
    map.push(i);
  }
  return { norm, map };
}

/** Find a cited quote across consecutive blocks; returns per-block ranges. */
export function findQuote(blocks: Block[], quote: string): HighlightRange[] {
  const q = loose(quote.trim()).norm.replace(/-\s/g, '');
  if (q.length < 4) return [];
  // Search each block, then pairs of neighbours (quotes can span a paragraph break).
  const probe = q.slice(0, Math.min(q.length, 80));
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const L = loose(b.text);
    const idx = L.norm.indexOf(probe);
    if (idx < 0) continue;
    const startOrig = L.map[idx]!;
    const want = q.length;
    const endNorm = Math.min(L.norm.length, idx + want);
    const endOrig = (L.map[endNorm - 1] ?? b.text.length - 1) + 1;
    const ranges: HighlightRange[] = [{ blockId: b.id, start: startOrig, end: endOrig }];
    let remaining = want - (endNorm - idx);
    let j = i + 1;
    while (remaining > 2 && j < blocks.length) {
      const nb = blocks[j]!;
      const take = Math.min(nb.text.length, remaining);
      ranges.push({ blockId: nb.id, start: 0, end: take });
      remaining -= take + 1;
      j++;
    }
    return ranges;
  }
  return [];
}

function bestOverlap(blocks: Block[], quote: string): HighlightRange | null {
  const qt = new Set(terms(quote));
  if (!qt.size) return null;
  let best: { b: Block; score: number } | null = null;
  for (const b of blocks) {
    const bt = terms(b.text);
    let hit = 0;
    for (const t of bt) if (qt.has(t)) hit++;
    const score = hit / Math.sqrt(bt.length + 1);
    if (!best || score > best.score) best = { b, score };
  }
  return best && best.score > 0 ? { blockId: best.b.id, start: 0, end: best.b.text.length } : null;
}
