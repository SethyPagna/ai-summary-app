import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { supabase } from './lib/supabase';
import AuthPage from './components/AuthPage';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ProjectView from './components/ProjectView';
import FileHistory from './components/FileHistory';
import Settings from './components/Settings';
import NewProjectModal from './components/NewProjectModal';
import { useToast } from './hooks/useToast';

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('darkMode') === 'true'
  );
  const [readability, setReadability] = useState({
    fontSize: '16px',
    lineHeight: 1.7,
    letterSpacing: '0em',
  });

  const [projects, setProjects] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [activeView, setActiveView] = useState('home');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  // Apply dark mode
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  // Load user data
  useEffect(() => {
    if (!user) return;
    setDataLoading(true);

    Promise.all([
      supabase.from('projects').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('documents').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    ]).then(([{ data: proj }, { data: docs }]) => {
      if (proj) setProjects(proj);
      if (docs) setDocuments(docs);
      setDataLoading(false);
    });
  }, [user]);

  function handleNavigate(view, projectId = null) {
    setActiveView(view);
    if (projectId) setActiveProjectId(projectId);
    setSidebarOpen(false);
  }

  function handleProjectCreated(project) {
    setProjects((prev) => [project, ...prev]);
    setShowNewProject(false);
    setActiveProjectId(project.id);
    setActiveView('project');
    toast(`Navigated to "${project.name}"`, 'info');
  }

  function handleNewProject() {
    setShowNewProject(true);
  }

  const activeProject = projects.find((p) => p.id === activeProjectId);

  let pageTitle = 'Dashboard';
  if (activeView === 'project') pageTitle = activeProject?.name || 'Project';
  if (activeView === 'history') pageTitle = 'File History';
  if (activeView === 'settings') pageTitle = 'Settings';

  if (authLoading) {
    return (
      <div className="loading-page">
        <span className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPage
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
      />
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        user={user}
        projects={projects}
        activeView={activeView}
        activeProjectId={activeProjectId}
        onNavigate={handleNavigate}
        onNewProject={handleNewProject}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="main-content">
        {/* Topbar */}
        <header className="topbar" style={{ height: '50px' }}>
          <button
            className="icon-btn mobile-menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
            style={{ display: 'none' }}
          >
            ☰
          </button>
          <div className="topbar-title"></div>
          <div className="topbar-actions">
            <button
              className="icon-btn"
              onClick={() => setDarkMode((d) => !d)}
              title="Toggle dark mode"
            >
              {darkMode ? '☀' : '⏾'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleNewProject}
              style={{ width: 'auto' }}
            >
              + New Project
            </button>
          </div>
        </header>

        {/* Page body */}
        <main className="page-body">
          {dataLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <span className="spinner" style={{ width: 28, height: 28, color: 'var(--accent)' }} />
              <p style={{ color: 'var(--text-muted)', marginTop: 16, fontSize: 14 }}>
                Loading your workspace…
              </p>
            </div>
          ) : (
            <>
              {activeView === 'home' && (
                <Dashboard
                  user={user}
                  projects={projects}
                  documents={documents}
                  onNavigate={handleNavigate}
                  onNewProject={handleNewProject}
                />
              )}

              {activeView === 'project' && activeProject && (
                <ProjectView
                  project={activeProject}
                  userId={user.id}
                  readability={readability}
                />
              )}

              {activeView === 'project' && !activeProject && (
                <div className="empty-state">
                  <div className="empty-icon">◈</div>
                  <h3>Project not found</h3>
                  <p>This project may have been deleted.</p>
                  <br />
                  <button className="btn btn-primary" onClick={() => handleNavigate('home')} style={{ width: 'auto' }}>
                    Go to Dashboard
                  </button>
                </div>
              )}

              {activeView === 'history' && (
                <FileHistory
                  documents={documents}
                  projects={projects}
                  onNavigate={handleNavigate}
                />
              )}

              {activeView === 'settings' && (
                <Settings
                  darkMode={darkMode}
                  onToggleDark={() => setDarkMode((d) => !d)}
                  readability={readability}
                  onReadabilityChange={setReadability}
                />
              )}
            </>
          )}
        </main>
      </div>

      {showNewProject && (
        <NewProjectModal
          userId={user.id}
          onClose={() => setShowNewProject(false)}
          onCreated={handleProjectCreated}
        />
      )}
    </div>
  );
}
