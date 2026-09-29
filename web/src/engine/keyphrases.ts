// Keyphrase extraction, RAKE/YAKE-flavoured:
//  - candidates are 1–4-word n-grams inside stopword/punctuation-delimited runs
//    (the RAKE split), trimmed of verb-like edges,
//  - scored by frequency, length, first position, heading presence and word
//    "degree" (how often a word co-occurs inside longer phrases — RAKE),
//  - then deduplicated so a phrase and its sub-phrases don't both appear.
// A library-level TF-IDF re-weighting is applied at display time
// (libraryRerank).

import { STOPWORDS, stem, tokenize } from './text';
import type { Keyphrase } from './types';

const GENERIC = new Set(
  (
    'example examples figure table section chapter page paper study result results data number numbers way ways part parts ' +
    'point points case cases time times year years people percent per cent lot lots kind kinds use today item items note notes ' +
    'thing things group groups level levels day days week weeks month months hour hours minute minutes end start line lines ' +
    'first second third last next new old good bad high low small large big long short main key important major different same ' +
    'several various certain able whole around final fictional sample one two three four five six seven eight nine ten ' +
    'hundred hundreds thousand thousands million percent half idea ideas thing way lot'
  ).split(' '),
);

// Verbs and adverbs that commonly glue noun phrases together in running text.
const VERBISH = new Set(
  (
    'include includes included including suggest suggests suggested show shows showed shown make makes made take takes took taken ' +
    'provide provides provided help helps helped mean means meant keep keeps kept become becomes need needs needed want wants ' +
    'wanted found find finds report reports reported argue argues argued describe describes described compare compares compared ' +
    'receive received complete completed ask asks asked agree agreed propose proposed share shared feel felt raise raised ' +
    'seem seemed tend tends tended allow allows allowed lead leads led cause causes caused call calls called give gives gave ' +
    'turn turns turned move moves moved stay stays stayed leave leaves left link links linked support supports supported ' +
    'follow follows followed depend depends depended remain remains remained expect expects expected consider considered ' +
    'note noted explain explains explained produce produces produced improve improves improved increase increases increased ' +
    'reduce reduces reduced create creates created keeps run runs ran set sets put puts get gets got try tries tried ' +
    'build builds built add adds added spend spends spent hold holds held bring brings brought begin begins began ' +
    'really actually often usually typically simply mainly largely generally especially particularly slightly directly ' +
    'immediately randomly roughly approximately nearly almost clearly highly strongly widely'
  ).split(' '),
);

const MAX_WORDS = 4;

const SUBJECTS = new Set('it they we he she i you which who that also often then never always still usually families people others'.split(' '));
const OBJECT_STARTS = new Set('the a an its their his her our your my this these those'.split(' '));
const DETERMINERS = new Set('the a an its their his her our your my this these those of in on at for from with by into about'.split(' '));

interface Tok {
  stem: string;
  word: string;
  raw: string;
  start: number;
  end: number;
}

interface Cand {
  key: string;
  n: number;
  surfaces: Map<string, number>;
  count: number;
  first: number;
  inHeading: boolean;
}

function isVerbish(t: Tok, atEnd: boolean): boolean {
  if (VERBISH.has(t.word)) return true;
  // Past participles work as adjectives before a noun ("spaced review") but a
  // phrase ending in one is usually a clause ("group scored").
  return atEnd && t.word.length > 4 && /[^e]ed$/.test(t.word) && !/^[\p{Lu}]/u.test(t.raw);
}

const isCap = (t: Tok | undefined) => !!t && /^[\p{Lu}]/u.test(t.raw);

export interface KeyphraseOptions {
  limit?: number;
  headings?: string[];
}

