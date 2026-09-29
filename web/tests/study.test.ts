import { describe, expect, it } from 'vitest';
import { analyze } from '../src/engine/analyze';
import { loadMarkdownSample, loadPdfSample } from './helpers';

describe('flashcards and quiz', async () => {
  const docs = [await loadPdfSample(), loadMarkdownSample()];

  it('cloze cards blank a real phrase from the source sentence', () => {
    for (const doc of docs) {
      const a = analyze('d', doc.title, doc.blocks);
      expect(a.flashcards.length).toBeGreaterThanOrEqual(8);
      for (const c of a.flashcards.filter((c) => c.kind === 'cloze')) {
        expect(c.front).toContain('_____');
        expect(c.front.replace('_____', c.back)).toBe(c.context);
        expect(a.sentences[c.sentence]!.text).toBe(c.context);
      }
      expect(new Set(a.flashcards.map((c) => c.id)).size).toBe(a.flashcards.length);
    }
  });

  it('quiz questions have four distinct options and one correct answer from the text', () => {
    for (const doc of docs) {
      const a = analyze('d', doc.title, doc.blocks);
      expect(a.quiz.length).toBeGreaterThanOrEqual(5);
      for (const q of a.quiz) {
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options.map((o) => o.toLowerCase())).size).toBe(4);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.prompt.replace('_____', q.options[q.answer]!).toLowerCase()).toBe(q.explanation.toLowerCase());
      }
    }
  });

  it('is deterministic for the same document id', () => {
    const doc = docs[0]!;
    expect(analyze('same', doc.title, doc.blocks).quiz).toEqual(analyze('same', doc.title, doc.blocks).quiz);
  });

  it('finds defining sentences for the glossary', () => {
    const a = analyze('d', docs[0]!.title, docs[0]!.blocks);
    const rp = a.glossary.find((g) => g.term === 'retrieval practice');
    expect(rp?.defining).toBe(true);
    expect(rp?.definition).toMatch(/^Retrieval practice is the act of recalling/);
  });

  it('builds an outline from headings, skipping references', () => {
    const a = analyze('d', docs[0]!.title, docs[0]!.blocks);
    const labels = a.outline.children.map((c) => c.label);
    expect(labels).toContain('3 Results');
    expect(labels).not.toContain('References');
    for (const b of a.outline.children) expect(b.children.length).toBeLessThanOrEqual(3);
  });
});
