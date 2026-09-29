import { useEffect, useState, type ReactNode } from 'react';
import type { QaAnswer } from '../engine/qa';
import { highlightMatcher, tokensForHighlight } from '../engine/qa';
import { loadDoc, useApp, type LoadedDoc } from '../store/app';
import { CiteChip } from './common';
import { sentenceTarget } from './cite';

const CONF_LABEL = { high: 'Strong match', medium: 'Partial match', low: 'Weak match' } as const;

function useDocs(ids: string[]): Map<string, LoadedDoc> {
  const key = [...new Set(ids)].join('|');
  const version = useApp((s) => s.dataVersion);
  const [map, setMap] = useState<Map<string, LoadedDoc>>(new Map());
  useEffect(() => {
    let alive = true;
    Promise.all(key.split('|').filter(Boolean).map((id) => loadDoc(id).catch(() => null))).then((docs) => {
      if (alive) setMap(new Map(docs.filter((d): d is LoadedDoc => !!d).map((d) => [d.meta.id, d])));
    });
    return () => {
      alive = false;
    };
  }, [key, version]);
  return map;
}

function emphasise(text: string, match: (w: string) => boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const t of tokensForHighlight(text)) {
    if (!match(t.word)) continue;
    if (t.start > last) out.push(text.slice(last, t.start));
    out.push(<b key={t.start}>{text.slice(t.start, t.end)}</b>);
    last = t.end;
  }
  out.push(text.slice(last));
  return out;
}

export function LocalAnswer({ answer, showTitles }: { answer: QaAnswer; showTitles?: boolean }) {
  const docs = useDocs([...answer.sentences.map((s) => s.docId), ...answer.related.map((r) => r.docId)]);
  const match = highlightMatcher(answer.matchedTerms);

  if (answer.kind === 'not_found') {
    return (
      <div className="answer answer-none">
        <p className="answer-msg">{answer.message}</p>
        {answer.related.length > 0 && (
          <p className="related">
            Nearest passages:{' '}
            {answer.related.map((r, i) => {
              const d = docs.get(r.docId);
              return d ? <CiteChip key={i} target={sentenceTarget(r.docId, d.analysis, d.blocks, r.sentence)} /> : null;
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="answer">
      <div className="answer-meta">
        {answer.kind === 'answer' ? (
          <span className={`conf conf-${answer.confidence}`} title="How much of the question the passages cover">
            <span className="conf-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {CONF_LABEL[answer.confidence]}
          </span>
        ) : (
          <span className="conf conf-high">Overview</span>
        )}
        <span className="answer-mode">Local · extractive · BM25</span>
      </div>
      {answer.shortAnswer && (
        <p className="short-answer">
          <span className="kicker">Short answer</span> {answer.shortAnswer}
        </p>
      )}
      {answer.message && answer.kind === 'answer' && <p className="answer-msg">{answer.message}</p>}
      <ul className="answer-sents">
        {answer.sentences.map((s) => {
          const d = docs.get(s.docId);
          const t = d ? sentenceTarget(s.docId, d.analysis, d.blocks, s.sentence) : null;
          if (t && showTitles && d) t.label = `${d.meta.title.length > 22 ? d.meta.title.slice(0, 21) + '…' : d.meta.title} · ${t.label}`;
          return (
            <li key={`${s.docId}:${s.sentence}`}>
              {emphasise(s.text, match)} <CiteChip target={t} />
            </li>
          );
        })}
      </ul>
      {answer.message && answer.kind === 'overview' && <p className="sub">{answer.message}</p>}
      {answer.related.length > 0 && (
        <p className="related">
          Also relevant:{' '}
          {answer.related.map((r, i) => {
            const d = docs.get(r.docId);
            return d ? <CiteChip key={i} target={sentenceTarget(r.docId, d.analysis, d.blocks, r.sentence)} /> : null;
          })}
        </p>
      )}
    </div>
  );
}
