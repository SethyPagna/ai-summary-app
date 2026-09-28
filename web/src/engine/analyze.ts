// Orchestrates the local engine: blocks -> sentences/sections/chunks ->
// TextRank summaries, keyphrases, entities, readability, study material,
// outline and suggested questions. Pure and deterministic; runs in a worker.

import { extractEntities } from './entities';
import { extractKeyphrases } from './keyphrases';
import { buildOutline } from './outline';
import { answerQuestion, buildQaIndex } from './qa';
import { readingStats } from './readability';
import { chunkSentences, segment } from './segment';
import { clozeCandidates, makeFlashcards, makeGlossary, makeQuiz } from './study';
import { pickSummaries, rankSentences, mmrSelect, type RankInput } from './textrank';
import { STOPWORDS, stem, terms, tokenize } from './text';
import { cosine } from './vectors';
import { ANALYSIS_VERSION, type Analysis, type Block, type Keyphrase } from './types';

export function analyze(docId: string, title: string, blocks: Block[]): Analysis {
  const seg = segment(blocks, title);
  const { sentences, sections, eligible } = seg;

  // Keyphrases first: they bias the sentence ranking towards on-topic sentences.
  const sentenceTexts = sentences.map((s) => s.text);
  const keyphrases = extractKeyphrases(
    sentences.map((s, i) => (!seg.backMatter[i] && (eligible[i] || s.words >= 3) ? s.text : '')),
    { limit: 30, headings: sections.map((s) => s.title) },
  );
  const phraseWeights = keyphraseWeights(sentenceTexts, keyphrases.slice(0, 15));

  const kindOf = new Map(blocks.map((b) => [b.id, b.kind]));
  const inputs: RankInput[] = sentences.map((s) => {
    const sec = sections[s.section];
    return {
      phraseWeight: phraseWeights[s.i] ?? 0,
      aside: kindOf.get(s.blockId) === 'note',
      text: s.text,
      words: s.words,
      posInSection: sec ? s.i - sec.sentStart : s.i,
      relPos: sentences.length > 1 ? s.i / (sentences.length - 1) : 0,
      headingTerms: sec && sec.blockId ? terms(sec.title) : undefined,
      eligible: eligible[s.i] ?? false,
    };
  });
  const rank = rankSentences(inputs);
  const picks = pickSummaries(inputs, rank, (i) => sentences[i]?.section ?? 0);

  // Per-section summaries (1–2 sentences each) for sections with content.
  const sim = (a: number, b: number) => cosine(rank.vecs[a]!, rank.vecs[b]!);
  const sectionSummaries = sections
    .filter((sec) => sec.sentEnd - sec.sentStart >= 2)
    .map((sec) => {
      const ids: number[] = [];
      for (let i = sec.sentStart; i < sec.sentEnd; i++) if (eligible[i]) ids.push(i);
      const k = sec.sentEnd - sec.sentStart >= 8 ? 2 : 1;
      const chosen = mmrSelect(ids, (i) => rank.scores[i]!, sim, Math.min(k, ids.length), 0.7).sort((a, b) => a - b);
      return { section: sec.index, sentences: chosen };
    })
    .filter((s) => s.sentences.length > 0);

  const entities = extractEntities(sentences.map((s, i) => (seg.backMatter[i] ? '' : s.text)));
  const stats = readingStats(
    sentences.filter((s) => eligible[s.i] || s.words >= 3).map((s) => s.text),
    seg.paragraphs,
  );
  const chunks = chunkSentences(sentences, sections, blocks);

  const glossary = makeGlossary(sentences, eligible, keyphrases, 12);
  const cloze = clozeCandidates(sentences, rank.scores, eligible, keyphrases, 48);
  const flashcards = makeFlashcards(docId, cloze, glossary, 16);
  const quiz = makeQuiz(docId, cloze, keyphrases, 8);
  const outline = buildOutline(title, sentences, sections, keyphrases);

  const termCounts = new Map<string, number>();
  for (const s of sentences) for (const t of terms(s.text)) termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
  const topTerms: Record<string, number> = {};
  [...termCounts.entries()]
    .filter(([t]) => t.length > 2 && !/^\d+$/.test(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 400)
    .forEach(([t, c]) => (topTerms[t] = c));

  const partial: Analysis = {
    version: ANALYSIS_VERSION,
    docId,
    sentences,
    scores: rank.scores,
    sections,
    chunks,
    summary: { ...picks, sections: sectionSummaries },
    keyphrases,
    entities,
    stats,
    flashcards,
    quiz,
    glossary,
    outline,
    terms: topTerms,
    suggestions: [],
  };
  partial.suggestions = suggestQuestions(partial, title);
  return partial;
}

/** Share of the top keyphrases' weight present in each sentence (0..1). */
function keyphraseWeights(sentences: string[], phrases: Keyphrase[]): number[] {
  const keys = phrases.map((p) => ({ key: ` ${p.key} `, w: p.score * (1 + 0.6 * (p.key.split(' ').length - 1)) }));
  const raw = sentences.map((text) => {
    const seq = ' ' + tokenize(text).map((t) => (STOPWORDS.has(t.word) ? '|' : stem(t.word))).join(' ') + ' ';
    let sum = 0;
    for (const k of keys) if (seq.includes(k.key)) sum += k.w;
    return sum;
  });
  const max = Math.max(...raw, 0);
  return max > 0 ? raw.map((v) => v / max) : raw;
}

/** Candidate questions, kept only if the local Q&A can answer them well. */
export function suggestQuestions(a: Analysis, title: string): string[] {
  const has = (re: RegExp) => a.sentences.some((s) => re.test(s.text));
  const sectionTitles = a.sections.map((s) => s.title.toLowerCase());
  const cands: string[] = [];
  if (sectionTitles.some((t) => /result|finding/.test(t))) cands.push('What were the main findings?');
  if (has(/\b(decid|agreed|approv)/i)) cands.push('What was decided?');
  if (has(/\b(deadline|due|by (?:mon|tues|wednes|thurs|fri)day|launch)/i)) cands.push('When is the deadline?');
  if (has(/\bbudget\b/i)) cands.push('How much is the budget?');
  if (has(/\b(limitation|caveat|weakness)/i)) cands.push('What are the limitations?');
  if (has(/\b(risk|threat|danger)/i)) cands.push('What are the main risks?');
  if (has(/\bbecause\b|\bdue to\b/i)) {
    const p = a.keyphrases.find((k) => k.key.includes(' '));
    if (p) cands.push(`Why does ${p.phrase} matter?`);
  }
  const defining = a.glossary.find((g) => g.defining);
  if (defining) cands.push(`What is meant by “${defining.term}”?`);
  for (const k of a.keyphrases.filter((k) => k.key.includes(' ') || /^[\p{Lu}]/u.test(k.phrase)).slice(0, 4))
    cands.push(`What does the text say about ${k.phrase}?`);

  const index = buildQaIndex([{ docId: a.docId, title, analysis: a }]);
  const out: string[] = [];
  for (const q of cands) {
    if (out.length >= 4) break;
    if (out.includes(q)) continue;
    const ans = answerQuestion(q, index);
    if (ans.kind === 'answer' && ans.confidence !== 'low') out.push(q);
  }
  if (out.length < 4) out.push('What is this document about?');
  return out;
}
