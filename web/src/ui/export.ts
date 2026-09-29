// Markdown export of a document's summary, notes, highlights and Q&A.

import { resolveCitation } from '../ai/citations';
import type { AiSegment } from '../ai/stream';
import type { DocMapEntry } from '../ai/request';
import { anchorLabel } from '../engine/segment';
import type { Analysis, Block } from '../engine/types';
import { getChat, getNotes, loadDoc, type LoadedDoc } from '../store/app';
import type { SavedAi } from '../store/db';
import { kindLabel } from './common';

function cite(doc: LoadedDoc, si: number): string {
  const s = doc.analysis.sentences[si];
  if (!s) return '';
  const b = doc.blocks.find((x) => x.id === s.blockId);
  const label = anchorLabel(b?.anchor, '');
  return label ? ` [${label}]` : '';
}

function sentence(doc: LoadedDoc, si: number): string {
  return (doc.analysis.sentences[si]?.text ?? '') + cite(doc, si);
}

async function aiToMarkdown(saved: SavedAi): Promise<string> {
  const blocks = new Map<string, Block[]>();
  for (const d of saved.docMap) {
    try {
      blocks.set(d.docId, (await loadDoc(d.docId)).blocks);
    } catch {
      // doc deleted since
    }
  }
  return segmentsToMarkdown(saved.segments, saved.docMap, blocks);
}

export function segmentsToMarkdown(segments: AiSegment[], docMap: DocMapEntry[], blocks: Map<string, Block[]>): string {
  let text = '';
  for (const seg of segments) {
    text += seg.text;
    const labels = [
      ...new Set(
        seg.citations
          .map((c) => resolveCitation(c, docMap, (id) => blocks.get(id))?.label)
          .filter((l): l is string => !!l),
      ),
    ];
    if (labels.length) text = text.replace(/\s*$/, (trail) => ` [${labels.join('; ')}]${trail}`);
  }
  return text.trim();
}

export async function exportMarkdown(docId: string): Promise<{ filename: string; markdown: string }> {
  const doc = await loadDoc(docId);
  const { meta, analysis } = doc;
  const notes = await getNotes(docId);
  const chat = await getChat(`doc:${docId}`);
  const a: Analysis = analysis;
  const lines: string[] = [];
  const size = meta.pages ? `${meta.pages} pages` : meta.slides ? `${meta.slides} slides` : '';
  lines.push(`# ${meta.title}`, '');
  lines.push(
    `_Source: ${meta.fileName} · ${kindLabel(meta.kind)}${size ? ` · ${size}` : ''} · ${a.stats.words.toLocaleString()} words · ${a.stats.readingMinutes} min read · Flesch ${a.stats.flesch} (${a.stats.fleschLabel})_`,
  );
  lines.push(`_Exported ${new Date().toISOString().slice(0, 10)} from AI Summary. Local summaries are extractive: every line is a sentence from the source._`, '');

  lines.push('## TL;DR', '', ...a.summary.tldr.map((i) => `> ${sentence(doc, i)}`), '');
  lines.push('## Summary', '', ...a.summary.detailed.map((i) => `- ${sentence(doc, i)}`), '');
  if (a.summary.sections.length > 1) {
    lines.push('## Section by section', '');
    for (const s of a.summary.sections) {
      lines.push(`### ${a.sections[s.section]?.title ?? 'Section'}`, '', ...s.sentences.map((i) => `- ${sentence(doc, i)}`), '');
    }
  }
  lines.push('## Key phrases', '', a.keyphrases.slice(0, 20).map((k) => `${k.phrase} (${k.count})`).join(' · '), '');
  if (a.entities.length) {
    lines.push('## Names, dates and figures', '');
    const groups: [string, string[]][] = [
      ['Dates', ['date']],
      ['Figures', ['money', 'percent']],
      ['Names', ['name']],
      ['Links', ['email', 'url']],
    ];
    for (const [label, types] of groups) {
      const items = a.entities.filter((e) => types.includes(e.type)).map((e) => e.text);
      if (items.length) lines.push(`- **${label}:** ${items.join(', ')}`);
    }
    lines.push('');
  }
  for (const [key, title] of [
    ['summary', 'Claude summary'],
    ['eli5', 'Explained simply (Claude)'],
    ['studyguide', 'Study guide (Claude)'],
  ] as const) {
    const saved = notes.ai[key];
    if (saved) lines.push(`## ${title}`, '', await aiToMarkdown(saved), '', `_${saved.model}, ${new Date(saved.createdAt).toLocaleString()}_`, '');
  }
  if (notes.text.trim()) lines.push('## Notes', '', notes.text.trim(), '');
  if (notes.highlights.length) {
    lines.push('## Highlights', '');
    for (const h of notes.highlights) {
      const b = doc.blocks.find((x) => x.id === h.blockId);
      const label = anchorLabel(b?.anchor, '');
      lines.push(`> ${h.text.trim()}${label ? ` — ${label}` : ''}`, '');
    }
  }
  const qa = chat.messages;
  if (qa.length) {
    lines.push('## Questions & answers', '');
    for (const m of qa) {
      if (m.role === 'user') lines.push(`**Q:** ${m.text}`, '');
      else if (m.local) {
        const conf = m.local.kind === 'not_found' ? 'not found' : `${m.local.confidence} confidence`;
        lines.push(`**A** _(local, ${conf})_:`);
        if (m.local.message) lines.push(m.local.message);
        for (const s of m.local.sentences) {
          const d = s.docId === docId ? doc : await loadDoc(s.docId).catch(() => null);
          if (d) lines.push(`- ${sentence(d, s.sentence)}`);
        }
        lines.push('');
      } else if (m.ai) {
        lines.push(`**A** _(Claude, ${m.ai.model})_:`, '', await aiToMarkdown(m.ai), '');
      } else if (m.error || m.refusal) {
        lines.push(`**A:** _(no answer — ${m.error ?? 'declined'})_`, '');
      }
    }
  }
  const filename = `${meta.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'document'}-summary.md`;
  return { filename, markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n') };
}

export function downloadText(filename: string, text: string, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
