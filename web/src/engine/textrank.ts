// Extractive summarisation: biased TextRank over a sentence-similarity graph,
// followed by Maximal Marginal Relevance (MMR) selection for diversity.

import { terms } from './text';
import { cosine, tfidfVectors, type SparseVec } from './vectors';

export interface RankInput {
  text: string;
  words: number;
  /** Position within its section (0 = first sentence). */
  posInSection: number;
  /** Relative position in the document, 0..1. */
  relPos: number;
  /** Terms of the enclosing section heading, stemmed. */
  headingTerms?: string[];
  eligible: boolean;
  /** 0..1: how much of the document's keyphrase mass this sentence carries. */
  phraseWeight?: number;
  /** Speaker notes and similar asides rank a little lower. */
  aside?: boolean;
}

export interface RankResult {
  scores: number[]; // normalised to 0..1
  vecs: SparseVec[];
}

const DAMPING = 0.85;
/** Weight of TF-IDF cosine vs. TextRank's overlap measure (tuned on the samples). */
const SIM_MIX = 0.5;
const MAX_NODES = 450;

/** Personalised PageRank over the weighted similarity graph. */
export function pagerank(weights: Float64Array[], bias: number[], iterations = 60, tol = 1e-6): number[] {
  const n = bias.length;
  if (n === 0) return [];
  const biasSum = bias.reduce((a, b) => a + b, 0) || 1;
  const p = bias.map((b) => b / biasSum);
  const outSum = weights.map((row) => row.reduce((a, b) => a + b, 0));
  let r = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < iterations; it++) {
    const next = new Array<number>(n).fill(0);
    let dangling = 0;
    for (let j = 0; j < n; j++) {
      const s = outSum[j]!;
      if (s === 0) {
        dangling += r[j]!;
        continue;
      }
      const row = weights[j]!;
      const share = r[j]! / s;
      for (let i = 0; i < n; i++) {
        const w = row[i]!;
        if (w) next[i]! += w * share;
      }
    }
    let delta = 0;
    for (let i = 0; i < n; i++) {
      const v = (1 - DAMPING) * p[i]! + DAMPING * (next[i]! + dangling * p[i]!);
      delta += Math.abs(v - r[i]!);
      next[i] = v;
    }
    r = next;
    if (delta < tol) break;
  }
  return r;
}

/**
 * Score every sentence. Long documents are pre-filtered to the most central
 * MAX_NODES sentences (by similarity to the document centroid) so the graph
 * stays O(n²) on a bounded n.
 */
