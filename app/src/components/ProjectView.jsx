import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_MODEL, MODELS } from '../lib/ai';
import FileUpload from './FileUpload';
import SummaryPanel from './SummaryPanel';
import ChatPanel from './ChatPanel';

export default function ProjectView({ project, userId, readability }) {
  const [documents, setDocuments] = useState([]);
  const [activeTab, setActiveTab] = useState('upload');
  const [modelId, setModelId] = useState(
    () => localStorage.getItem('selected_model') || DEFAULT_MODEL
  );

  // Keep model in sync if changed from Settings
  useEffect(() => {
    function syncModel() {
      const stored = localStorage.getItem('selected_model') || DEFAULT_MODEL;
      setModelId(stored);
    }
    window.addEventListener('storage', syncModel);
    return () => window.removeEventListener('storage', syncModel);
  }, []);

  useEffect(() => {
    if (!project?.id) return;
    supabase
      .from('documents')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setDocuments(data);
      });
  }, [project?.id]);

  function handleDocumentAdded(doc) {
    setDocuments((prev) => {
      const exists = prev.find((d) => d.id === doc.id);
      if (exists) return prev.map((d) => (d.id === doc.id ? doc : d));
      return [doc, ...prev];
    });
  }

  const activeModel = MODELS.find((m) => m.id === modelId) || MODELS[0];
  const summaryCount = documents.filter((d) => d.summary).length || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Project header combined with tab buttons */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '9px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-light))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            //icon project
            fontSize: 20, color: 'white', flexShrink: 0, 
          }}>◈</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 1 }}>
              {documents.length} document{documents.length !== 1 ? 's' : ''}
              {' · '}Created {new Date(project.created_at).toLocaleDateString()}
            </div>
          </div>
          {/* Active model badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 20,
            background: 'var(--accent-bg)', border: '1px solid var(--accent-light)',
            fontSize: 12, color: 'var(--accent)', fontWeight: 500, flexShrink: 0,
          }}>
            {activeModel.badge} {activeModel.label}
          </div>
        </div>

        {/* Tab bar integrated into the header */}
        <div style={{
          display: 'flex', gap: 2, marginTop: 0,
          background: 'var(--bg-secondary)', borderRadius: 12, padding: 4,
          border: '1px solid var(--border)',
        }}>
          <button
            onClick={() => setActiveTab('upload')}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 9, border: 'none',
              background: activeTab === 'upload' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'upload' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.2s',
              boxShadow: activeTab === 'upload' ? 'var(--shadow-sm)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span>⬆</span> Upload
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 9, border: 'none',
              background: activeTab === 'summary' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'summary' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.2s',
              boxShadow: activeTab === 'summary' ? 'var(--shadow-sm)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span>✦</span> Summaries {summaryCount > 0 && (
              <span style={{
                background: 'var(--accent)', color: 'white',
                fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                marginLeft: 4,
              }}>{summaryCount}</span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 9, border: 'none',
              background: activeTab === 'chat' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'chat' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.2s',
              boxShadow: activeTab === 'chat' ? 'var(--shadow-sm)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span>💬</span> Chat
          </button>
        </div>
      </div>

      {/* 
        ── CRITICAL: All panels stay mounted, only visibility toggles.
           This prevents ChatPanel from losing its message state when switching tabs.
      */}
      <div style={{ display: activeTab === 'upload' ? 'block' : 'none' }}>
        <FileUpload
          projectId={project.id}
          userId={userId}
          onDocumentAdded={handleDocumentAdded}
          modelId={modelId}
        />
      </div>

      <div style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
        <SummaryPanel documents={documents} readability={readability} />
      </div>

      <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ChatPanel
          projectId={project.id}
          userId={userId}
          documents={documents}
          readability={readability}
          modelId={modelId}
          onModelChange={(id) => {
            setModelId(id);
            localStorage.setItem('selected_model', id);
          }}
        />
      </div>
    </div>
  );
}