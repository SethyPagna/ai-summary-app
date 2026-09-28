// Outline / mind-map tree: sections (from detected headings) with their most
// characteristic keyphrases. Documents without headings are organised around
// their top keyphrases and the phrases that co-occur with them.

import { escapeRegExp } from './text';
import { BACK_MATTER } from './segment';
import type { Keyphrase, OutlineNode, Section, Sentence } from './types';

const MAX_BRANCHES = 8;
const LEAVES = 3;

function occurrences(sentences: Sentence[], phrase: string): number[] {
  const re = new RegExp(`\\b${phrase.split(/\s+/).map(escapeRegExp).join('[\\s\\-]+')}`, 'i');
  const hits: number[] = [];
  for (const s of sentences) if (re.test(s.text)) hits.push(s.i);
  return hits;
}

export function buildOutline(title: string, sentences: Sentence[], sections: Section[], phrases: Keyphrase[]): OutlineNode {
  const root: OutlineNode = { id: 'root', label: title, kind: 'root', sentence: -1, children: [] };
  const occ = new Map(phrases.slice(0, 40).map((p) => [p.key, occurrences(sentences, p.phrase)]));

  const withContent = sections.filter((s) => s.sentEnd > s.sentStart && s.blockId !== null && !BACK_MATTER.test(s.title));
  if (withContent.length >= 2) {
    const minLevel = Math.min(...withContent.map((s) => s.level));
    let branches = withContent.filter((s) => s.level <= minLevel + 0);
    if (branches.length < 2) branches = withContent;
    if (branches.length > MAX_BRANCHES) {
      branches = branches
        .slice()
        .sort((a, b) => b.sentEnd - b.sentStart - (a.sentEnd - a.sentStart))
        .slice(0, MAX_BRANCHES)
        .sort((a, b) => a.index - b.index);
    }
    // A branch owns sentences until the next branch starts (so subsections roll up).
    const ranges = branches.map((b, k) => ({ b, start: b.sentStart, end: branches[k + 1]?.sentStart ?? sentences.length }));
    const usedAt = new Map<string, number>();
    for (const { b, start, end } of ranges) {
      const scored = phrases
        .slice(0, 40)
        .map((p) => {
          const hits = (occ.get(p.key) ?? []).filter((i) => i >= start && i < end);
          const total = occ.get(p.key)?.length ?? 1;
          // Distinctiveness: share of the phrase's occurrences inside this section.
          const multi = p.key.includes(' ') || /^[\p{Lu}]/u.test(p.phrase) ? 1.6 : 1;
          return { p, hits, s: hits.length ? multi * p.score * (hits.length / total) * (1 + Math.log(hits.length)) : 0 };
        })
        .filter((x) => x.s > 0 && !b.title.toLowerCase().includes(x.p.phrase.toLowerCase()))
        .sort((a, b2) => b2.s - a.s);
      const leaves: OutlineNode[] = [];
      for (const x of scored) {
        if (leaves.length >= LEAVES) break;
        if ((usedAt.get(x.p.key) ?? 0) >= 2) continue;
        // Skip a leaf that is part of (or contains) one already on this branch.
        if (leaves.some((l) => overlapsKey(l.id.split(':').slice(1).join(':'), x.p.key))) continue;
        usedAt.set(x.p.key, (usedAt.get(x.p.key) ?? 0) + 1);
        leaves.push({ id: `${b.index}:${x.p.key}`, label: x.p.phrase, kind: 'phrase', sentence: x.hits[0]!, children: [] });
      }
      root.children.push({ id: `s${b.index}`, label: b.title, kind: 'section', sentence: start < sentences.length ? start : -1, children: leaves });
    }
    return root;
  }

  // No usable headings: cluster by co-occurrence around the top phrases.
  const top = phrases.slice(0, 24);
  const taken = new Set<string>();
  for (const p of top) {
    if (root.children.length >= 6) break;
    if (taken.has(p.key)) continue;
    taken.add(p.key);
    const mine = new Set(occ.get(p.key) ?? []);
    const related = top
      .filter((q) => !taken.has(q.key))
      .map((q) => ({ q, co: (occ.get(q.key) ?? []).filter((i) => mine.has(i) || mine.has(i - 1) || mine.has(i + 1)).length }))
      .filter((x) => x.co > 0)
      .sort((a, b) => b.co - a.co || b.q.score - a.q.score)
      .slice(0, LEAVES);
    related.forEach((r) => taken.add(r.q.key));
    root.children.push({
      id: `k${p.key}`,
      label: p.phrase,
      kind: 'section',
      sentence: occ.get(p.key)?.[0] ?? -1,
      children: related.map((r) => ({ id: `k${p.key}:${r.q.key}`, label: r.q.phrase, kind: 'phrase', sentence: occ.get(r.q.key)?.[0] ?? -1, children: [] })),
    });
  }
  return root;
}

function overlapsKey(a: string, b: string): boolean {
  const pa = ` ${a} `;
  const pb = ` ${b} `;
  return pa.includes(pb) || pb.includes(pa);
}
