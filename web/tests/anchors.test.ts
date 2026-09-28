import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/engine/analyze';
import { anchorLabel } from '../src/engine/segment';
import { extractPptx } from '../src/ingest/pptx';
import type { Block, ParsedDoc } from '../src/engine/types';
import { FIXTURES, loadMarkdownSample, loadPdfSample } from './helpers';

async function loadPptx(): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(readFileSync(join(FIXTURES, 'microgrid-deck.pptx')));
  return extractPptx(zip, 'deck');
}

function checkSentenceOffsets(blocks: Block[], doc: ReturnType<typeof analyze>) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const s of doc.sentences) expect(byId.get(s.blockId)!.text.slice(s.start, s.end)).toBe(s.text);
}

describe('chunk anchors', () => {
  it('PDF chunks carry page anchors and never span two pages', async () => {
    const doc = await loadPdfSample();
    const a = analyze('pdf', doc.title, doc.blocks);
    checkSentenceOffsets(doc.blocks, a);
    const pageOf = new Map(doc.blocks.map((b) => [b.id, b.anchor.page]));
    expect(a.chunks.length).toBeGreaterThan(3);
    for (const c of a.chunks) {
      expect(c.anchor.page).toBeGreaterThanOrEqual(1);
      const pages = new Set(c.blockIds.map((id) => pageOf.get(id)));
      expect(pages.size).toBe(1);
      expect(pages.has(c.anchor.page)).toBe(true);
      expect(anchorLabel(c.anchor)).toBe(`p. ${c.anchor.page}`);
    }
    // Results live on page 2 of the sample.
    const results = a.chunks.find((c) => c.heading === '3 Results')!;
    expect(results.anchor.page).toBe(2);
  });

  it('PPTX blocks and chunks are anchored to slides, with notes and tables', async () => {
    const doc = await loadPptx();
    expect(doc.slides).toBe(4);
    expect(doc.title).toBe('Solar Microgrids for Rural Clinics');
    expect(doc.blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual([
      'Solar Microgrids for Rural Clinics',
      'Why clinics need reliable power',
      'Pilot results',
      'Next steps',
    ]);
    const note = doc.blocks.find((b) => b.kind === 'note')!;
    expect(note.anchor.slide).toBe(2);
    const table = doc.blocks.find((b) => b.kind === 'table')!;
    expect(table.rows![1]).toEqual(['Outage hours per week', '14', '1.5']);
    const a = analyze('pptx', doc.title, doc.blocks);
    checkSentenceOffsets(doc.blocks, a);
    for (const c of a.chunks) expect(anchorLabel(c.anchor)).toMatch(/^Slide [1-4]$/);
  });

  it('Markdown chunks are anchored to their section heading', () => {
    const doc = loadMarkdownSample();
    const a = analyze('md', doc.title, doc.blocks);
    checkSentenceOffsets(doc.blocks, a);
    const fest = a.chunks.find((c) => /Bon Om Touk, the Water Festival/.test(c.text))!;
    expect(fest.heading).toBe('Bon Om Touk');
    expect(anchorLabel(fest.anchor)).toBe('§ Bon Om Touk');
    for (const c of a.chunks) expect(c.sentEnd).toBeGreaterThan(c.sentStart);
  });
});
