import { describe, expect, it } from 'vitest';
import { parseMarkdown, parsePlainText } from '../src/ingest/blocks';
import { layoutPdf, type PdfItem, type PdfPage } from '../src/ingest/pdf-layout';
import { parseSlideXml, decodeXml } from '../src/ingest/pptx';
import { extractEntities } from '../src/engine/entities';
import { readingStats } from '../src/engine/readability';
import { extractKeyphrases } from '../src/engine/keyphrases';
import { loadPdfSample, loadMarkdownSample } from './helpers';

describe('Markdown parser', () => {
  it('extracts structure and strips inline syntax', () => {
    const md = `---\ntitle: Front Title\n---\n# Heading One\n\nSome **bold** and [a link](http://x.y) text.\n\n- item *one*\n- item two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`\ncode here\n\`\`\`\n\n> quoted words`;
    const { title, blocks } = parseMarkdown(md);
    expect(title).toBe('Front Title');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'li', 'li', 'table', 'code', 'quote']);
    expect(blocks[1]!.text).toBe('Some bold and a link text.');
    expect(blocks[2]!.text).toBe('item one');
    expect(blocks[4]!.rows).toEqual([['A', 'B'], ['1', '2']]);
    expect(blocks[1]!.anchor.section).toBe('Heading One');
  });
});

describe('plain-text parser', () => {
  it('detects headings, paragraphs and bullets', () => {
    const blocks = parsePlainText('REPORT\n\nFirst paragraph line one\ncontinues here.\n\nNext steps\n\n- do this\n- do that\n');
    expect(blocks.map((b) => `${b.kind}:${b.text}`)).toEqual(['heading:REPORT', 'paragraph:First paragraph line one continues here.', 'heading:Next steps', 'li:do this', 'li:do that']);
  });
});

describe('PDF layout', () => {
  it('reconstructs the sample: title, headings, no running header/footer', async () => {
    const doc = await loadPdfSample();
    expect(doc.title).toMatch(/^Spacing Out: Retrieval Practice/);
    const headings = doc.blocks.filter((b) => b.kind === 'heading').map((b) => b.text);
    expect(headings).toEqual(expect.arrayContaining(['Abstract', '1 Introduction', '3 Results', '6 Conclusion', 'References']));
    const all = doc.blocks.map((b) => b.text).join('\n');
    expect(all).not.toMatch(/Page \d of \d/);
    expect(all).not.toMatch(/AI Summary sample · Spacing Out/);
  });

  const item = (str: string, x: number, y: number, size = 10, bold = false): PdfItem => ({ str, x, y, w: str.length * size * 0.5, size, bold });

  it('joins hyphenated line breaks and orders two columns', () => {
    const left: PdfItem[] = [];
    const right: PdfItem[] = [];
    let y = 700;
    for (const line of ['Left column starts with a hyphen-', 'ated word and continues here.', 'Second line of left text ends.']) {
      left.push(item(line, 40, y));
      y -= 13;
    }
    y = 700;
    for (const line of ['Right column text begins here and', 'keeps going to its end.']) {
      right.push(item(line, 320, y));
      y -= 13;
    }
    const page: PdfPage = { number: 1, width: 600, height: 800, items: [...right, ...left] };
    const { blocks } = layoutPdf([page]);
    const text = blocks.map((b) => b.text).join(' | ');
    expect(text.indexOf('Left column')).toBeLessThan(text.indexOf('Right column'));
    expect(text).toContain('hyphenated word');
  });
});

describe('PPTX slide XML', () => {
  it('reads title placeholders, bullets and entities', () => {
    const xml = `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Q3 &amp; Q4 Plan</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>
        <a:p><a:r><a:t>Hire two </a:t></a:r><a:r><a:t>engineers</a:t></a:r></a:p>
        <a:p><a:pPr lvl="1"/><a:r><a:t>By &#x201C;March&#x201D;</a:t></a:r></a:p>
      </p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`;
    const s = parseSlideXml(xml);
    expect(s.title).toBe('Q3 & Q4 Plan');
    expect(s.items).toEqual([
      { type: 'para', para: { text: 'Hire two engineers', level: 0, bullet: true } },
      { type: 'para', para: { text: 'By “March”', level: 1, bullet: true } },
    ]);
    expect(decodeXml('&lt;a&gt; &#65;')).toBe('<a> A');
  });
});

describe('entities, readability and keyphrases', () => {
  it('finds dates, money, percentages and names', () => {
    const e = extractEntities([
      'The research budget is $1,200 for the semester and 22% of users returned.',
      'Anika Rao will ship it by Friday, 24 October 2026.',
      'Anika Rao also met Lina Ouk. Email team@example.org or visit https://example.org/plan.',
    ]);
    const has = (type: string, text: string) => e.some((x) => x.type === type && x.text === text);
    expect(has('money', '$1,200')).toBe(true);
    expect(has('percent', '22%')).toBe(true);
    expect(has('date', 'Friday, 24 October 2026')).toBe(true);
    expect(has('name', 'Anika Rao')).toBe(true);
    expect(has('email', 'team@example.org')).toBe(true);
    expect(has('url', 'https://example.org/plan')).toBe(true);
  });

  it('scores simple prose as easier than dense prose', () => {
    const easy = readingStats(['The cat sat on the mat.', 'It was warm and the sun was out.'], 1);
    const hard = readingStats(['Institutional considerations notwithstanding, interdisciplinary methodological heterogeneity complicates generalisation.'], 1);
    expect(easy.flesch).toBeGreaterThan(hard.flesch);
    expect(easy.fleschLabel).toMatch(/easy/i);
  });

  it('prefers multi-word noun phrases over verb fragments', () => {
    const doc = loadMarkdownSample();
    const kp = extractKeyphrases(doc.blocks.filter((b) => b.kind !== 'heading').flatMap((b) => b.text.split(/(?<=\.)\s+/)), 12).map((k) => k.phrase);
    expect(kp).toEqual(expect.arrayContaining(['Tonlé Sap River', 'flood pulse', 'floating villages']));
    expect(kp.some((p) => /\b(links|supports|follows)$/.test(p))).toBe(false);
  });
});
