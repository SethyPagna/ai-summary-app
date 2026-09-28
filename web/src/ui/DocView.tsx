import { useEffect, useRef, useState } from 'react';
import { DOC_TABS, type DocTab } from '../store/store';
import { app, deleteDoc, moveDoc, navigate, renameDoc, toast, useApp, useDoc, type LoadedDoc } from '../store/app';
import { Icon, kindLabel, Spinner } from './common';
import { Reader } from './Reader';
import { BriefTab } from './BriefTab';
import { AskTab } from './AskTab';
import { StudyTab } from './StudyTab';
import { MapTab } from './MapTab';
import { CompareTab } from './CompareTab';
import { downloadText, exportMarkdown } from './export';

const TAB_LABELS: Record<DocTab, string> = { brief: 'Brief', ask: 'Ask', study: 'Study', map: 'Map', compare: 'Compare', source: 'Source' };

export function DocView({ docId, tab, other }: { docId: string; tab: DocTab; other?: string }) {
  const { data, error } = useDoc(docId);
  const readerOpen = useApp((s) => s.readerOpen);
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1080px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 1080px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // "source" is a pseudo-tab on narrow screens.
  const activeTab: DocTab = tab === 'source' ? (wide ? 'brief' : 'source') : tab;
  useEffect(() => {
    if (tab === 'source' && !wide) app.set({ readerOpen: true });
  }, [tab, wide]);

  if (error) {
    return (
      <div className="empty-state">
        <h2>Couldn’t open this document</h2>
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => navigate({ name: 'home' })}>
          Back to library
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="empty-state">
        <Spinner label="Opening document…" />
      </div>
    );
  }

  return (
    <div className="docview">
      <div className="doc-main">
        <DocHeader doc={data} />
        <nav className="tabs" role="tablist" aria-label="Document views">
          {DOC_TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`tab-${t}`}
              aria-selected={activeTab === t}
              aria-controls={`panel-${t}`}
              className="tab"
              onClick={() => navigate({ name: 'doc', docId, tab: t, other: t === 'compare' ? other : undefined })}
            >
              <span className="tab-n">0{i + 1}</span>
              {TAB_LABELS[t]}
            </button>
          ))}
          {!wide && (
            <button type="button" className="tab tab-source" onClick={() => app.set({ readerOpen: true })}>
              <Icon name="book" size={15} />
              Source
            </button>
          )}
        </nav>
        <div className="tab-panel" role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {activeTab === 'brief' || activeTab === 'source' ? <BriefTab doc={data} /> : null}
          {activeTab === 'ask' && <AskTab doc={data} />}
          {activeTab === 'study' && <StudyTab doc={data} />}
          {activeTab === 'map' && <MapTab doc={data} />}
          {activeTab === 'compare' && <CompareTab doc={data} other={other} />}
        </div>
      </div>
      {wide ? (
        <div className="doc-reader">
          <Reader doc={data} />
        </div>
      ) : (
        readerOpen && (
          <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && app.set({ readerOpen: false })}>
            <Reader doc={data} sheet />
          </div>
        )
      )}
    </div>
  );
}

function DocHeader({ doc }: { doc: LoadedDoc }) {
  const { meta, analysis } = doc;
  const projects = useApp((s) => s.projects);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) titleRef.current?.select();
  }, [editing]);
  const extent = meta.pages ? `${meta.pages} page${meta.pages > 1 ? 's' : ''}` : meta.slides ? `${meta.slides} slides` : `${analysis.stats.paragraphs} paragraphs`;

  return (
    <header className="doc-head">
      <p className="kicker doc-kicker">
        <span className="kind-tag">{kindLabel(meta.kind)}</span>
        <span>{extent}</span>
        <span>{analysis.stats.words.toLocaleString()} words</span>
        <span>{analysis.stats.readingMinutes} min read</span>
      </p>
      {editing ? (
        <form
          className="title-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void renameDoc(meta.id, titleRef.current?.value ?? meta.title);
            setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor="title-input">
            Document title
          </label>
          <input id="title-input" ref={titleRef} defaultValue={meta.title} onBlur={(e) => (void renameDoc(meta.id, e.target.value), setEditing(false))} />
        </form>
      ) : (
        <h1 className={`doc-title${meta.title.length > 64 ? ' is-long' : ''}`}>
          <button type="button" className="title-btn" onClick={() => setEditing(true)} title="Rename">
            {meta.title}
          </button>
        </h1>
      )}
      <div className="doc-actions">
        <label className="select-wrap">
          <Icon name="folder" size={15} />
          <span className="sr-only">Project</span>
          <select value={meta.projectId} onChange={(e) => void moveDoc(meta.id, e.target.value).then(() => toast('Moved.'))}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={async () => {
            const { filename, markdown } = await exportMarkdown(meta.id);
            downloadText(filename, markdown);
            toast('Exported as Markdown.', 'success');
          }}
        >
          <Icon name="download" size={15} /> Export .md
        </button>
        {confirmDelete ? (
          <span className="confirm-inline" role="alert">
            Delete this document?
            <button type="button" className="btn btn-danger btn-small" onClick={() => void deleteDoc(meta.id)}>
              Delete
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(true)} aria-label="Delete document">
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    </header>
  );
}
