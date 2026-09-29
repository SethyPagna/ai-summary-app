import { useEffect, useMemo, useRef, useState } from 'react';
import { answerQuestion, buildQaIndex } from '../engine/qa';
import { libraryRerank } from '../engine/keyphrases';
import type { EntityType } from '../engine/types';
import { sampleById } from '../samples/manifest';
import { app, focusPassage, getNotes, libraryDocFreq, navigate, saveNotes, setKeyphrase, useApp, type LoadedDoc } from '../store/app';
import type { NotesRecord, SavedAi } from '../store/db';
import { AiFootnote, AiStatus, AiText, NeedKey, useClaude } from './ai';
import { CiteChip, Icon } from './common';
import { sentenceTarget } from './cite';
import { LocalAnswer } from './LocalAnswer';

type Len = 'short' | 'detailed';

export function BriefTab({ doc }: { doc: LoadedDoc }) {
  const { meta, analysis: a, blocks } = doc;
  const [len, setLen] = useState<Len>('short');
  const docs = useApp((s) => s.docs);
  const keyphrase = useApp((s) => s.keyphrase);

  const phrases = useMemo(() => {
    const { df, count } = libraryDocFreq();
    return libraryRerank(a.keyphrases, df, count).slice(0, 18);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, docs.length]);

  const question = sampleById(meta.sample)?.question ?? a.suggestions[0] ?? 'What is this document about?';
  const answer = useMemo(() => answerQuestion(question, buildQaIndex([{ docId: meta.id, title: meta.title, analysis: a }])), [question, meta.id, meta.title, a]);

  const target = (si: number) => sentenceTarget(meta.id, a, blocks, si);

  // First visit to a sample: show where the suggested answer comes from.
  const autoCite = useApp((s) => s.autoCite);
  useEffect(() => {
    if (autoCite !== meta.id) return;
    app.set({ autoCite: null });
    const first = answer.sentences[0];
    if (!first || !matchMedia('(min-width: 1080px)').matches) return;
    const t = sentenceTarget(first.docId, a, blocks, first.sentence);
    if (t) app.set({ focus: { ...t, nonce: Date.now() } });
  }, [autoCite, meta.id, answer, a, blocks]);
  const summaryIds = len === 'short' ? a.summary.short : a.summary.detailed;

  return (
    <div className="brief">
      <section className="tldr" aria-labelledby="tldr-h">
        <h2 id="tldr-h" className="kicker">
          TL;DR <span className="kicker-note">TextRank · most central sentence{a.summary.tldr.length > 1 ? 's' : ''}</span>
        </h2>
        <blockquote className={`pull${a.summary.tldr.reduce((n, i) => n + (a.sentences[i]?.text.length ?? 0), 0) > 170 ? ' is-long' : ''}`}>
          {a.summary.tldr.map((i) => (
            <span key={i}>
              {a.sentences[i]?.text} <CiteChip target={target(i)} />{' '}
            </span>
          ))}
        </blockquote>
        <div className="keyline" aria-label="Top key phrases">
          <span className="kicker">Key phrases</span>
          {phrases.slice(0, 6).map((k) => (
            <button key={k.key} type="button" className={`chip chip-small${keyphrase === k.phrase ? ' chip-accent' : ''}`} onClick={() => setKeyphrase(keyphrase === k.phrase ? null : k.phrase)} aria-pressed={keyphrase === k.phrase}>
              {k.phrase}
            </button>
          ))}
        </div>
      </section>

      <section className="panel suggested" aria-labelledby="sq-h">
        <div className="panel-head">
          <h2 id="sq-h" className="kicker">
            Suggested question
          </h2>
          <button type="button" className="link" onClick={() => navigate({ name: 'doc', docId: meta.id, tab: 'ask' })}>
            Ask your own <Icon name="arrow" size={14} />
          </button>
        </div>
        <p className="q">{question}</p>
        <LocalAnswer answer={answer} />
      </section>

      <section aria-labelledby="sum-h">
        <div className="section-head">
          <h2 id="sum-h" className="h-section">
            Summary
          </h2>
          <div className="seg" role="radiogroup" aria-label="Summary length">
            {(['short', 'detailed'] as Len[]).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={len === l} onClick={() => setLen(l)}>
                {l === 'short' ? `Short · ${a.summary.short.length}` : `Detailed · ${a.summary.detailed.length}`}
              </button>
            ))}
          </div>
        </div>
        <ol className="summary-list">
          {summaryIds.map((i) => (
            <li key={i}>
              {a.sentences[i]?.text} <CiteChip target={target(i)} />
            </li>
          ))}
        </ol>
        <p className="method-note">Extractive: every line above is a sentence from the document, chosen by graph ranking (TextRank) with MMR for variety.</p>
      </section>

      <ClaudeCard doc={doc} />

      <section aria-labelledby="kp-h">
        <h2 id="kp-h" className="h-section">
          Index of key phrases
        </h2>
        <p className="sub">Click a phrase to highlight it in the source.</p>
        <ul className="index-list">
          {phrases.map((k) => (
            <li key={k.key}>
              <button type="button" className={`index-item${keyphrase === k.phrase ? ' is-active' : ''}`} onClick={() => setKeyphrase(keyphrase === k.phrase ? null : k.phrase)} aria-pressed={keyphrase === k.phrase}>
                <span className="index-term">{k.phrase}</span>
                <span className="index-dots" aria-hidden="true" />
                <span className="index-count" aria-label={`${k.count} mentions`}>
                  {k.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Entities doc={doc} />

      {a.summary.sections.length > 1 && (
        <section aria-labelledby="sec-h">
          <h2 id="sec-h" className="h-section">
            Section by section
          </h2>
          <ol className="sections">
            {a.summary.sections.map((s) => (
              <li key={s.section}>
                <h3>{a.sections[s.section]?.title}</h3>
                <p>
                  {s.sentences.map((i) => (
                    <span key={i}>
                      {a.sentences[i]?.text} <CiteChip target={target(i)} />{' '}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="colophon" aria-labelledby="stats-h">
        <h2 id="stats-h" className="kicker">
          Readability
        </h2>
        <dl>
          <div>
            <dt>Words</dt>
            <dd>{a.stats.words.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Read time</dt>
            <dd>{a.stats.readingMinutes} min</dd>
          </div>
          <div>
            <dt>Flesch ease</dt>
            <dd>
              {a.stats.flesch} <small>{a.stats.fleschLabel}</small>
            </dd>
          </div>
          <div>
            <dt>Grade level</dt>
            <dd>{a.stats.grade}</dd>
          </div>
          <div>
            <dt>Sentences</dt>
            <dd>{a.stats.sentences}</dd>
          </div>
          <div>
            <dt>Words / sentence</dt>
            <dd>{a.stats.avgSentenceWords}</dd>
          </div>
        </dl>
      </section>

      <Notes doc={doc} />
    </div>
  );
}

const ENTITY_GROUPS: [string, EntityType[]][] = [
  ['Dates', ['date']],
  ['Figures', ['money', 'percent']],
  ['Names & places', ['name']],
  ['Links', ['email', 'url']],
];

function Entities({ doc }: { doc: LoadedDoc }) {
  const { meta, analysis: a, blocks } = doc;
  if (!a.entities.length) return null;
  return (
    <section aria-labelledby="ent-h">
      <h2 id="ent-h" className="h-section">
        Names, dates &amp; figures
      </h2>
      <div className="entities">
        {ENTITY_GROUPS.map(([label, types]) => {
          const items = a.entities.filter((e) => types.includes(e.type));
          if (!items.length) return null;
          return (
            <div key={label} className="entity-group">
              <h3 className="kicker">{label}</h3>
              <ul>
                {items.map((e) => {
                  const t = sentenceTarget(meta.id, a, blocks, e.sentences[0] ?? 0);
                  return (
                    <li key={e.type + e.text}>
                      <button
                        type="button"
                        className={`entity entity-${e.type}`}
                        onClick={() => t && focusPassage(t)}
                        title={t ? `First mention: ${t.label}` : undefined}
                      >
                        {e.text}
                        {e.count > 1 && <span className="entity-count">×{e.count}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ClaudeCard({ doc }: { doc: LoadedDoc }) {
  const { meta } = doc;
  const keySet = useApp((s) => s.keySet);
  const { state, run, stop } = useClaude();
  const [saved, setSaved] = useState<{ summary?: SavedAi; eli5?: SavedAi }>({});
  const [mode, setMode] = useState<'summary' | 'eli5'>('summary');
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let alive = true;
    getNotes(meta.id).then((n) => alive && setSaved({ summary: n.ai.summary, eli5: n.ai.eli5 }));
    return () => {
      alive = false;
    };
  }, [meta.id]);

  const go = async (m: 'summary' | 'eli5') => {
    setMode(m);
    setAsked(true);
    if (!keySet) return;
    const res = await run({ kind: m }, [meta.id]);
    if (res.status === 'done') {
      const notes = await getNotes(meta.id);
      notes.ai[m] = res.saved;
      await saveNotes(notes);
      setSaved((s) => ({ ...s, [m]: res.saved }));
    }
  };

  const busy = state.status === 'preparing' || state.status === 'streaming';
  const shown = saved[mode];

  return (
    <section className="panel claude-card" aria-labelledby="claude-h" aria-busy={busy}>
      <div className="panel-head">
        <h2 id="claude-h" className="kicker">
          <Icon name="sparkle" size={14} /> Claude · optional
        </h2>
        {busy && (
          <button type="button" className="btn btn-ghost btn-small" onClick={stop}>
            <Icon name="stop" size={13} /> Stop
          </button>
        )}
      </div>
      <p className="sub">Abstractive answers written by Claude with your own key — every claim links back to the passage it came from.</p>
      <div className="row wrap">
        <button type="button" className={`btn ${mode === 'summary' && (shown || busy) ? 'btn-primary' : ''}`} disabled={busy} onClick={() => void go('summary')}>
          {saved.summary ? 'Rewrite summary' : 'Write an abstractive summary'}
        </button>
        <button type="button" className={`btn ${mode === 'eli5' && (saved.eli5 || busy) ? 'btn-primary' : ''}`} disabled={busy} onClick={() => void go('eli5')}>
          Explain like I’m new
        </button>
      </div>
      {asked && !keySet && <NeedKey feature={mode === 'summary' ? 'The abstractive summary' : 'Explain like I’m new'} />}
      <div aria-live="polite">
        <AiStatus state={state} onRetry={() => void go(mode)} />
        {state.status === 'streaming' && <AiText segments={state.segments} docMap={state.docMap} streaming />}
        {state.status !== 'streaming' && shown && (
          <>
            <AiText segments={shown.segments} docMap={shown.docMap} />
            <AiFootnote saved={shown} />
          </>
        )}
      </div>
    </section>
  );
}

function Notes({ doc }: { doc: LoadedDoc }) {
  const { meta, blocks } = doc;
  const version = useApp((s) => s.dataVersion);
  const [notes, setNotes] = useState<NotesRecord | null>(null);
  const [text, setText] = useState('');
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    getNotes(meta.id).then((n) => {
      if (!alive) return;
      setNotes(n);
      if (loadedFor.current !== meta.id) {
        loadedFor.current = meta.id;
        setText(n.text);
      }
    });
    return () => {
      alive = false;
    };
  }, [meta.id, version]);

  // Debounced autosave.
  useEffect(() => {
    if (!notes || text === notes.text) return;
    const t = setTimeout(async () => {
      const fresh = await getNotes(meta.id);
      fresh.text = text;
      await saveNotes(fresh);
      setNotes(fresh);
    }, 500);
    return () => clearTimeout(t);
  }, [text, notes, meta.id]);

  const removeHighlight = async (id: string) => {
    const fresh = await getNotes(meta.id);
    fresh.highlights = fresh.highlights.filter((h) => h.id !== id);
    await saveNotes(fresh);
    setNotes(fresh);
    app.set((s) => ({ dataVersion: s.dataVersion + 1 }));
  };

  return (
    <section aria-labelledby="notes-h" className="notes">
      <h2 id="notes-h" className="h-section">
        Notes &amp; highlights
      </h2>
      <label className="sr-only" htmlFor="notes-text">
        Your notes
      </label>
      <textarea id="notes-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Your notes — saved on this device and included in the Markdown export." rows={4} />
      {notes && notes.highlights.length > 0 ? (
        <ul className="highlights">
          {notes.highlights.map((h) => {
            const b = blocks.find((x) => x.id === h.blockId);
            return (
              <li key={h.id}>
                <button
                  type="button"
                  className="hl-quote"
                  onClick={() => focusPassage({ docId: meta.id, ranges: [{ blockId: h.blockId, start: h.start, end: h.end }], label: 'highlight', quote: h.text })}
                >
                  “{h.text.trim()}”
                </button>
                <span className="hl-meta">{b?.anchor.page ? `p. ${b.anchor.page}` : b?.anchor.slide ? `Slide ${b.anchor.slide}` : ''}</span>
                <button type="button" className="icon-btn" onClick={() => void removeHighlight(h.id)} aria-label="Remove highlight">
                  <Icon name="close" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sub">Tip: select text in the source to highlight it or ask about it.</p>
      )}
    </section>
  );
}
