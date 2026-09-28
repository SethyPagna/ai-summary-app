// Entry point for turning a File (or pasted text) into a ParsedDoc.

import type { DocKind, ParsedDoc } from '../engine/types';
import { docxInWorker, pptxInWorker, textInWorker } from './engine-client';
import { htmlToBlocks } from './html';
import { looksLikeMarkdown, titleFromFileName } from './blocks';
import { decodeText, textToDoc } from './office';

export const MAX_BYTES = 25 * 1024 * 1024;
export const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html,application/pdf';

export function detectKind(name: string, mime = ''): DocKind | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'md' || ext === 'markdown' || mime === 'text/markdown') return 'md';
  if (ext === 'html' || ext === 'htm' || mime === 'text/html') return 'html';
  if (ext === 'txt' || ext === 'text' || ext === 'log' || mime === 'text/plain') return 'txt';
  return null;
}

export function unsupportedReason(name: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'doc') return 'Legacy .doc files are not supported — open it in Word and save as .docx.';
  if (ext === 'ppt') return 'Legacy .ppt files are not supported — save the deck as .pptx.';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'Images have no text layer to read. Use a PDF with selectable text.';
  return `“.${ext || '?'}” isn’t supported. Try PDF, DOCX, PPTX, TXT, Markdown or HTML.`;
}

export interface ParseResult {
  parsed: ParsedDoc;
  /** Original bytes, kept for PDFs so Claude mode can send the real file. */
  original?: ArrayBuffer;
}

export async function parseBuffer(name: string, kind: DocKind, buffer: ArrayBuffer, onProgress?: (fraction: number, detail?: string) => void): Promise<ParseResult> {
  if (buffer.byteLength === 0) throw new Error('This file is empty.');
  switch (kind) {
    case 'pdf': {
      const { extractPdf } = await import('./pdf');
      const parsed = await extractPdf(buffer, name, (d, t) => onProgress?.(d / t, `page ${d} of ${t}`));
      return { parsed, original: buffer };
    }
    case 'docx': {
      onProgress?.(0.3, 'unpacking');
      let html: string;
      try {
        ({ html } = await docxInWorker(buffer));
      } catch {
        throw new Error('Could not open this Word file. It may be damaged, password-protected, or an old .doc saved with a .docx name.');
      }
      const { title, blocks } = htmlToBlocks(html);
      if (!blocks.length) throw new Error('No readable text found in this Word document (it may contain only images).');
      return { parsed: { title: title ?? titleFromFileName(name), kind, blocks } };
    }
    case 'pptx': {
      onProgress?.(0.3, 'reading slides');
      return { parsed: await pptxInWorker(buffer, name) };
    }
    case 'html': {
      const { title, blocks } = htmlToBlocks(decodeText(buffer));
      if (!blocks.length) throw new Error('No readable text found in this HTML file.');
      return { parsed: { title: title ?? titleFromFileName(name), kind, blocks } };
    }
    case 'txt':
    case 'md': {
      const parsed = await textInWorker(buffer, name, kind);
      if (!parsed.blocks.length) throw new Error('This file has no readable text.');
      return { parsed };
    }
    case 'paste':
      throw new Error('Use parsePasted for pasted text.');
  }
}

export function parsePasted(text: string, title?: string): ParseResult {
  const clean = text.trim();
  if (clean.length < 40) throw new Error('Paste at least a few sentences so there is something to summarise.');
  const parsed = textToDoc(clean, 'Pasted text', looksLikeMarkdown(clean) ? 'md' : 'paste', title?.trim() || undefined);
  parsed.kind = 'paste';
  return { parsed };
}
