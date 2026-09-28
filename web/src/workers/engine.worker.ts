/// <reference lib="webworker" />
// The engine worker: heavy parsing (DOCX/PPTX/text) and the full local
// analysis run here so the UI thread stays responsive.

import { analyze } from '../engine/analyze';
import { docxToHtml, pptxToDoc, decodeText, textToDoc } from '../ingest/office';
import type { EngineRequest, EngineResponse } from '../ingest/engine-protocol';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const req = e.data;
  const reply = (msg: EngineResponse) => self.postMessage(msg);
  try {
    switch (req.type) {
      case 'analyze': {
        const result = analyze(req.docId, req.title, req.blocks);
        reply({ id: req.id, ok: true, result });
        break;
      }
      case 'docx': {
        reply({ id: req.id, ok: true, result: await docxToHtml(req.buffer) });
        break;
      }
      case 'pptx': {
        reply({ id: req.id, ok: true, result: await pptxToDoc(req.buffer, req.fileName) });
        break;
      }
      case 'text': {
        const text = decodeText(req.buffer);
        reply({ id: req.id, ok: true, result: textToDoc(text, req.fileName, req.kind) });
        break;
      }
    }
  } catch (err) {
    reply({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
