import { dismissUploads, openDoc, useApp } from '../store/app';
import { formatBytes, Icon } from './common';

const STAGE: Record<string, string> = {
  queued: 'Waiting',
  reading: 'Reading file',
  extracting: 'Extracting text',
  analysing: 'Summarising',
  saving: 'Saving',
  done: 'Ready',
  error: 'Failed',
};

export function UploadTray() {
  const uploads = useApp((s) => s.uploads);
  if (!uploads.length) return null;
  const active = uploads.filter((u) => u.stage !== 'done' && u.stage !== 'error').length;
  return (
    <section className="tray" aria-label="Uploads" aria-live="polite">
      <div className="tray-head">
        <span className="kicker">{active ? `Processing ${active} file${active > 1 ? 's' : ''}` : 'Uploads'}</span>
        {!active && (
          <button type="button" className="icon-btn icon-btn-small" onClick={dismissUploads} aria-label="Dismiss uploads">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <ul>
        {uploads.map((u) => (
          <li key={u.id} className={`tray-item is-${u.stage}`}>
            <div className="tray-row">
              <span className="tray-name" title={u.name}>
                {u.name}
              </span>
              <span className="tray-size">{u.size ? formatBytes(u.size) : ''}</span>
            </div>
            <div className="bar" role="progressbar" aria-label={`${u.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
              <i style={{ width: `${Math.round(u.progress * 100)}%` }} />
            </div>
            <div className="tray-row">
              <span className="tray-stage">
                {u.stage === 'error' ? u.error : `${STAGE[u.stage]}${u.detail ? ` · ${u.detail}` : ''}`}
              </span>
              {u.stage === 'done' && u.docId && (
                <button type="button" className="link" onClick={() => openDoc(u.docId!)}>
                  Open
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
