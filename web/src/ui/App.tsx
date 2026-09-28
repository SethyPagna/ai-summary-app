import { useEffect, useRef, useState } from 'react';
import { DOC_TABS } from '../store/store';
import { ACCEPT, app, ingestFiles, loadSample, navigate, setDialog, toggleTheme, useApp } from '../store/app';
import { Brand, Sidebar } from './Sidebar';
import { Home } from './Home';
import { DocView } from './DocView';
import { Dialogs } from './Dialogs';
import { UploadTray } from './UploadTray';
import { Icon, Spinner } from './common';

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function App() {
  const ready = useApp((s) => s.ready);
  const route = useApp((s) => s.route);
  const dialog = useApp((s) => s.dialog);
  const toast = useApp((s) => s.toast);
  const drawer = useApp((s) => s.drawer);
  const persistent = useApp((s) => s.persistent);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const openPicker = () => fileRef.current?.click();

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDialog('search');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (e.key === 'Escape') {
        if (app.get().readerOpen) app.set({ readerOpen: false });
        else if (app.get().drawer) app.set({ drawer: false });
        else app.set({ focus: null, keyphrase: null });
        return;
      }
      if (app.get().dialog) return;
      const r = app.get().route;
      switch (e.key) {
        case '/':
          e.preventDefault();
          setDialog('search');
          break;
        case 'u':
          openPicker();
          break;
        case 'p':
          setDialog('paste');
          break;
        case 's':
          void loadSample();
          break;
        case 't':
          toggleTheme();
          break;
        case ',':
          setDialog('settings');
          break;
        case '?':
          setDialog('shortcuts');
          break;
        case 'r':
          if (r.name === 'doc') app.set({ readerOpen: !app.get().readerOpen });
          break;
        default:
          if (r.name === 'doc' && /^[1-5]$/.test(e.key)) {
            navigate({ name: 'doc', docId: r.docId, tab: DOC_TABS[Number(e.key) - 1]! });
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drag-and-drop anywhere on the page.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void ingestFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // Close the mobile drawer when the route changes; move focus to main content.
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route.name, route.name === 'doc' ? route.docId : '']);

  return (
    <div className={`shell${dialog ? ' has-dialog' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Sidebar onUpload={openPicker} />
      {drawer && <div className="drawer-backdrop" onClick={() => app.set({ drawer: false })} />}
      <div className="main-wrap">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => app.set({ drawer: true })} aria-label="Open library">
            <Icon name="menu" />
          </button>
          <Brand />
          <div className="row">
            <button type="button" className="icon-btn" onClick={() => setDialog('search')} aria-label="Search">
              <Icon name="search" />
            </button>
            <button type="button" className="icon-btn" onClick={() => setDialog('settings')} aria-label="Settings">
              <Icon name="settings" />
            </button>
          </div>
        </header>
        {!persistent && ready && (
          <p className="banner" role="status">
            This browser blocked storage, so your library won’t be saved after you close the tab.
          </p>
        )}
        <main id="main" tabIndex={-1} className="main">
          {!ready ? (
            <div className="empty-state">
              <Spinner label="Opening your library…" />
            </div>
          ) : route.name === 'doc' ? (
            <DocView key={route.docId} docId={route.docId} tab={route.tab} other={route.other} />
          ) : (
            <Home onUpload={openPicker} onFiles={(f) => void ingestFiles(f)} />
          )}
        </main>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void ingestFiles(files);
        }}
        data-testid="file-input"
      />
      <UploadTray />
      <Dialogs />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div>
            <Icon name="upload" size={34} />
            <p>Drop to add to your library</p>
            <span>PDF · DOCX · PPTX · TXT · MD · HTML</span>
          </div>
        </div>
      )}
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
