const EXT_ICON = {
  pdf: '📄',
  docx: '📝',
  doc: '📝',
  pptx: '📊',
  ppt: '📊',
  txt: '📃',
};

export default function FileHistory({ documents, projects, onNavigate }) {
  const sorted = [...documents].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  function getExt(name) {
    return name?.split('.').pop().toLowerCase() || '';
  }

  if (sorted.length === 0) {
    return (
      <div>
        <div className="welcome-section">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>
            File History
          </h2>
          <p>All your uploaded documents across all projects.</p>
        </div>
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <h3>No files yet</h3>
          <p>Upload files in a project to see them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="welcome-section">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>
          File History
        </h2>
        <p>{sorted.length} document{sorted.length !== 1 ? 's' : ''} across all projects</p>
      </div>

      <div className="history-list">
        {sorted.map((doc) => {
          const project = projects.find((p) => p.id === doc.project_id);
          const ext = getExt(doc.name);
          return (
            <div
              key={doc.id}
              className="history-item"
              onClick={() => project && onNavigate('project', project.id)}
            >
              <div style={{ fontSize: 24 }}>{EXT_ICON[ext] || '📁'}</div>
              <div className="history-item-info">
                <div className="history-item-name">{doc.name}</div>
                <div className="history-item-meta">
                  <span>{project?.name || 'Unknown project'}</span>
                  <span style={{ margin: '0 6px' }}>·</span>
                  <span>{new Date(doc.created_at).toLocaleString()}</span>
                  {doc.summary && (
                    <>
                      <span style={{ margin: '0 6px' }}>·</span>
                      <span style={{ color: 'var(--success)' }}>AI summarized</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    padding: '2px 7px',
                    borderRadius: 6,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  {ext || '?'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
