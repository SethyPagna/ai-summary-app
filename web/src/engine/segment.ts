// Turns structured blocks into sentences, sections and retrieval chunks while
// preserving anchors (page / slide / section) for every piece.

import { countWords, splitSentences } from './text';
import type { Anchor, Block, Chunk, Section, Sentence } from './types';

export const BACK_MATTER = /^(?:\d+\.?\s+)?(references|bibliography|works cited|citations|acknowledg(e)?ments?|appendix\b.*)$/i;

export interface Segmented {
  sentences: Sentence[];
  sections: Section[];
  /** Per sentence: may it appear in a summary? (tables, fragments are excluded) */
  eligible: boolean[];
  /** Per sentence: part of back matter (references, appendix)? */
  backMatter: boolean[];
  paragraphs: number;
}

export function segment(blocks: Block[], docTitle: string): Segmented {
  const sentences: Sentence[] = [];
  const eligible: boolean[] = [];
  const back: boolean[] = [];
  const sections: Section[] = [];
  let paragraphs = 0;

  const openSection = (title: string, level: number, blockId: string | null, anchor: Anchor) => {
    const prev = sections[sections.length - 1];
    if (prev) prev.sentEnd = sentences.length;
    sections.push({ index: sections.length, title, level, blockId, sentStart: sentences.length, sentEnd: sentences.length, anchor });
  };

  const firstHeadingIdx = blocks.findIndex((b) => b.kind === 'heading');
  const firstContentIdx = blocks.findIndex((b) => b.kind !== 'heading');
  // A leading heading that equals the title is the title, not a section.
  const titleBlock =
    firstHeadingIdx === 0 && (firstContentIdx === -1 || firstContentIdx > 0) && norm(blocks[0]!.text) === norm(docTitle) ? blocks[0]!.id : null;

  openSection(docTitle, 0, null, blocks[0]?.anchor ?? {});

  for (const b of blocks) {
    if (b.kind === 'heading') {
      if (b.id === titleBlock) continue;
      openSection(b.text, b.level ?? 2, b.id, b.anchor);
      continue;
    }
    if (b.kind === 'code') continue;
    const sectionIdx = sections.length - 1;
    if (b.kind === 'table') {
      // Each row becomes its own (non-summary) sentence.
      let offset = 0;
      for (const line of b.text.split('\n')) {
        const start = offset;
        const end = offset + line.length;
        offset = end + 1;
        if (!line.trim()) continue;
        sentences.push({ i: sentences.length, blockId: b.id, start, end, text: line, words: countWords(line), section: sectionIdx });
        eligible.push(false);
        back.push(false);
      }
      paragraphs++;
      continue;
    }
    paragraphs++;
    const backMatter = BACK_MATTER.test(sections[sectionIdx]?.title ?? '');
    for (const sp of splitSentences(b.text)) {
      const w = countWords(sp.text);
      if (w === 0) continue;
      sentences.push({ i: sentences.length, blockId: b.id, start: sp.start, end: sp.end, text: sp.text, words: w, section: sectionIdx });
      const letters = sp.text.replace(/[^\p{L}]/gu, '').length;
      back.push(backMatter);
      const standfirst = /^(?:how|why|what|when|where|who)\b/i.test(sp.text) && !/\?["”']?$/.test(sp.text);
      // "Attendees: A, B, C" / "Date: Tuesday…" are metadata, not summary material.
      const labelValue = /^[\p{Lu}][\p{L}\s]{1,24}:\s/u.test(sp.text) && !/[.!?]["”']?$/.test(sp.text);
      eligible.push(!backMatter && !standfirst && !labelValue && w >= 6 && w <= 70 && letters / sp.text.length > 0.55 && !/:\s*$/.test(sp.text));
    }
  }
  const last = sections[sections.length - 1];
  if (last) last.sentEnd = sentences.length;

  // Drop an empty leading "title" section if real sections follow.
  if (sections.length > 1 && sections[0]!.sentEnd === sections[0]!.sentStart) {
    sections.shift();
    sections.forEach((s, i) => (s.index = i));
    for (const s of sentences) s.section = Math.max(0, s.section - 1);
  }
  return { sentences, sections, eligible, backMatter: back, paragraphs };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const CHUNK_TARGET = 110;
const CHUNK_MAX = 170;

export function chunkSentences(sentences: Sentence[], sections: Section[], blocks: Block[]): Chunk[] {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const chunks: Chunk[] = [];
  let cur: Sentence[] = [];
  let words = 0;

  const locKey = (s: Sentence) => {
    const a = blockById.get(s.blockId)?.anchor ?? {};
    return `${s.section}|${a.page ?? ''}|${a.slide ?? ''}`;
  };

  const flush = () => {
    if (!cur.length) return;
    const first = cur[0]!;
    const blockIds = [...new Set(cur.map((s) => s.blockId))];
    const anchor = { ...(blockById.get(first.blockId)?.anchor ?? {}) };
    const heading = sections[first.section]?.title ?? '';
    chunks.push({
      id: `c${chunks.length}`,
      index: chunks.length,
      sentStart: first.i,
      sentEnd: cur[cur.length - 1]!.i + 1,
      blockIds,
      anchor,
      heading,
      text: cur.map((s) => s.text).join(' '),
    });
    cur = [];
    words = 0;
  };

  for (const s of sentences) {
    if (cur.length && locKey(cur[0]!) !== locKey(s)) flush();
    if (cur.length && words >= CHUNK_TARGET && words + s.words > CHUNK_MAX) flush();
    cur.push(s);
    words += s.words;
  }
  flush();
  return chunks;
}

/** Human label for an anchor: "p. 3", "Slide 4" or "§ Methods". */
export function anchorLabel(anchor: Anchor | undefined, fallback = ''): string {
  if (!anchor) return fallback;
  if (anchor.page) return `p. ${anchor.page}`;
  if (anchor.slide) return `Slide ${anchor.slide}`;
  if (anchor.section) return `§ ${shorten(anchor.section, 28)}`;
  return fallback;
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
