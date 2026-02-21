import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';

export default function AuthPage({ darkMode, onToggleDark }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast('Welcome back!', 'success');
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
        if (error) throw error;
        toast('Account created! Please check your email to confirm.', 'success');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">
          <div className="auth-brand-icon">✦</div>
          <h1>AI Summary App</h1>
          <p>Intelligent document analysis & summarization</p>
        </div>

        <div className="auth-card">
          <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
          <p className="subtitle">
            {mode === 'login'
              ? 'Sign in to access your documents and projects'
              : 'Join to start summarizing your documents with AI'}
          </p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder={mode === 'signup' ? 'Min 6 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                Don't have an account?{' '}
                <button onClick={() => { setMode('signup'); setError(''); }}>Sign up</button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={() => { setMode('login'); setError(''); }}>Sign in</button>
              </>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onToggleDark}
            style={{ fontSize: 13 }}
          >
            {darkMode ? '☀ Light Mode' : '⏾ Dark Mode'}
          </button>
        </div>
      </div>
    </div>
  );
}
