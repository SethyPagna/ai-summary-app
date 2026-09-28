// Claude integration for the UI: a hook that runs a streaming request with
// the user's key, and components to render streamed output with citation
// chips, errors, refusals and the no-key explainer.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '../engine/types';
import { buildRequest, PDF_LIMITS, toBase64, type AiSourceDoc, type AiTask, type DocMapEntry } from '../ai/request';
import { classifyError, runClaudeStream, type AiError, type AiMeta, type AiSegment } from '../ai/stream';
import { resolveCitation, type CitationTarget } from '../ai/citations';
import { createClient } from '../ai/client';
import { modelInfo } from '../ai/models';
import { app, getOriginal, loadDoc, setDialog, useApp } from '../store/app';
import type { SavedAi } from '../store/db';
import { CITE_MARK, CiteChip, Icon, Markdown, Spinner } from './common';

export type AiRunState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'streaming'; segments: AiSegment[]; meta: AiMeta; docMap: DocMapEntry[] }
  | { status: 'done'; saved: SavedAi }
  | { status: 'refusal'; category: string | null; explanation: string | null; model: string }
  | { status: 'error'; error: AiError };

async function sourcesFor(docIds: string[]): Promise<AiSourceDoc[]> {
  const { sendPdf } = app.get();
  const out: AiSourceDoc[] = [];
  for (const id of docIds) {
    const d = await loadDoc(id);
    let pdfBase64: string | undefined;
    const m = d.meta;
    if (m.kind === 'pdf' && sendPdf && m.hasOriginal && m.size <= PDF_LIMITS.maxBytes && (m.pages ?? 0) <= PDF_LIMITS.maxPages) {
      const bytes = await getOriginal(id);
      if (bytes) pdfBase64 = toBase64(bytes);
    }
    out.push({ docId: id, title: m.title, kind: m.kind, fileName: m.fileName, blocks: d.blocks, pdfBase64 });
  }
  return out;
}

