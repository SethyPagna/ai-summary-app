// Text primitives: sentence splitting, tokenising, a light stemmer and
// stopwords. Deterministic and dependency-free so it runs in a worker, in the
// main thread and in tests identically.

export const STOPWORDS = new Set(
  (
    "a about above after again against all almost also although always am among an and another any anyone anything " +
    "are aren't around as at be became because become becomes been before being below between both but by can cannot " +
    "can't could couldn't did didn't do does doesn't doing don't done down during each either else enough etc even ever " +
    "every few for from further get gets getting given gives go goes going got had hadn't has hasn't have haven't having " +
    "he he'd he'll he's her here here's hers herself him himself his how how's however i i'd i'll i'm i've if in into is " +
    "isn't it it's its itself just least less let's like likely made make makes many may maybe me might more most mostly " +
    "much must mustn't my myself neither no nor not now of off often on once one only onto or other others otherwise our " +
    "ours ourselves out over own per perhaps quite rather really said same say says see seem seems several shall shan't she " +
    "she'd she'll she's should shouldn't since so some something sometimes still such than that that's the their theirs " +
    "them themselves then there there's therefore these they they'd they'll they're they've thing things this those though " +
    "through thus to too toward towards under until up upon us use used uses using very via was wasn't way we we'd we'll " +
    "we're we've well were weren't what what's whatever when when's where where's whereas whether which while who who's " +
    "whom whose why why's will with within without won't would wouldn't yet you you'd you'll you're you've your yours " +
    "yourself yourselves also e.g i.e vs versus across along already amongst another around back beyond come comes could " +
    "whichever wherever whoever whilst within new yes"
  ).split(/\s+/),
);

/** Words that carry no topical signal in questions. */
export const QUESTION_WORDS = new Set(
  'what which who whom whose when where why how does do did is are was were can could should would tell me about explain describe list give please show summarize summarise document doc text paper file mention mentioned say says said according main key important major primary overall kind sort anything something happen happened meant mean means define definition'.split(
    ' ',
  ),
);

