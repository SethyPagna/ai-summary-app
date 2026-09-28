// PPTX extraction from the Office Open XML parts, using only regexes so it
// runs inside a Web Worker (no DOMParser there). Keeps slide order from
// presentation.xml, slide titles, bullet levels, tables and speaker notes.

import type JSZipType from 'jszip';
import { BlockBuilder } from './blocks';
import type { ParsedDoc } from '../engine/types';

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface SlidePara {
  text: string;
  level: number;
  bullet: boolean;
}

export interface SlideContent {
  title?: string;
  items: ({ type: 'para'; para: SlidePara } | { type: 'table'; rows: string[][] })[];
}

function paragraphsOf(xml: string): { text: string; level: number; hasBullet: boolean }[] {
  const out: { text: string; level: number; hasBullet: boolean }[] = [];
  const re = /<a:p>([\s\S]*?)<\/a:p>|<a:p\s[^>]*>([\s\S]*?)<\/a:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[1] ?? m[2] ?? '';
    const lvl = body.match(/<a:pPr\b[^>]*\blvl="(\d)"/);
    const hasBullet = /<a:bu(?:Char|AutoNum)\b/.test(body);
    const noBullet = /<a:buNone\b/.test(body);
    const parts: string[] = [];
    const runRe = /<a:t>([^<]*)<\/a:t>|<a:t\s[^>]*>([^<]*)<\/a:t>|<a:br\s*\/>/g;
    let r: RegExpExecArray | null;
    while ((r = runRe.exec(body))) {
      if (r[0].startsWith('<a:br')) parts.push(' ');
      else parts.push(decodeXml(r[1] ?? r[2] ?? ''));
    }
    const text = parts.join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, level: lvl ? Number(lvl[1]) : 0, hasBullet: hasBullet && !noBullet });
  }
  return out;
}

export function parseSlideXml(xml: string): SlideContent {
  const content: SlideContent = { items: [] };
  const shapeRe = /<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g;
  let m: RegExpExecArray | null;
  while ((m = shapeRe.exec(xml))) {
    const shape = m[0];
    if (shape.startsWith('<p:graphicFrame')) {
      if (!/<a:tbl\b/.test(shape)) continue;
      const rows: string[][] = [];
      const rowRe = /<a:tr\b[\s\S]*?<\/a:tr>/g;
      let tr: RegExpExecArray | null;
      while ((tr = rowRe.exec(shape))) {
        const cells: string[] = [];
        const cellRe = /<a:tc\b[\s\S]*?<\/a:tc>/g;
        let tc: RegExpExecArray | null;
        while ((tc = cellRe.exec(tr[0]))) cells.push(paragraphsOf(tc[0]).map((p) => p.text).join(' '));
        if (cells.some((c) => c)) rows.push(cells);
      }
      if (rows.length) content.items.push({ type: 'table', rows });
      continue;
    }
    const ph = shape.match(/<p:ph\b([^>]*)\/?>/);
    const phType = ph ? ph[1]!.match(/type="(\w+)"/)?.[1] ?? 'body' : null;
    if (phType && ['sldNum', 'dt', 'ftr', 'hdr', 'sldImg'].includes(phType)) continue;
    const paras = paragraphsOf(shape);
    if (!paras.length) continue;
    if ((phType === 'title' || phType === 'ctrTitle') && !content.title) {
      content.title = paras.map((p) => p.text).join(' ');
      continue;
    }
    // No title placeholder yet: a short, non-bullet first line acts as the title.
    if (!content.title && content.items.length === 0 && !phType && paras.length && !paras[0]!.hasBullet && paras[0]!.text.split(/\s+/).length <= 12) {
      content.title = paras[0]!.text;
      paras.shift();
      if (!paras.length) continue;
    }
    const isBody = phType === 'body' || phType === 'obj' || phType === 'subTitle';
    for (const p of paras) {
      content.items.push({ type: 'para', para: { text: p.text, level: p.level, bullet: p.hasBullet || (isBody && phType !== 'subTitle') } });
    }
  }
  return content;
}

export function parseNotesXml(xml: string): string[] {
  const out: string[] = [];
  const shapeRe = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  let m: RegExpExecArray | null;
  while ((m = shapeRe.exec(xml))) {
    const phType = m[0].match(/<p:ph\b[^>]*type="(\w+)"/)?.[1];
    if (phType && phType !== 'body') continue;
    for (const p of paragraphsOf(m[0])) out.push(p.text);
  }
  return out;
}

function relTargets(relsXml: string): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  const re = /<Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml))) {
    const attrs = m[1]!;
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    const type = attrs.match(/\bType="([^"]+)"/)?.[1] ?? '';
    if (id && target) map.set(id, { target, type });
  }
  return map;
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export async function extractPptx(zip: JSZipType, fallbackTitle: string): Promise<ParsedDoc> {
  const read = async (path: string) => (zip.file(path) ? await zip.file(path)!.async('string') : null);

  // Slide order from presentation.xml; fall back to numeric file order.
  let slidePaths: string[] = [];
  const pres = await read('ppt/presentation.xml');
  const presRels = await read('ppt/_rels/presentation.xml.rels');
  if (pres && presRels) {
    const rels = relTargets(presRels);
    const ids = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((x) => x[1]!);
    slidePaths = ids.map((id) => rels.get(id)).filter((r): r is { target: string; type: string } => !!r).map((r) => resolvePath('ppt/presentation.xml', r.target));
  }
  if (!slidePaths.length) {
    slidePaths = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  }
  if (!slidePaths.length) throw new Error('No slides found. Is this a valid .pptx presentation?');

  let docTitle: string | undefined;
  const core = await read('docProps/core.xml');
  const coreTitle = core?.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1];
  if (coreTitle && coreTitle.trim()) docTitle = decodeXml(coreTitle.trim());

  const b = new BlockBuilder();
  let textChars = 0;
  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i]!;
    const slideNo = i + 1;
    const xml = await read(path);
    if (!xml) continue;
    const slide = parseSlideXml(xml);
    if (i === 0 && slide.title && !docTitle) docTitle = slide.title;
    b.add('heading', slide.title ?? `Slide ${slideNo}`, { level: 2, slide: slideNo });
    for (const item of slide.items) {
      if (item.type === 'table') {
        b.add('table', item.rows.map((r) => r.join(' | ')).join('\n'), { rows: item.rows, slide: slideNo });
      } else {
        textChars += item.para.text.length;
        b.add(item.para.bullet ? 'li' : 'paragraph', item.para.text, { level: item.para.level, slide: slideNo });
      }
    }
    // Speaker notes.
    const relsPath = path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    const rels = await read(relsPath);
    if (rels) {
      for (const r of relTargets(rels).values()) {
        if (!/notesSlide$/.test(r.type)) continue;
        const notes = await read(resolvePath(path, r.target));
        if (!notes) continue;
        const paras = parseNotesXml(notes);
        if (paras.length) {
          const text = paras.join(' ');
          textChars += text.length;
          b.add('note', text, { slide: slideNo });
        }
      }
    }
  }
  if (textChars < 5) throw new Error('This presentation has no readable text (slides may be images only).');
  return { title: docTitle ?? fallbackTitle, kind: 'pptx', blocks: b.blocks, slides: slidePaths.length };
}
