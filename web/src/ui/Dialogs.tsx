import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getKey, maskKey } from '../ai/client';
import { MODELS } from '../ai/models';
import { BM25, parseQuery } from '../engine/bm25';
import { terms } from '../engine/text';
import { anchorLabel } from '../engine/segment';
import { highlightMatcher, tokensForHighlight } from '../engine/qa';
import {
  deleteEverything,
  focusPassage,
  ingestPasted,
  loadAllDocs,
  saveKey,
  setDialog,
  setModel,
  setReaderScale,
  setSendPdf,
  toggleTheme,
  useApp,
  type LoadedDoc,
} from '../store/app';
import { Icon, Kbd, kindLabel, Spinner } from './common';

function Modal({ title, onClose, children, wide, labelledBy }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,select,button:not(.modal-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        // Keep focus inside the dialog.
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,textarea,select,[tabindex="0"]')];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          f[f.length - 1]!.focus();
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault();
          f[0]!.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  const id = labelledBy ?? 'modal-title';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-btn modal-x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const close = () => setDialog(null);
  if (dialog === 'settings') return <SettingsDialog onClose={close} />;
  if (dialog === 'shortcuts') return <ShortcutsDialog onClose={close} />;
  if (dialog === 'search') return <SearchDialog onClose={close} />;
  if (dialog === 'paste') return <PasteDialog onClose={close} />;
  if (dialog === 'delete-all') return <DeleteAllDialog onClose={close} />;
  return null;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const keySet = useApp((s) => s.keySet);
  const remembered = useApp((s) => s.keyRemembered);
  const model = useApp((s) => s.model);
  const sendPdf = useApp((s) => s.sendPdf);
  const theme = useApp((s) => s.theme);
  const scale = useApp((s) => s.readerScale);
  const persistent = useApp((s) => s.persistent);
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(remembered);
  const [show, setShow] = useState(false);
  const looksValid = /^sk-ant-[\w-]{10,}$/.test(draft.trim());

  return (
    <Modal title="Settings" onClose={onClose}>
      <section className="settings-section">
        <h3 className="kicker">
          <Icon name="sparkle" size={14} /> Claude mode · optional
        </h3>
        <p className="sub">
          Everything works without a key. Add your own Anthropic API key to unlock abstractive summaries, chat with citations, “explain like I’m new” and study guides.
          Requests go directly from this browser to api.anthropic.com.
        </p>
        {keySet ? (
          <div className="key-set">
            <p>
              <Icon name="check" size={15} /> Key active: <code>{maskKey(getKey())}</code> {remembered ? '· remembered on this device' : '· in memory for this tab only'}
            </p>
            <button type="button" className="btn btn-small" onClick={() => saveKey('', false)}>
              Remove key
            </button>
          </div>
        ) : (
          <form
            className="key-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              saveKey(draft, remember);
              setDraft('');
            }}
          >
            <label htmlFor="api-key">Anthropic API key</label>
            <div className="row">
              <input
                id="api-key"
                type={show ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-describedby="key-help"
              />
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setShow((v) => !v)} aria-pressed={show}>
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            <p id="key-help" className="sub">
              {draft && !looksValid ? 'That doesn’t look like an Anthropic key (they start with “sk-ant-”), but you can still try it.' : 'Get one at console.anthropic.com. Usage is billed to your account.'}
            </p>
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Remember on this device</span>
            </label>
            {remember && (
              <p className="warn" role="note">
                The key will be saved unencrypted in this browser’s local storage. Anyone with access to this browser profile — or a malicious extension — could read it. Only use
                this on a personal device; remove it here at any time.
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
              Use this key
            </button>
          </form>
        )}
        <fieldset className="models">
          <legend>Model</legend>
          {MODELS.map((m) => (
            <label key={m.id} className={`model${model === m.id ? ' is-on' : ''}`}>
              <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} />
              <span>
                <strong>{m.label}</strong>
                <small>
                  {m.blurb} · <code>{m.id}</code>
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={sendPdf} onChange={(e) => setSendPdf(e.target.checked)} />
          <span>Send original PDFs (up to 12 MB / 100 pages) so Claude sees layout, tables and figures; otherwise the extracted text is sent.</span>
        </label>
      </section>

      <section className="settings-section">
        <h3 className="kicker">Reading</h3>
        <div className="row wrap">
          <button type="button" className="btn btn-small" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /> {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <div className="seg seg-tight" role="group" aria-label="Source text size">
            <button type="button" onClick={() => setReaderScale(scale - 0.05)}>
              A−
            </button>
            <span className="seg-value">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => setReaderScale(scale + 0.05)}>
              A+
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="kicker">Your data</h3>
        <p className="sub">
          {persistent
            ? 'Documents, summaries, chats and study progress are stored in IndexedDB in this browser only. Nothing is uploaded.'
            : 'This browser blocked storage (private mode or a sandboxed frame), so your library lives in memory and disappears when you close the tab.'}
        </p>
        <button type="button" className="btn btn-danger btn-small" onClick={() => setDialog('delete-all')}>
          <Icon name="trash" size={15} /> Delete everything…
        </button>
      </section>
    </Modal>
  );
}

function DeleteAllDialog({ onClose }: { onClose: () => void }) {
  const count = useApp((s) => s.docs.length);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Delete everything?" onClose={onClose}>
      <p>
        This permanently removes {count} document{count === 1 ? '' : 's'}, their summaries, chats, notes, study progress and any remembered API key from this browser. It cannot be
        undone.
      </p>
      <div className="row modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await deleteEverything();
          }}
        >
          {busy ? 'Deleting…' : 'Delete everything'}
        </button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['/'], 'Search the library'],
  [['U'], 'Upload files'],
  [['P'], 'Paste text'],
  [['S'], 'Load a sample'],
  [['1', '–', '5'], 'Switch document tabs'],
  [['R'], 'Open the source (small screens)'],
  [['T'], 'Toggle light / dark'],
  [[','], 'Settings'],
  [['Esc'], 'Close dialogs, clear highlight'],
  [['Space'], 'Flip a flashcard'],
  [['G', '/', 'A'], 'Flashcard: got it / again'],
  [['A', '–', 'D'], 'Quiz: choose an answer'],
  [['?'], 'This list'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label}>
            <dt>{keys.map((k, i) => (k === '–' || k === '/' ? <span key={i}> {k} </span> : <Kbd key={i}>{k}</Kbd>))}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

function PasteDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Paste text" onClose={onClose} wide>
      <form
        className="paste-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const id = await ingestPasted(text, title);
          setBusy(false);
          if (id) onClose();
        }}
      >
        <label htmlFor="paste-title">Title (optional)</label>
        <input id="paste-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lecture 4 notes" />
        <label htmlFor="paste-text">Text or Markdown</label>
        <textarea id="paste-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an article, notes or a transcript…" />
        <div className="row modal-actions">
          <span className="sub">{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : ''}</span>
          <button type="submit" className="btn btn-primary" disabled={busy || text.trim().length < 40}>
            {busy ? 'Summarising…' : 'Add & summarise'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface SearchHit {
  doc: LoadedDoc;
  chunk: number;
  score: number;
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<LoadedDoc[] | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    let alive = true;
    loadAllDocs().then((d) => alive && setDocs(d));
    return () => {
      alive = false;
    };
  }, []);
  const index = useMemo(() => {
    if (!docs) return null;
    const units: { doc: LoadedDoc; chunk: number }[] = [];
    for (const d of docs) d.analysis.chunks.forEach((_, i) => units.push({ doc: d, chunk: i }));
    const bm = new BM25(units.map((u) => ({ terms: [...terms(u.doc.meta.title), ...terms(u.doc.analysis.chunks[u.chunk]!.heading), ...terms(u.doc.analysis.chunks[u.chunk]!.text)] })));
    return { bm, units };
  }, [docs]);
  const results: SearchHit[] = useMemo(() => {
    if (!index || q.trim().length < 2) return [];
    const query = parseQuery(q, index.bm);
    const hits = index.bm.search(query, 12);
    return hits.map((h) => ({ ...index.units[h.id]!, score: h.score }));
  }, [index, q]);
  const matcher = useMemo(() => highlightMatcher(parseQuery(q).filter((t) => t.source === 'query').map((t) => t.surface)), [q]);

  const open = (hit: SearchHit) => {
    const c = hit.doc.analysis.chunks[hit.chunk]!;
    const s = hit.doc.analysis.sentences[c.sentStart]!;
    const e = hit.doc.analysis.sentences[c.sentEnd - 1]!;
    const block = hit.doc.blocks.find((b) => b.id === s.blockId);
    onClose();
    focusPassage({
      docId: hit.doc.meta.id,
      ranges: s.blockId === e.blockId ? [{ blockId: s.blockId, start: s.start, end: e.end }] : [{ blockId: s.blockId, start: s.start, end: s.end }],
      label: anchorLabel(block?.anchor, 'passage'),
      quote: c.text.slice(0, 200),
    });
  };

  return (
    <Modal title="Search your library" onClose={onClose} wide>
      <div className="search-box">
        <Icon name="search" />
        <label htmlFor="search-input" className="sr-only">
          Search
        </label>
        <input
          id="search-input"
          type="search"
          value={q}
          placeholder="Search every document — words, phrases, names…"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter' && results[sel]) {
              e.preventDefault();
              open(results[sel]!);
            }
          }}
        />
      </div>
      {!docs ? (
        <Spinner label="Indexing library…" />
      ) : docs.length === 0 ? (
        <p className="sub">Your library is empty.</p>
      ) : q.trim().length < 2 ? (
        <p className="sub">
          Searching {docs.length} document{docs.length === 1 ? '' : 's'} with BM25. Use <Kbd>↑</Kbd> <Kbd>↓</Kbd> and <Kbd>Enter</Kbd>.
        </p>
      ) : results.length === 0 ? (
        <p className="sub">No matches for “{q}”.</p>
      ) : (
        <ul className="results" role="listbox" aria-label="Results">
          {results.map((r, i) => {
            const c = r.doc.analysis.chunks[r.chunk]!;
            const block = r.doc.blocks.find((b) => b.id === c.blockIds[0]);
            const snippet = c.text.length > 240 ? c.text.slice(0, 238) + '…' : c.text;
            let last = 0;
            const parts: ReactNode[] = [];
            for (const t of tokensForHighlight(snippet)) {
              if (!matcher(t.word)) continue;
              parts.push(snippet.slice(last, t.start), <b key={t.start}>{snippet.slice(t.start, t.end)}</b>);
              last = t.end;
            }
            parts.push(snippet.slice(last));
            return (
              <li key={`${r.doc.meta.id}:${r.chunk}`} role="option" aria-selected={i === sel}>
                <button type="button" className={`result${i === sel ? ' is-sel' : ''}`} onClick={() => open(r)} onMouseEnter={() => setSel(i)}>
                  <span className="kicker">
                    {kindLabel(r.doc.meta.kind)} · {r.doc.meta.title} · {anchorLabel(block?.anchor, '')}
                  </span>
                  <span className="result-text">{parts}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
