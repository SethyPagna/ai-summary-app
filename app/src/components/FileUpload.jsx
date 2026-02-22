import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { extractTextFromFile, truncateText, FILE_LIMITS } from '../lib/extractor';
import { summarizeDocument } from '../lib/ai';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';

const FILE_ICONS = {
  pdf:  { icon: '📄', cls: 'file-type-pdf' },
  docx: { icon: '📝', cls: 'file-type-docx' },
  pptx: { icon: '📊', cls: 'file-type-pptx' },
  txt:  { icon: '📃', cls: 'file-type-txt' },
};

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getExt(name) {
  return name.split('.').pop().toLowerCase();
}

const STATUS_STEPS = {
  pending:     { label: 'Pending',      cls: 'status-pending',    progress: 0 },
  reading:     { label: 'Reading…',     cls: 'status-processing', progress: 20 },
  extracting:  { label: 'Extracting…',  cls: 'status-processing', progress: 45 },
  summarizing: { label: 'Summarizing…', cls: 'status-processing', progress: 75 },
  saving:      { label: 'Saving…',      cls: 'status-processing', progress: 90 },
  done:        { label: 'Done ✓',        cls: 'status-done',       progress: 100 },
  error:       { label: 'Error',         cls: 'status-error',      progress: 0 },
};

// export default function FileUpload({ projectId, userId, onDocumentAdded, modelId }) {
export default function FileUpload({ projectId, onDocumentAdded, modelId }) {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [showLimits, setShowLimits] = useState(false);
  const inputRef = useRef(null);
  const toast = useToast();
  const { user } = useAuth();

  const updateFile = useCallback((id, patch) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f))),
  []);

  const processFile = useCallback(async (entry) => {
    const { file, id } = entry;

    try {
      if (!user) {throw new Error("User not authenticated. Please refresh and log in again.");}
      updateFile(id, { status: 'reading' });
      await new Promise((r) => setTimeout(r, 80)); // let React paint

      updateFile(id, { status: 'extracting' });
      const text = await extractTextFromFile(file);
      const truncated = truncateText(text);

      updateFile(id, { status: 'summarizing' });
      const summary = await summarizeDocument(truncated, modelId);

      updateFile(id, { status: 'saving' });

      // Upload to Supabase storage
      // const storagePath = `${userId}/${projectId}/${Date.now()}_${file.name}`;
      // const { data: { user } } = await supabase.auth.getUser();
      const storagePath = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const { error: storageErr } = await supabase.storage
        .from('app-files')
        .upload(storagePath, file, { upsert: true });
      if (storageErr) {
        // Non-fatal — log but continue (storage might fail due to RLS but DB save is primary)
        console.warn('Storage upload warning:', storageErr.message);
      }

      // Save document record
      const { data: doc, error: dbErr } = await supabase
        .from('documents')
        // .insert({ project_id: projectId, user_id: userId, name: file.name, content: truncated, summary })
        .insert({
          project_id: projectId,
          user_id: user.id,
          name: file.name,
          content: truncated,
          summary
        })
        .select()
        .single();

      if (dbErr) throw new Error(`Database error: ${dbErr.message}`);

      updateFile(id, { status: 'done', summary, docId: doc.id });
      toast(`"${file.name}" summarized successfully`, 'success');
      onDocumentAdded?.(doc);

    } catch (err) {
      const msg = err.message || 'Unknown error occurred';
      updateFile(id, { status: 'error', errorMsg: msg });
      // Don't toast — error is shown inline under the file row
    }
  }, [projectId, modelId, onDocumentAdded, toast, updateFile]);

  function addFiles(rawFiles) {
    const entries = Array.from(rawFiles).map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      name: file.name,
      size: file.size,
      ext: getExt(file.name),
      status: 'pending',
      errorMsg: null,
    }));
    setFiles((prev) => [...prev, ...entries]);
    entries.forEach(processFile);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function retryFile(entry) {
    updateFile(entry.id, { status: 'pending', errorMsg: null });
    processFile(entry);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Upload zone */}
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="upload-icon">⬆</div>
        <div className="upload-title">Drop files here or click to browse</div>
        <div className="upload-subtitle">Multiple files supported — all processed simultaneously</div>
        <div className="upload-types">
          {FILE_LIMITS.supportedTypes.map((t) => (
            <span key={t} className="type-badge">.{t}</span>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          Max size per file: <strong style={{ color: 'var(--text-secondary)' }}>{FILE_LIMITS.maxSizeMB} MB</strong>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.txt"
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* File limits info toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => setShowLimits((v) => !v)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--accent)', fontSize: 13, fontFamily: 'var(--font-body)',
            display: 'flex', alignItems: 'center', gap: 5, padding: 0,
          }}
        >
          <span style={{ fontSize: 15 }}>{showLimits ? '▾' : '▸'}</span>
          Upload limits & notes
        </button>
      </div>

      {showLimits && (
        <div style={{
          background: 'var(--accent-bg)',
          border: '1px solid var(--accent-light)',
          borderRadius: 12,
          padding: '14px 18px',
          fontSize: 13,
          color: 'var(--text-secondary)',
          animation: 'fadeIn 0.15s ease',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 8, fontSize: 13 }}>
            📋 Upload Limits & Supported Formats
          </div>
          <ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5, listStyle: 'disc' }}>
            {FILE_LIMITS.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="file-list">
          {files.map((f) => {
            const typeInfo = FILE_ICONS[f.ext] || { icon: '📁', cls: 'file-type-default' };
            const step = STATUS_STEPS[f.status] || STATUS_STEPS.pending;
            const isActive = ['reading','extracting','summarizing','saving'].includes(f.status);

            return (
              <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div className="file-item" style={{ borderRadius: f.errorMsg ? '12px 12px 0 0' : 12, borderBottom: f.errorMsg ? 'none' : undefined }}>
                  <div className={`file-type-icon ${typeInfo.cls}`}>{typeInfo.icon}</div>
                  <div className="file-info">
                    <div className="file-name">{f.name}</div>
                    <div className="file-size">
                      {formatBytes(f.size)}
                      {f.status === 'done' && (
                        <span style={{ color: 'var(--success)', marginLeft: 8 }}>✓ Summarized</span>
                      )}
                    </div>
                    {isActive && (
                      <div className="progress-bar" style={{ marginTop: 5 }}>
                        <div className="progress-fill" style={{ width: step.progress + '%', transition: 'width 0.4s ease' }} />
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`file-status ${step.cls}`}>
                      {isActive && <span className="spinner" style={{ width: 10, height: 10, marginRight: 4 }} />}
                      {step.label}
                    </span>

                    {f.status === 'error' && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => retryFile(f)}
                        title="Retry"
                        style={{ padding: '4px 8px', fontSize: 12 }}
                      >
                        ↻ Retry
                      </button>
                    )}

                    {(f.status === 'done' || f.status === 'error') && (
                      <button className="file-remove" onClick={() => removeFile(f.id)} title="Remove">✕</button>
                    )}
                  </div>
                </div>

                {/* Inline error — shown directly under the file row */}
                {f.status === 'error' && f.errorMsg && (
                  <div style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderTop: 'none',
                    borderRadius: '0 0 12px 12px',
                    padding: '10px 16px',
                    fontSize: 12,
                    color: '#991b1b',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    lineHeight: 1.5,
                  }}>
                    <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
                    <span>{f.errorMsg}</span>
                  </div>
                )}
                {f.status === 'error' && f.errorMsg && (
                  <style>{`[data-theme="dark"] .dark-err { background: #2a1414 !important; border-color: #5a2020 !important; color: #f87171 !important; }`}</style>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
