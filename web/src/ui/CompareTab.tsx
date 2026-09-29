import { useEffect, useMemo, useState } from 'react';
import { compareDocs } from '../engine/compare';
import type { Chunk } from '../engine/types';
import { anchorLabel } from '../engine/segment';
import { SAMPLES } from '../samples/manifest';
import { loadDoc, loadSample, navigate, setKeyphrase, useApp, type LoadedDoc } from '../store/app';
import { CiteChip, Icon, Spinner } from './common';
import type { CitationTarget } from '../ai/citations';

function chunkTarget(doc: LoadedDoc, c: Chunk): CitationTarget {
  const first = doc.analysis.sentences[c.sentStart];
  const last = doc.analysis.sentences[c.sentEnd - 1];
  const ranges =
    first && last && first.blockId === last.blockId
      ? [{ blockId: first.blockId, start: first.start, end: last.end }]
      : c.blockIds.map((id) => {
          const b = doc.blocks.find((x) => x.id === id);
          return { blockId: id, start: 0, end: b?.text.length ?? 0 };
        });
  const block = doc.blocks.find((b) => b.id === c.blockIds[0]);
  return { docId: doc.meta.id, label: anchorLabel(block?.anchor, 'passage'), quote: c.text.slice(0, 240), ranges };
}

export function CompareTab({ doc, other }: { doc: LoadedDoc; other?: string }) {
  const docs = useApp((s) => s.docs);
  const candidates = docs.filter((d) => d.id !== doc.meta.id);
  // Default to the most related document (shared key-phrase stems).
  const mostSimilar = useMemo(() => {
    const mine = new Set(doc.analysis.keyphrases.flatMap((k) => k.key.split(' ')));
    let best: string | undefined;
    let bestScore = -1;
    for (const d of candidates) {
      const theirs = new Set(d.phraseKeys.flatMap((k) => k.split(' ')));
      let inter = 0;
      for (const t of theirs) if (mine.has(t)) inter++;
      const score = inter / Math.max(1, mine.size + theirs.size - inter);
      if (score > bestScore) {
        bestScore = score;
        best = d.id;
      }
    }
    return best;
  }, [candidates, doc.analysis.keyphrases]);
  const otherId = other && candidates.some((d) => d.id === other) ? other : mostSimilar;
  const [B, setB] = useState<LoadedDoc | null>(null);

  useEffect(() => {
    let alive = true;
    setB(null);
    if (otherId) loadDoc(otherId).then((d) => alive && setB(d));
    return () => {
      alive = false;
    };
  }, [otherId]);

  const cmp = useMemo(() => (B ? compareDocs(doc.analysis, B.analysis) : null), [doc, B]);

  if (!candidates.length) {
    const missing = SAMPLES.filter((s) => !docs.some((d) => d.sample === s.id));
    return (
      <div className="empty-panel">
        <h2 className="h-section">Compare needs a second document</h2>
        <p className="sub">Add another file, or load a sample to compare against. The study and the sprint notes share a theme.</p>
        <div className="row wrap">
          {missing.map((s) => (
            <button key={s.id} type="button" className="btn" onClick={() => void loadSample(s.id).then(() => navigate({ name: 'doc', docId: doc.meta.id, tab: 'compare' }))}>
              Load “{s.title}”
            </button>
          ))}
        </div>
      </div>
    );
  }

  const pct = cmp ? Math.round(cmp.similarity * 100) : 0;
  return (
    <div className="compare">
      <div className="compare-pick">
        <span className="kicker">Compare with</span>
        <label className="select-wrap grow">
          <span className="sr-only">Second document</span>
          <select value={otherId} onChange={(e) => navigate({ name: 'doc', docId: doc.meta.id, tab: 'compare', other: e.target.value })}>
            {candidates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!B || !cmp ? (
        <Spinner label="Comparing…" />
      ) : (
        <>
          <div className="similarity">
            <div className="sim-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Vocabulary similarity">
              <i style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <p>
              <strong>{pct}% vocabulary overlap</strong>{' '}
              <span className="sub">
                (TF-IDF cosine of the two documents’ terms) —{' '}
                {pct >= 45 ? 'closely related.' : pct >= 20 ? 'related in places.' : pct >= 8 ? 'loosely related.' : 'mostly different topics.'}
              </span>
            </p>
          </div>

          <div className="venn">
            <div>
              <h3 className="kicker">Only in “{clip(doc.meta.title)}”</h3>
              <ul className="tags">
                {cmp.onlyA.map((k) => (
                  <li key={k.key}>
                    <button type="button" className="chip chip-small" onClick={() => setKeyphrase(k.phrase)}>
                      {k.phrase}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="venn-shared">
              <h3 className="kicker">Shared</h3>
              {cmp.shared.length ? (
                <ul className="tags">
                  {cmp.shared.map((s) => (
                    <li key={s.a.key}>
                      <button type="button" className="chip chip-small chip-accent" onClick={() => setKeyphrase(s.a.phrase)}>
                        {s.a.phrase}
                        {s.b.phrase.toLowerCase() !== s.a.phrase.toLowerCase() && <span className="dim"> ~ {s.b.phrase}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sub">No key phrases in common.</p>
              )}
            </div>
            <div>
              <h3 className="kicker">Only in “{clip(B.meta.title)}”</h3>
              <ul className="tags">
                {cmp.onlyB.map((k) => (
                  <li key={k.key}>
                    <span className="chip chip-small chip-static">{k.phrase}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <h2 className="h-section">Most similar passages</h2>
          {cmp.passages.length ? (
            <ol className="pairs">
              {cmp.passages.map((p) => {
                const ca = doc.analysis.chunks[p.a]!;
                const cb = B.analysis.chunks[p.b]!;
                return (
                  <li key={`${p.a}-${p.b}`} className="pair">
                    <div className="pair-score">{Math.round(p.similarity * 100)}%</div>
                    <blockquote>
                      <span className="kicker">{clip(doc.meta.title, 30)}</span>
                      <p>{excerpt(ca.text)}</p>
                      <CiteChip target={chunkTarget(doc, ca)} />
                    </blockquote>
                    <blockquote>
                      <span className="kicker">{clip(B.meta.title, 30)}</span>
                      <p>{excerpt(cb.text)}</p>
                      <CiteChip target={chunkTarget(B, cb)} />
                    </blockquote>
                    {p.shared.length > 0 && <p className="pair-terms">Shared terms: {p.shared.join(', ')}</p>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="sub">No passages are meaningfully similar.</p>
          )}
          <p className="sub">
            <Icon name="info" size={13} /> Clicking a passage from the other document opens it in the reader.
          </p>
        </>
      )}
    </div>
  );
}

function clip(s: string, n = 34) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function excerpt(s: string) {
  return s.length > 280 ? s.slice(0, 278).replace(/\s+\S*$/, '') + '…' : s;
}
