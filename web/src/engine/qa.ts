// Extractive question answering: BM25 retrieves chunks, then candidate
// sentences are re-scored by weighted query-term coverage, chunk relevance,
// answer-type cues (dates for "when", numbers for "how many", …) and TextRank
// centrality. It answers only with sentences from the sources and says so
// plainly when nothing relevant is found.

import { BM25, expandWithFeedback, parseQuery, type WeightedTerm } from './bm25';
import { mmrSelect } from './textrank';
import { stem, terms, tokenize } from './text';
import type { Analysis, Chunk } from './types';

export interface QaSource {
  docId: string;
  title: string;
  analysis: Pick<Analysis, 'sentences' | 'chunks' | 'scores' | 'summary'>;
}

export interface QaUnit {
  source: number;
  chunk: Chunk;
}

export interface QaIndex {
  bm25: BM25;
  units: QaUnit[];
  sources: QaSource[];
}

export type Confidence = 'high' | 'medium' | 'low';

export interface QaSentence {
  docId: string;
  sentence: number;
  text: string;
}

export interface QaAnswer {
  kind: 'answer' | 'overview' | 'not_found';
  confidence: Confidence;
  shortAnswer?: string;
  sentences: QaSentence[];
  matchedTerms: string[];
  missingTerms: string[];
  related: { docId: string; sentence: number; heading: string }[];
  message?: string;
}

type QType = 'date' | 'number' | 'name' | 'cause' | 'method' | 'definition' | 'general' | 'other';

export function buildQaIndex(sources: QaSource[]): QaIndex {
  const units: QaUnit[] = [];
  sources.forEach((src, si) => {
    for (const c of src.analysis.chunks) units.push({ source: si, chunk: c });
  });
  // Headings are indexed twice to give section titles a gentle boost.
  const bm25 = new BM25(units.map((u) => ({ terms: [...terms(u.chunk.heading), ...terms(u.chunk.heading), ...terms(u.chunk.text)] })));
  return { bm25, units, sources };
}

