import type { Block } from '../engine/types';

export type EngineRequest =
  | { id: number; type: 'analyze'; docId: string; title: string; blocks: Block[] }
  | { id: number; type: 'docx'; buffer: ArrayBuffer }
  | { id: number; type: 'pptx'; buffer: ArrayBuffer; fileName: string }
  | { id: number; type: 'text'; buffer: ArrayBuffer; fileName: string; kind: 'txt' | 'md' };

export type EngineResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

// Distributive Omit so each union member keeps its own fields.
export type EngineCall = EngineRequest extends infer R ? (R extends EngineRequest ? Omit<R, 'id'> : never) : never;
