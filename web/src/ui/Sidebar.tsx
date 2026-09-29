import { useState } from 'react';
import { app, createProject, deleteProject, INBOX, loadSample, navigate, renameProject, SAMPLES_PROJECT, setDialog, toggleTheme, useApp } from '../store/app';
import { Icon, Kbd, kindLabel, timeAgo } from './common';

export function Brand() {
  return (
    <a className="brand" href="#/" onClick={(e) => (e.preventDefault(), navigate({ name: 'home' }))} aria-label="AI Summary — home">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M7 4h13l6 6v18H7z" className="bm-page" />
        <path d="M20 4v6h6" className="bm-fold" />
        <path d="M11 15h11M11 19h8M11 23h10" className="bm-lines" />
        <path d="M9.5 18.6h11.5" className="bm-marker" />
      </svg>
      <span className="brand-name">
        AI Summary<span className="brand-v">v2</span>
      </span>
    </a>
  );
}

export function Sidebar({ onUpload }: { onUpload: () => void }) {
  const docs = useApp((s) => s.docs);
  const projects = useApp((s) => s.projects);
  const active = useApp((s) => s.activeProject);
  const route = useApp((s) => s.route);
  const theme = useApp((s) => s.theme);
  const persistent = useApp((s) => s.persistent);
  const drawer = useApp((s) => s.drawer);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const shown = active === 'all' ? docs : docs.filter((d) => d.projectId === active);
  const currentDoc = route.name === 'doc' ? route.docId : null;

  return (
    <aside className={`sidebar${drawer ? ' is-open' : ''}`} aria-label="Library">
      <div className="side-top">
        <Brand />
        <button type="button" className="icon-btn side-close" onClick={() => app.set({ drawer: false })} aria-label="Close library">
          <Icon name="close" />
        </button>
      </div>
      <div className="side-actions">
        <button type="button" className="btn btn-primary btn-block" onClick={onUpload}>
          <Icon name="upload" size={16} /> Add documents
        </button>
        <div className="row">
          <button type="button" className="btn btn-block btn-small" onClick={() => setDialog('paste')}>
            <Icon name="paste" size={15} /> Paste
          </button>
          <button type="button" className="btn btn-block btn-small" onClick={() => void loadSample()}>
            <Icon name="sparkle" size={15} /> Sample
          </button>
        </div>
        <button type="button" className="search-trigger" onClick={() => setDialog('search')}>
          <Icon name="search" size={15} />
          <span>Search library</span>
          <Kbd>/</Kbd>
        </button>
      </div>

      <nav className="side-projects" aria-label="Projects">
        <div className="side-label">
          <span>Projects</span>
          <button type="button" className="icon-btn icon-btn-small" onClick={() => setAdding(true)} aria-label="New project">
            <Icon name="plus" size={15} />
          </button>
        </div>
        <ul>
          <li>
            <button type="button" className={`proj${active === 'all' ? ' is-active' : ''}`} onClick={() => app.set({ activeProject: 'all' })}>
              <span>All documents</span>
              <span className="count">{docs.length}</span>
            </button>
          </li>
          {projects.map((p) => (
            <li key={p.id}>
              {editing === p.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = new FormData(e.currentTarget).get('name') as string;
                    void renameProject(p.id, v);
                    setEditing(null);
                  }}
                >
                  <input className="proj-input" name="name" defaultValue={p.name} aria-label="Project name" autoFocus onBlur={(e) => (void renameProject(p.id, e.target.value), setEditing(null))} />
                </form>
              ) : (
                <div className="proj-row">
                  <button type="button" className={`proj${active === p.id ? ' is-active' : ''}`} onClick={() => app.set({ activeProject: p.id })} onDoubleClick={() => p.id !== INBOX && p.id !== SAMPLES_PROJECT && setEditing(p.id)}>
                    <Icon name="folder" size={14} />
                    <span className="proj-name">{p.name}</span>
                    <span className="count">{docs.filter((d) => d.projectId === p.id).length}</span>
                  </button>
                  {p.id !== INBOX && p.id !== SAMPLES_PROJECT && active === p.id && (
                    <button type="button" className="icon-btn icon-btn-small" onClick={() => void deleteProject(p.id)} aria-label={`Delete project ${p.name}`} title="Delete project (documents move to My documents)">
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
          {adding && (
            <li>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = new FormData(e.currentTarget).get('name') as string;
                  void createProject(v);
                  setAdding(false);
                }}
              >
                <input className="proj-input" name="name" placeholder="Project name" aria-label="New project name" autoFocus onBlur={(e) => (e.target.value ? void createProject(e.target.value) : null, setAdding(false))} />
              </form>
            </li>
          )}
        </ul>
      </nav>

      <div className="side-docs">
        <div className="side-label">
          <span>{active === 'all' ? 'Recent' : projects.find((p) => p.id === active)?.name ?? 'Documents'}</span>
        </div>
        {shown.length === 0 ? (
          <p className="side-empty">{docs.length ? 'No documents in this project yet.' : 'Your library is empty. Add a file or try a sample.'}</p>
        ) : (
          <ul className="doc-list">
            {shown.map((d) => (
              <li key={d.id}>
                <a
                  href={`#/doc/${d.id}/brief`}
                  className={`doc-link${currentDoc === d.id ? ' is-active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate({ name: 'doc', docId: d.id, tab: 'brief' });
                  }}
                  aria-current={currentDoc === d.id ? 'page' : undefined}
                >
                  <span className="doc-kind">{kindLabel(d.kind)}</span>
                  <span className="doc-name">{d.title}</span>
                  <span className="doc-time">{timeAgo(d.createdAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="side-foot">
        <p className={`storage ${persistent ? '' : 'is-warn'}`}>
          <span className="dot" aria-hidden="true" />
          {persistent ? 'Saved in this browser only' : 'Storage blocked — nothing will be saved'}
        </p>
        <div className="row">
          <button type="button" className="icon-btn" onClick={() => setDialog('settings')} aria-label="Settings" title="Settings (,)">
            <Icon name="settings" />
          </button>
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Toggle theme (T)">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setDialog('shortcuts')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            <Icon name="keyboard" />
          </button>
        </div>
      </div>
    </aside>
  );
}
