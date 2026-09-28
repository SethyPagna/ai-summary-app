// Promise-based RPC to the engine worker, with a transparent main-thread
// fallback when workers are unavailable (e.g. very locked-down iframes).

import type { Analysis, Block, ParsedDoc } from '../engine/types';
import type { EngineCall, EngineRequest, EngineResponse } from './engine-protocol';
import { decodeText, docxToHtml, pptxToDoc, textToDoc } from './office';

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module', name: 'engine' });
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      // A load failure: fail pending calls; they will be retried on the main thread.
      e.preventDefault?.();
      workerBroken = true;
      worker = null;
      for (const [, p] of pending) p.reject(new WorkerUnavailable());
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

class WorkerUnavailable extends Error {
  constructor() {
    super('worker unavailable');
  }
}

async function runOnMain(call: EngineCall): Promise<unknown> {
  switch (call.type) {
    case 'analyze': {
      const { analyze } = await import('../engine/analyze');
      return analyze(call.docId, call.title, call.blocks);
    }
    case 'docx':
      return docxToHtml(call.buffer);
    case 'pptx':
      return pptxToDoc(call.buffer, call.fileName);
    case 'text':
      return textToDoc(decodeText(call.buffer), call.fileName, call.kind);
  }
}

async function call<T>(msg: EngineCall, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker();
  if (!w) return (await runOnMain(msg)) as T;
  const id = ++seq;
  try {
    return (await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Copy buffers we may need again on fallback; transfer only large ones.
      w.postMessage({ ...msg, id } as EngineRequest, transfer);
    })) as T;
  } catch (err) {
    if (err instanceof WorkerUnavailable) return (await runOnMain(msg)) as T;
    throw err;
  }
}

export function analyzeInWorker(docId: string, title: string, blocks: Block[]): Promise<Analysis> {
  return call<Analysis>({ type: 'analyze', docId, title, blocks });
}

export function docxInWorker(buffer: ArrayBuffer): Promise<{ html: string; warnings: string[] }> {
  return call({ type: 'docx', buffer: buffer.slice(0) });
}

export function pptxInWorker(buffer: ArrayBuffer, fileName: string): Promise<ParsedDoc> {
  return call({ type: 'pptx', buffer: buffer.slice(0), fileName });
}

export function textInWorker(buffer: ArrayBuffer, fileName: string, kind: 'txt' | 'md'): Promise<ParsedDoc> {
  return call({ type: 'text', buffer: buffer.slice(0), fileName, kind });
}
