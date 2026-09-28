// Builds Claude Messages API requests for the app's AI features. Pure: no SDK
// runtime import, so it is cheap to test and to keep out of the initial bundle.
//
// - Documents go in as `document` blocks with citations enabled: extracted text
//   as a plain-text source (char_location citations), original PDFs as base64
//   (page_location citations).
// - claude-opus-5 opts into server-side refusal fallbacks (`fallbacks:
//   "default"`, beta `server-side-fallback-2026-07-01`).
// - Opus 5 / Sonnet 5 use adaptive thinking with an effort level; max_tokens
//   leaves room for thinking + answer.

import type { BetaContentBlockParam, BetaMessageParam, BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Block, DocKind } from '../engine/types';
import { FALLBACK_BETA, modelInfo, type ModelId } from './models';

export type AiTaskKind = 'summary' | 'eli5' | 'studyguide' | 'chat';

export interface AiSourceDoc {
  docId: string;
  title: string;
  kind: DocKind;
  fileName?: string;
  blocks: Block[];
  /** Base64 of the original PDF; when present it is sent instead of the text. */
  pdfBase64?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AiTask {
  kind: AiTaskKind;
  /** chat: the new question. eli5: optional passage to focus on. */
  prompt?: string;
  history?: ChatTurn[];
}

export interface BlockOffset {
  blockId: string;
  start: number;
  end: number;
}

export interface DocMapEntry {
  docId: string;
  title: string;
  mode: 'text' | 'pdf';
  offsets: BlockOffset[];
}

export interface BuiltRequest {
  params: BetaMessageStreamParams;
  docMap: DocMapEntry[];
}

export const MAX_TOKENS = 16000;
/** Keep plain-text documents to a sane size for a browser demo (~100k tokens). */
export const MAX_DOC_CHARS = 400_000;

/**
 * Serialise blocks as readable text and remember where each block's text
 * starts, so char_location citations can be mapped back to exact passages.
 */
export function buildDocumentText(blocks: Block[]): { text: string; offsets: BlockOffset[]; truncated: boolean } {
  let text = '';
  const offsets: BlockOffset[] = [];
  let lastPage: number | undefined;
  let lastSlide: number | undefined;
  let truncated = false;
  for (const b of blocks) {
    let prefix = '';
    if (b.anchor.page && b.anchor.page !== lastPage) {
      prefix += `[Page ${b.anchor.page}]\n\n`;
      lastPage = b.anchor.page;
    }
    if (b.anchor.slide && b.anchor.slide !== lastSlide) {
      prefix += `[Slide ${b.anchor.slide}]\n\n`;
      lastSlide = b.anchor.slide;
    }
    if (b.kind === 'heading') prefix += '#'.repeat(Math.min(6, b.level ?? 2)) + ' ';
    else if (b.kind === 'li') prefix += '  '.repeat(b.level ?? 0) + '- ';
    else if (b.kind === 'quote') prefix += '> ';
    else if (b.kind === 'note') prefix += 'Speaker notes: ';
    const sep = text ? '\n\n' : '';
    if (text.length + sep.length + prefix.length + b.text.length > MAX_DOC_CHARS) {
      truncated = true;
      break;
    }
    text += sep + prefix;
    offsets.push({ blockId: b.id, start: text.length, end: text.length + b.text.length });
    text += b.text;
  }
  return { text, offsets, truncated };
}

const SYSTEM = [
  'You are the reading assistant inside “AI Summary”, a document-intelligence app.',
  'Answer only from the documents in the conversation. When a statement comes from a document, cite it: the app turns each citation into a link to the exact passage.',
  'If the documents do not contain the answer, say so plainly instead of guessing.',
  'Keep responses focused, brief, and concise to avoid overwhelming the person. Disclaimers and caveats are brief, with most of the response on the main answer.',
  'Format with light Markdown only: short paragraphs, "- " bullets, **bold** for key terms, and "## " headings only when a response has several parts.',
].join(' ');

const TASK_PROMPTS: Record<Exclude<AiTaskKind, 'chat'>, string> = {
  summary:
    'Write an abstractive summary for a busy reader. Start with a one-sentence gist in bold, then 3–6 bullet points covering the main ideas, findings, decisions and any numbers that matter. If there are several documents, say how they relate.',
  eli5:
    'Explain this to someone who is new to the topic. Use plain words, one short analogy if it genuinely helps, and define any jargon in a line each. Aim for about 200 words.',
  studyguide:
    'Create a study guide with three parts: "## Key ideas" (bullets), "## Terms to know" (term — one-line definition) and "## Check yourself" (5 questions, each followed by a short answer). Match the length to the material; do not pad.',
};

export function effortFor(kind: AiTaskKind): 'low' | 'medium' | 'high' {
  if (kind === 'eli5') return 'low';
  return 'medium';
}

export function buildRequest(model: ModelId, task: AiTask, docs: AiSourceDoc[]): BuiltRequest {
  if (!docs.length) throw new Error('No documents selected.');
  const info = modelInfo(model);
  const docMap: DocMapEntry[] = [];

  const docBlocks: BetaContentBlockParam[] = [];
  docs.forEach((d, i) => {
    const context = `${d.fileName ?? d.title} (${d.kind.toUpperCase()})`;
    const last = i === docs.length - 1;
    // Cache the document prefix so follow-up questions re-read it cheaply.
    const cache = last ? { cache_control: { type: 'ephemeral' as const } } : {};
    if (d.pdfBase64) {
      docBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: d.pdfBase64 },
        title: d.title,
        context,
        citations: { enabled: true },
        ...cache,
      });
      docMap.push({ docId: d.docId, title: d.title, mode: 'pdf', offsets: [] });
    } else {
      const { text, offsets } = buildDocumentText(d.blocks);
      docBlocks.push({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: text },
        title: d.title,
        context,
        citations: { enabled: true },
        ...cache,
      });
      docMap.push({ docId: d.docId, title: d.title, mode: 'text', offsets });
    }
  });

  let system = SYSTEM;
  const messages: BetaMessageParam[] = [];
  if (task.kind === 'chat') {
    // Chat is user-facing and latency-sensitive.
    system += ' Latency-sensitive; begin your visible answer immediately.';
    const history = task.history ?? [];
    const question = (task.prompt ?? '').trim();
    if (!question) throw new Error('Ask a question first.');
    // The API needs the conversation to open with a user turn.
    const firstUserIdx = history.findIndex((t) => t.role === 'user');
    const turns: ChatTurn[] = [...(firstUserIdx >= 0 ? history.slice(firstUserIdx) : []), { role: 'user', text: question }];
    // Documents ride along with the first user turn; later turns are plain text.
    turns.forEach((t, idx) => {
      if (idx === 0 && t.role === 'user') {
        messages.push({ role: 'user', content: [...docBlocks, { type: 'text', text: t.text }] });
      } else {
        messages.push({ role: t.role, content: t.text });
      }
    });
  } else {
    let text = TASK_PROMPTS[task.kind];
    if (task.kind === 'eli5' && task.prompt?.trim()) text += `\n\nFocus on this passage:\n«${task.prompt.trim()}»`;
    messages.push({ role: 'user', content: [...docBlocks, { type: 'text', text }] });
  }

  const params: BetaMessageStreamParams = {
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages,
  };
  if (info.adaptive) {
    params.thinking = { type: 'adaptive' };
    params.output_config = { effort: effortFor(task.kind) };
  }
  if (info.fallbacks) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return { params, docMap };
}

/** Base64-encode bytes in chunks (fast and safe for multi-MB PDFs). */
export function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Send the original PDF only when it is reasonably small. */
export const PDF_LIMITS = { maxBytes: 12 * 1024 * 1024, maxPages: 100 };
