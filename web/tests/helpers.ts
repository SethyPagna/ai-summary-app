// Shared helpers for tests: load the bundled samples through the same parsers
// the app uses (pdf.js legacy build in Node for the PDF).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutPdf, type PdfPage } from '../src/ingest/pdf-layout';
import { textToDoc } from '../src/ingest/office';
import type { ParsedDoc } from '../src/engine/types';

export const SAMPLES = join(__dirname, '..', 'public', 'samples');
export const FIXTURES = join(__dirname, 'fixtures');

export function loadMarkdownSample(): ParsedDoc {
  return textToDoc(readFileSync(join(SAMPLES, 'tonle-sap.md'), 'utf8'), 'tonle-sap.md', 'md');
}

export async function loadPdfPages(file: string): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(file));
  const task = pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    await page.getOperatorList();
    pages.push({
      number: n,
      width: vp.width,
      height: vp.height,
      items: content.items
        .filter((it): it is Extract<typeof it, { str: string }> => 'str' in it)
        .map((it) => {
          const t = it.transform as number[];
          const font = page.commonObjs.has(it.fontName) ? (page.commonObjs.get(it.fontName) as { name?: string; bold?: boolean }) : {};
          return { str: it.str, x: t[4]!, y: t[5]!, w: it.width, size: Math.hypot(t[2]!, t[3]!), bold: !!font.bold || /bold/i.test(font.name ?? '') };
        }),
    });
  }
  await task.destroy();
  return pages;
}

export async function loadPdfSample(): Promise<ParsedDoc> {
  const pages = await loadPdfPages(join(SAMPLES, 'spacing-study.pdf'));
  const layout = layoutPdf(pages);
  return { title: layout.title ?? 'untitled', kind: 'pdf', blocks: layout.blocks, pages: pages.length };
}
