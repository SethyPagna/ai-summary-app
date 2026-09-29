// HTML (uploaded .html files and mammoth's DOCX output) -> blocks, using the
// browser's DOMParser. Scripts, styles and navigation chrome are ignored.

import { BlockBuilder, parsePlainText } from './blocks';
import type { Block } from '../engine/types';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'SVG', 'IFRAME', 'HEAD', 'IMG']);
const BLOCKISH = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'DL', 'DT', 'DD', 'HR', 'BR']);

export function htmlToBlocks(html: string): { title?: string; blocks: Block[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const b = new BlockBuilder();
  let title = doc.querySelector('title')?.textContent?.trim() || undefined;

  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

  const walk = (el: Element, listDepth: number) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (SKIP.has(tag)) continue;
      if (/^H[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        const t = text(child);
        if (level === 1 && !title) title = t;
        b.add('heading', t, { level });
      } else if (tag === 'P' || tag === 'DT' || tag === 'DD' || tag === 'FIGCAPTION') {
        b.add('paragraph', text(child));
      } else if (tag === 'UL' || tag === 'OL') {
        walk(child, listDepth + 1);
      } else if (tag === 'LI') {
        // Text of the item itself, excluding nested lists.
        const clone = child.cloneNode(true) as Element;
        clone.querySelectorAll('ul,ol').forEach((n) => n.remove());
        b.add('li', text(clone), { level: Math.max(0, listDepth - 1) });
        for (const nested of Array.from(child.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL')) walk(nested, listDepth + 1);
      } else if (tag === 'BLOCKQUOTE') {
        b.add('quote', text(child));
      } else if (tag === 'PRE') {
        b.add('code', child.textContent ?? '');
      } else if (tag === 'TABLE') {
        const rows = Array.from(child.querySelectorAll('tr'))
          .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => text(c)))
          .filter((r) => r.some((c) => c));
        if (rows.length) b.add('table', rows.map((r) => r.join(' | ')).join('\n'), { rows });
      } else {
        const hasBlockChildren = Array.from(child.children).some((c) => BLOCKISH.has(c.tagName));
        if (hasBlockChildren) {
          // Collect loose text nodes as their own paragraph, then recurse.
          const loose = Array.from(child.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !BLOCKISH.has((n as Element).tagName)))
            .map((n) => n.textContent ?? '')
            .join(' ')
            .trim();
          if (loose.length > 20) b.add('paragraph', loose);
          walk(child, listDepth);
        } else {
          b.add('paragraph', text(child));
        }
      }
    }
  };
  walk(doc.body, 0);
  if (!b.blocks.length) {
    // Text directly inside <body> with no block elements.
    const raw = doc.body.textContent ?? '';
    if (raw.trim()) return { title, blocks: parsePlainText(raw) };
  }
  return { title, blocks: b.blocks };
}
