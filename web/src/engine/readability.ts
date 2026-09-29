import { syllables, tokenize } from './text';
import type { ReadingStats } from './types';

const WPM = 238; // average adult silent reading speed (Brysbaert, 2019)

export function fleschLabel(score: number): string {
  if (score >= 90) return 'Very easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly easy';
  if (score >= 60) return 'Plain English';
  if (score >= 50) return 'Fairly difficult';
  if (score >= 30) return 'Difficult';
  return 'Very difficult';
}

export function readingStats(sentences: string[], paragraphs: number): ReadingStats {
  let wordCount = 0;
  let syl = 0;
  const unique = new Set<string>();
  for (const s of sentences) {
    for (const t of tokenize(s)) {
      if (!/\p{L}/u.test(t.word)) continue;
      wordCount++;
      syl += syllables(t.word);
      unique.add(t.word);
    }
  }
  const sentenceCount = Math.max(1, sentences.length);
  const w = Math.max(1, wordCount);
  const wps = w / sentenceCount;
  const spw = syl / w;
  const flesch = 206.835 - 1.015 * wps - 84.6 * spw;
  const grade = 0.39 * wps + 11.8 * spw - 15.59;
  return {
    words: wordCount,
    sentences: sentences.length,
    paragraphs,
    uniqueWords: unique.size,
    readingMinutes: Math.max(1, Math.round(wordCount / WPM)),
    flesch: Math.round(Math.max(0, Math.min(100, flesch))),
    fleschLabel: fleschLabel(flesch),
    grade: Math.round(Math.max(0, grade) * 10) / 10,
    avgSentenceWords: Math.round(wps * 10) / 10,
  };
}