export function rankSentences(inputs: RankInput[]): RankResult {
  const termLists = inputs.map((s) => terms(s.text));
  const { vecs } = tfidfVectors(termLists);
  const n = inputs.length;
  const scores = new Array<number>(n).fill(0);
  if (n === 0) return { scores, vecs };

  let nodes = inputs.map((_, i) => i).filter((i) => inputs[i]!.eligible && termLists[i]!.length > 0);
  if (nodes.length === 0) nodes = inputs.map((_, i) => i);

  if (nodes.length > MAX_NODES) {
    // Centroid pre-filter.
    const centroid = new Map<number, number>();
    for (const i of nodes) {
      const v = vecs[i]!;
      for (let k = 0; k < v.ids.length; k++) centroid.set(v.ids[k]!, (centroid.get(v.ids[k]!) ?? 0) + v.w[k]! / (v.norm || 1));
    }
    const cent = [...centroid.entries()].sort((a, b) => a[0] - b[0]);
    const cv: SparseVec = {
      ids: Int32Array.from(cent.map((e) => e[0])),
      w: Float64Array.from(cent.map((e) => e[1])),
      norm: Math.sqrt(cent.reduce((a, e) => a + e[1] * e[1], 0)),
    };
    nodes = nodes
      .map((i) => ({ i, s: cosine(vecs[i]!, cv) + (inputs[i]!.posInSection === 0 ? 0.05 : 0) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_NODES)
      .map((x) => x.i)
      .sort((a, b) => a - b);
  }

  const m = nodes.length;
  const W: Float64Array[] = Array.from({ length: m }, () => new Float64Array(m));
  // Edge weight blends TF-IDF cosine with the original TextRank overlap
  // measure |Si ∩ Sj| / (log|Si| + log|Sj|), which favours substantive
  // sentences over short ones that happen to share a rare word.
  const mix = SIM_MIX;
  const sets = nodes.map((i) => new Set(termLists[i]));
  const logLen = nodes.map((i) => Math.log(termLists[i]!.length + 1));
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      const cos = cosine(vecs[nodes[a]!]!, vecs[nodes[b]!]!);
      if (cos <= 0) continue;
      let inter = 0;
      const [small, large] = sets[a]!.size < sets[b]!.size ? [sets[a]!, sets[b]!] : [sets[b]!, sets[a]!];
      for (const t of small) if (large.has(t)) inter++;
      const overlap = inter / (logLen[a]! + logLen[b]! || 1);
      const sim = mix * cos + (1 - mix) * Math.min(1, overlap / 2);
      if (sim > 0.04) {
        W[a]![b] = sim;
        W[b]![a] = sim;
      }
    }
  }

  const bias = nodes.map((i) => {
    const s = inputs[i]!;
    let b = 1;
    b += 0.35 / (1 + s.posInSection); // lead sentences of a section
    b += 0.3 * (1 - s.relPos); // earlier in the document
    b += 1.2 * (s.phraseWeight ?? 0); // carries the document's keyphrases
    if (s.headingTerms?.length) {
      const own = new Set(termLists[i]);
      const hits = s.headingTerms.filter((t) => own.has(t)).length;
      b += 0.5 * (hits / s.headingTerms.length);
    }
    if (s.words < 8) b *= 0.45;
    else if (s.words < 12) b *= 0.75;
    if (s.words > 45) b *= 0.8;
    if (!/[.!?:;"”')\]]$/.test(s.text)) b *= 0.6; // fragments, captions, bylines
    if (/^(?:how|why|what|when|where|who)\b/i.test(s.text) && !/\?\s*$/.test(s.text)) b *= 0.5; // headline-style standfirsts
    if (s.aside) b *= 0.6;
    if (/\?\s*$/.test(s.text)) b *= 0.6;
    return b;
  });

  const r = pagerank(W, bias);
  const max = Math.max(...r);
  const min = Math.min(...r);
  nodes.forEach((i, k) => {
    scores[i] = max > min ? 0.05 + (0.95 * (r[k]! - min)) / (max - min) : 1;
  });
  return { scores, vecs };
}

/**
 * Greedy MMR: pick `k` items maximising λ·relevance − (1−λ)·redundancy.
 * Returns indices in selection order.
 */
export function mmrSelect(candidates: number[], relevance: (i: number) => number, similarity: (a: number, b: number) => number, k: number, lambda = 0.7): number[] {
  const chosen: number[] = [];
  const pool = new Set(candidates);
  while (chosen.length < k && pool.size) {
    let best = -1;
    let bestScore = -Infinity;
    for (const i of pool) {
      let red = 0;
      for (const j of chosen) red = Math.max(red, similarity(i, j));
      const s = lambda * relevance(i) - (1 - lambda) * red;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) break;
    chosen.push(best);
    pool.delete(best);
  }
  return chosen;
}

export interface SummaryPick {
  tldr: number[];
  short: number[];
  detailed: number[];
}

export function pickSummaries(inputs: RankInput[], rank: RankResult, sectionOf: (i: number) => number = () => 0): SummaryPick {
  const n = inputs.length;
  const eligible = inputs.map((_, i) => i).filter((i) => inputs[i]!.eligible);
  const pool = eligible.length ? eligible : inputs.map((_, i) => i);
  // Redundancy also counts "same section" so summaries spread across the document.
  const sim = (a: number, b: number) => Math.max(cosine(rank.vecs[a]!, rank.vecs[b]!), sectionOf(a) === sectionOf(b) ? 0.3 : 0);
  const rel = (i: number) => rank.scores[i]!;
  const byOrder = (xs: number[]) => xs.slice().sort((a, b) => a - b);

  const ranked = pool.slice().sort((a, b) => rank.scores[b]! - rank.scores[a]!);
  // Limit MMR candidates for speed; the tail never gets picked anyway.
  const cands = ranked.slice(0, 120);

  const shortK = clamp(Math.round(n * 0.08), 4, 6);
  const detailedK = clamp(Math.round(n * 0.2), Math.min(6, pool.length), 14);

  // TL;DR: the single best sentence (preferring medium length), plus a second
  // if the first is very short.
  // TL;DR: the best-ranked sentence of a comfortable length (a slightly
  // lower-ranked 14–40 word sentence beats a terse top one); a second
  // sentence only when the first is very short.
  // Ranking weighs in keyphrase coverage: the gist should mention what the document is about.
  const gist = (i: number) => rank.scores[i]! * (0.8 + 0.4 * (inputs[i]!.phraseWeight ?? 0));
  const byGist = (xs: number[]) => xs.slice().sort((a, b) => gist(b) - gist(a));
  // Speaker notes and other asides only stand in when nothing else qualifies.
  const main = cands.filter((i) => !inputs[i]!.aside);
  const base = (main.length ? main : cands).slice(0, 25);
  const comfy = byGist(base.filter((i) => inputs[i]!.words >= 14 && inputs[i]!.words <= 40));
  const tldrCands = byGist(base.filter((i) => inputs[i]!.words >= 8 && inputs[i]!.words <= 42));
  const top = (tldrCands.length ? tldrCands : cands)[0];
  const first = comfy[0] !== undefined && top !== undefined && gist(comfy[0]) >= gist(top) * 0.8 ? comfy[0] : top;
  const tldr: number[] = [];
  if (first !== undefined) {
    tldr.push(first);
    if (inputs[first]!.words < 12) {
      const second = mmrSelect(cands.filter((i) => i !== first && inputs[i]!.words <= 30), rel, sim, 1, 0.6)[0];
      if (second !== undefined) tldr.push(second);
    }
  }

  const short = byOrder(mmrSelect(cands, rel, sim, Math.min(shortK, cands.length), 0.6));
  const detailed = byOrder(mmrSelect(cands, rel, sim, Math.min(detailedK, cands.length), 0.75));
  return { tldr: byOrder(tldr), short, detailed };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
