import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';

export default function NewProjectModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;

    if (!user) {
      toast('You must be logged in to create a project.', 'error');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          name: name.trim(),
          user_id: user.id
        })
        .select()
        .single();

      if (error) throw error;

      toast(`Project "${name}" created!`, 'success');
      onCreated(data);
    } catch (err) {
      toast('Failed to create project: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">New Project</h2>
        <p className="modal-subtitle">
          Create a new project to organize your documents and chats.
        </p>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label>Project Name</label>
            <input
              type="text"
              placeholder="e.g. Q4 Reports, Research Notes…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? <span className="spinner" /> : null}
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