export function useClaude() {
  const [state, setState] = useState<AiRunState>({ status: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  async function run(task: AiTask, docIds: string[]): Promise<AiRunState> {
    ctrl.current?.abort();
    const controller = new AbortController();
    ctrl.current = controller;
    setState({ status: 'preparing' });
    let sdkRef: Awaited<ReturnType<typeof createClient>>['sdk'] | null = null;
    try {
      const [{ client, sdk }, docs] = await Promise.all([createClient(), sourcesFor(docIds)]);
      sdkRef = sdk;
      const { params, docMap } = buildRequest(app.get().model, task, docs);
      let frame = 0;
      let latest: { segments: AiSegment[]; meta: AiMeta } | null = null;
      const outcome = await runClaudeStream(
        client,
        params,
        (segments, meta) => {
          latest = { segments, meta };
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              if (latest && !controller.signal.aborted) setState({ status: 'streaming', segments: latest.segments, meta: latest.meta, docMap });
            });
        },
        controller.signal,
      );
      cancelAnimationFrame(frame);
      let next: AiRunState;
      if (outcome.status === 'refusal') next = { status: 'refusal', category: outcome.category, explanation: outcome.explanation, model: outcome.model };
      else
        next = {
          status: 'done',
          saved: { segments: outcome.segments, docMap, model: outcome.model, status: outcome.status, fallback: outcome.fallback, createdAt: Date.now() },
        };
      setState(next);
      return next;
    } catch (err) {
      let error: AiError;
      if (sdkRef) error = classifyError(err, sdkRef);
      else error = { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
      const next: AiRunState = error.kind === 'aborted' ? { status: 'idle' } : { status: 'error', error };
      setState(next);
      return next;
    }
  }

  return { state, run, stop: () => ctrl.current?.abort(), setState };
}

/** Load blocks for every document referenced by an AI answer. */
export function useBlocks(docIds: string[]): Map<string, Block[]> {
  const key = docIds.join('|');
  const [map, setMap] = useState<Map<string, Block[]>>(new Map());
  useEffect(() => {
    let alive = true;
    Promise.all(docIds.map((id) => loadDoc(id).then((d) => [id, d.blocks] as const).catch(() => null))).then((pairs) => {
      if (alive) setMap(new Map(pairs.filter((p): p is readonly [string, Block[]] => !!p)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

/** Render segments as Markdown with numbered citation chips. */
export function AiText({ segments, docMap, streaming }: { segments: AiSegment[]; docMap: DocMapEntry[]; streaming?: boolean }) {
  const blocks = useBlocks(docMap.map((d) => d.docId));
  const multiDoc = docMap.length > 1;
  const { text, targets } = useMemo(() => {
    const targets: (CitationTarget | null)[] = [];
    const seen = new Map<string, number>();
    let text = '';
    for (const seg of segments) {
      text += seg.text;
      const marks: number[] = [];
      for (const c of seg.citations) {
        const t = resolveCitation(c, docMap, (id) => blocks.get(id));
        if (!t) continue;
        if (multiDoc) t.label = `${shortTitle(docMap[c.docIndex]?.title ?? '')} · ${t.label}`;
        const key = `${t.docId}:${t.ranges.map((r) => `${r.blockId}.${r.start}`).join(',')}`;
        let idx = seen.get(key);
        if (idx === undefined) {
          idx = targets.length;
          targets.push(t);
          seen.set(key, idx);
        }
        if (!marks.includes(idx)) marks.push(idx);
      }
      if (marks.length) {
        // Keep chips on the same line as the cited text (before any trailing newline).
        const trail = text.match(/\s*$/)?.[0] ?? '';
        text = text.slice(0, text.length - trail.length) + marks.map((m) => `${CITE_MARK}${m}${CITE_MARK}`).join('') + trail;
      }
    }
    return { text, targets };
  }, [segments, docMap, blocks, multiDoc]);
  return (
    <div className={`ai-text${streaming ? ' is-streaming' : ''}`}>
      <Markdown text={text} chips={(i) => <CiteChip target={targets[i] ?? null} index={i + 1} />} />
    </div>
  );
}

function shortTitle(t: string): string {
  return t.length > 18 ? t.slice(0, 17).trimEnd() + '…' : t;
}

export function NeedKey({ feature }: { feature: string }) {
  return (
    <div className="needkey" role="note">
      <Icon name="lock" size={16} />
      <div>
        <p>
          <strong>{feature} uses Claude — optional.</strong> Everything else on this page runs locally without a key. To enable it, add your own Anthropic
          API key; it stays in this tab’s memory unless you choose to remember it.
        </p>
        <button type="button" className="btn btn-small" onClick={() => setDialog('settings')}>
          Add a Claude API key
        </button>
      </div>
    </div>
  );
}

function RetryButton({ seconds, onRetry }: { seconds?: number; onRetry: () => void }) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!left) return;
    const t = setTimeout(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <button type="button" className="btn btn-small" disabled={left > 0} onClick={onRetry}>
      <Icon name="retry" size={14} />
      {left > 0 ? `Retry in ${left}s` : 'Retry'}
    </button>
  );
}

export function AiStatus({ state, onRetry }: { state: AiRunState; onRetry: () => void }) {
  const model = useApp((s) => s.model);
  if (state.status === 'preparing') return <Spinner label={`Sending to ${modelInfo(model).label}…`} />;
  if (state.status === 'streaming' && state.meta.thinking && !state.segments.some((s) => s.text)) return <Spinner label="Claude is thinking…" />;
  if (state.status === 'error') {
    const e = state.error;
    return (
      <div className="ai-error" role="alert">
        <p>{e.message}</p>
        <div className="row">
          {(e.kind === 'auth' || e.kind === 'permission' || e.kind === 'not_found') && (
            <button type="button" className="btn btn-small" onClick={() => setDialog('settings')}>
              Open settings
            </button>
          )}
          {(e.kind === 'rate_limit' || e.kind === 'network' || e.kind === 'server' || e.kind === 'overloaded' || e.kind === 'unknown') && (
            <RetryButton seconds={e.retryAfter} onRetry={onRetry} />
          )}
        </div>
      </div>
    );
  }
  if (state.status === 'refusal') {
    return (
      <div className="ai-error" role="alert">
        <p>
          Claude declined this request{state.category ? ` (policy category: ${state.category})` : ''}. Any partial response was discarded.
          {state.explanation ? ` ${state.explanation}` : ''}
        </p>
        <div className="row">
          <RetryButton onRetry={onRetry} />
        </div>
      </div>
    );
  }
  return null;
}

export function AiFootnote({ saved }: { saved: SavedAi }) {
  return (
    <p className="ai-foot">
      {modelInfo(saved.model).id === saved.model ? modelInfo(saved.model).label : saved.model}
      {saved.fallback && (
        <>
          {' '}
          · <span title="Server-side refusal fallback">{saved.fallback.from} declined; {saved.fallback.to} continued</span>
        </>
      )}
      {saved.status === 'max_tokens' && <> · stopped at the length limit — the answer may be cut off</>}
      {' '}· generated {new Date(saved.createdAt).toLocaleString()}
    </p>
  );
}
