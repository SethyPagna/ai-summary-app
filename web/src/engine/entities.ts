// Lightweight entity spotting with regular expressions: dates, money,
// percentages, emails, URLs and capitalised names. Each entity keeps the
// sentences it occurs in so the UI can cite it.

import { STOPWORDS } from './text';
import type { Entity, EntityType } from './types';

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const MONTH_FULL = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const WEEKDAY = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';

const PATTERNS: [EntityType, RegExp][] = [
  ['email', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ['url', /\bhttps?:\/\/[^\s<>()\]"']+[^\s<>()\]"'.,;:!?]|\bwww\.[^\s<>()\]"']+[^\s<>()\]"'.,;:!?]/g],
  [
    'money',
    /(?:[$€£¥៛]|\b(?:USD|EUR|GBP|KHR|US\$)\s?)\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|m|M|bn|B|million|billion|thousand|trillion)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand)?\s?(?:dollars|euros|pounds|riel|USD|EUR|GBP)\b/g,
  ],
  ['percent', /\b\d+(?:[.,]\d+)?\s?(?:%|percent\b|per cent\b|percentage points\b)/g],
  [
    'date',
    new RegExp(
      [
        `\\b${WEEKDAY},?\\s+${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`,
        `\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`,
        `\\b(?:${WEEKDAY},?\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+\\d{4})?\\b`,
        `\\b${MONTH_FULL}\\s+\\d{4}\\b`,
        `\\b\\d{4}-\\d{2}-\\d{2}\\b`,
        `\\b\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b`,
        `\\bQ[1-4]\\s+\\d{4}\\b`,
        `\\b(?:early|mid|late)[-\\s](?:19|20)\\d{2}s?\\b`,
        `\\b(?:in|since|by|until|from|before|after|during|of)\\s+(?:19|20)\\d{2}\\b`,
      ].join('|'),
      'g',
    ),
  ],
];

const NAME_RE = /\b(?:[\p{Lu}][\p{Ll}'’\-]+|[\p{Lu}]{2,}[\p{Ll}]?)(?:\s+(?:(?:of|de|da|van|von|der|la|le|du|&)\s+)?(?:[\p{Lu}][\p{Ll}'’\-]+|[\p{Lu}]{2,}))*\b/gu;
const MONTHS_DAYS = new Set('January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split(' '));

const NAME_BLOCKLIST = new Set(
  (
    'The A An This That These Those It Its In On At For From With By To Of And But Or If When While Where What Why How Who ' +
    'We Our You Your They Their He She His Her I My Me Us Them Yes No Not Also However Therefore Thus Here There Each Every ' +
    'Some Many Most Such One Two Three First Second Third Next Finally Overall Note Table Figure Section Chapter Page Slide ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September ' +
    'October November December Today Tomorrow Yesterday Abstract Introduction Conclusion Conclusions Summary Results Discussion ' +
    'Methods Method Background References Appendix Action Items Agenda Decisions Notes Owner Due Status TBD OK Q&A FAQ'
  ).split(' '),
);

export function extractEntities(sentences: string[]): Entity[] {
  const found = new Map<string, Entity>();
  const add = (type: EntityType, text: string, si: number) => {
    const clean = text.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const key = `${type}:${type === 'name' ? clean : clean.toLowerCase()}`;
    let e = found.get(key);
    if (!e) {
      e = { type, text: clean, count: 0, sentences: [] };
      found.set(key, e);
    }
    e.count++;
    if (e.sentences.length < 8 && e.sentences[e.sentences.length - 1] !== si) e.sentences.push(si);
  };

  // Capitalised words seen mid-sentence anywhere (helps accept sentence-initial names).
  const midCaps = new Set<string>();
  sentences.forEach((s) => {
    const re = /(?<=\S\s+)([\p{Lu}][\p{Ll}]+)/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) midCaps.add(m[1]!);
  });

  sentences.forEach((s, si) => {
    const taken: [number, number][] = [];
    const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
    for (const [type, re] of PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const a = m.index;
        const b = a + m[0].length;
        if (overlaps(a, b)) continue;
        let text = m[0];
        if (type === 'date') text = text.replace(/^(?:in|since|by|until|from|before|after|during|of)\s+/i, '');
        taken.push([a, b]);
        add(type, text, si);
      }
    }
    NAME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NAME_RE.exec(s))) {
      const a = m.index;
      const b = a + m[0].length;
      if (overlaps(a, b)) continue;
      let text = m[0];
      // Strip leading blocklisted words ("The Mekong River" -> "Mekong River").
      let parts = text.split(/\s+/);
      while (parts.length && (NAME_BLOCKLIST.has(parts[0]!) || STOPWORDS.has(parts[0]!.toLowerCase()))) parts.shift();
      // Months and weekdays end a name ("Around October" is not a name).
      const md = parts.findIndex((p) => MONTHS_DAYS.has(p));
      if (md >= 0) parts = parts.slice(0, md);
      while (parts.length && /^(?:of|de|da|van|von|der|la|le|du|&)$/.test(parts[parts.length - 1]!)) parts.pop();
      if (!parts.length) continue;
      text = parts.join(' ');
      const single = parts.length === 1;
      if (single && (NAME_BLOCKLIST.has(text) || STOPWORDS.has(text.toLowerCase()))) continue;
      if (single && text.length < 3) continue;
      const atStart = s.slice(0, a).trim() === '' || /[:\-–—•]\s*$/.test(s.slice(0, a));
      if (single && atStart && !midCaps.has(text) && !/^[\p{Lu}]{2,}/u.test(text)) continue;
      add('name', text, si);
    }
  });

  const list = [...found.values()].filter((e) => {
    if (e.type !== 'name') return true;
    const multi = e.text.includes(' ');
    const acronym = /^[\p{Lu}]{2,}/u.test(e.text);
    return e.count >= 2 || multi || acronym;
  });

  const order: EntityType[] = ['date', 'money', 'percent', 'name', 'email', 'url'];
  list.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || b.count - a.count || a.sentences[0]! - b.sentences[0]!);
  // Cap per type so a long document does not flood the panel.
  const perType = new Map<EntityType, number>();
  return list.filter((e) => {
    const c = perType.get(e.type) ?? 0;
    perType.set(e.type, c + 1);
    return c < (e.type === 'name' ? 18 : 12);
  });
}

/** Which entity types a sentence contains (used by Q&A answer typing). */
export function sentenceEntityTypes(sentence: string): Set<EntityType> {
  const types = new Set<EntityType>();
  for (const [type, re] of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(sentence)) types.add(type);
  }
  return types;
}
