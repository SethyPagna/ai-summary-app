import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Flashcard } from '../engine/types';
import { getNotes, getStudy, saveNotes, saveStudy, useApp, type LoadedDoc } from '../store/app';
import type { SavedAi, StudyRecord } from '../store/db';
import { AiFootnote, AiStatus, AiText, NeedKey, useClaude } from './ai';
import { CiteChip, Icon, Kbd } from './common';
import { sentenceTarget } from './cite';

type Mode = 'cards' | 'quiz' | 'glossary' | 'guide';

export function StudyTab({ doc }: { doc: LoadedDoc }) {
  const [mode, setMode] = useState<Mode>('cards');
  const [study, setStudy] = useState<StudyRecord | null>(null);
  useEffect(() => {
    let alive = true;
    getStudy(doc.meta.id).then((s) => alive && setStudy(s));
    return () => {
      alive = false;
    };
  }, [doc.meta.id]);

  const update = useCallback(
    async (patch: Partial<StudyRecord>) => {
      const next = { ...(study ?? { id: doc.meta.id, boxes: {} }), ...patch };
      setStudy(next);
      await saveStudy(next);
    },
    [study, doc.meta.id],
  );

  const a = doc.analysis;
  return (
    <div className="study">
      <div className="seg seg-wide" role="tablist" aria-label="Study tools">
        {(
          [
            ['cards', `Flashcards · ${a.flashcards.length}`],
            ['quiz', `Quiz · ${a.quiz.length}`],
            ['glossary', `Key terms · ${a.glossary.length}`],
            ['guide', 'Study guide · Claude'],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'cards' && study && <Flashcards doc={doc} study={study} update={update} />}
      {mode === 'quiz' && study && <Quiz doc={doc} study={study} update={update} />}
      {mode === 'glossary' && <Glossary doc={doc} />}
      {mode === 'guide' && <StudyGuide doc={doc} />}
    </div>
  );
}

function clozeFront(front: string): ReactNode[] {
  const parts = front.split('_____');
  return parts.flatMap((p, i) =>
    i < parts.length - 1
      ? [
          p,
          <span key={i} className="blank">
            <span className="sr-only">blank</span>
          </span>,
        ]
      : [p],
  );
}

function highlightAnswer(context: string, answer: string): ReactNode[] {
  const idx = context.toLowerCase().indexOf(answer.toLowerCase());
  if (idx < 0) return [context];
  return [context.slice(0, idx), <mark key="a" className="answer-mark">{context.slice(idx, idx + answer.length)}</mark>, context.slice(idx + answer.length)];
}

function Flashcards({ doc, study, update }: { doc: LoadedDoc; study: StudyRecord; update: (p: Partial<StudyRecord>) => Promise<void> }) {
  const cards = doc.analysis.flashcards;
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Leitner order: lowest box first, reading order within a box. Frozen per session.
  const order = useMemo(() => cards.map((c, k) => ({ c, k })).sort((x, y) => (study.boxes[x.c.id] ?? 1) - (study.boxes[y.c.id] ?? 1) || x.k - y.k).map((x) => x.c), [cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const card: Flashcard | undefined = order[i];
  const mastered = cards.filter((c) => (study.boxes[c.id] ?? 1) >= 3).length;

  const grade = async (ok: boolean) => {
    if (!card) return;
    const box = study.boxes[card.id] ?? 1;
    await update({ boxes: { ...study.boxes, [card.id]: ok ? Math.min(5, box + 1) : 1 } });
    setFlipped(false);
    setI((x) => (x + 1) % order.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        // Focused buttons (including the card itself) handle Space/Enter natively.
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'ArrowRight') {
        setFlipped(false);
        setI((x) => (x + 1) % order.length);
      } else if (e.key === 'ArrowLeft') {
        setFlipped(false);
        setI((x) => (x - 1 + order.length) % order.length);
      } else if (flipped && (e.key === 'g' || e.key === 'G')) void grade(true);
      else if (flipped && (e.key === 'a' || e.key === 'A')) void grade(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!card) return <p className="empty-note">This document is too short to make flashcards from. Try a longer one.</p>;
  const box = study.boxes[card.id] ?? 1;
  const t = sentenceTarget(doc.meta.id, doc.analysis, doc.blocks, card.sentence);

  return (
    <div className="cards">
      <div className="cards-top">
        <span className="kicker">
          Card {i + 1} of {order.length}
        </span>
        <span className="kicker">
          {mastered} mastered · box {box}/5
          <span className="boxes" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((b) => (
              <i key={b} className={b <= box ? 'on' : ''} />
            ))}
          </span>
        </span>
      </div>
      <button type="button" className={`flashcard${flipped ? ' is-flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Card back — press to see the question' : 'Card front — press to reveal the answer'}>
        <span className="face front">
          <span className="face-label">{card.kind === 'cloze' ? 'Fill the gap' : 'Define'}</span>
          <span className="face-text">{card.kind === 'cloze' ? clozeFront(card.front) : card.front}</span>
          <span className="face-hint">
            <Icon name="flip" size={14} /> Reveal · <Kbd>Space</Kbd>
          </span>
        </span>
        <span className="face back">
          <span className="face-label">Answer</span>
          <span className="face-answer">{card.kind === 'cloze' ? card.back : ''}</span>
          <span className="face-text small">{card.kind === 'cloze' ? highlightAnswer(card.context, card.back) : card.back}</span>
        </span>
      </button>
      <div className="cards-actions">
        <button type="button" className="btn btn-ghost" onClick={() => (setFlipped(false), setI((x) => (x - 1 + order.length) % order.length))} aria-label="Previous card">
          <Icon name="back" size={15} />
        </button>
        {flipped ? (
          <>
            <button type="button" className="btn" onClick={() => void grade(false)}>
              Again <Kbd>A</Kbd>
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void grade(true)}>
              Got it <Kbd>G</Kbd>
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setFlipped(true)}>
            Reveal answer
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => (setFlipped(false), setI((x) => (x + 1) % order.length))} aria-label="Next card">
          <Icon name="arrow" size={15} />
        </button>
      </div>
      <p className="sub center">
        Source: <CiteChip target={t} /> · Cards you get right move up a box and come back less often (Leitner system).
      </p>
    </div>
  );
}

function Quiz({ doc, study, update }: { doc: LoadedDoc; study: StudyRecord; update: (p: Partial<StudyRecord>) => Promise<void> }) {
  const qs = doc.analysis.quiz;
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);
  const q = qs[i];
  const score = qs.filter((x) => picked[x.id] === x.answer).length;

  const choose = (opt: number) => {
    if (!q || picked[q.id] !== undefined) return;
    setPicked((p) => ({ ...p, [q.id]: opt }));
  };
  const next = async () => {
    if (i + 1 < qs.length) setI(i + 1);
    else {
      setDone(true);
      await update({ quizLast: score, quizTotal: qs.length, quizBest: Math.max(study.quizBest ?? 0, score) });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select') || done) return;
      const map: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
      const k = e.key.toLowerCase();
      if (k in map) choose(map[k]!);
      else if (k === 'enter' && q && picked[q.id] !== undefined && !(e.target as HTMLElement).closest('button')) void next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!qs.length) return <p className="empty-note">Not enough distinct key phrases in this document to build a fair quiz.</p>;

  if (done) {
    return (
      <div className="quiz-done">
        <p className="kicker">Result</p>
        <p className="score">
          {score}
          <span>/{qs.length}</span>
        </p>
        <p className="sub">
          Best so far: {Math.max(study.quizBest ?? 0, score)}/{qs.length}. Questions are generated from the most central sentences; distractors are other key phrases from the document.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setPicked({});
            setI(0);
            setDone(false);
          }}
        >
          <Icon name="retry" size={14} /> Try again
        </button>
      </div>
    );
  }

  const chosen = q ? picked[q.id] : undefined;
  const t = q ? sentenceTarget(doc.meta.id, doc.analysis, doc.blocks, q.sentence) : null;
  return (
    <div className="quiz">
      <div className="cards-top">
        <span className="kicker">
          Question {i + 1} of {qs.length}
        </span>
        <span className="kicker">
          Score {score} · best {study.quizBest ?? 0}/{study.quizTotal ?? qs.length}
        </span>
      </div>
      <div className="progress" aria-hidden="true">
        <i style={{ width: `${((i + (chosen !== undefined ? 1 : 0)) / qs.length) * 100}%` }} />
      </div>
      {q && (
        <>
          <p className="quiz-prompt">{clozeFront(q.prompt)}</p>
          <ol className="options" type="A">
            {q.options.map((o, k) => {
              const state = chosen === undefined ? '' : k === q.answer ? 'is-right' : k === chosen ? 'is-wrong' : 'is-dim';
              return (
                <li key={k}>
                  <button type="button" className={`option ${state}`} onClick={() => choose(k)} disabled={chosen !== undefined} aria-pressed={chosen === k}>
                    <span className="option-key">{'ABCD'[k]}</span>
                    {o}
                  </button>
                </li>
              );
            })}
          </ol>
          {chosen !== undefined && (
            <div className={`feedback ${chosen === q.answer ? 'ok' : 'no'}`} role="status">
              <strong>{chosen === q.answer ? 'Correct.' : `Not quite — it’s “${q.options[q.answer]}”.`}</strong> {q.explanation} <CiteChip target={t} />
              <div className="row">
                <button type="button" className="btn btn-primary btn-small" onClick={() => void next()}>
                  {i + 1 < qs.length ? 'Next question' : 'See result'} <Icon name="arrow" size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Glossary({ doc }: { doc: LoadedDoc }) {
  const g = doc.analysis.glossary;
  if (!g.length) return <p className="empty-note">No key terms found.</p>;
  return (
    <dl className="glossary">
      {g.map((e) => (
        <div key={e.term}>
          <dt>
            {e.term} {e.defining && <span className="tag">defined</span>}
          </dt>
          <dd>
            {e.definition} <CiteChip target={sentenceTarget(doc.meta.id, doc.analysis, doc.blocks, e.sentence)} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StudyGuide({ doc }: { doc: LoadedDoc }) {
  const keySet = useApp((s) => s.keySet);
  const { state, run, stop } = useClaude();
  const [saved, setSaved] = useState<SavedAi | undefined>();
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    let alive = true;
    getNotes(doc.meta.id).then((n) => alive && setSaved(n.ai.studyguide));
    return () => {
      alive = false;
    };
  }, [doc.meta.id]);
  const go = async () => {
    setAsked(true);
    if (!keySet) return;
    const res = await run({ kind: 'studyguide' }, [doc.meta.id]);
    if (res.status === 'done') {
      const notes = await getNotes(doc.meta.id);
      notes.ai.studyguide = res.saved;
      await saveNotes(notes);
      setSaved(res.saved);
    }
  };
  const busy = state.status === 'preparing' || state.status === 'streaming';
  return (
    <div className="guide">
      <p className="sub">Claude writes a study guide — key ideas, terms and self-check questions — with every point linked to its source passage.</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void go()} disabled={busy}>
          <Icon name="sparkle" size={14} /> {saved ? 'Regenerate study guide' : 'Generate study guide'}
        </button>
        {busy && (
          <button type="button" className="btn btn-ghost" onClick={stop}>
            Stop
          </button>
        )}
      </div>
      {asked && !keySet && <NeedKey feature="The study guide" />}
      <div aria-live="polite" className="panel-plain">
        <AiStatus state={state} onRetry={() => void go()} />
        {state.status === 'streaming' && <AiText segments={state.segments} docMap={state.docMap} streaming />}
        {state.status !== 'streaming' && saved && (
          <>
            <AiText segments={saved.segments} docMap={saved.docMap} />
            <AiFootnote saved={saved} />
          </>
        )}
      </div>
    </div>
  );
}
