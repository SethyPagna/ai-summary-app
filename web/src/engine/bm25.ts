// Okapi BM25 over retrieval chunks, with light query expansion:
//  1. stemming + stopword/question-word removal,
//  2. a small synonym table (weight 0.5),
//  3. typo tolerance against the index vocabulary (edit distance ≤ 2),
//  4. optional pseudo-relevance feedback from the top results (weight 0.3).

import { QUESTION_WORDS, STOPWORDS, editDistance, stem, tokenize } from './text';

export interface WeightedTerm {
  term: string; // stemmed
  weight: number;
  source: 'query' | 'synonym' | 'typo' | 'feedback';
  surface: string;
}

export interface Hit {
  id: number;
  score: number;
}

const K1 = 1.2;
const B = 0.75;

const SYNONYMS: Record<string, string[]> = {
  aim: ['goal', 'objective', 'purpose'],
  goal: ['aim', 'objective', 'purpose'],
  objective: ['goal', 'aim'],
  purpose: ['goal', 'aim'],
  result: ['finding', 'outcome', 'effect'],
  finding: ['result', 'outcome'],
  outcome: ['result', 'finding', 'effect'],
  effect: ['impact', 'result', 'outcome'],
  impact: ['effect', 'consequence'],
  problem: ['issue', 'challenge', 'risk'],
  issue: ['problem', 'challenge', 'risk'],
  challenge: ['problem', 'issue', 'difficulty'],
  risk: ['threat', 'problem'],
  threat: ['risk', 'danger'],
  method: ['approach', 'technique', 'procedure', 'methodology'],
  approach: ['method', 'technique', 'strategy'],
  cost: ['price', 'budget', 'expense', 'spend'],
  price: ['cost'],
  budget: ['cost', 'spend', 'funding'],
  money: ['budget', 'funding', 'cost'],
  decide: ['decision', 'agree', 'approved'],
  decision: ['decided', 'agreed', 'approved'],
  deadline: ['due', 'date', 'by'],
  benefit: ['advantage', 'gain', 'improvement'],
  advantage: ['benefit', 'strength'],
  drawback: ['limitation', 'disadvantage', 'weakness'],
  limitation: ['limit', 'drawback', 'weakness', 'caveat'],
  weakness: ['limitation', 'drawback'],
  conclusion: ['conclude', 'summary', 'takeaway'],
  improve: ['increase', 'boost', 'better', 'gain'],
  increase: ['rise', 'grow', 'improve', 'higher'],
  decrease: ['drop', 'decline', 'reduce', 'lower', 'fall'],
  reduce: ['decrease', 'lower', 'cut'],
  student: ['learner', 'participant'],
  participant: ['student', 'subject', 'respondent'],
  people: ['person', 'participant', 'population'],
  team: ['group', 'staff'],
  plan: ['roadmap', 'schedule', 'timeline'],
  next: ['upcoming', 'future', 'follow'],
  task: ['action', 'todo', 'assignment'],
  action: ['task', 'owner', 'todo'],
  owner: ['responsible', 'assigned', 'lead'],
  fish: ['fishery', 'fisheries', 'catch'],
  water: ['flood', 'river', 'lake'],
  large: ['big', 'major'],
  small: ['minor', 'little'],
  important: ['key', 'significant', 'major'],
  learn: ['study', 'learning', 'memory'],
  memory: ['recall', 'retention', 'remember'],
  remember: ['recall', 'retain', 'memory'],
  sleep: ['rest', 'night'],
  test: ['exam', 'quiz', 'assessment'],
  exam: ['test', 'assessment', 'quiz'],
  future: ['next', 'upcoming', 'later'],
  danger: ['risk', 'threat'],
  data: ['dataset', 'evidence', 'measurement'],
  deep: ['depth'],
  depth: ['deep'],
  tall: ['height', 'high'],
  high: ['height'],
  wide: ['width'],
  far: ['distance'],
  big: ['large', 'size', 'area'],
  found: ['founded', 'created', 'established'],
  founded: ['created', 'established', 'formed'],
  start: ['begin', 'launch', 'created'],
  begin: ['start'],
  celebrate: ['festival', 'celebration'],
  festival: ['celebrate', 'celebration'],
  why: ['because', 'reason'],
};

