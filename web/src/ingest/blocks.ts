// Helpers to build Block lists with stable ids and section anchors, plus the
// plain-text and Markdown parsers (pure, no DOM, so they run in the worker).

import { normalizeWhitespace } from '../engine/text';
import type { Anchor, Block, BlockKind } from '../engine/types';

export class BlockBuilder {
  readonly blocks: Block[] = [];
  private section: string | undefined;

  add(kind: BlockKind, text: string, opts: { level?: number; rows?: string[][]; page?: number; slide?: number } = {}): Block | null {
    const clean = kind === 'code' || kind === 'table' ? text.replace(/\s+$/g, '') : normalizeWhitespace(text).replace(/\n/g, ' ');
    if (!clean.trim()) return null;
    if (kind === 'heading') this.section = clean;
    const anchor: Anchor = {};
    if (opts.page) anchor.page = opts.page;
    if (opts.slide) anchor.slide = opts.slide;
    if (kind !== 'heading' && this.section) anchor.section = this.section;
    if (kind === 'heading') anchor.section = clean;
    const block: Block = { id: `b${this.blocks.length}`, kind, text: clean, anchor };
    if (opts.level !== undefined) block.level = opts.level;
    if (opts.rows) block.rows = opts.rows;
    this.blocks.push(block);
    return block;
  }

  setSection(s: string | undefined) {
    this.section = s;
  }
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base[0]!.toUpperCase() + base.slice(1) : 'Untitled';
}

const BULLET_RE = /^\s*(?:[-*+•▪◦‣]|\d{1,3}[.)]|[a-z][.)])\s+/;

function looksLikeHeading(line: string, next: string | undefined): boolean {
  // `next` is the next non-blank line (headings are often followed by a blank line).
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/[.,;:!?]$/.test(t) && !/^[\p{Lu}\d\s]+:$/u.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 10) return false;
  if (BULLET_RE.test(t)) return false;
  const isCaps = /^[\p{Lu}\d\s&/'’\-–—:]+$/u.test(t) && /\p{Lu}{2,}/u.test(t);
  const numbered = /^(?:\d+(?:\.\d+)*|[IVX]+)\.?\s+\p{Lu}/u.test(t);
  const titleCase = words.filter((w) => /^\p{Lu}/u.test(w)).length >= Math.ceil(words.length * 0.6);
  const followedByText = next !== undefined && next.trim().length > 0;
  // "Recommendations", "Next steps": short capitalised line standing alone.
  const shortLabel = words.length <= 4 && /^\p{Lu}/u.test(t) && !/\d{3,}/.test(t);
  return (isCaps || numbered || shortLabel || (titleCase && words.length <= 8)) && followedByText;
}

/** Plain text: blank-line paragraphs, list items, heuristic headings. */
export function parsePlainText(text: string): Block[] {
  const b = new BlockBuilder();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) b.add('paragraph', para.join(' '));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (!line.trim()) {
      flush();
      continue;
    }
    // Setext-style underline headings.
    if (next !== undefined && /^\s*(=+|-{3,})\s*$/.test(next) && line.trim().length < 90) {
      flush();
      b.add('heading', line, { level: next.includes('=') ? 1 : 2 });
      i++;
      continue;
    }
    if (BULLET_RE.test(line)) {
      flush();
      b.add('li', line.replace(BULLET_RE, ''), { level: Math.min(3, Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2)) });
      continue;
    }
    const prevBlank = i === 0 || !lines[i - 1]!.trim();
    const nextBlank = next === undefined || !next.trim();
    let k = i + 1;
    while (k < lines.length && !lines[k]!.trim()) k++;
    // A heading stands on its own line: blank before, and blank or a list/paragraph after.
    if (prevBlank && (nextBlank || BULLET_RE.test(next ?? '')) && looksLikeHeading(line, lines[k])) {
      flush();
      b.add('heading', line.replace(/:$/, ''), { level: /^\d+\.\d+/.test(line.trim()) ? 3 : 2 });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return b.blocks;
}

/** Strip inline Markdown syntax, keeping the readable text. */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');
}

export interface MarkdownResult {
  title?: string;
  blocks: Block[];
}

/** A compact CommonMark-ish parser that yields structured blocks. */
export function parseMarkdown(src: string): MarkdownResult {
  const b = new BlockBuilder();
  let text = src.replace(/\r\n?/g, '\n');
  let title: string | undefined;

  // YAML front matter.
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    const t = fm[1]!.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (t) title = t[1];
    text = text.slice(fm[0].length);
  }

  const lines = text.split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) b.add('paragraph', stripInlineMarkdown(para.join(' ')));
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];

    if (!line.trim()) {
      flush();
      continue;
    }
    // Fenced code.
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      b.add('code', body.join('\n'));
      continue;
    }
    // ATX heading.
    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (atx) {
      flush();
      const level = atx[1]!.length;
      const h = stripInlineMarkdown(atx[2]!);
      if (level === 1 && !title) title = h;
      b.add('heading', h, { level });
      continue;
    }
    // Setext heading.
    if (next !== undefined && para.length === 0 && /^\s*(=+|-+)\s*$/.test(next) && line.trim()) {
      const level = next.includes('=') ? 1 : 2;
      const h = stripInlineMarkdown(line.trim());
      if (level === 1 && !title) title = h;
      b.add('heading', h, { level });
      i++;
      continue;
    }
    // Horizontal rule.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    // Table.
    if (/^\s*\|.*\|\s*$/.test(line) && next !== undefined && /^\s*\|?\s*:?-{2,}/.test(next)) {
      flush();
      const rows: string[][] = [];
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => stripInlineMarkdown(c.trim()));
      rows.push(cells(line));
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      i--;
      b.add('table', rows.map((r) => r.join(' | ')).join('\n'), { rows });
      continue;
    }
    // Blockquote.
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [line.replace(/^\s*>\s?/, '')];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1]!)) body.push(lines[++i]!.replace(/^\s*>\s?/, ''));
      b.add('quote', stripInlineMarkdown(body.join(' ')));
      continue;
    }
    // List item (with lazy continuation lines).
    const li = line.match(/^(\s*)(?:[-*+]|\d{1,3}[.)])\s+(.*)$/);
    if (li) {
      flush();
      const body = [li[2]!];
      while (i + 1 < lines.length && lines[i + 1]!.trim() && /^\s{2,}\S/.test(lines[i + 1]!) && !/^\s*(?:[-*+]|\d{1,3}[.)])\s+/.test(lines[i + 1]!))
        body.push(lines[++i]!.trim());
      b.add('li', stripInlineMarkdown(body.join(' ').replace(/^\[[ xX]\]\s*/, '')), { level: Math.min(3, Math.floor(li[1]!.length / 2)) });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return { title, blocks: b.blocks };
}

export function looksLikeMarkdown(text: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/m.test(text) || /^```/m.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text) || /^\s*[-*]\s+\S/m.test(text) && /\*\*[^*]+\*\*/.test(text);
}
