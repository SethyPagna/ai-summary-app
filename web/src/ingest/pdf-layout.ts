// Reconstructs reading order and structure from positioned PDF text items:
// columns, lines, paragraphs, headings (by font size / numbering / caps),
// de-hyphenation, and removal of running headers, footers and page numbers.
// Pure functions so they are unit-testable without pdf.js.

import { BlockBuilder } from './blocks';
import type { Block } from '../engine/types';

export interface PdfItem {
  str: string;
  x: number;
  y: number; // baseline, PDF units (origin bottom-left)
  w: number;
  size: number;
  bold: boolean;
}

export interface PdfPage {
  number: number;
  width: number;
  height: number;
  items: PdfItem[];
}

interface Line {
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
  bold: boolean;
  page: number;
  colLeft: number;
  colRight: number;
}

function groupLines(items: PdfItem[], page: number, colLeft: number, colRight: number): Line[] {
  const sorted = items.filter((i) => i.str.trim() || i.str === ' ').sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfItem[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      const ref = row[0]!;
      const tol = 0.5 * Math.max(ref.size, it.size, 1);
      if (Math.abs(ref.y - it.y) <= tol) {
        row.push(it);
        continue;
      }
    }
    rows.push([it]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = -Infinity;
    let chars = 0;
    let boldChars = 0;
    let sizeSum = 0;
    for (const it of row) {
      const gap = it.x - prevEnd;
      if (text && gap > 0.18 * it.size && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      prevEnd = it.x + it.w;
      const n = it.str.trim().length;
      chars += n;
      sizeSum += n * it.size;
      if (it.bold) boldChars += n;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push({
      text,
      x0: row[0]!.x,
      x1: Math.max(...row.map((i) => i.x + i.w)),
      y: row[0]!.y,
      size: chars ? sizeSum / chars : row[0]!.size,
      bold: chars > 0 && boldChars / chars > 0.6,
      page,
      colLeft,
      colRight,
    });
  }
  return lines;
}

/** Split a page into reading-order lines, handling simple two-column layouts. */
export function pageLines(p: PdfPage): Line[] {
  const items = p.items.filter((i) => i.str.length);
  const mid = p.width / 2;
  let left = 0;
  let right = 0;
  let straddle = 0;
  for (const i of items) {
    const n = i.str.trim().length;
    if (i.x + i.w < mid - 4) left += n;
    else if (i.x > mid + 4) right += n;
    else straddle += n;
  }
  const total = left + right + straddle || 1;
  const twoCol = left / total > 0.25 && right / total > 0.25 && straddle / total < 0.12;
  if (!twoCol) {
    const xs = items.map((i) => i.x);
    const colLeft = xs.length ? Math.min(...xs) : 0;
    const colRight = items.length ? Math.max(...items.map((i) => i.x + i.w)) : p.width;
    return groupLines(items, p.number, colLeft, colRight);
  }
  const L = items.filter((i) => i.x + i.w < mid - 4);
  const R = items.filter((i) => i.x > mid + 4);
  const S = items.filter((i) => !L.includes(i) && !R.includes(i));
  const colTop = Math.max(...[...L, ...R].map((i) => i.y));
  const above = S.filter((i) => i.y >= colTop);
  const below = S.filter((i) => i.y < colTop);
  const bounds = (xs: PdfItem[]) => [Math.min(...xs.map((i) => i.x)), Math.max(...xs.map((i) => i.x + i.w))] as const;
  const [ll, lr] = L.length ? bounds(L) : [0, mid];
  const [rl, rr] = R.length ? bounds(R) : [mid, p.width];
  const out: Line[] = [];
  if (above.length) out.push(...groupLines(above, p.number, 0, p.width));
  out.push(...groupLines(L, p.number, ll, lr));
  out.push(...groupLines(R, p.number, rl, rr));
  if (below.length) out.push(...groupLines(below, p.number, 0, p.width));
  return out;
}

const PAGE_NUM_RE = /^(?:page\s*)?[-–]?\s*\d{1,4}\s*[-–]?(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const BULLET_RE = /^(?:[•▪◦‣●○■□–\-*]\s+|\(?\d{1,2}[.)]\s+|\(?[a-z][.)]\s+)/;
const NUMBERED_HEADING_RE = /^(?:\d+(?:\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+\p{Lu}/u;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export interface PdfLayoutResult {
  blocks: Block[];
  title?: string;
  chars: number;
}

export function layoutPdf(pages: PdfPage[]): PdfLayoutResult {
  const perPage = pages.map((p) => ({ p, lines: pageLines(p) }));

  // Body font size: the size carrying the most characters.
  const sizeChars = new Map<number, number>();
  for (const { lines } of perPage)
    for (const l of lines) {
      const k = Math.round(l.size * 2) / 2;
      sizeChars.set(k, (sizeChars.get(k) ?? 0) + l.text.length);
    }
  const body = [...sizeChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;

  // Running headers/footers: same (digit-normalised) text in the top/bottom
  // band of at least half the pages.
  const bandKey = (l: Line, h: number) => (l.y > h * 0.9 ? 'top' : l.y < h * 0.1 ? 'bottom' : null);
  const repeats = new Map<string, number>();
  for (const { p, lines } of perPage) {
    const seen = new Set<string>();
    for (const l of lines) {
      const band = bandKey(l, p.height);
      if (!band) continue;
      const key = band + ':' + l.text.toLowerCase().replace(/\d+/g, '#');
      if (!seen.has(key)) {
        seen.add(key);
        repeats.set(key, (repeats.get(key) ?? 0) + 1);
      }
    }
  }
  const minRepeat = Math.max(2, Math.ceil(pages.length / 2));
  const isChrome = (l: Line, h: number) => {
    const band = bandKey(l, h);
    if (!band) return false;
    if (PAGE_NUM_RE.test(l.text)) return true;
    return pages.length >= 2 && (repeats.get(band + ':' + l.text.toLowerCase().replace(/\d+/g, '#')) ?? 0) >= minRepeat;
  };

  const b = new BlockBuilder();
  let title: string | undefined;
  let chars = 0;

  // Heading size ranks (sizes clearly above body text).
  const headingSizes = [...sizeChars.keys()].filter((s) => s >= body * 1.12).sort((a, c) => c - a);
  let titleSize: number | null = null;
  const levelForSize = (s: number) => {
    const k = Math.round(s * 2) / 2;
    const sizes = headingSizes.filter((x) => x !== titleSize);
    const idx = sizes.indexOf(k);
    if (idx < 0) return sizes.length ? 3 : 2;
    return Math.min(3, idx + 2);
  };

  let para: Line[] = [];
  let paraKind: 'paragraph' | 'li' = 'paragraph';
  const flush = () => {
    if (!para.length) return;
    let text = '';
    for (const l of para) {
      if (!text) text = l.text;
      else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(l.text)) text = text.slice(0, -1) + l.text;
      else text += ' ' + l.text;
    }
    chars += text.length;
    b.add(paraKind, paraKind === 'li' ? text.replace(BULLET_RE, '') : text, { page: para[0]!.page });
    para = [];
    paraKind = 'paragraph';
  };

  for (const { p, lines } of perPage) {
    const content = lines.filter((l) => !isChrome(l, p.height));
    const gaps: number[] = [];
    for (let i = 1; i < content.length; i++) {
      const d = content[i - 1]!.y - content[i]!.y;
      if (d > 0 && Math.abs(content[i]!.size - body) < 1) gaps.push(d);
    }
    const lineGap = median(gaps) || body * 1.3;

    let pendingHeading: Line[] = [];
    const flushHeading = () => {
      if (!pendingHeading.length) return;
      const text = pendingHeading.map((l) => l.text).join(' ').replace(/\s+/g, ' ');
      const first = pendingHeading[0]!;
      const isTitle = !title && first.page === 1 && first.size >= Math.max(...headingSizes, body * 1.3) - 0.01;
      chars += text.length;
      if (isTitle) {
        title = text;
        titleSize = Math.round(first.size * 2) / 2;
        b.add('heading', text, { level: 1, page: first.page });
      } else {
        const numbered = text.match(/^(\d+(?:\.\d+)*)\.?\s/);
        const level = numbered ? Math.min(3, numbered[1]!.split('.').length + 1) : levelForSize(first.size);
        b.add('heading', text, { level: Math.min(3, level), page: first.page });
      }
      pendingHeading = [];
    };

    for (let i = 0; i < content.length; i++) {
      const l = content[i]!;
      const prev = content[i - 1];
      const words = l.text.split(/\s+/).length;
      const noStop = !/[.;,]$/.test(l.text);
      const big = l.size >= body * 1.12 && words <= 18;
      const numbered = NUMBERED_HEADING_RE.test(l.text) && words <= 12 && noStop && l.size >= body - 0.5;
      const caps = /^[\p{Lu}\d\s&:—–-]{3,}$/u.test(l.text) && /\p{Lu}{3,}/u.test(l.text) && words <= 6;
      const boldHead = l.bold && words <= 12 && noStop && !(content[i + 1]?.bold && content[i + 1]!.size === l.size && words > 8);
      const heading = big || numbered || caps || boldHead;

      if (heading) {
        flush();
        // Merge consecutive heading lines of the same size (wrapped titles).
        const last = pendingHeading[pendingHeading.length - 1];
        if (last && Math.abs(last.size - l.size) < 0.6 && last.y - l.y < l.size * 2) pendingHeading.push(l);
        else {
          flushHeading();
          pendingHeading.push(l);
        }
        continue;
      }
      flushHeading();

      const bullet = BULLET_RE.test(l.text) && !/^\d{1,2}[.)]\s+\d/.test(l.text);
      let newPara = para.length === 0;
      if (prev && para.length) {
        const gap = prev.y - l.y;
        const prevLine = para[para.length - 1]!;
        const prevShort = prevLine.x1 < prevLine.colRight - (prevLine.colRight - prevLine.colLeft) * 0.12;
        const indented = l.x0 > prevLine.x0 + body * 0.8 && para.length > 1;
        if (gap > lineGap * 1.3 || gap < 0 || l.page !== prevLine.page) newPara = true;
        else if (prevShort && /[.!?:”")]$/.test(prevLine.text)) newPara = true;
        else if (bullet) newPara = true;
        else if (indented && /[.!?”"]$/.test(prevLine.text)) newPara = true;
        else if (Math.abs(l.size - prevLine.size) > 1.2) newPara = true;
      }
      if (newPara) {
        flush();
        paraKind = bullet ? 'li' : 'paragraph';
      }
      para.push(l);
    }
    flushHeading();
    flush();
  }
  return { blocks: b.blocks, title, chars };
}
