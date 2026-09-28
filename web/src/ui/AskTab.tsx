import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { answerQuestion, buildQaIndex } from '../engine/qa';
import type { ChatTurn } from '../ai/request';
import { modelInfo } from '../ai/models';
import { app, getChat, loadDoc, saveChat, useApp, type LoadedDoc } from '../store/app';
import { uid, type ChatMessage, type ChatRecord } from '../store/db';
import { AiFootnote, AiStatus, AiText, NeedKey, useClaude } from './ai';
import { Icon } from './common';
import { LocalAnswer } from './LocalAnswer';

type Mode = 'local' | 'claude';
type Scope = 'doc' | 'project' | 'all';

export function AskTab({ doc }: { doc: LoadedDoc }) {
  const { meta, analysis } = doc;
  const keySet = useApp((s) => s.keySet);
  const model = useApp((s) => s.model);
  const allDocs = useApp((s) => s.docs);
  const pending = useApp((s) => s.pendingAsk);
  const [mode, setMode] = useState<Mode>('local');
  const [scope, setScope] = useState<Scope>('doc');
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<ChatRecord>({ id: `doc:${meta.id}`, messages: [] });
  const [needKey, setNeedKey] = useState(false);
  const [sources, setSources] = useState<LoadedDoc[]>([doc]);
  const claude = useClaude();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scopeIds = useMemo(() => {
    if (scope === 'doc') return [meta.id];
    const list = scope === 'project' ? allDocs.filter((d) => d.projectId === meta.projectId) : allDocs;
    const ids = list.map((d) => d.id);
    return ids.includes(meta.id) ? ids : [meta.id, ...ids];
  }, [scope, allDocs, meta.id, meta.projectId]);

  useEffect(() => {
    let alive = true;
    getChat(`doc:${meta.id}`).then((c) => alive && setChat(c));
    return () => {
      alive = false;
    };
  }, [meta.id]);

  useEffect(() => {
    let alive = true;
    Promise.all(scopeIds.map((id) => (id === meta.id ? Promise.resolve(doc) : loadDoc(id).catch(() => null)))).then((ds) => {
      if (alive) setSources(ds.filter((d): d is LoadedDoc => !!d));
    });
    return () => {
      alive = false;
    };
  }, [scopeIds, doc, meta.id]);

  const index = useMemo(() => buildQaIndex(sources.map((d) => ({ docId: d.meta.id, title: d.meta.title, analysis: d.analysis }))), [sources]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [chat.messages.length, claude.state.status]);

  const persist = async (messages: ChatMessage[]) => {
    const rec = { id: `doc:${meta.id}`, messages };
    setChat(rec);
    await saveChat(rec);
  };

  const ask = async (question: string, m: Mode = mode) => {
    const q = question.trim();
    if (!q) return;
    if (m === 'claude' && !keySet) {
      setNeedKey(true);
      return;
    }
    setNeedKey(false);
    setInput('');
    const userMsg: ChatMessage = { id: uid('m'), role: 'user', mode: m, text: q, createdAt: Date.now(), scope: scopeIds };
    const base = [...chat.messages, userMsg];
    if (m === 'local') {
      const local = answerQuestion(q, index);
      await persist([...base, { id: uid('m'), role: 'assistant', mode: 'local', text: '', createdAt: Date.now(), scope: scopeIds, local }]);
      return;
    }
    await persist(base);
    // Claude sees the earlier Claude turns of this conversation (text only).
    const history: ChatTurn[] = [];
    for (const msg of chat.messages.slice(-12)) {
      if (msg.mode !== 'claude') continue;
      if (msg.role === 'user') history.push({ role: 'user', text: msg.text });
      else if (msg.ai) history.push({ role: 'assistant', text: msg.ai.segments.map((s) => s.text).join('') });
    }
    // Drop a dangling user turn (e.g. an earlier failed request).
    while (history.length && history[history.length - 1]!.role === 'user') history.pop();
    const res = await claude.run({ kind: 'chat', prompt: q, history }, scopeIds);
    const reply: ChatMessage = { id: uid('m'), role: 'assistant', mode: 'claude', text: '', createdAt: Date.now(), scope: scopeIds };
    if (res.status === 'done') reply.ai = res.saved;
    else if (res.status === 'refusal') reply.refusal = { category: res.category, explanation: res.explanation };
    else if (res.status === 'error') reply.error = res.error.message;
    else return; // stopped by the user
    await persist([...base, reply]);
    claude.setState({ status: 'idle' });
  };

  // Questions handed over from the reader's selection toolbar.
  useEffect(() => {
    if (!pending || pending.docId !== meta.id) return;
    app.set({ pendingAsk: null });
    setMode(pending.mode);
    if (pending.send) void ask(pending.text, pending.mode);
    else {
      setInput(pending.text);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, meta.id]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  const busy = claude.state.status === 'preparing' || claude.state.status === 'streaming';
  const multi = scopeIds.length > 1;

  return (
    <div className="ask">
      <div className="ask-controls">
        <div className="seg" role="radiogroup" aria-label="Answer engine">
          <button type="button" role="radio" aria-checked={mode === 'local'} onClick={() => setMode('local')}>
            Local · instant
          </button>
          <button type="button" role="radio" aria-checked={mode === 'claude'} onClick={() => setMode('claude')}>
            <Icon name={keySet ? 'sparkle' : 'lock'} size={13} /> Claude
          </button>
        </div>
        <label className="select-wrap">
          <span className="sr-only">Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="doc">This document</option>
            <option value="project">This project ({allDocs.filter((d) => d.projectId === meta.projectId).length})</option>
            <option value="all">Whole library ({allDocs.length})</option>
          </select>
        </label>
        {chat.messages.length > 0 && (
          <button type="button" className="link" onClick={() => void persist([])}>
            Clear conversation
          </button>
        )}
      </div>
      <p className="sub">
        {mode === 'local'
          ? 'Answers are built from the best-matching sentences (BM25 retrieval with synonym and typo expansion). Every sentence links to its source.'
          : `${modelInfo(model).label} reads the ${multi ? `${scopeIds.length} documents` : 'document'} and answers with citations. Uses your API key.`}
      </p>

      {chat.messages.length === 0 && (
        <div className="suggestions" aria-label="Suggested questions">
          {analysis.suggestions.map((q) => (
            <button key={q} type="button" className="chip" onClick={() => void ask(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="thread" aria-live="polite">
        {chat.messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg-q">
              <span className="kicker">{m.mode === 'claude' ? 'You → Claude' : 'You'}</span>
              <p>{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="msg-a">
              {m.local && <LocalAnswer answer={m.local} showTitles={m.scope.length > 1} />}
              {m.ai && (
                <div className="answer answer-ai">
                  <div className="answer-meta">
                    <span className="answer-mode">
                      <Icon name="sparkle" size={13} /> Claude · abstractive · cited
                    </span>
                  </div>
                  <AiText segments={m.ai.segments} docMap={m.ai.docMap} />
                  <AiFootnote saved={m.ai} />
                </div>
              )}
              {(m.error || m.refusal) && (
                <div className="answer answer-none">
                  <p className="answer-msg">
                    {m.refusal ? `Claude declined this request${m.refusal.category ? ` (${m.refusal.category})` : ''}. The partial response was discarded.` : m.error}
                  </p>
                </div>
              )}
            </div>
          ),
        )}
        {(busy || claude.state.status === 'error' || claude.state.status === 'refusal') && (
          <div className="msg-a">
            <div className="answer answer-ai">
              <AiStatus state={claude.state} onRetry={() => void ask(chat.messages.filter((x) => x.role === 'user').pop()?.text ?? '', 'claude')} />
              {claude.state.status === 'streaming' && <AiText segments={claude.state.segments} docMap={claude.state.docMap} streaming />}
            </div>
          </div>
        )}
        <div ref={endRef} className="thread-end" />
      </div>

      {needKey && mode === 'claude' && <NeedKey feature="Chatting with Claude" />}

      <form className="ask-form" onSubmit={onSubmit}>
        <label htmlFor="ask-input" className="sr-only">
          Ask a question
        </label>
        <textarea
          id="ask-input"
          ref={inputRef}
          rows={2}
          value={input}
          placeholder={multi ? `Ask across ${scopeIds.length} documents…` : 'Ask about this document…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn btn-primary" onClick={claude.stop}>
            <Icon name="stop" size={14} /> Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            Ask <Icon name="send" size={14} />
          </button>
        )}
      </form>
    </div>
  );
}
