// PDF text extraction with pdf.js (lazy-loaded). Parsing runs in pdf.js's own
// worker, bundled locally; this module only turns positioned text items into
// structured blocks via pdf-layout.

import { layoutPdf, type PdfItem, type PdfPage } from './pdf-layout';
import { titleFromFileName } from './blocks';
import type { ParsedDoc } from '../engine/types';

// The legacy build ships polyfills: pdf.js 6's modern build relies on very new
// built-ins (e.g. Map.prototype.getOrInsertComputed) that most browsers lack.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

interface FontInfo {
  name?: string;
  bold?: boolean;
  black?: boolean;
}

export async function extractPdf(data: ArrayBuffer, fileName: string, onProgress?: (done: number, total: number) => void): Promise<ParsedDoc> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    disableFontFace: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    void task.destroy();
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password and try again.');
    throw new Error('Could not read this PDF — the file may be damaged or not a real PDF.');
  }

  const pages: PdfPage[] = [];
  const detectFonts = doc.numPages <= 40;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const fonts = new Map<string, FontInfo>();
    if (detectFonts) {
      try {
        await page.getOperatorList();
        for (const it of content.items) {
          if (!('fontName' in it) || fonts.has(it.fontName)) continue;
          const f = page.commonObjs.has(it.fontName) ? (page.commonObjs.get(it.fontName) as FontInfo) : {};
          fonts.set(it.fontName, f);
        }
      } catch {
        // Font details are optional; size-based heuristics still apply.
      }
    }
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const [, , c, d, e, f] = it.transform as number[];
      const size = Math.hypot(c ?? 0, d ?? 0) || it.height || 10;
      const font = fonts.get(it.fontName);
      const bold = !!(font?.bold || font?.black || /bold|black|heavy|semibold|demi/i.test(font?.name ?? ''));
      items.push({ str: it.str, x: e ?? 0, y: f ?? 0, w: it.width, size, bold });
    }
    pages.push({ number: n, width: viewport.width, height: viewport.height, items });
    page.cleanup();
    onProgress?.(n, doc.numPages);
  }

  let metaTitle: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const t = (meta.info as { Title?: string } | undefined)?.Title?.trim();
    if (t && !/^(untitled|microsoft word|document\d*)/i.test(t)) metaTitle = t;
  } catch {
    // no metadata
  }
  const numPages = doc.numPages;
  await task.destroy();

  const layout = layoutPdf(pages);
  if (layout.chars < Math.max(40, numPages * 25)) {
    throw new Error('This PDF has no text layer (it looks scanned or image-only). Run OCR on it first, then upload again.');
  }
  return {
    title: layout.title ?? metaTitle ?? titleFromFileName(fileName),
    kind: 'pdf',
    blocks: layout.blocks,
    pages: numPages,
  };
}
