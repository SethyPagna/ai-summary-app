// IndexedDB persistence with an in-memory fallback (e.g. sandboxed iframes or
// private modes where IndexedDB is unavailable). Everything stays on-device.

import type { Analysis, Block, DocKind } from '../engine/types';
import type { QaAnswer } from '../engine/qa';
import type { AiSegment } from '../ai/stream';
import type { DocMapEntry } from '../ai/request';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

export interface DocMeta {
  id: string;
  projectId: string;
  title: string;
  fileName: string;
  kind: DocKind;
  size: number;
  createdAt: number;
  updatedAt: number;
  pages?: number;
  slides?: number;
  words: number;
  readingMinutes: number;
  sample?: string;
  hasOriginal: boolean;
  /** Stemmed keys of the top keyphrases (library TF-IDF). */
  phraseKeys: string[];
  topPhrases: string[];
  tldr: string;
}

export interface DocBlocks {
  id: string;
  blocks: Block[];
}

export interface OriginalFile {
  id: string;
  mime: string;
  data: ArrayBuffer;
}

export interface SavedAi {
  segments: AiSegment[];
  docMap: DocMapEntry[];
  model: string;
  status: 'done' | 'max_tokens';
  fallback?: { from: string; to: string };
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  mode: 'local' | 'claude';
  text: string;
  createdAt: number;
  scope: string[];
  local?: QaAnswer;
  ai?: SavedAi;
  error?: string;
  refusal?: { category: string | null; explanation: string | null };
}

export interface ChatRecord {
  id: string; // `doc:<id>` or `project:<id>`
  messages: ChatMessage[];
}

export interface StudyRecord {
  id: string; // doc id
  boxes: Record<string, number>;
  quizBest?: number;
  quizLast?: number;
  quizTotal?: number;
}

export interface Highlight {
  id: string;
  blockId: string;
  start: number;
  end: number;
  text: string;
  createdAt: number;
}

export interface NotesRecord {
  id: string; // doc id
  text: string;
  highlights: Highlight[];
  ai: Partial<Record<'summary' | 'eli5' | 'studyguide', SavedAi>>;
}

export interface Stores {
  projects: Project;
  meta: DocMeta;
  blocks: DocBlocks;
  originals: OriginalFile;
  analyses: Analysis & { id: string };
  chats: ChatRecord;
  study: StudyRecord;
  notes: NotesRecord;
}

export type StoreName = keyof Stores;
const STORE_NAMES: StoreName[] = ['projects', 'meta', 'blocks', 'originals', 'analyses', 'chats', 'study', 'notes'];
const DB_NAME = 'ai-summary-v2';
const DB_VERSION = 1;

export interface Database {
  persistent: boolean;
  get<K extends StoreName>(store: K, id: string): Promise<Stores[K] | undefined>;
  put<K extends StoreName>(store: K, value: Stores[K]): Promise<void>;
  del(store: StoreName, id: string): Promise<void>;
  all<K extends StoreName>(store: K): Promise<Stores[K][]>;
  clearAll(): Promise<void>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class IdbDatabase implements Database {
  persistent = true;
  constructor(private db: IDBDatabase) {}
  private tx(store: StoreName, mode: IDBTransactionMode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  async get<K extends StoreName>(store: K, id: string) {
    return (await req(this.tx(store, 'readonly').get(id))) as Stores[K] | undefined;
  }
  async put<K extends StoreName>(store: K, value: Stores[K]) {
    await req(this.tx(store, 'readwrite').put(value));
  }
  async del(store: StoreName, id: string) {
    await req(this.tx(store, 'readwrite').delete(id));
  }
  async all<K extends StoreName>(store: K) {
    return (await req(this.tx(store, 'readonly').getAll())) as Stores[K][];
  }
  async clearAll() {
    const t = this.db.transaction(STORE_NAMES, 'readwrite');
    await Promise.all(STORE_NAMES.map((s) => req(t.objectStore(s).clear())));
  }
}

class MemoryDatabase implements Database {
  persistent = false;
  private data = new Map<StoreName, Map<string, unknown>>(STORE_NAMES.map((s) => [s, new Map()]));
  async get<K extends StoreName>(store: K, id: string) {
    return structuredClone(this.data.get(store)!.get(id)) as Stores[K] | undefined;
  }
  async put<K extends StoreName>(store: K, value: Stores[K]) {
    this.data.get(store)!.set((value as { id: string }).id, structuredClone(value));
  }
  async del(store: StoreName, id: string) {
    this.data.get(store)!.delete(id);
  }
  async all<K extends StoreName>(store: K) {
    return [...this.data.get(store)!.values()].map((v) => structuredClone(v)) as Stores[K][];
  }
  async clearAll() {
    for (const m of this.data.values()) m.clear();
  }
}

export async function openDatabase(): Promise<Database> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        for (const s of STORE_NAMES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('blocked'));
      setTimeout(() => reject(new Error('timeout')), 4000);
    });
    return new IdbDatabase(db);
  } catch {
    return new MemoryDatabase();
  }
}

export function uid(prefix = ''): string {
  const c = globalThis.crypto;
  const id = c && 'randomUUID' in c ? c.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return prefix + id;
}