export function questionType(q: string): QType {
  const s = q.toLowerCase().trim();
  if (/^(summari[sz]e|tl;?dr|overview)\b|what(?:'s| is) (?:this|the) (?:document|doc|text|paper|file|article|deck|report)(?: mainly)? about|\b(main|key) (points|ideas|takeaways|themes)\b|^what (?:is|are) (?:this|these) about/.test(s))
    return 'general';
  if (/^when\b|\bwhat (year|date|day|month|time)\b|\b(deadline|due date|by when)\b/.test(s)) return 'date';
  if (/\bhow (many|much|long|often|large|big|far|fast|deep|high|tall|wide|old|heavy|small|early|late)\b|\bwhat (percentage|percent|proportion|share|number|amount|fraction|size|score|rate)\b/.test(s)) return 'number';
  if (/^who\b|\bwhich (person|people|team|company|organi[sz]ation|member)\b|\bwho (is|are|was|were|will)\b/.test(s)) return 'name';
  if (/^why\b|\breasons?\b|\bcause[sd]?\b|\bwhat (led|leads) to\b/.test(s)) return 'cause';
  if (/^how\b|\bwhat steps\b|\bprocess\b/.test(s)) return 'method';
  if (/^(what|who) (is|are|was|were) (an? |the )?[\w\s-]{2,40}\??$|\bdefin(e|ition)\b|\bmeaning of\b|\bwhat does .+ mean\b|\bwhat is meant by\b/.test(s)) return 'definition';
  return 'other';
}

const DATE_RE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?|\b\d{4}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b|\b(?:19|20)\d{2}\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;
const CAUSE_RE = /\b(because|due to|since|as a result|therefore|so that|led to|leads to|caus(?:e|ed|es)|reason|driven by|thanks to|explains?)\b/i;
const METHOD_RE = /\b(by|using|through|via|steps?|method|approach|process|procedure|first|then)\b/i;

const MONTH_RE = /\b(?:(?:early|mid|late)[-\s])?(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/;
const NUM_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|a hundred|hundreds of|a thousand|thousands of|a few|several|a|an)';
const QUANTITY_RE = new RegExp(
  `(?:[$€£¥៛]\\s?)?\\b\\d[\\d,]*(?:\\.\\d+)?\\s?(?:%|percent|per cent|percentage points)?(?:\\s?[a-zA-Z²]+(?:\\s[a-zA-Z²]+)?)?|\\b${NUM_WORD}\\s+[a-zA-Z²]+(?:\\s[a-zA-Z²]+)?`,
  'gi',
);

/** Units a "how …" question expects, e.g. "how deep" -> lengths. */
function unitPreference(question: string): RegExp | null {
  const q = question.toLowerCase();
  if (/how (large|big)|\barea\b|\bsize\b/.test(q)) return /\bsquare\b|km²|km2|\bhectares?\b|\bacres?\b/i;
  if (/how (deep|tall|high|wide|far|long is)/.test(q) || /\b(depth|height|width|distance)\b/.test(q))
    return /^(?!.*\bsquare\b).*\b(?:metres?|meters?|m|km|kilometres?|kilometers?|feet|ft|miles?|cm|mm)\b/i;
  if (/how (long|often)|\bduration\b/.test(q)) return /\b(?:hours?|minutes?|days?|weeks?|months?|years?|times|sessions?)\b/i;
  if (/\b(cost|budget|price|spend|spent|money|pay|paid|fund\w*|salary|fee)\b/.test(q)) return /[$€£¥៛]|\b(?:dollars?|usd|eur|riel)\b/i;
  if (/percent|percentage|proportion|share|what fraction/.test(q)) return /%|percent|percentage/i;
  if (/how many/.test(q)) return null;
  return null;
}

function shortAnswerFor(type: QType, text: string, question = ''): string | undefined {
  if (type === 'date') return text.match(DATE_RE)?.[0] ?? text.match(MONTH_RE)?.[0];
  if (type === 'number') {
    const pref = unitPreference(question);
    const all = [...text.matchAll(QUANTITY_RE)].map((m) => m[0].trim()).filter((m) => /\d/.test(m) || pref);
    if (pref) {
      const hit = all.find((m) => pref.test(m) && (/\d/.test(m) || new RegExp(`^${NUM_WORD}\\s`, 'i').test(m)));
      return hit ? trimQuantity(hit, pref) : undefined;
    }
    const numeric = all.find((m) => /\d/.test(m));
    return numeric ? trimQuantity(numeric, null) : undefined;
  }
  return undefined;
}

/** Keep the number plus at most its unit word(s). */
function trimQuantity(q: string, pref: RegExp | null): string {
  const words = q.split(/\s+/);
  if (pref) {
    const idx = words.findIndex((w) => pref.test(w));
    if (idx >= 0) return words.slice(0, idx + 1 + (words[idx] === 'square' ? 1 : 0)).join(' ');
  }
  // Drop a trailing ordinary word unless it is a known unit.
  const unit = /^(?:%|percent|percentage|points|km|kilometres?|metres?|m|kg|hours?|minutes?|days?|weeks?|months?|years?|students?|participants?|people|times|million|billion|thousand)$/i;
  let keep = 1;
  while (keep < words.length && unit.test(words[keep]!)) keep++;
  return words.slice(0, keep).join(' ');
}

/** Questions that point at a part of a document's structure. */
const SECTION_INTENTS: [RegExp, RegExp][] = [
  [/\b(find|finding|findings|found|result|results|show|showed|outcome)\b/i, /result|finding|outcome/i],
  [/\b(conclu\w*|takeaways?|lessons?)\b/i, /conclu|takeaway|summary|discussion/i],
  [/\b(method|methods|methodology|procedure|design|conducted|participants?)\b/i, /method|design|procedure|participants/i],
  [/\b(limitations?|caveats?|weakness\w*)\b/i, /limitation|caveat/i],
  [/\b(decid\w*|decisions?|agreed)\b/i, /decision|resolution|agreed/i],
  [/\b(action items?|next steps?|to-?dos?|tasks?|owners?|responsible)\b/i, /action|next step|to-?do|tasks/i],
  [/\b(risks?|threats?|concerns?|pressures?)\b/i, /risk|threat|concern|pressure/i],
];

/** Sentence indices in sections whose heading matches the question's intent. */
function intentSentences(question: string, src: QaSource): Set<number> {
  const hit = new Set<number>();
  const patterns = SECTION_INTENTS.filter(([q]) => q.test(question)).map(([, sec]) => sec);
  if (!patterns.length) return hit;
  for (const c of src.analysis.chunks) {
    if (!patterns.some((re) => re.test(c.heading))) continue;
    for (let i = c.sentStart; i < c.sentEnd; i++) hit.add(i);
  }
  return hit;
}

export function answerQuestion(question: string, index: QaIndex, maxSentences = 3): QaAnswer {
  const qtype = questionType(question);
  let query = parseQuery(question, index.bm25);
  const original = query.filter((q) => q.source === 'query' || q.source === 'typo');

  if (qtype === 'general' || original.length === 0) {
    return overview(index, qtype === 'general' ? undefined : 'That question has no specific terms to look up, so here is the overall summary instead.');
  }

  if (qtype === 'definition') maxSentences = Math.min(maxSentences, 2);
  let hits = index.bm25.search(query, 8);
  if (!hits.length) return notFound(question, original);

  // Pseudo-relevance feedback helps short queries find paraphrased passages.
  if (original.length <= 3) {
    query = expandWithFeedback(index.bm25, query, hits);
    hits = index.bm25.search(query, 8);
  }

  // Structure-aware boost: "what were the findings?" should look in Results.
  const intent = index.sources.map((src) => intentSentences(question, src));
  const intentUnits = new Set<number>();
  index.units.forEach((u, ui) => {
    const set = intent[u.source]!;
    if (set.size && set.has(u.chunk.sentStart)) intentUnits.add(ui);
  });
  for (const ui of intentUnits) if (!hits.some((h) => h.id === ui)) hits.push({ id: ui, score: (hits[0]?.score ?? 1) * 0.5 });

  const topScore = Math.max(...hits.map((h) => h.score));
  const hasIntent = intent.some((set) => set.size > 0);
  const idfOf = (t: WeightedTerm) => index.bm25.idf(t.term) * t.weight;
  const totalOriginalWeight = original.reduce((a, t) => a + idfOf(t), 0) || 1;

  interface Cand {
    key: string;
    source: number;
    sentence: number;
    text: string;
    score: number;
    covered: Set<string>;
    termSet: Set<string>;
  }
  const cands: Cand[] = [];
  const scanned = [...hits.slice(0, 5), ...hits.slice(5).filter((h) => intentUnits.has(h.id))];
  for (const h of scanned) {
    const unit = index.units[h.id]!;
    const src = index.sources[unit.source]!;
    const chunkRel = h.score / topScore;
    for (let si = unit.chunk.sentStart; si < unit.chunk.sentEnd; si++) {
      const s = src.analysis.sentences[si];
      if (!s) continue;
      const termSet = new Set(terms(s.text));
      let cov = 0;
      let covAll = 0;
      const covered = new Set<string>();
      for (const q of query) {
        if (!termSet.has(q.term)) continue;
        covAll += index.bm25.idf(q.term) * q.weight;
        if (q.source === 'query' || q.source === 'typo') {
          cov += idfOf(q);
          covered.add(q.term);
        }
      }
      const inIntent = intent[unit.source]!.has(si);
      if (covAll === 0 && !inIntent) continue;
      let score = 0.55 * (cov / totalOriginalWeight) + 0.15 * Math.min(1, covAll / totalOriginalWeight) + 0.3 * chunkRel;
      if (inIntent) {
        score += 0.6 + 0.3 * (src.analysis.scores[si] ?? 0);
        // Structure answered the question even when the words differ.
        for (const q of original) covered.add(q.term);
      } else if (hasIntent) {
        score *= 0.7;
      }
      score += 0.08 * (src.analysis.scores[si] ?? 0);
      switch (qtype) {
        case 'date':
          if (DATE_RE.test(s.text)) score += 0.25;
          break;
        case 'number':
          if (/\d/.test(s.text)) score += 0.22;
          break;
        case 'name':
          if (/\s[\p{Lu}][\p{Ll}]+/u.test(s.text)) score += 0.08;
          break;
        case 'cause':
          if (CAUSE_RE.test(s.text)) score += 0.15;
          break;
        case 'method':
          if (METHOD_RE.test(s.text)) score += 0.06;
          break;
        case 'definition': {
          const head = original.map((o) => o.surface).join('\\s+');
          if (new RegExp(`\\b${head}\\w*\\b[^.]{0,40}\\b(is|are|refers to|means|describes|was|were)\\b`, 'i').test(s.text)) score += 0.3;
          break;
        }
        default:
          break;
      }
      if (s.words < 5) score *= 0.6;
      // Table rows are evidence, but prose usually answers better.
      if (/ \| /.test(s.text)) score *= 0.85;
      cands.push({ key: `${unit.source}:${si}`, source: unit.source, sentence: si, text: s.text, score, covered, termSet });
    }
  }

  if (!cands.length) return notFound(question, original);
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0]!;
  const pool = cands.filter((c) => c.score >= best.score * 0.6).slice(0, 12);
  const byKey = new Map(pool.map((c, i) => [i, c]));
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / Math.max(1, a.size + b.size - inter);
  };
  const picked = mmrSelect(
    pool.map((_, i) => i),
    (i) => byKey.get(i)!.score,
    (a, b) => jaccard(byKey.get(a)!.termSet, byKey.get(b)!.termSet),
    Math.min(maxSentences, pool.length),
    0.75,
  ).map((i) => byKey.get(i)!);

  // Keep only sentences that genuinely add query coverage or are strong.
  const chosen: Cand[] = [];
  const coveredAll = new Set<string>();
  for (const c of picked) {
    const adds = [...c.covered].some((t) => !coveredAll.has(t));
    if (chosen.length === 0 || adds || c.score >= best.score * (hasIntent ? 0.7 : 0.85)) {
      chosen.push(c);
      c.covered.forEach((t) => coveredAll.add(t));
    }
  }
  // Best evidence first; ties in reading order.
  chosen.sort((a, b) => b.score - a.score || a.source - b.source || a.sentence - b.sentence);

  const coverage = original.filter((o) => coveredAll.has(o.term)).length / original.length;
  const bestCoverage = best.covered.size / original.length;
  const idfStrength = original.filter((o) => coveredAll.has(o.term)).reduce((a, o) => a + index.bm25.idf(o.term), 0);

  const matchedTerms = surfacesFor(original.filter((o) => coveredAll.has(o.term)), query, coveredAll);
  const missingTerms = original.filter((o) => !coveredAll.has(o.term)).map((o) => o.surface);

  // Weighted by IDF so that matching only a vague word ("help") is not enough.
  const coverageW = original.filter((o) => coveredAll.has(o.term)).reduce((a, o) => a + idfOf(o), 0) / totalOriginalWeight;
  if (coverage === 0 || (original.length >= 2 && coverageW < 0.5 && idfStrength < 4) || (original.length >= 3 && coverage < 0.34)) {
    const found = original.filter((o) => coveredAll.has(o.term));
    const nf = notFound(question, original.filter((o) => !coveredAll.has(o.term)));
    return {
      ...nf,
      message: found.length ? `The text mentions ${quoteList(found)}, but nothing about ${quoteList(original.filter((o) => !coveredAll.has(o.term)), 'or')} — so it can’t answer this.` : nf.message,
      related: chosen.slice(0, 2).map((c) => relatedOf(index, c.source, c.sentence)),
    };
  }

  let confidence: Confidence = coverage >= 0.75 && bestCoverage >= 0.5 ? 'high' : coverage >= 0.5 ? 'medium' : 'low';
  const shortAnswer = shortAnswerFor(qtype, chosen.find((c) => shortAnswerFor(qtype, c.text, question))?.text ?? '', question);
  let typeNote: string | undefined;
  if ((qtype === 'date' || qtype === 'number') && !shortAnswer) {
    // Related passages, but none states the date/number that was asked for.
    confidence = 'low';
    typeNote = `These passages are related, but none of them states a specific ${qtype === 'date' ? 'date' : 'figure'}.`;
  }
  const sentences = chosen.map((c) => ({ docId: index.sources[c.source]!.docId, sentence: c.sentence, text: c.text }));
  const related = hits
    .slice(0, 4)
    .map((h) => index.units[h.id]!)
    .filter((u) => !chosen.some((c) => c.source === u.source && c.sentence >= u.chunk.sentStart && c.sentence < u.chunk.sentEnd))
    .slice(0, 2)
    .map((u) => relatedOf(index, u.source, u.chunk.sentStart));

  return {
    kind: 'answer',
    confidence,
    shortAnswer,
    sentences,
    matchedTerms,
    missingTerms,
    related,
    message:
      typeNote ??
      (confidence === 'low'
        ? `Only a partial match — the sources don’t mention ${missingTerms.map((t) => `“${t}”`).join(', ') || 'every part of the question'}.`
        : undefined),
  };
}

