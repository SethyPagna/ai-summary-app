// Sparse TF-IDF vectors with integer term ids, and cosine similarity by
// merge-join. Small, fast and allocation-light.

export interface SparseVec {
  ids: Int32Array; // sorted ascending
  w: Float64Array;
  norm: number;
}

export class Vocab {
  private map = new Map<string, number>();
  id(term: string): number {
    let v = this.map.get(term);
    if (v === undefined) {
      v = this.map.size;
      this.map.set(term, v);
    }
    return v;
  }
  get(term: string): number | undefined {
    return this.map.get(term);
  }
  get size(): number {
    return this.map.size;
  }
}

/** Build TF-IDF vectors for a set of term lists (one list per unit). */
export function tfidfVectors(units: string[][], vocab = new Vocab()): { vecs: SparseVec[]; df: Map<number, number>; vocab: Vocab } {
  const df = new Map<number, number>();
  const tfs: Map<number, number>[] = units.map((ts) => {
    const tf = new Map<number, number>();
    for (const t of ts) {
      const id = vocab.id(t);
      tf.set(id, (tf.get(id) ?? 0) + 1);
    }
    for (const id of tf.keys()) df.set(id, (df.get(id) ?? 0) + 1);
    return tf;
  });
  const N = units.length;
  const vecs = tfs.map((tf) => {
    const entries = [...tf.entries()].sort((a, b) => a[0] - b[0]);
    const ids = new Int32Array(entries.length);
    const w = new Float64Array(entries.length);
    let norm = 0;
    entries.forEach(([id, c], k) => {
      const idf = Math.log((N + 1) / ((df.get(id) ?? 0) + 1)) + 1;
      const weight = (1 + Math.log(c)) * idf;
      ids[k] = id;
      w[k] = weight;
      norm += weight * weight;
    });
    return { ids, w, norm: Math.sqrt(norm) };
  });
  return { vecs, df, vocab };
}

export function cosine(a: SparseVec, b: SparseVec): number {
  if (!a.norm || !b.norm) return 0;
  let i = 0;
  let j = 0;
  let dot = 0;
  const ai = a.ids;
  const bi = b.ids;
  while (i < ai.length && j < bi.length) {
    const x = ai[i]!;
    const y = bi[j]!;
    if (x === y) {
      dot += a.w[i]! * b.w[j]!;
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return dot / (a.norm * b.norm);
}

/** Cosine similarity between two plain term→weight maps. */
export function mapCosine(a: Map<string, number> | Record<string, number>, b: Map<string, number> | Record<string, number>): number {
  const A = a instanceof Map ? a : new Map(Object.entries(a));
  const B = b instanceof Map ? b : new Map(Object.entries(b));
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of A) {
    na += v * v;
    const w = B.get(k);
    if (w) dot += v * w;
  }
  for (const v of B.values()) nb += v * v;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}