const ABBREVIATIONS = new Set(
  (
    'mr mrs ms dr prof sr jr st vs fig figs eq eqs no nos vol vols pp p al approx dept est inc ltd co corp jan feb mar apr ' +
    'jun jul aug sep sept oct nov dec e.g i.e cf ca univ assn bros gen gov rep sen rev col lt sgt capt cmdr mt ft op ed eds ' +
    'u.s u.k u.n ph.d m.sc b.sc a.k.a'
  ).split(/\s+/),
);

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/­/g, '')
    .replace(/[  -   　]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export interface Span {
  start: number;
  end: number;
  text: string;
}

const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);
const OPENERS = /["'“‘(\[«¿¡]/;

/**
 * Split text into sentences, returning char offsets into the input.
 * Handles abbreviations, initials, decimals, ellipses, closing quotes and
 * list numbering; blank lines are always hard boundaries.
 */
export function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  const n = text.length;
  let start = 0;

  const push = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) spans.push({ start: s, end: e, text: text.slice(s, e) });
    start = end;
  };

  for (let i = 0; i < n; i++) {
    const ch = text[i]!;

    // Hard boundary: blank line.
    if (ch === '\n' && text[i + 1] === '\n') {
      push(i);
      continue;
    }

    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;

    // Collapse runs like "?!" or "..." into one terminator.
    let j = i;
    while (j + 1 < n && /[.!?…]/.test(text[j + 1]!)) j++;
    // Include closing quotes/brackets.
    let k = j;
    while (k + 1 < n && CLOSERS.has(text[k + 1]!)) k++;

    // Must be followed by whitespace (or end of text).
    if (k + 1 < n && !/\s/.test(text[k + 1]!)) {
      i = j;
      continue;
    }

    // Look at the next non-space character.
    let m = k + 1;
    while (m < n && /\s/.test(text[m]!)) m++;
    if (m >= n) {
      push(n);
      i = n;
      break;
    }
    const next = text[m]!;
    const nextStartsSentence = /[\p{Lu}\p{N}]/u.test(next) || OPENERS.test(next) || /[฀-࿿ក-៿]/.test(next);
    if (!nextStartsSentence) {
      i = j;
      continue;
    }

    if (ch === '.' && j === i) {
      // Examine the token before the period.
      let t = i - 1;
      while (t >= start && !/\s/.test(text[t]!)) t--;
      const token = text.slice(t + 1, i);
      const bare = token.replace(/^[("'“‘\[]+/, '').toLowerCase();
      if (ABBREVIATIONS.has(bare)) {
        i = j;
        continue;
      }
      // Single-letter initial ("J. K. Rowling") or dotted acronym ("U.S.").
      if (/^[\p{Lu}]$/u.test(token) || /^(?:[\p{L}]\.)+[\p{L}]$/u.test(token)) {
        i = j;
        continue;
      }
      // List numbering at the start of a sentence: "1. First step".
      const soFar = text.slice(start, t + 1).trim();
      if (/^\d{1,3}$/.test(token) && soFar === '') {
        i = j;
        continue;
      }
    }

    push(k + 1);
    i = k;
  }
  if (start < n) push(n);
  return spans;
}

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

export interface Token {
  word: string; // lowercased surface form
  raw: string; // original casing
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text))) {
    let raw = m[0];
    // Trim trailing hyphens/apostrophes and possessive 's.
    raw = raw.replace(/['’\-]+$/, '');
    raw = raw.replace(/['’]s$/i, '');
    if (!raw) continue;
    out.push({ word: raw.toLowerCase(), raw, start: m.index, end: m.index + raw.length });
  }
  return out;
}

export function words(text: string): string[] {
  return tokenize(text).map((t) => t.word);
}

const DOUBLE_OK = new Set(['l', 's', 'z']);

// Irregular forms that suffix stripping cannot reach.
const IRREGULAR: Record<string, string> = {
  slept: 'sleep', taught: 'teach', thought: 'think', bought: 'buy', brought: 'bring', caught: 'catch', fought: 'fight',
  sought: 'seek', went: 'go', gone: 'go', ran: 'run', wrote: 'write', written: 'write', spoke: 'speak', spoken: 'speak',
  chose: 'choose', chosen: 'choose', began: 'begin', begun: 'begin', grew: 'grow', grown: 'grow', knew: 'know', known: 'know',
  rose: 'rise', risen: 'rise', fell: 'fall', fallen: 'fall', met: 'meet', paid: 'pay', felt: 'feel', kept: 'keep', lost: 'lose',
  built: 'build', sent: 'send', spent: 'spend', held: 'hold', stood: 'stand', understood: 'understand', children: 'child',
  men: 'man', women: 'woman', mice: 'mouse', feet: 'foot', teeth: 'tooth', criteria: 'criterion', phenomena: 'phenomenon',
  analyses: 'analysis', theses: 'thesis', hypotheses: 'hypothesis', larger: 'large', largest: 'large', bigger: 'big', biggest: 'big',
  deeper: 'deep', deepest: 'deep', higher: 'high', highest: 'high', lower: 'low', lowest: 'low', longer: 'long', longest: 'long',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad', fewer: 'few', smaller: 'small', smallest: 'small',
};

/**
 * A light, consistent English stemmer (a pragmatic subset of Porter). It only
 * needs to be consistent: the same function is used for indexing and queries.
 */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/’/g, "'");
  const irregular = IRREGULAR[w];
  if (irregular) return irregular;
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith("'s")) w = w.slice(0, -2);
  // British -ise/-isation spellings share stems with -ize/-ization.
  if (w.length > 6) w = w.replace(/is(e|ed|es|ing|ation|ations)$/, 'iz$1');

  const strip = (suffix: string, min: number, repl = ''): boolean => {
    if (w.endsWith(suffix) && w.length - suffix.length >= min) {
      w = w.slice(0, -suffix.length) + repl;
      return true;
    }
    return false;
  };

  if (strip('isations', 3, 'iz') || strip('izations', 3, 'iz') || strip('isation', 3, 'iz') || strip('ization', 3, 'iz')) {
    // fallthrough to final cleanup
  } else if (strip('sses', 2, 'ss')) {
    // classes -> class
  } else if (strip('ies', 2, 'y')) {
    // studies -> study
  } else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
    w = w.slice(0, -1);
  }

  if (strip('ied', 2, 'y')) {
    // studied -> study
  } else if (strip('ing', 4) || strip('ed', 4)) {
    const last = w[w.length - 1]!;
    if (w.length > 3 && last === w[w.length - 2] && !DOUBLE_OK.has(last) && !/[aeiou]/.test(last)) {
      w = w.slice(0, -1);
    }
  } else if (strip('ly', 4)) {
    // quickly -> quick
  } else if (strip('ational', 3, 'ate') || strip('ation', 4, 'ate')) {
    // relational -> relate, summation -> summate
  }

  if (w.endsWith('ise') && w.length > 5) w = w.slice(0, -3) + 'iz';
  else if (w.endsWith('ize') && w.length > 5) w = w.slice(0, -1);
  if (w.endsWith('al') && w.length > 6) w = w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4 && !w.endsWith('ee')) w = w.slice(0, -1);
  if (w.endsWith('ate') && w.length > 6) w = w.slice(0, -3);
  return w;
}

/** Content terms (stemmed, stopwords removed) for indexing. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(text)) {
    if (t.word.length < 2 && !/\d/.test(t.word)) continue;
    if (STOPWORDS.has(t.word)) continue;
    out.push(stem(t.word));
  }
  return out;
}

export function countWords(text: string): number {
  let c = 0;
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.exec(text)) c++;
  return c;
}

/** Estimate English syllables for readability scoring. */
export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '');
  w = w.replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function truncateWords(text: string, max: number): string {
  const parts = text.split(/\s+/);
  if (parts.length <= max) return text;
  return parts.slice(0, max).join(' ') + '…';
}

/** Stable 32-bit FNV-1a hash (used for ids and seeded shuffles). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic given a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Damerau-Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[m]![n]!;
}

export function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
