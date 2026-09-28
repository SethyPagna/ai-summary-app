// Study tools generated from the local analysis:
//  - cloze flashcards: blank the strongest keyphrase (or number/date) in a
//    high-ranking sentence,
//  - definition cards from the glossary,
//  - multiple-choice questions whose distractors are other keyphrases of a
//    similar shape (or perturbed numbers), shuffled with a seeded RNG.

import { escapeRegExp, hash, rng, shuffle, stem, tokenize } from './text';
import type { Flashcard, GlossaryEntry, Keyphrase, QuizQuestion, Sentence } from './types';

const BLANK = '_____';

interface ClozeCand {
  sentence: Sentence;
  answer: string;
  kind: 'phrase' | 'number';
  phraseKey?: string;
  start: number;
  end: number;
}

const NUM_RE = /(?:[$€£]\s?)?\b\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:%|percent\b)?/g;

function findPhrase(text: string, phrase: string): { start: number; end: number } | null {
  // Match the phrase allowing inflection on the last word.
  const parts = phrase.split(/\s+/).map(escapeRegExp);
  const last = parts.pop()!;
  const re = new RegExp(`\\b${[...parts, `${last}(?:s|es|ed|ing)?`].join('[\\s\\-]+')}\\b`, 'i');
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export function clozeCandidates(sentences: Sentence[], scores: number[], eligible: boolean[], phrases: Keyphrase[], limit = 40): ClozeCand[] {
  const ranked = sentences
    .filter((s) => eligible[s.i] && s.words >= 8 && s.words <= 42)
    .sort((a, b) => (scores[b.i] ?? 0) - (scores[a.i] ?? 0))
    .slice(0, limit);
  const topPhrases = phrases.slice(0, 40);
  const used = new Map<string, number>();
  const out: ClozeCand[] = [];
  for (const s of ranked) {
    let pick: ClozeCand | null = null;
    // Prefer multi-word, higher-scoring phrases that are not already overused.
    const weight = (p: Keyphrase) => p.score * (1 + 0.6 * (p.key.split(' ').length - 1));
    const options = topPhrases
      .map((p) => ({ p, loc: findPhrase(s.text, p.phrase) }))
      // Single common words make poor cards; keep unigrams only for proper nouns and acronyms.
      .filter((x) => x.loc && (used.get(x.p.key) ?? 0) < 2 && (x.p.key.includes(' ') || /^[\p{Lu}]/u.test(x.p.phrase)))
      .filter((x) => x.loc!.start > 0 || x.p.key.includes(' '))
      .sort((a, b) => weight(b.p) - weight(a.p));
    const best = options[0];
    if (best && best.loc) {
      const answer = s.text.slice(best.loc.start, best.loc.end);
      // Don't blank most of the sentence.
      if (answer.split(/\s+/).length <= s.words / 2) pick = { sentence: s, answer, kind: 'phrase', phraseKey: best.p.key, ...best.loc };
    }
    if (!pick) {
      NUM_RE.lastIndex = 0;
      const m = NUM_RE.exec(s.text);
      if (m && /\d/.test(m[0]) && m[0].trim().length > 0) {
        const t = m[0].trim();
        pick = { sentence: s, answer: t, kind: 'number', start: m.index, end: m.index + t.length };
      }
    }
    if (pick) {
      if (pick.phraseKey) used.set(pick.phraseKey, (used.get(pick.phraseKey) ?? 0) + 1);
      out.push(pick);
    }
  }
  return out;
}

export function makeFlashcards(docId: string, cands: ClozeCand[], glossary: GlossaryEntry[], max = 16): Flashcard[] {
  const cards: Flashcard[] = [];
  const seenAnswers = new Set<string>();
  for (const c of cands) {
    if (cards.length >= max - Math.min(4, glossary.length)) break;
    const key = c.answer.toLowerCase();
    if (seenAnswers.has(key)) continue;
    seenAnswers.add(key);
    const front = c.sentence.text.slice(0, c.start) + BLANK + c.sentence.text.slice(c.end);
    cards.push({
      id: `f${hash(docId + ':' + c.sentence.i + ':' + key).toString(36)}`,
      kind: 'cloze',
      front,
      back: c.answer,
      context: c.sentence.text,
      sentence: c.sentence.i,
    });
  }
  for (const g of glossary.filter((g) => g.defining).slice(0, 4)) {
    if (cards.length >= max) break;
    cards.push({
      id: `d${hash(docId + ':def:' + g.term).toString(36)}`,
      kind: 'define',
      front: `What is meant by “${g.term}”?`,
      back: g.definition,
      context: g.definition,
      sentence: g.sentence,
    });
  }
  // Keep reading order so a first pass follows the document.
  return cards.sort((a, b) => a.sentence - b.sentence);
}

function numberDistractors(answer: string, rand: () => number): string[] {
  if (/^(?:1[89]|20|21)\d{2}$/.test(answer)) {
    // Years: nearby years, not multiples.
    const y = Number(answer);
    return shuffle([-12, -7, -4, -2, 3, 5, 9], rand)
      .slice(0, 3)
      .map((d) => String(y + d));
  }
  const m = answer.match(/^([$€£]\s?)?([\d,]*\.?\d+)(\s?(?:%|percent))?$/);
  if (!m) return [];
  const prefix = m[1] ?? '';
  const suffix = m[3] ?? '';
  const raw = m[2]!.replace(/,/g, '');
  const value = Number(raw);
  if (!Number.isFinite(value)) return [];
  const decimals = raw.includes('.') ? raw.split('.')[1]!.length : 0;
  const isPercent = /%|percent/.test(suffix);
  const factors = shuffle([0.5, 0.7, 1.3, 1.5, 2, 0.8, 1.2], rand);
  const out = new Set<string>();
  for (const f of factors) {
    let v = value * f;
    if (isPercent) v = Math.min(99, v);
    let s = decimals ? v.toFixed(decimals) : String(Math.max(1, Math.round(v)));
    if (!decimals && value >= 1000) s = Number(s).toLocaleString('en-US');
    const candidate = `${prefix}${s}${suffix}`;
    if (candidate !== answer) out.add(candidate);
    if (out.size >= 3) break;
  }
  return [...out];
}

export function makeQuiz(docId: string, cands: ClozeCand[], phrases: Keyphrase[], max = 8): QuizQuestion[] {
  const rand = rng(hash(docId + ':quiz'));
  const questions: QuizQuestion[] = [];
  const usedAnswers = new Set<string>();
  const pool = phrases.slice(0, 40);
  for (const c of cands) {
    if (questions.length >= max) break;
    const answerKey = c.answer.toLowerCase();
    if (usedAnswers.has(answerKey)) continue;
    let distractors: string[] = [];
    if (c.kind === 'number') {
      distractors = numberDistractors(c.answer, rand);
    } else {
      const aWords = c.answer.split(/\s+/).length;
      const aStems = new Set(tokenize(c.answer).map((t) => stem(t.word)));
      const sentenceLower = c.sentence.text.toLowerCase();
      const options = pool.filter((p) => {
        if (p.key === c.phraseKey) return false;
        const pw = p.phrase.split(/\s+/).length;
        if (Math.abs(pw - aWords) > 1) return false;
        if (sentenceLower.includes(p.phrase.toLowerCase())) return false;
        // Avoid near-synonyms of the answer (sharing a stem).
        if (tokenize(p.phrase).some((t) => aStems.has(stem(t.word)))) return false;
        return true;
      });
      // Prefer distractors of the same kind (proper names vs common phrases).
      const proper = /^[\p{Lu}]/u.test(c.answer) && c.start > 0;
      const same = options.filter((p) => /^[\p{Lu}]/u.test(p.phrase) === proper);
      const other = options.filter((p) => /^[\p{Lu}]/u.test(p.phrase) !== proper);
      distractors = [...shuffle(same.slice(0, 8), rand), ...shuffle(other.slice(0, 6), rand)]
        .slice(0, 3)
        .map((p) => (c.start === 0 ? p.phrase[0]!.toUpperCase() + p.phrase.slice(1) : p.phrase));
    }
    if (distractors.length < 3) continue;
    usedAnswers.add(answerKey);
    const options = shuffle([c.answer, ...distractors.slice(0, 3)], rand);
    const prompt = c.sentence.text.slice(0, c.start) + BLANK + c.sentence.text.slice(c.end);
    questions.push({
      id: `q${hash(docId + ':' + c.sentence.i + ':' + answerKey).toString(36)}`,
      prompt,
      options,
      answer: options.indexOf(c.answer),
      sentence: c.sentence.i,
      explanation: c.sentence.text,
    });
  }
  return questions;
}

const DEFINING = '(?:(?:is|are)\\s+(?:a|an|the|when|how|what|one|any)\\b|refers? to|means|describes?|denotes|is defined as|is known as|is called)';

export function makeGlossary(sentences: Sentence[], eligible: boolean[], phrases: Keyphrase[], max = 12): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const p of phrases) {
    if (out.length >= max) break;
    const multi = p.key.includes(' ') || /^[\p{Lu}]/u.test(p.phrase);
    const esc = p.phrase.split(/\s+/).map(escapeRegExp).join('[\\s\\-]+');
    // The term must be the subject: sentence-initial, optionally after a determiner and one modifier.
    const defRe = new RegExp(`^(?:(?:the|a|an|this|that|these|those)\\s+)?(?:[\\w-]+\\s+)?${esc}\\w*(?:\\s*\\([^)]*\\))?(?:,[^,]{1,60},)?\\s+${DEFINING}`, 'i');
    const calledRe = new RegExp(`\\b(?:called|known as|termed|dubbed)\\s+(?:the\\s+|an?\\s+)?[“"']?${esc}`, 'i');
    const anyRe = new RegExp(`\\b${esc}`, 'i');
    let defining = false;
    let found = sentences.find((s) => eligible[s.i] && (defRe.test(s.text) || calledRe.test(s.text)));
    if (found) defining = true;
    else if (multi) found = sentences.find((s) => eligible[s.i] && anyRe.test(s.text));
    if (!found) continue;
    if (out.some((g) => g.sentence === found!.i && !defining)) continue;
    out.push({ term: p.phrase, definition: found.text, sentence: found.i, defining });
  }
  return out;
}
