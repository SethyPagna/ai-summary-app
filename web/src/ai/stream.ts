// Runs a streaming Claude request and turns the event stream into renderable
// segments (text + citations). Handles, distinctly:
//  - stop_reason "refusal"  -> partial output is discarded, category surfaced
//  - stop_reason "max_tokens" -> text kept, marked as cut off
//  - server-side fallback blocks -> "declined by X, continued on Y" notice
//  - API errors: 401, 403, 404, 429 (+retry-after), 400/413, 5xx/529, network, abort

import type Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams, BetaTextCitation } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export interface AiCitation {
  docIndex: number;
  kind: 'char' | 'page' | 'block';
  /** char: [start,end) char offsets; page: [startPage, endPage) (1-based, end exclusive). */
  start: number;
  end: number;
  citedText: string;
  docTitle: string | null;
}

export interface AiSegment {
  text: string;
  citations: AiCitation[];
}

export interface AiMeta {
  thinking: boolean;
  fallback?: { from: string; to: string };
  model?: string;
}

export type AiOutcome =
  | {
      status: 'done' | 'max_tokens';
      segments: AiSegment[];
      model: string;
      fallback?: { from: string; to: string };
      usage?: { input: number; output: number; cacheRead: number };
    }
  | { status: 'refusal'; category: string | null; explanation: string | null; model: string };

export type AiErrorKind =
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'rate_limit'
  | 'bad_request'
  | 'too_large'
  | 'overloaded'
  | 'server'
  | 'network'
  | 'aborted'
  | 'unknown';

export interface AiError {
  kind: AiErrorKind;
  message: string;
  status?: number;
  retryAfter?: number;
}

export function toCitation(c: BetaTextCitation): AiCitation | null {
  switch (c.type) {
    case 'char_location':
      return { docIndex: c.document_index, kind: 'char', start: c.start_char_index, end: c.end_char_index, citedText: c.cited_text, docTitle: c.document_title };
    case 'page_location':
      return { docIndex: c.document_index, kind: 'page', start: c.start_page_number, end: c.end_page_number, citedText: c.cited_text, docTitle: c.document_title };
    case 'content_block_location':
      return { docIndex: c.document_index, kind: 'block', start: c.start_block_index, end: c.end_block_index, citedText: c.cited_text, docTitle: c.document_title };
    default:
      return null;
  }
}

type Sdk = typeof Anthropic;

export async function runClaudeStream(
  client: Anthropic,
  params: BetaMessageStreamParams,
  onUpdate: (segments: AiSegment[], meta: AiMeta) => void,
  signal?: AbortSignal,
): Promise<AiOutcome> {
  const stream = client.beta.messages.stream(params, { signal });
  const blocks = new Map<number, AiSegment>();
  const meta: AiMeta = { thinking: false };
  const emit = () => onUpdate([...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s), { ...meta });

  for await (const ev of stream) {
    switch (ev.type) {
      case 'message_start':
        meta.model = ev.message.model;
        emit();
        break;
      case 'content_block_start': {
        const b = ev.content_block;
        if (b.type === 'text') {
          blocks.set(ev.index, { text: b.text ?? '', citations: [] });
          meta.thinking = false;
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          meta.thinking = true;
        } else if (b.type === 'fallback') {
          meta.fallback = { from: b.from.model, to: b.to.model };
        }
        emit();
        break;
      }
      case 'content_block_delta': {
        const seg = blocks.get(ev.index);
        if (ev.delta.type === 'text_delta' && seg) {
          seg.text += ev.delta.text;
          emit();
        } else if (ev.delta.type === 'citations_delta' && seg) {
          const c = toCitation(ev.delta.citation);
          if (c) seg.citations.push(c);
          emit();
        }
        break;
      }
      case 'content_block_stop':
        if (meta.thinking) {
          meta.thinking = false;
          emit();
        }
        break;
      default:
        break;
    }
  }

  const final = await stream.finalMessage();
  // Branch on stop_reason before reading content: a refusal may carry partial
  // text (mid-stream) or none at all (before output). Either way, discard it.
  if (final.stop_reason === 'refusal') {
    const details = final.stop_details as { category?: string | null; explanation?: string | null } | null | undefined;
    return { status: 'refusal', category: details?.category ?? null, explanation: details?.explanation ?? null, model: final.model };
  }

  const segments: AiSegment[] = [];
  let fallback = meta.fallback;
  for (const block of final.content) {
    if (block.type === 'text') {
      segments.push({ text: block.text, citations: (block.citations ?? []).map(toCitation).filter((c): c is AiCitation => !!c) });
    } else if (block.type === 'fallback') {
      fallback = { from: block.from.model, to: block.to.model };
    }
  }
  const usage = final.usage;
  return {
    status: final.stop_reason === 'max_tokens' ? 'max_tokens' : 'done',
    segments,
    model: final.model,
    fallback,
    usage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0 } : undefined,
  };
}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  const raw = headers?.get?.('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(1, Math.ceil(secs));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

/** Map SDK errors to user-facing categories, most specific class first. */
export function classifyError(err: unknown, sdk: Sdk): AiError {
  if (err instanceof sdk.APIUserAbortError) return { kind: 'aborted', message: 'Stopped.' };
  if (err instanceof sdk.AuthenticationError)
    return { kind: 'auth', status: 401, message: 'Anthropic rejected this API key (401). Check the key in Settings — it should start with “sk-ant-”.' };
  if (err instanceof sdk.PermissionDeniedError)
    return { kind: 'permission', status: 403, message: 'This key isn’t allowed to use that model or feature (403). Try another model in Settings.' };
  if (err instanceof sdk.NotFoundError) return { kind: 'not_found', status: 404, message: 'That model isn’t available to this key (404). Pick another model in Settings.' };
  if (err instanceof sdk.RateLimitError) {
    const retryAfter = parseRetryAfter(err.headers as Headers | undefined);
    return {
      kind: 'rate_limit',
      status: 429,
      retryAfter,
      message: `Rate limited by the API (429).${retryAfter ? ` You can retry in ${retryAfter}s.` : ' Wait a moment and retry.'}`,
    };
  }
  if (err instanceof sdk.BadRequestError) {
    const msg = err.message.replace(/^\d+\s*/, '');
    const tooLarge = /too (long|large)|exceed|maximum/i.test(msg);
    return { kind: tooLarge ? 'too_large' : 'bad_request', status: 400, message: tooLarge ? `The documents are too large for this request (400). Try one document at a time.` : `The API rejected the request (400): ${truncate(msg, 180)}` };
  }
  // APIConnectionError is a subclass of APIError in the TS SDK: check it first.
  if (err instanceof sdk.APIConnectionError)
    return { kind: 'network', message: 'Couldn’t reach api.anthropic.com. Check your connection (or an ad/privacy blocker) and retry.' };
  if (err instanceof sdk.APIError) {
    const status = err.status;
    if (status === 413) return { kind: 'too_large', status, message: 'The request is too large (413). Try one document at a time.' };
    if (status === 529) return { kind: 'overloaded', status, message: 'Claude is overloaded right now (529). Retry shortly, or switch to a smaller model.' };
    if (status && status >= 500) return { kind: 'server', status, message: `Anthropic API error (${status}). Please retry.` };
    return { kind: 'unknown', status, message: `API error${status ? ` (${status})` : ''}: ${truncate(err.message, 180)}` };
  }
  if (err instanceof TypeError) return { kind: 'network', message: 'Couldn’t reach api.anthropic.com. Check your connection and retry.' };
  return { kind: 'unknown', message: err instanceof Error ? err.message : 'Something went wrong.' };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