function relatedOf(index: QaIndex, source: number, sentence: number) {
  const src = index.sources[source]!;
  const chunk = src.analysis.chunks.find((c) => sentence >= c.sentStart && sentence < c.sentEnd);
  return { docId: src.docId, sentence, heading: chunk?.heading ?? src.title };
}

function surfacesFor(orig: WeightedTerm[], query: WeightedTerm[], covered: Set<string>): string[] {
  const s = new Set<string>();
  for (const o of orig) s.add(o.surface);
  for (const q of query) if (q.source !== 'query' && covered.has(q.term)) s.add(q.surface);
  return [...s];
}

function quoteList(ts: WeightedTerm[], joiner = 'and'): string {
  const q = ts.map((t) => `“${t.surface}”`);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} ${joiner} ${q[q.length - 1]}`;
}

function notFound(_question: string, original: WeightedTerm[]): QaAnswer {
  const what = quoteList(original, 'or');
  return {
    kind: 'not_found',
    confidence: 'low',
    sentences: [],
    matchedTerms: [],
    missingTerms: original.map((o) => o.surface),
    related: [],
    message: what
      ? `I couldn’t find anything about ${what} in the searched text. Try different wording, or widen the scope.`
      : 'I couldn’t find a relevant passage for that question.',
  };
}

function overview(index: QaIndex, message?: string): QaAnswer {
  const sentences: QaSentence[] = [];
  for (const src of index.sources.slice(0, 3)) {
    const ids = index.sources.length > 1 ? src.analysis.summary.tldr : src.analysis.summary.short;
    for (const i of ids) {
      const s = src.analysis.sentences[i];
      if (s) sentences.push({ docId: src.docId, sentence: i, text: s.text });
    }
  }
  return {
    kind: 'overview',
    confidence: 'high',
    sentences,
    matchedTerms: [],
    missingTerms: [],
    related: [],
    message: message ?? 'Here are the most central sentences (TextRank), in document order.',
  };
}

/** Terms to visually highlight in an answer, including stem-matched variants. */
export function highlightMatcher(termsToMatch: string[]): (word: string) => boolean {
  const stems = new Set(termsToMatch.map((t) => stem(t.toLowerCase())));
  return (word: string) => stems.has(stem(word.toLowerCase()));
}

export function tokensForHighlight(text: string) {
  return tokenize(text);
}
