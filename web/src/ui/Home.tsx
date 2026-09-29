import { useState } from 'react';
import { SAMPLES } from '../samples/manifest';
import { loadSample, navigate, setDialog, useApp } from '../store/app';
import { Icon, kindLabel, timeAgo } from './common';

export function Home({ onUpload, onFiles }: { onUpload: () => void; onFiles: (files: File[]) => void }) {
  const docs = useApp((s) => s.docs);
  const uploads = useApp((s) => s.uploads);
  const [over, setOver] = useState(false);
  const loadingSample = uploads.some((u) => u.stage !== 'done' && u.stage !== 'error');

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker hero-kicker">No account · no server · your files stay in this browser</p>
          <h1 className="hero-title">
            Read less.
            <br />
            <em>Understand more.</em>
          </h1>
          <p className="lede">
            AI Summary turns PDFs, Word files, slide decks and notes into a brief you can check: summaries, key phrases, answers and study cards —
            each linked to the exact passage it came from. It runs entirely on your device; Claude is an optional upgrade with your own key.
          </p>
          <div className="row wrap hero-cta">
            <button type="button" className="btn btn-accent btn-large" onClick={() => void loadSample()} disabled={loadingSample}>
              Try a sample <Icon name="arrow" size={16} />
            </button>
            <button type="button" className="btn btn-large" onClick={onUpload}>
              <Icon name="upload" size={16} /> Upload files
            </button>
            <button type="button" className="btn btn-ghost btn-large" onClick={() => setDialog('paste')}>
              <Icon name="paste" size={16} /> Paste text
            </button>
          </div>
        </div>
        <figure className="specimen" aria-label="Example of a cited answer">
          <div className="spec-head">
            <span className="kicker">Ask · local</span>
            <span className="conf conf-high">
              <span className="conf-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Strong match
            </span>
          </div>
          <p className="spec-q">When does the Tonlé Sap reverse?</p>
          <p className="spec-a">
            From around June, the monsoon rains and snowmelt from the Tibetan Plateau raise the Mekong so high that it pushes water up the Tonlé Sap River instead, and the flow reverses.{' '}
            <span className="cite cite-static">§ How the reversal works</span>
          </p>
          <div className="spec-source">
            <span className="kicker">Source</span>
            <p>
              …For most of the year, water drains from the lake down the river and into the Mekong. <mark className="hl-cite">From around June, the monsoon rains and snowmelt from the Tibetan Plateau raise the Mekong so high that it pushes water up the Tonlé Sap River instead, and the flow reverses.</mark>
            </p>
          </div>
          <figcaption>Every answer is built from sentences in your document, with a link to where each one came from.</figcaption>
        </figure>
      </section>

      <section
        className={`dropzone${over ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const files = [...e.dataTransfer.files];
          if (files.length) onFiles(files);
        }}
      >
        <Icon name="upload" size={26} />
        <p>
          <strong>Drop files here</strong> or{' '}
          <button type="button" className="link-strong" onClick={onUpload}>
            browse
          </button>
        </p>
        <p className="sub">PDF · DOCX · PPTX · TXT · Markdown · HTML — up to 25 MB each, several at once</p>
      </section>

      {docs.length > 0 && (
        <section className="recent" aria-labelledby="recent-h">
          <h2 id="recent-h" className="h-section">
            Continue reading
          </h2>
          <ul className="recent-list">
            {docs.slice(0, 6).map((d) => (
              <li key={d.id}>
                <button type="button" className="recent-card" onClick={() => navigate({ name: 'doc', docId: d.id, tab: 'brief' })}>
                  <span className="kicker">
                    {kindLabel(d.kind)} · {d.readingMinutes} min · {timeAgo(d.createdAt)}
                  </span>
                  <span className="recent-title">{d.title}</span>
                  <span className="recent-tldr">{d.tldr}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="samples-h">
        <h2 id="samples-h" className="h-section">
          Start with a sample
        </h2>
        <p className="sub">Three original documents bundled with the app. One click shows the summary, key phrases and a cited answer.</p>
        <ul className="samples">
          {SAMPLES.map((s, i) => {
            const loaded = docs.find((d) => d.sample === s.id);
            return (
              <li key={s.id}>
                <button type="button" className={`sample-card sample-${s.kind}`} onClick={() => void loadSample(s.id)} disabled={loadingSample}>
                  <span className="sample-n">0{i + 1}</span>
                  <span className="kicker">{s.label}</span>
                  <span className="sample-title">{s.title}</span>
                  <span className="sample-blurb">{s.blurb}</span>
                  <span className="sample-go">
                    {loaded ? 'Open' : 'Load & summarise'} <Icon name="arrow" size={14} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="how" aria-labelledby="how-h">
        <h2 id="how-h" className="h-section">
          How it works
        </h2>
        <ol className="how-list">
          <li>
            <span className="how-n">1</span>
            <h3>Extract</h3>
            <p>PDF pages, Word headings, slide titles and speaker notes are parsed in your browser (pdf.js, mammoth, JSZip) on background threads, keeping page and section anchors.</p>
          </li>
          <li>
            <span className="how-n">2</span>
            <h3>Distill</h3>
            <p>TextRank ranks sentences, MMR keeps the summary varied, RAKE-style scoring finds key phrases, and BM25 retrieves passages to answer questions — deterministic and instant.</p>
          </li>
          <li>
            <span className="how-n">3</span>
            <h3>Study</h3>
            <p>Cloze flashcards with spaced review, a scored quiz, a mind map and document comparison — all generated locally and saved on this device.</p>
          </li>
        </ol>
        <p className="privacy">
          <Icon name="lock" size={15} /> Your documents are stored in IndexedDB in this browser and never uploaded. If you add a Claude API key, requests go straight from your browser to
          api.anthropic.com — there is no middle server.
        </p>
      </section>
    </div>
  );
}
