import { describe, expect, it } from 'vitest';
import { BM25, parseQuery } from '../src/engine/bm25';
import { terms } from '../src/engine/text';
import { answerQuestion, buildQaIndex, questionType } from '../src/engine/qa';
import { analyze } from '../src/engine/analyze';
import { loadMarkdownSample, loadPdfSample } from './helpers';

const docs = [
  'The flood pulse carries fish into the flooded forest where they spawn.',
  'Rice farmers plant as the water recedes, using the fertile sediment.',
  'Hydropower dams can flatten the flood pulse and reduce fish catches.',
  'The festival features boat races in the capital every November.',
];

describe('BM25', () => {
  const index = new BM25(docs.map((d) => ({ terms: terms(d) })));

  it('ranks documents by term relevance', () => {
    const hits = index.search(parseQuery('flood pulse fish'), 4);
    expect(hits.map((h) => h.id).slice(0, 2).sort()).toEqual([0, 2]);
    expect(hits.some((h) => h.id === 3)).toBe(false);
  });

  it('gives rarer terms a higher IDF', () => {
    expect(index.idf('festiv')).toBeGreaterThan(index.idf('flood'));
  });

  it('expands synonyms and tolerates typos', () => {
    const syn = parseQuery('What were the results?');
    expect(syn.some((t) => t.source === 'synonym' && t.surface === 'finding')).toBe(true);
    const typo = parseQuery('hydropwer dams', index);
    expect(typo.some((t) => t.source === 'typo' && t.term === terms('hydropower')[0])).toBe(true);
  });
});

describe('question answering', () => {
  it('answers with cited sentences and a short answer when the type is clear', () => {
    const doc = loadMarkdownSample();
    const a = analyze('md', doc.title, doc.blocks);
    const idx = buildQaIndex([{ docId: 'md', title: doc.title, analysis: a }]);
    const ans = answerQuestion('When is the Water Festival?', idx);
    expect(ans.kind).toBe('answer');
    expect(ans.shortAnswer).toBe('November');
    expect(ans.sentences.some((s) => /Bon Om Touk/.test(s.text))).toBe(true);
    for (const s of ans.sentences) expect(a.sentences[s.sentence]!.text).toBe(s.text);
  });

  it('uses document structure for "findings" questions', async () => {
    const doc = await loadPdfSample();
    const a = analyze('pdf', doc.title, doc.blocks);
    const idx = buildQaIndex([{ docId: 'pdf', title: doc.title, analysis: a }]);
    const ans = answerQuestion('What were the main findings?', idx);
    expect(ans.sentences[0]!.text).toMatch(/78%/);
  });

  it('is honest when nothing relevant is found', () => {
    const doc = loadMarkdownSample();
    const a = analyze('md', doc.title, doc.blocks);
    const idx = buildQaIndex([{ docId: 'md', title: doc.title, analysis: a }]);
    const ans = answerQuestion('What is quantum chromodynamics?', idx);
    expect(ans.kind).toBe('not_found');
    expect(ans.sentences).toHaveLength(0);
    expect(ans.message).toMatch(/couldn’t find/);
  });

  it('classifies question types', () => {
    expect(questionType('When is the deadline?')).toBe('date');
    expect(questionType('How many students took part?')).toBe('number');
    expect(questionType('Who owns the scheduler work?')).toBe('name');
    expect(questionType('Why does the river reverse?')).toBe('cause');
    expect(questionType('What is this document about?')).toBe('general');
  });
});
