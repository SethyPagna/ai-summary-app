// Application state and actions. UI components read state via useApp() and
// call these actions; all persistence goes through the Database interface.

import { useEffect, useState } from 'react';
import { ANALYSIS_VERSION, type Analysis, type Block, type ParsedDoc } from '../engine/types';
import { analyzeInWorker } from '../ingest/engine-client';
import { ACCEPT, MAX_BYTES, detectKind, parseBuffer, parsePasted, unsupportedReason } from '../ingest/ingest';
import { initKey, setKey as storeKey } from '../ai/client';
import { DEFAULT_MODEL, type ModelId } from '../ai/models';
import type { HighlightRange } from '../ai/citations';
import { sampleById, SAMPLES } from '../samples/manifest';
import { createStore, parseHash, routeHash, useSelector, type Route } from './store';
import { openDatabase, uid, type ChatRecord, type Database, type DocMeta, type NotesRecord, type Project, type StudyRecord } from './db';

export type UploadStage = 'queued' | 'reading' | 'extracting' | 'analysing' | 'saving' | 'done' | 'error';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  stage: UploadStage;
  progress: number;
  detail?: string;
  error?: string;
  docId?: string;
}

export interface Focus {
  docId: string;
  ranges: HighlightRange[];
  label: string;
  quote?: string;
  nonce: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

export type Dialog = null | 'settings' | 'shortcuts' | 'search' | 'paste' | 'delete-all';

export interface AppState {
  ready: boolean;
  persistent: boolean;
  projects: Project[];
  docs: DocMeta[];
  route: Route;
  uploads: UploadItem[];
  theme: 'light' | 'dark';
  keySet: boolean;
  keyRemembered: boolean;
  model: ModelId;
  sendPdf: boolean;
  dialog: Dialog;
  toast: Toast | null;
  focus: Focus | null;
  keyphrase: string | null;
  readerScale: number;
  drawer: boolean;
  readerOpen: boolean;
  dataVersion: number;
  activeProject: string;
  /** Desktop focus mode: the source column is collapsed. */
  sourceHidden: boolean;
  /** Doc freshly opened via "Try a sample": pre-highlight its suggested answer. */
  autoCite: string | null;
  /** A question handed to the Ask tab from elsewhere (reader selection, suggestions). */
  pendingAsk: { text: string; mode: 'local' | 'claude'; docId: string; send?: boolean } | null;
}

export const INBOX = 'inbox';
export const SAMPLES_PROJECT = 'samples';

function initialTheme(): 'light' | 'dark' {
  try {
    const t = localStorage.getItem('ais2.theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // ignore
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const app = createStore<AppState>({
  ready: false,
  persistent: true,
  projects: [],
  docs: [],
  route: { name: 'home' },
  uploads: [],
  theme: 'light',
  keySet: false,
  keyRemembered: false,
  model: DEFAULT_MODEL,
  sendPdf: true,
  dialog: null,
  toast: null,
  focus: null,
  keyphrase: null,
  readerScale: 1,
  drawer: false,
  readerOpen: false,
  dataVersion: 0,
  activeProject: 'all',
  pendingAsk: null,
  autoCite: null,
  sourceHidden: false,
});

export function useApp<R>(select: (s: AppState) => R): R {
  return useSelector(app, select);
}

let db: Database | null = null;
function database(): Database {
  if (!db) throw new Error('Database not ready');
  return db;
}

// ---------------------------------------------------------------- init

let listening = false;

export async function init() {
  const theme = initialTheme();
  const { key, remembered } = initKey();
  app.set({
    theme,
    keySet: !!key,
    keyRemembered: remembered,
    model: pref<ModelId>('ais2.model', DEFAULT_MODEL),
    sendPdf: pref('ais2.sendPdf', true),
    readerScale: pref('ais2.readerScale', 1),
    sourceHidden: pref('ais2.sourceHidden', false),
    route: parseHash(location.hash),
  });
  applyTheme(theme);
  if (!listening) {
    listening = true;
    window.addEventListener('hashchange', () => {
      app.set({ route: parseHash(location.hash), drawer: false });
    });
  }

  db = await openDatabase();
  let projects = await db.all('projects');
  const ensure = async (id: string, name: string) => {
    if (!projects.some((p) => p.id === id)) {
      const p = { id, name, createdAt: id === INBOX ? 0 : 1 };
      await db!.put('projects', p);
      projects = [...projects, p];
    }
  };
  await ensure(INBOX, 'My documents');
  await ensure(SAMPLES_PROJECT, 'Samples');
  const docs = await db.all('meta');
  app.set({ ready: true, persistent: db.persistent, projects: sortProjects(projects), docs: sortDocs(docs) });
}

function sortProjects(ps: Project[]) {
  return ps.slice().sort((a, b) => a.createdAt - b.createdAt);
}
function sortDocs(ds: DocMeta[]) {
  return ds.slice().sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------- navigation & ui

export function navigate(route: Route) {
  const hash = routeHash(route);
  if (location.hash !== hash) location.hash = hash;
  app.set({ route, drawer: false });
}

export function openDoc(docId: string, tab: Extract<Route, { name: 'doc' }>['tab'] = 'brief') {
  navigate({ name: 'doc', docId, tab });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone: Toast['tone'] = 'info') {
  clearTimeout(toastTimer);
  app.set({ toast: { id: Date.now(), text, tone } });
  toastTimer = setTimeout(() => app.set({ toast: null }), tone === 'error' ? 6000 : 3200);
}

export function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#15120f' : '#f4efe6');
}

export function toggleTheme() {
  const theme = app.get().theme === 'dark' ? 'light' : 'dark';
  app.set({ theme });
  applyTheme(theme);
  try {
    localStorage.setItem('ais2.theme', theme);
  } catch {
    // ignore
  }
}

export function setDialog(dialog: Dialog) {
  app.set({ dialog });
}

export function setModel(model: ModelId) {
  app.set({ model });
  savePref('ais2.model', model);
}

export function setSendPdf(sendPdf: boolean) {
  app.set({ sendPdf });
  savePref('ais2.sendPdf', sendPdf);
}

export function setReaderScale(readerScale: number) {
  const v = Math.max(0.85, Math.min(1.3, Math.round(readerScale * 100) / 100));
  app.set({ readerScale: v });
  savePref('ais2.readerScale', v);
}

export function saveKey(key: string, remember: boolean) {
  storeKey(key, remember);
  app.set({ keySet: !!key.trim(), keyRemembered: remember && !!key.trim() });
}

export function setSourceHidden(sourceHidden: boolean) {
  app.set({ sourceHidden });
  savePref('ais2.sourceHidden', sourceHidden);
}

export function focusPassage(f: Omit<Focus, 'nonce'>) {
  // Showing a citation always brings the source back into view.
  if (app.get().sourceHidden) setSourceHidden(false);
  app.set({ focus: { ...f, nonce: Date.now() }, readerOpen: true, keyphrase: null });
  const r = app.get().route;
  if (r.name !== 'doc' || r.docId !== f.docId) {
    navigate({ name: 'doc', docId: f.docId, tab: r.name === 'doc' ? r.tab : 'brief' });
  }
}

export function setKeyphrase(k: string | null) {
  if (k && app.get().sourceHidden) setSourceHidden(false);
  app.set({ keyphrase: k, readerOpen: k ? true : app.get().readerOpen });
}

// ---------------------------------------------------------------- documents

export interface LoadedDoc {
  meta: DocMeta;
  blocks: Block[];
  analysis: Analysis;
}

const cache = new Map<string, LoadedDoc>();
const inflight = new Map<string, Promise<LoadedDoc>>();

export async function loadDoc(docId: string): Promise<LoadedDoc> {
  const hit = cache.get(docId);
  if (hit) return hit;
  const pending = inflight.get(docId);
  if (pending) return pending;
  const p = (async () => {
    const d = database();
    const meta = await d.get('meta', docId);
    if (!meta) throw new Error('This document no longer exists.');
    const blocks = (await d.get('blocks', docId))?.blocks ?? [];
    let analysis: Analysis | undefined = await d.get('analyses', docId);
    if (!analysis || analysis.version !== ANALYSIS_VERSION) {
      analysis = await analyzeInWorker(docId, meta.title, blocks);
      await d.put('analyses', { ...analysis, id: docId });
    }
    const loaded = { meta, blocks, analysis };
    cache.set(docId, loaded);
    return loaded;
  })();
  inflight.set(docId, p);
  try {
    return await p;
  } finally {
    inflight.delete(docId);
  }
}

export function useDoc(docId: string | undefined): { data: LoadedDoc | null; error: string | null } {
  const [state, setState] = useState<{ id?: string; data: LoadedDoc | null; error: string | null }>({ data: null, error: null });
  const version = useApp((s) => s.dataVersion);
  const ready = useApp((s) => s.ready);
  useEffect(() => {
    if (!docId || !ready) return;
    let alive = true;
    const cached = cache.get(docId);
    if (cached) setState({ id: docId, data: cached, error: null });
    else setState({ id: docId, data: null, error: null });
    loadDoc(docId).then(
      (data) => alive && setState({ id: docId, data, error: null }),
      (e: Error) => alive && setState({ id: docId, data: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [docId, version, ready]);
  return state.id === docId ? { data: state.data, error: state.error } : { data: null, error: null };
}

export async function getOriginal(docId: string): Promise<ArrayBuffer | null> {
  return (await database().get('originals', docId))?.data ?? null;
}

async function storeParsed(parsed: ParsedDoc, opts: { fileName: string; size: number; projectId: string; original?: ArrayBuffer; sample?: string }, onStage: (s: UploadStage) => void): Promise<string> {
  const id = uid('d');
  onStage('analysing');
  const analysis = await analyzeInWorker(id, parsed.title, parsed.blocks);
  if (analysis.sentences.length === 0) throw new Error('No readable sentences were found in this document.');
  onStage('saving');
  const now = Date.now();
  const meta: DocMeta = {
    id,
    projectId: opts.projectId,
    title: parsed.title.slice(0, 200),
    fileName: opts.fileName,
    kind: parsed.kind,
    size: opts.size,
    createdAt: now,
    updatedAt: now,
    pages: parsed.pages,
    slides: parsed.slides,
    words: analysis.stats.words,
    readingMinutes: analysis.stats.readingMinutes,
    sample: opts.sample,
    hasOriginal: !!opts.original,
    phraseKeys: analysis.keyphrases.map((k) => k.key),
    topPhrases: analysis.keyphrases.slice(0, 6).map((k) => k.phrase),
    tldr: analysis.summary.tldr.map((i) => analysis.sentences[i]?.text ?? '').join(' '),
  };
  const d = database();
  await d.put('blocks', { id, blocks: parsed.blocks });
  await d.put('analyses', { ...analysis, id });
  if (opts.original) await d.put('originals', { id, mime: 'application/pdf', data: opts.original });
  await d.put('meta', meta);
  cache.set(id, { meta, blocks: parsed.blocks, analysis });
  app.set((s) => ({ docs: sortDocs([...s.docs.filter((x) => x.id !== id), meta]) }));
  return id;
}

function updateUpload(id: string, patch: Partial<UploadItem>) {
  app.set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
}

export function dismissUploads() {
  app.set((s) => ({ uploads: s.uploads.filter((u) => u.stage !== 'done' && u.stage !== 'error') }));
}

export function currentProjectForNew(): string {
  const p = app.get().activeProject;
  return p !== 'all' && p !== SAMPLES_PROJECT && app.get().projects.some((x) => x.id === p) ? p : INBOX;
}

export async function ingestFiles(files: File[], projectId = currentProjectForNew()): Promise<string[]> {
  const items: UploadItem[] = files.map((f) => ({ id: uid('u'), name: f.name, size: f.size, stage: 'queued', progress: 0 }));
  app.set((s) => ({ uploads: [...s.uploads.filter((u) => u.stage !== 'done'), ...items] }));
  const added: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const item = items[i]!;
    try {
      const kind = detectKind(file.name, file.type);
      if (!kind) throw new Error(unsupportedReason(file.name));
      if (file.size > MAX_BYTES) throw new Error(`Too large (${(file.size / 1048576).toFixed(1)} MB). The limit is ${MAX_BYTES / 1048576} MB.`);
      updateUpload(item.id, { stage: 'reading', progress: 0.05 });
      const buffer = await file.arrayBuffer();
      updateUpload(item.id, { stage: 'extracting', progress: 0.15 });
      const { parsed, original } = await parseBuffer(file.name, kind, buffer, (f, detail) => updateUpload(item.id, { progress: 0.15 + 0.55 * f, detail }));
      const docId = await storeParsed(parsed, { fileName: file.name, size: file.size, projectId, original }, (stage) =>
        updateUpload(item.id, { stage, progress: stage === 'analysing' ? 0.75 : 0.92, detail: undefined }),
      );
      updateUpload(item.id, { stage: 'done', progress: 1, docId });
      added.push(docId);
    } catch (e) {
      updateUpload(item.id, { stage: 'error', progress: 1, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (added.length) {
    openDoc(added[0]!);
    toast(added.length === 1 ? 'Document added — summary ready.' : `${added.length} documents added.`, 'success');
    // Auto-hide finished uploads after a moment if nothing failed.
    setTimeout(() => {
      if (!app.get().uploads.some((u) => u.stage === 'error')) dismissUploads();
    }, 4000);
  }
  return added;
}

export async function ingestPasted(text: string, title?: string): Promise<string | null> {
  try {
    const { parsed } = parsePasted(text, title);
    const id = await storeParsed(parsed, { fileName: 'Pasted text', size: text.length, projectId: currentProjectForNew() }, () => {});
    openDoc(id);
    toast('Text added — summary ready.', 'success');
    return id;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return null;
  }
}

let sampleLoading: string | null = null;
export async function loadSample(sampleId = SAMPLES[0]!.id): Promise<string | null> {
  const existing = app.get().docs.find((d) => d.sample === sampleId);
  if (existing) {
    openDoc(existing.id);
    return existing.id;
  }
  const info = sampleById(sampleId);
  if (!info || sampleLoading) return null;
  sampleLoading = sampleId;
  const item: UploadItem = { id: uid('u'), name: info.file.split('/').pop()!, size: 0, stage: 'reading', progress: 0.05 };
  app.set((s) => ({ uploads: [...s.uploads.filter((u) => u.stage !== 'done'), item] }));
  try {
    const res = await fetch(new URL(info.file, document.baseURI));
    if (!res.ok) throw new Error(`Could not load the sample (${res.status}).`);
    const buffer = await res.arrayBuffer();
    updateUpload(item.id, { size: buffer.byteLength, stage: 'extracting', progress: 0.2 });
    const kind = detectKind(info.file)!;
    const { parsed, original } = await parseBuffer(info.file, kind, buffer, (f, detail) => updateUpload(item.id, { progress: 0.2 + 0.5 * f, detail }));
    const id = await storeParsed(parsed, { fileName: info.file.split('/').pop()!, size: buffer.byteLength, projectId: SAMPLES_PROJECT, original, sample: sampleId }, (stage) =>
      updateUpload(item.id, { stage, progress: stage === 'analysing' ? 0.75 : 0.92 }),
    );
    updateUpload(item.id, { stage: 'done', progress: 1, docId: id });
    setTimeout(dismissUploads, 1800);
    app.set({ autoCite: id });
    openDoc(id);
    return id;
  } catch (e) {
    updateUpload(item.id, { stage: 'error', error: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    sampleLoading = null;
  }
}

export async function deleteDoc(docId: string) {
  const d = database();
  await Promise.all([
    d.del('meta', docId),
    d.del('blocks', docId),
    d.del('analyses', docId),
    d.del('originals', docId),
    d.del('chats', `doc:${docId}`),
    d.del('study', docId),
    d.del('notes', docId),
  ]);
  cache.delete(docId);
  app.set((s) => ({ docs: s.docs.filter((x) => x.id !== docId), focus: s.focus?.docId === docId ? null : s.focus }));
  const r = app.get().route;
  if (r.name === 'doc' && r.docId === docId) navigate({ name: 'home' });
  toast('Document deleted.');
}

export async function moveDoc(docId: string, projectId: string) {
  const d = database();
  const meta = await d.get('meta', docId);
  if (!meta) return;
  const next = { ...meta, projectId, updatedAt: Date.now() };
  await d.put('meta', next);
  const c = cache.get(docId);
  if (c) cache.set(docId, { ...c, meta: next });
  app.set((s) => ({ docs: s.docs.map((x) => (x.id === docId ? next : x)) }));
}

export async function renameDoc(docId: string, title: string) {
  const t = title.trim();
  if (!t) return;
  const d = database();
  const meta = await d.get('meta', docId);
  if (!meta) return;
  const next = { ...meta, title: t.slice(0, 200), updatedAt: Date.now() };
  await d.put('meta', next);
  const c = cache.get(docId);
  if (c) cache.set(docId, { ...c, meta: next });
  app.set((s) => ({ docs: s.docs.map((x) => (x.id === docId ? next : x)), dataVersion: s.dataVersion + 1 }));
}

export async function createProject(name: string): Promise<Project | null> {
  const n = name.trim();
  if (!n) return null;
  const p: Project = { id: uid('p'), name: n.slice(0, 60), createdAt: Date.now() };
  await database().put('projects', p);
  app.set((s) => ({ projects: sortProjects([...s.projects, p]), activeProject: p.id }));
  return p;
}

export async function renameProject(id: string, name: string) {
  const n = name.trim();
  const p = app.get().projects.find((x) => x.id === id);
  if (!p || !n) return;
  const next = { ...p, name: n.slice(0, 60) };
  await database().put('projects', next);
  app.set((s) => ({ projects: s.projects.map((x) => (x.id === id ? next : x)) }));
}

export async function deleteProject(id: string) {
  if (id === INBOX || id === SAMPLES_PROJECT) return;
  const d = database();
  for (const doc of app.get().docs.filter((x) => x.projectId === id)) await moveDoc(doc.id, INBOX);
  await d.del('projects', id);
  app.set((s) => ({ projects: s.projects.filter((x) => x.id !== id), activeProject: 'all' }));
  toast('Project removed; its documents moved to My documents.');
}

export async function deleteEverything() {
  await database().clearAll();
  cache.clear();
  storeKey(null, false);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('ais2.')) localStorage.removeItem(k);
  } catch {
    // ignore
  }
  app.set({ docs: [], projects: [], uploads: [], focus: null, keySet: false, keyRemembered: false, dialog: null, activeProject: 'all' });
  await init();
  navigate({ name: 'home' });
  toast('Everything was deleted from this browser.', 'success');
}

// ---------------------------------------------------------------- per-doc records

export async function getChat(id: string): Promise<ChatRecord> {
  return (await database().get('chats', id)) ?? { id, messages: [] };
}
export async function saveChat(rec: ChatRecord) {
  await database().put('chats', rec);
}
export async function getStudy(docId: string): Promise<StudyRecord> {
  return (await database().get('study', docId)) ?? { id: docId, boxes: {} };
}
export async function saveStudy(rec: StudyRecord) {
  await database().put('study', rec);
}
export async function getNotes(docId: string): Promise<NotesRecord> {
  return (await database().get('notes', docId)) ?? { id: docId, text: '', highlights: [], ai: {} };
}
export async function saveNotes(rec: NotesRecord) {
  await database().put('notes', rec);
  app.set((s) => ({ dataVersion: s.dataVersion }));
}

/** All loaded analyses for library-wide search. */
export async function loadAllDocs(): Promise<LoadedDoc[]> {
  const out: LoadedDoc[] = [];
  for (const m of app.get().docs) {
    try {
      out.push(await loadDoc(m.id));
    } catch {
      // skip broken entries
    }
  }
  return out;
}

export function libraryDocFreq(): { df: (key: string) => number; count: number } {
  const docs = app.get().docs;
  const counts = new Map<string, number>();
  for (const d of docs) for (const k of new Set(d.phraseKeys)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return { df: (k) => counts.get(k) ?? 0, count: docs.length };
}

export { ACCEPT };