export function extractKeyphrases(sentences: string[], opts: KeyphraseOptions | number = {}): Keyphrase[] {
  const { limit = 30, headings = [] } = typeof opts === 'number' ? { limit: opts } : opts;
  const cands = new Map<string, Cand>();
  const wordFreq = new Map<string, number>();
  const wordDeg = new Map<string, number>();
  const headingStems = new Set(headings.flatMap((h) => tokenize(h).map((t) => stem(t.word))));

  const runsOf = (sentence: string): Tok[][] => {
    const runs: Tok[][] = [];
    let run: Tok[] = [];
    let prevEnd = -1;
    const flush = () => {
      if (run.length) runs.push(run);
      run = [];
    };
    for (const t of tokenize(sentence)) {
      const gap = prevEnd >= 0 ? sentence.slice(prevEnd, t.start) : '';
      if (gap && /[^\s\-]/.test(gap)) flush();
      prevEnd = t.end;
      const w = t.word;
      if (STOPWORDS.has(w) || w.length < 2 || /^\d+(?:[.,]\d+)*$/.test(w)) {
        flush();
        continue;
      }
      run.push({ stem: stem(w), word: w, raw: t.raw, start: t.start, end: t.end });
    }
    flush();
    return runs;
  };

  // Evidence that a single word is used as a verb rather than a noun:
  // "it reverses its flow", "water that falls" vs "the flow", "of fish".
  const verbEvidence = new Map<string, number>();
  const nounEvidence = new Map<string, number>();
  sentences.forEach((sentence) => {
    const toks = tokenize(sentence);
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i]!.word;
      if (STOPWORDS.has(w)) continue;
      const st = stem(w);
      const prev = toks[i - 1]?.word;
      const next = toks[i + 1]?.word;
      if ((prev && SUBJECTS.has(prev)) || (next && OBJECT_STARTS.has(next) && /s$/.test(w))) verbEvidence.set(st, (verbEvidence.get(st) ?? 0) + 1);
      if (prev && DETERMINERS.has(prev)) nounEvidence.set(st, (nounEvidence.get(st) ?? 0) + 1);
    }
  });

  sentences.forEach((sentence, si) => {
    for (const run of runsOf(sentence)) {
      // RAKE degree: co-occurrence inside the (verb-trimmed) run.
      for (const t of run) {
        wordFreq.set(t.stem, (wordFreq.get(t.stem) ?? 0) + 1);
        wordDeg.set(t.stem, (wordDeg.get(t.stem) ?? 0) + Math.min(run.length, MAX_WORDS));
      }
      for (let n = 1; n <= MAX_WORDS; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const g = run.slice(i, i + n);
          const first = g[0]!;
          const last = g[n - 1]!;
          if (isVerbish(first, false) || isVerbish(last, true) || /ly$/.test(first.word)) continue;
          // Don't cut a proper name in half ("Sap River" out of "Tonlé Sap River").
          if ((isCap(first) && isCap(run[i - 1])) || (isCap(last) && isCap(run[i + n]))) continue;
          if (g.some((t) => VERBISH.has(t.word))) continue;
          if (g.every((t) => GENERIC.has(t.stem) || GENERIC.has(t.word))) continue;
          if (n === 1 && (first.word.length < 3 || GENERIC.has(first.word))) continue;
          const key = g.map((t) => t.stem).join(' ');
          const surface = sentence.slice(first.start, last.end).replace(/\s+/g, ' ');
          let c = cands.get(key);
          if (!c) {
            c = { key, n, surfaces: new Map(), count: 0, first: si, inHeading: g.every((t) => headingStems.has(t.stem)) };
            cands.set(key, c);
          }
          c.count++;
          c.surfaces.set(surface, (c.surfaces.get(surface) ?? 0) + 1);
        }
      }
    }
  });

  const total = Math.max(1, sentences.length);
  const minCount = total > 25 ? 2 : 1;
  const scored: Keyphrase[] = [];
  for (const c of cands.values()) {
    const words = c.key.split(' ');
    if (c.count < minCount) continue;
    if (c.n === 1 && c.count < Math.min(3, minCount + 1) && !/^[\p{Lu}]/u.test(pickSurface(c.surfaces))) continue;
    if (c.n === 1 && (verbEvidence.get(c.key) ?? 0) > (nounEvidence.get(c.key) ?? 0)) continue;
    let rake = 0;
    for (const w of words) rake += (wordDeg.get(w) ?? 1) / (wordFreq.get(w) ?? 1);
    rake /= words.length;
    const lenBoost = c.n === 1 ? 1 : c.n === 2 ? 2.6 : c.n === 3 ? 3 : 2.4;
    const posBoost = 1 + 0.3 * (1 - c.first / total);
    const headBoost = c.inHeading ? 1.35 : 1;
    // Unigrams saturate faster: frequent common nouns should not drown out phrases.
    const freq = c.n === 1 ? Math.pow(c.count, 0.55) : Math.pow(c.count, 0.85);
    const score = freq * lenBoost * posBoost * headBoost * (0.6 + (0.4 * Math.min(3, rake)) / 3);
    scored.push({ phrase: pickSurface(c.surfaces), key: c.key, score, count: c.count, first: c.first });
  }
  scored.sort((a, b) => b.score - a.score || a.first - b.first);

  // Dedupe overlapping phrases: keep the longer one when it carries most of
  // the shorter one's occurrences, otherwise keep the shorter, more general one.
  const out: Keyphrase[] = [];
  const maxUnigrams = Math.ceil(limit * 0.4);
  for (const k of scored) {
    if (out.length >= limit) break;
    const kw = k.key.split(' ');
    if (kw.length === 1 && out.filter((o) => !o.key.includes(' ')).length >= maxUnigrams) continue;
    let drop = false;
    for (let i = 0; i < out.length; i++) {
      const o = out[i]!;
      const ow = o.key.split(' ');
      if (ow.length > kw.length && containsSeq(ow, kw) && k.count <= o.count * 2.2) drop = true;
      else if (kw.length > ow.length && containsSeq(kw, ow) && k.count < o.count * 0.6) drop = true;
      if (drop) break;
    }
    if (!drop) {
      // A longer phrase may make an already-chosen sub-phrase redundant.
      for (let i = out.length - 1; i >= 0; i--) {
        const ow = out[i]!.key.split(' ');
        if (kw.length > ow.length && containsSeq(kw, ow) && k.count >= out[i]!.count * 0.75) out.splice(i, 1);
      }
      out.push(k);
    }
  }
  out.sort((a, b) => b.score - a.score);
  const max = out[0]?.score ?? 1;
  return out.map((k) => ({ ...k, score: Math.round((k.score / max) * 1000) / 1000 }));
}

