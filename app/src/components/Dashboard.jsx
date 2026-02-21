export default function Dashboard({ user, projects, documents, onNavigate, onNewProject }) {
  const userName = user?.user_metadata?.full_name?.split(' ')[0] || 'there';

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  const totalDocs = documents.length;
  const totalSummaries = documents.filter((d) => d.summary).length;

  const projectIcons = ['◈', '◉', '◎', '◍', '◌', '●'];

  return (
    <div>
      <div className="welcome-section">
        <h2>Good {getGreeting()}, {userName} 👋</h2>
        <p>Here's an overview of your AI-powered document workspace.</p>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon">◈</div>
          <div className="stat-value">{projects.length}</div>
          <div className="stat-label">Projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📄</div>
          <div className="stat-value">{totalDocs}</div>
          <div className="stat-label">Documents</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✦</div>
          <div className="stat-value">{totalSummaries}</div>
          <div className="stat-label">Summaries</div>
        </div>
      </div>

      <div className="section-header">
        <div className="section-title">Recent Projects</div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onNewProject}
        >
          + New Project
        </button>
      </div>

      <div className="projects-grid">
        {/* New project card */}
        <div className="project-card new-project-card" onClick={onNewProject}>
          <div style={{ fontSize: 28 }}>+</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>New Project</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Start organizing</div>
        </div>

        {recentProjects.map((project, i) => {
          const docCount = documents.filter((d) => d.project_id === project.id).length;
          return (
            <div
              key={project.id}
              className="project-card"
              onClick={() => onNavigate('project', project.id)}
            >
              <div className="project-icon">{projectIcons[i % projectIcons.length]}</div>
              <div className="project-name">{project.name}</div>
              <div className="project-meta">
                {docCount} document{docCount !== 1 ? 's' : ''}
                {' · '}
                {new Date(project.created_at).toLocaleDateString()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent documents */}
      {documents.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 8 }}>
            <div className="section-title">Recent Documents</div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onNavigate('history')}
            >
              View all
            </button>
          </div>
          <div className="history-list">
            {[...documents]
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .slice(0, 4)
              .map((doc) => {
                const project = projects.find((p) => p.id === doc.project_id);
                return (
                  <div
                    key={doc.id}
                    className="history-item"
                    onClick={() => project && onNavigate('project', project.id)}
                  >
                    <div style={{ fontSize: 22 }}>📄</div>
                    <div className="history-item-info">
                      <div className="history-item-name">{doc.name}</div>
                      <div className="history-item-meta">
                        {project?.name || 'Unknown project'}
                        {' · '}
                        {new Date(doc.created_at).toLocaleDateString()}
                        {doc.summary && ' · Summarized'}
                      </div>
                    </div>
                    {doc.summary && (
                      <span style={{ fontSize: 12, color: 'var(--success)' }}>✓</span>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      )}

      {projects.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <h3>Create your first project</h3>
          <p>Organize your documents into projects and let AI summarize them instantly.</p>
          <br />
          <button className="btn btn-primary" onClick={onNewProject} style={{ width: 'auto' }}>
            + Create Project
          </button>
        </div>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
