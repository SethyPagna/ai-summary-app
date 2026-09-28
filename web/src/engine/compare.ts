// Compare two analysed documents: overall similarity (TF-IDF cosine over
// term counts), shared vs unique keyphrases, and the most similar passages.

import { terms } from './text';
import { cosine, tfidfVectors, mapCosine } from './vectors';
import type { Analysis, Keyphrase } from './types';

export interface PassagePair {
  a: number; // chunk index in A
  b: number; // chunk index in B
  similarity: number;
  shared: string[];
}

export interface Comparison {
  similarity: number;
  shared: { a: Keyphrase; b: Keyphrase }[];
  onlyA: Keyphrase[];
  onlyB: Keyphrase[];
  passages: PassagePair[];
}

const MAX_CHUNKS = 160;

export function compareDocs(A: Pick<Analysis, 'keyphrases' | 'chunks' | 'terms'>, B: Pick<Analysis, 'keyphrases' | 'chunks' | 'terms'>): Comparison {
  // Keyphrases: exact stemmed-key matches, then single-word containment.
  const shared: { a: Keyphrase; b: Keyphrase }[] = [];
  const usedB = new Set<string>();
  const usedA = new Set<string>();
  const bByKey = new Map(B.keyphrases.map((k) => [k.key, k]));
  for (const a of A.keyphrases) {
    const b = bByKey.get(a.key);
    if (b) {
      shared.push({ a, b });
      usedA.add(a.key);
      usedB.add(b.key);
    }
  }
  for (const a of A.keyphrases) {
    if (usedA.has(a.key)) continue;
    const aw = a.key.split(' ');
    const b = B.keyphrases.find((k) => !usedB.has(k.key) && (aw.length === 1 ? k.key.split(' ').includes(a.key) : k.key.split(' ').length === 1 && aw.includes(k.key)));
    if (b) {
      shared.push({ a, b });
      usedA.add(a.key);
      usedB.add(b.key);
    }
  }
  shared.sort((x, y) => y.a.score + y.b.score - (x.a.score + x.b.score));

  // Document similarity from term counts with a pair-level IDF.
  const idfPair = (k: string) => (k in A.terms && k in B.terms ? 1 : 1.6);
  const weigh = (t: Record<string, number>) => {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(t)) m.set(k, (1 + Math.log(v)) * idfPair(k));
    return m;
  };
  const similarity = mapCosine(weigh(A.terms), weigh(B.terms));

  // Passages: TF-IDF over the union of chunks.
  const ca = A.chunks.slice(0, MAX_CHUNKS);
  const cb = B.chunks.slice(0, MAX_CHUNKS);
  const lists = [...ca.map((c) => terms(c.text)), ...cb.map((c) => terms(c.text))];
  const { vecs } = tfidfVectors(lists);
  const pairs: PassagePair[] = [];
  for (let i = 0; i < ca.length; i++) {
    for (let j = 0; j < cb.length; j++) {
      const s = cosine(vecs[i]!, vecs[ca.length + j]!);
      if (s > 0.08) pairs.push({ a: i, b: j, similarity: s, shared: [] });
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);
  const top: PassagePair[] = [];
  const seenA = new Set<number>();
  const seenB = new Set<number>();
  for (const p of pairs) {
    if (top.length >= 5) break;
    if (seenA.has(p.a) || seenB.has(p.b)) continue;
    seenA.add(p.a);
    seenB.add(p.b);
    const ta = new Set(lists[p.a]);
    p.shared = [...new Set(lists[ca.length + p.b]!.filter((t) => ta.has(t)))].slice(0, 6);
    top.push(p);
  }

  return {
    similarity,
    shared: shared.slice(0, 16),
    onlyA: A.keyphrases.filter((k) => !usedA.has(k.key)).slice(0, 12),
    onlyB: B.keyphrases.filter((k) => !usedB.has(k.key)).slice(0, 12),
    passages: top,
  };
}