function containsSeq(hay: string[], needle: string[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Prefer the most frequent surface; lowercase unless it is consistently capitalised. */
function pickSurface(surfaces: Map<string, number>): string {
  const entries = [...surfaces.entries()].sort((a, b) => b[1] - a[1]);
  const best = entries[0]![0];
  if (/^[\p{Lu}]{2,}/u.test(best)) return best; // acronyms
  const total = entries.reduce((a, e) => a + e[1], 0);
  const allCapitalised = entries.every(([s]) => /^[\p{Lu}]/u.test(s));
  // Proper nouns: always capitalised and either multi-word ("Tonle Sap") or repeated.
  if (allCapitalised && (/\s[\p{Lu}]/u.test(best) || total > 1)) return best;
  // Otherwise the capital came from sentence position: prefer a lowercase variant.
  const lower = entries.find(([s]) => /^[\p{Ll}]/u.test(s));
  if (lower) return lower[0];
  return /^[\p{Lu}][\p{Ll}]/u.test(best) ? best[0]!.toLowerCase() + best.slice(1) : best;
}

/**
 * Re-weight a document's keyphrases by how distinctive they are across the
 * library (classic IDF over documents).
 */
export function libraryRerank(phrases: Keyphrase[], docFreq: (key: string) => number, docCount: number): Keyphrase[] {
  if (docCount <= 1) return phrases;
  const maxIdf = Math.log(docCount + 1) + 1;
  return phrases
    .map((k) => {
      const idf = Math.log((docCount + 1) / (docFreq(k.key) + 1)) + 1;
      return { ...k, score: k.score * (0.5 + 0.5 * (idf / maxIdf)) };
    })
    .sort((a, b) => b.score - a.score);
}