export interface IndexedUnit {
  terms: string[];
}

export class BM25 {
  readonly N: number;
  private avgdl: number;
  private dl: number[];
  private tf: Map<string, number>[];
  private df = new Map<string, number>();

  constructor(units: IndexedUnit[]) {
    this.N = units.length;
    this.tf = units.map((u) => {
      const m = new Map<string, number>();
      for (const t of u.terms) m.set(t, (m.get(t) ?? 0) + 1);
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return m;
    });
    this.dl = units.map((u) => u.terms.length);
    this.avgdl = this.dl.reduce((a, b) => a + b, 0) / Math.max(1, this.N);
  }

  idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  has(term: string): boolean {
    return this.df.has(term);
  }

  vocabulary(): IterableIterator<string> {
    return this.df.keys();
  }

  termFreq(id: number, term: string): number {
    return this.tf[id]?.get(term) ?? 0;
  }

  termsOf(id: number): Map<string, number> {
    return this.tf[id] ?? new Map();
  }

  scoreOne(id: number, query: WeightedTerm[]): number {
    const tf = this.tf[id];
    if (!tf) return 0;
    const norm = K1 * (1 - B + (B * this.dl[id]!) / (this.avgdl || 1));
    let s = 0;
    for (const q of query) {
      const f = tf.get(q.term);
      if (!f) continue;
      s += q.weight * this.idf(q.term) * ((f * (K1 + 1)) / (f + norm));
    }
    return s;
  }

  search(query: WeightedTerm[], k = 10): Hit[] {
    const hits: Hit[] = [];
    for (let id = 0; id < this.N; id++) {
      const score = this.scoreOne(id, query);
      if (score > 0) hits.push({ id, score });
    }
    hits.sort((a, b) => b.score - a.score || a.id - b.id);
    return hits.slice(0, k);
  }
}

/** Parse a natural-language query into weighted, expanded stemmed terms. */
export function parseQuery(query: string, index?: BM25): WeightedTerm[] {
  const out = new Map<string, WeightedTerm>();
  const put = (t: WeightedTerm) => {
    const prev = out.get(t.term);
    if (!prev || prev.weight < t.weight) out.set(t.term, t);
  };
  const toks = tokenize(query).filter((t) => !STOPWORDS.has(t.word) && !QUESTION_WORDS.has(t.word) && (t.word.length > 1 || /\d/.test(t.word)));
  for (const t of toks) {
    const st = stem(t.word);
    put({ term: st, weight: 1, source: 'query', surface: t.word });
    const syns = SYNONYMS[t.word] ?? SYNONYMS[st];
    if (syns) for (const s of syns) put({ term: stem(s), weight: 0.5, source: 'synonym', surface: s });
    if (index && !index.has(st) && st.length >= 5) {
      // Typo tolerance: nearest vocabulary term (distance 1, or 2 for long words).
      const maxD = st.length >= 8 ? 2 : 1;
      let best: string | null = null;
      let bestD = maxD + 1;
      for (const v of index.vocabulary()) {
        if (Math.abs(v.length - st.length) > maxD || v[0] !== st[0]) continue;
        const d = editDistance(st, v, maxD);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      if (best) put({ term: best, weight: 0.8, source: 'typo', surface: best });
    }
  }
  return [...out.values()];
}

/** RM3-lite pseudo-relevance feedback: add salient terms from the top hits. */
export function expandWithFeedback(index: BM25, query: WeightedTerm[], hits: Hit[], topDocs = 2, addTerms = 4): WeightedTerm[] {
  if (!hits.length) return query;
  const have = new Set(query.map((q) => q.term));
  const scores = new Map<string, number>();
  for (const h of hits.slice(0, topDocs)) {
    for (const [t, f] of index.termsOf(h.id)) {
      if (have.has(t) || t.length < 3 || /^\d+$/.test(t)) continue;
      scores.set(t, (scores.get(t) ?? 0) + (1 + Math.log(f)) * index.idf(t));
    }
  }
  const extra = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, addTerms)
    .map(([term]) => ({ term, weight: 0.3, source: 'feedback' as const, surface: term }));
  return [...query, ...extra];
}
