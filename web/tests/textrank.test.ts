import { describe, expect, it } from 'vitest';
import { mmrSelect, pagerank, pickSummaries, rankSentences, type RankInput } from '../src/engine/textrank';
import { analyze } from '../src/engine/analyze';
import { loadMarkdownSample, loadPdfSample } from './helpers';

const input = (text: string, i: number, n: number): RankInput => ({
  text,
  words: text.split(/\s+/).length,
  posInSection: i,
  relPos: n > 1 ? i / (n - 1) : 0,
  eligible: true,
});

describe('pagerank', () => {
  it('ranks the hub of a star graph highest', () => {
    const n = 5;
    const W = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 1; i < n; i++) {
      W[0]![i] = 1;
      W[i]![0] = 1;
    }
    const r = pagerank(W, new Array(n).fill(1));
    expect(r.indexOf(Math.max(...r))).toBe(0);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('rankSentences', () => {
  it('gives the most central sentence the top score', () => {
    const sents = [
      'Coffee plants need shade and steady rain to grow well.',
      'Tea bushes prefer cool hillsides with morning mist.',
      'Coffee and tea both need shade, rain and cool hillsides to grow well.',
      'Some farmers grow cocoa alongside their coffee.',
      'The weather on the hillsides changes quickly in spring.',
    ];
    const res = rankSentences(sents.map((s, i) => input(s, i, sents.length)));
    const best = res.scores.indexOf(Math.max(...res.scores));
    expect(best).toBe(2);
  });
});

describe('mmrSelect', () => {
  it('avoids picking near-duplicates', () => {
    const rel = [1, 0.99, 0.5];
    const sim = (a: number, b: number) => ((a === 0 && b === 1) || (a === 1 && b === 0) ? 0.95 : 0.1);
    expect(mmrSelect([0, 1, 2], (i) => rel[i]!, sim, 2, 0.6)).toEqual([0, 2]);
  });
});

describe('pickSummaries on real documents', () => {
  it('returns ordered, unique, length-appropriate summaries', async () => {
    for (const doc of [await loadPdfSample(), loadMarkdownSample()]) {
      const a = analyze('t', doc.title, doc.blocks);
      const { tldr, short, detailed } = a.summary;
      expect(tldr.length).toBeGreaterThanOrEqual(1);
      expect(short.length).toBeGreaterThanOrEqual(3);
      expect(detailed.length).toBeGreaterThan(short.length);
      for (const list of [tldr, short, detailed]) {
        expect([...list].sort((x, y) => x - y)).toEqual(list); // document order
        expect(new Set(list).size).toBe(list.length);
      }
      // References are never summary material.
      for (const i of detailed) expect(a.sentences[i]!.text).not.toMatch(/Psychological (Science|Bulletin)/);
    }
  });

  it('is deterministic', async () => {
    const doc = await loadPdfSample();
    expect(analyze('a', doc.title, doc.blocks).summary).toEqual(analyze('a', doc.title, doc.blocks).summary);
  });

  it('handles tiny inputs', () => {
    const r = rankSentences([input('Only one sentence here.', 0, 1)]);
    expect(pickSummaries([input('Only one sentence here.', 0, 1)], r).tldr).toEqual([0]);
  });
});
