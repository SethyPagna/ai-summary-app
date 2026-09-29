import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { buildDocumentText, buildRequest, type AiSourceDoc } from '../src/ai/request';
import { classifyError, runClaudeStream } from '../src/ai/stream';
import { resolveCitation } from '../src/ai/citations';
import { FALLBACK_BETA } from '../src/ai/models';
import { loadMarkdownSample } from './helpers';

const md = loadMarkdownSample();
const doc: AiSourceDoc = { docId: 'd1', title: md.title, kind: 'md', fileName: 'tonle-sap.md', blocks: md.blocks };

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function sse(events: object[]): string {
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

function mockClient(respond: (c: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    calls.push(c);
    return respond(c);
  };
  const client = new Anthropic({ apiKey: 'sk-ant-test', dangerouslyAllowBrowser: true, maxRetries: 0, fetch: fetchImpl as typeof fetch });
  return { client, calls };
}

const start = (model = 'claude-opus-5') => ({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
const stop = (stop_reason: string, extra: object = {}) => [
  { type: 'message_delta', delta: { stop_reason, stop_sequence: null, ...extra }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
];
const streamResponse = (events: object[]) => new Response(sse(events), { status: 200, headers: { 'content-type': 'text/event-stream' } });

describe('document serialisation', () => {
  it('records exact block offsets', () => {
    const { text, offsets } = buildDocumentText(md.blocks);
    expect(offsets).toHaveLength(md.blocks.length);
    for (const o of offsets) expect(text.slice(o.start, o.end)).toBe(md.blocks.find((b) => b.id === o.blockId)!.text);
    expect(text).toContain('## Bon Om Touk');
  });
});

describe('buildRequest', () => {
  it('Opus 5: adaptive thinking, effort, server-side fallbacks, cited documents with caching', () => {
    const { params, docMap } = buildRequest('claude-opus-5', { kind: 'summary' }, [doc]);
    expect(params.model).toBe('claude-opus-5');
    expect(params.max_tokens).toBe(16000);
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.betas).toEqual([FALLBACK_BETA]);
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
    expect(params.fallbacks).toBe('default');
    const content = params.messages[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'text', media_type: 'text/plain' }, title: md.title, citations: { enabled: true }, cache_control: { type: 'ephemeral' } });
    expect(content[1]).toMatchObject({ type: 'text' });
    expect(String(params.system)).toMatch(/cite/i);
    expect(docMap[0]).toMatchObject({ docId: 'd1', mode: 'text' });
  });

  it('sends PDFs as base64 documents when the original is available', () => {
    const { params, docMap } = buildRequest('claude-sonnet-5', { kind: 'summary' }, [{ ...doc, kind: 'pdf', pdfBase64: 'JVBERi0x' }]);
    const content = params.messages[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' }, citations: { enabled: true } });
    expect(docMap[0]!.mode).toBe('pdf');
    // Sonnet 5: adaptive thinking but no fallbacks beta.
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.betas).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
  });

  it('Haiku 4.5: no thinking, effort or betas', () => {
    const { params } = buildRequest('claude-haiku-4-5', { kind: 'eli5', prompt: 'the flood pulse' }, [doc]);
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toBeUndefined();
    expect(params.betas).toBeUndefined();
    const content = params.messages[0]!.content as Array<{ type: string; text?: string }>;
    expect(content.at(-1)!.text).toContain('«the flood pulse»');
  });

  it('chat: documents ride with the first user turn, history alternates, latency hint set', () => {
    const { params } = buildRequest(
      'claude-opus-5',
      {
        kind: 'chat',
        prompt: 'And why?',
        history: [
          { role: 'assistant', text: 'orphan reply that must be dropped' },
          { role: 'user', text: 'When does it reverse?' },
          { role: 'assistant', text: 'Around June.' },
        ],
      },
      [doc],
    );
    expect(params.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const first = params.messages[0]!.content as Array<{ type: string; text?: string }>;
    expect(first[0]!.type).toBe('document');
    expect(first.at(-1)!.text).toBe('When does it reverse?');
    expect(params.messages[2]!.content).toBe('And why?');
    expect(String(params.system)).toMatch(/Latency-sensitive/);
    expect(() => buildRequest('claude-opus-5', { kind: 'chat', prompt: '  ' }, [doc])).toThrow();
  });
});

describe('streaming with a mocked API', () => {
  it('streams text with citations and maps them to exact passages', async () => {
    const { params, docMap } = buildRequest('claude-opus-5', { kind: 'chat', prompt: 'When is the festival?' }, [doc]);
    const docText = (params.messages[0]!.content as Array<{ type: string; source?: { data: string } }>)[0]!.source!.data;
    const quote = 'Cambodians celebrate the reversal of the river with Bon Om Touk, the Water Festival, held over several days around the full moon in November.';
    const at = docText.indexOf(quote);
    expect(at).toBeGreaterThan(0);
    const { client, calls } = mockClient(() =>
      streamResponse([
        start(),
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'In November, ' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '', citations: [] } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'around the full moon.' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: { type: 'char_location', cited_text: quote, document_index: 0, document_title: md.title, start_char_index: at, end_char_index: at + quote.length, file_id: null } } },
        { type: 'content_block_stop', index: 2 },
        ...stop('end_turn'),
      ]),
    );
    const updates: number[] = [];
    let sawThinking = false;
    const out = await runClaudeStream(client, params, (segs, meta) => {
      updates.push(segs.length);
      sawThinking ||= meta.thinking;
    });
    // Request shape on the wire.
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(calls[0]!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(calls[0]!.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(calls[0]!.body).toMatchObject({ model: 'claude-opus-5', stream: true, fallbacks: 'default' });
    // Stream result.
    expect(sawThinking).toBe(true);
    expect(updates.length).toBeGreaterThan(3);
    expect(out.status).toBe('done');
    if (out.status !== 'done') return;
    expect(out.segments.map((s) => s.text).join('')).toBe('In November, around the full moon.');
    const cite = out.segments[1]!.citations[0]!;
    const target = resolveCitation(cite, docMap, () => md.blocks)!;
    expect(target.label).toBe('§ Bon Om Touk');
    const block = md.blocks.find((b) => b.id === target.ranges[0]!.blockId)!;
    expect(block.text.slice(target.ranges[0]!.start, target.ranges[0]!.end)).toBe(quote);
  });

  it('maps PDF page citations by locating the cited text on that page', () => {
    const blocks = [
      { id: 'b0', kind: 'paragraph' as const, text: 'Intro text on the first page.', anchor: { page: 1 } },
      { id: 'b1', kind: 'paragraph' as const, text: 'Results: the spaced group scored 78% on the final exam.', anchor: { page: 2 } },
    ];
    const t = resolveCitation({ docIndex: 0, kind: 'page', start: 2, end: 3, citedText: 'the spaced group scored 78%  on the final exam', docTitle: null }, [{ docId: 'p', title: 'P', mode: 'pdf', offsets: [] }], () => blocks)!;
    expect(t.label).toBe('p. 2');
    expect(blocks[1]!.text.slice(t.ranges[0]!.start, t.ranges[0]!.end)).toBe('the spaced group scored 78% on the final exam');
  });

  it('discards partial output on a refusal and surfaces the category', async () => {
    const { params } = buildRequest('claude-opus-5', { kind: 'summary' }, [doc]);
    const { client } = mockClient(() =>
      streamResponse([
        start(),
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial…' } },
        { type: 'content_block_stop', index: 0 },
        ...stop('refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined' } }),
      ]),
    );
    const out = await runClaudeStream(client, params, () => {});
    expect(out).toEqual({ status: 'refusal', category: 'cyber', explanation: 'declined', model: 'claude-opus-5' });
  });

  it('reports server-side fallbacks and max_tokens truncation', async () => {
    const { params } = buildRequest('claude-opus-5', { kind: 'summary' }, [doc]);
    const { client } = mockClient(() =>
      streamResponse([
        start('claude-opus-4-8'),
        { type: 'content_block_start', index: 0, content_block: { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal', category: 'cyber' } } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'A long answer that was cut' } },
        { type: 'content_block_stop', index: 1 },
        ...stop('max_tokens'),
      ]),
    );
    const out = await runClaudeStream(client, params, () => {});
    expect(out.status).toBe('max_tokens');
    if (out.status === 'refusal') return;
    expect(out.fallback).toEqual({ from: 'claude-opus-5', to: 'claude-opus-4-8' });
    expect(out.model).toBe('claude-opus-4-8');
  });
});

describe('error classification', () => {
  const run = async (respond: () => Response | Promise<Response>) => {
    const { params } = buildRequest('claude-opus-5', { kind: 'summary' }, [doc]);
    const { client } = mockClient(respond);
    try {
      await runClaudeStream(client, params, () => {});
      throw new Error('expected failure');
    } catch (e) {
      return classifyError(e, Anthropic);
    }
  };
  const json = (status: number, type: string, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ type: 'error', error: { type, message: type } }), { status, headers: { 'content-type': 'application/json', ...headers } });

  it('401 -> bad key', async () => {
    expect((await run(() => json(401, 'authentication_error'))).kind).toBe('auth');
  });
  it('429 -> rate limit with retry-after', async () => {
    const e = await run(() => json(429, 'rate_limit_error', { 'retry-after': '7' }));
    expect(e).toMatchObject({ kind: 'rate_limit', status: 429, retryAfter: 7 });
  });
  it('529 -> overloaded, 500 -> server', async () => {
    expect((await run(() => json(529, 'overloaded_error'))).kind).toBe('overloaded');
    expect((await run(() => json(500, 'api_error'))).kind).toBe('server');
  });
  it('404 -> model not available, 400 -> bad request', async () => {
    expect((await run(() => json(404, 'not_found_error'))).kind).toBe('not_found');
    expect((await run(() => json(400, 'invalid_request_error'))).kind).toBe('bad_request');
  });
  it('network failure -> network', async () => {
    const e = await run(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(e.kind).toBe('network');
  });
});
