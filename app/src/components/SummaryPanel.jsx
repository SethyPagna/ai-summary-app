import { useState } from 'react';
import { MarkdownRenderer } from '../lib/markdown.jsx';

export default function SummaryPanel({ documents, readability }) {
  const [activeTab, setActiveTab] = useState(0);

  const readyDocs = documents.filter((d) => d.summary);

  if (readyDocs.length === 0) {
    return (
      <div className="summary-panel">
        <div className="panel-header">
          <div className="panel-title">✦ Document Summaries</div>
        </div>
        <div className="panel-body">
          <div className="summary-empty">
            <div className="empty-icon">✦</div>
            <p>Upload documents above to see AI-generated summaries here.</p>
          </div>
        </div>
      </div>
    );
  }

  const pendingDocs = documents.filter((d) => !d.summary);
  const activeDoc = readyDocs[Math.min(activeTab, readyDocs.length - 1)];

  return (
    <div className="summary-panel">
      <div className="panel-header">
        <div className="panel-title">✦ Document Summaries</div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {readyDocs.length} / {documents.length} ready
        </span>
      </div>
      <div className="panel-body">
        {/* Tabs */}
        <div className="summary-tabs">
          {readyDocs.map((doc, i) => (
            <button
              key={doc.id}
              className={`summary-tab ${activeTab === i ? 'active' : ''}`}
              onClick={() => setActiveTab(i)}
              title={doc.name}
            >
              {doc.name.length > 18 ? doc.name.slice(0, 16) + '…' : doc.name}
            </button>
          ))}
        </div>

        {/* Pending skeletons */}
        {pendingDocs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {Array.from({ length: Math.min(4, 3) }).map((_, i) => (
              <div key={i} className="skeleton" style={{ width: `${[100, 85, 92, 70][i]}%` }} />
            ))}
          </div>
        )}

        {/* Active doc summary */}
        {activeDoc && (
          <div style={{ 
              maxHeight: '540px',  // Set a maximum height for the scrollable area
              overflowY: 'auto',    // Enable vertical scrolling
              overflowX: 'hidden',   // Hide horizontal scrolling if not needed
              padding: '40px',      // Optional padding
              border: '1px solid var(--border-color)',
              borderRadius: '4px'
            }}>
            <MarkdownRenderer
              content={activeDoc.summary}
              style={{
                fontSize: readability.fontSize,
                lineHeight: readability.lineHeight,
                letterSpacing: readability.letterSpacing,
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

