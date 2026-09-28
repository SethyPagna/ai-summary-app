import { describe, expect, it } from 'vitest';
import { splitSentences, stem, tokenize, terms, editDistance } from '../src/engine/text';

const texts = (s: string) => splitSentences(s).map((x) => x.text);

describe('splitSentences', () => {
  it('splits ordinary sentences and keeps offsets exact', () => {
    const src = 'The lake swells. Fish follow the water! Does it drain? Yes.';
    const spans = splitSentences(src);
    expect(spans.map((s) => s.text)).toEqual(['The lake swells.', 'Fish follow the water!', 'Does it drain?', 'Yes.']);
    for (const s of spans) expect(src.slice(s.start, s.end)).toBe(s.text);
  });

  it('does not split on abbreviations, initials, decimals or dotted acronyms', () => {
    expect(texts('Dr. Smith met Prof. Tan at 3.5 p.m. on Monday. They talked.')).toEqual(['Dr. Smith met Prof. Tan at 3.5 p.m. on Monday.', 'They talked.']);
    expect(texts('J. K. Rowling wrote it. It sold well.')).toEqual(['J. K. Rowling wrote it.', 'It sold well.']);
    expect(texts('Pi is about 3.14159 in value. Next.')).toEqual(['Pi is about 3.14159 in value.', 'Next.']);
    expect(texts('See e.g. the appendix for details. Done.')).toEqual(['See e.g. the appendix for details.', 'Done.']);
    expect(texts('Growth was strong (see Fig. 2) this year. Good.')).toEqual(['Growth was strong (see Fig. 2) this year.', 'Good.']);
  });

  it('keeps closing quotes and brackets with the sentence', () => {
    expect(texts('He said "Stop." Then he left. (It was late.) Fine.')).toEqual(['He said "Stop."', 'Then he left.', '(It was late.)', 'Fine.']);
  });

  it('does not split when the next word is lowercase', () => {
    expect(texts('The results were mixed… but promising overall. End.')).toEqual(['The results were mixed… but promising overall.', 'End.']);
  });

  it('treats blank lines as hard boundaries and handles list numbering', () => {
    expect(texts('Heading without period\n\nBody text here.')).toEqual(['Heading without period', 'Body text here.']);
    expect(texts('1. Mix the flour well. 2. Bake it.')).toEqual(['1. Mix the flour well.', '2. Bake it.']);
  });
});

describe('stem and tokenize', () => {
  it('maps inflections to one stem', () => {
    expect(new Set(['summarize', 'summarized', 'summarization', 'summarizes', 'summarising'].map(stem)).size).toBe(1);
    expect(new Set(['study', 'studies', 'studied', 'studying'].map(stem))).toEqual(new Set(['study']));
    expect(stem('slept')).toBe(stem('sleep'));
    expect(stem('ranking')).toBe(stem('ranks'));
    expect(stem('retrieval')).toBe(stem('retrieve'));
  });

  it('tokenises words with offsets and strips possessives', () => {
    const t = tokenize("The lake's rhythm, 2,500 km².");
    expect(t.map((x) => x.word)).toEqual(['the', 'lake', 'rhythm', '2', '500', 'km²']);
    expect(terms('The lake and the lakes')).toEqual(['lake', 'lake']);
  });

  it('computes Damerau-Levenshtein distance with transpositions', () => {
    expect(editDistance('retreival', 'retrieval')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});
