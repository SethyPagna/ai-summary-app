// DOCX / PPTX / text decoding. These run inside the engine worker; the heavy
// parsers (mammoth, JSZip) are loaded on first use only.

import { parseMarkdown, parsePlainText, titleFromFileName } from './blocks';
import type { ParsedDoc } from '../engine/types';

export async function docxToHtml(buffer: ArrayBuffer): Promise<{ html: string; warnings: string[] }> {
  const mod = await import('mammoth');
  const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh"],
      // Images are dropped: the reader view is text-only and base64 images bloat storage.
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    },
  );
  return { html: result.value, warnings: result.messages.filter((m) => m.type === 'error').map((m) => m.message) };
}

export async function pptxToDoc(buffer: ArrayBuffer, fileName: string): Promise<ParsedDoc> {
  const [{ default: JSZip }, { extractPptx }] = await Promise.all([import('jszip'), import('./pptx')]);
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('Could not open this presentation. It may be corrupted, password-protected, or an old binary .ppt file — save it as .pptx and try again.');
  }
  return extractPptx(zip, titleFromFileName(fileName));
}

/** Decode bytes as UTF-8 (with BOM handling), falling back to Windows-1252. */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 3 && bad / Math.max(1, utf8.length) > 0.001) {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8.replace(/^﻿/, '');
}

export function textToDoc(text: string, fileName: string, kind: 'txt' | 'md' | 'paste', explicitTitle?: string): ParsedDoc {
  if (kind === 'md') {
    const md = parseMarkdown(text);
    return { title: explicitTitle || md.title || titleFromFileName(fileName), kind, blocks: md.blocks };
  }
  const blocks = parsePlainText(text);
  const firstBlock = blocks[0];
  let title = explicitTitle || '';
  if (!title && firstBlock && firstBlock.kind === 'heading') title = firstBlock.text;
  if (!title && firstBlock && firstBlock.text.length < 90 && !/[.!?]$/.test(firstBlock.text) && blocks.length > 1) {
    firstBlock.kind = 'heading';
    firstBlock.level = 1;
    title = firstBlock.text;
  }
  return { title: title || titleFromFileName(fileName), kind, blocks };
}
