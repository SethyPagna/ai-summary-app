import { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid'; // UUID library
import { supabase } from '../lib/supabase';
import {
  chatWithDocuments,
  generateFollowUps,
  STARTER_SUGGESTIONS,
  MODELS,
  DEFAULT_MODEL,
} from '../lib/ai';
import { useToast } from '../hooks/useToast';
import { MarkdownRenderer } from '../lib/markdown.jsx';

// ─── Save AI message with automatic role fallback ────────────────────────────
async function saveAiMessage(payload) {
  for (const role of ['model']) {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ ...payload, role })
      .select()
      .single();

    if (!error) return data;

    console.warn(`Error saving message with role ${role}:`, error);

    const isConstraint =
      error.code === '23514' ||
      (error.message || '').toLowerCase().includes('check constraint');

    if (!isConstraint) throw error;
  }
  throw new Error('Role value rejected by DB.');
}

export default function ChatPanel({ projectId, userId, userInitial, documents, readability, modelId: propModelId, onModelChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [modelId, setModelId] = useState(propModelId || DEFAULT_MODEL);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const messagesEndRef = useRef(null);
  const modelMenuRef = useRef(null);
  const toast = useToast();

  useEffect(() => { if (propModelId) setModelId(propModelId); }, [propModelId]);

  useEffect(() => {
    if (!projectId) return;
    setLoaded(false);
    setMessages([]);
    supabase
      .from('chat_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) setInlineError(`Could not load history: ${error.message}`);
        else if (data) setMessages(data);
        setLoaded(true);
      });
  }, [projectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, suggestions]);

  useEffect(() => {
    const h = (e) => { if (modelMenuRef.current && !modelMenuRef.current.contains(e.target)) setShowModelMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function switchModel(id) {
    setModelId(id);
    onModelChange?.(id);
    setShowModelMenu(false);
    setSuggestions([]);
    toast(`Switched to ${MODELS.find((m) => m.id === id)?.label}`, 'info');
  }

  const activeModel = MODELS.find((m) => m.id === modelId) || MODELS[0];

  const docsContext = documents
    .filter((d) => d.content)
    .map((d) => `--- ${d.name} ---\n${d.content?.slice(0, 3000)}`)
    .join('\n\n');

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    setInlineError('');

    if (!documents.length) {
      setInlineError('No documents yet — upload files on the Upload tab first.');
      return;
    }

    setSuggestions([]);
    setInput('');
    setLoading(true);

    const userMsg = {
      role: 'user',
      text: text.trim(),
      project_id: projectId,
      user_id: userId,
      id: uuidv4(),
    };

    try {
      // Add user message to state once
      setMessages((prev) => [...prev, userMsg]);

      const reply = await chatWithDocuments([...messages, userMsg], docsContext, modelId);

      const aiMsg = {
        text: reply,
        id: uuidv4(),
        project_id: projectId,
        user_id: userId,
      };

      setMessages((prev) => [
        ...prev,
        { ...aiMsg, role: 'model' },
      ]); // Add AI message only

      // Save user message
      await supabase.from('chat_messages').insert(userMsg);
      // Save AI message
      await saveAiMessage(aiMsg);

      // Handle suggestions
      setLoadingSuggestions(true);
      generateFollowUps(text.trim(), reply, modelId)
        .then((qs) => setSuggestions(qs))
        .catch(() => {})
        .finally(() => setLoadingSuggestions(false));

    } catch (err) {
      setInlineError(err.message || 'Request failed. Please try again.');
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id)); // Remove user message on error
    } finally {
      setLoading(false);
    }
  }, [loading, documents, messages, docsContext, modelId, projectId, userId]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="chat-panel" style={{ 
      border: '1px solid #ccc', 
      borderRadius: '8px', 
      padding: '10px', 
      height: '80vh', 
      maxHeight: '680px', 
      overflowY: 'auto' 
    }}>

      {/* Header + model switcher */}
      <div className="panel-header" style={{ flexShrink: 0, gap: 15 }}>
        <div className="panel-title">💬 Chat with Documents</div>

        <div ref={modelMenuRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button onClick={() => setShowModelMenu((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
              borderRadius: 8, border: '1.5px solid var(--accent)',
              background: showModelMenu ? 'var(--bg-secondary)' : 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 500,
              transition: 'all 0.15s', whiteSpace: 'nowrap',
            }}
          >
            {activeModel.badge} {activeModel.label}
            <span style={{ fontSize: 9, opacity: 0.5 }}> {showModelMenu ? '▲' : '▼'}</span>
          </button>

          {showModelMenu && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              background: 'var(--bg-card)', border: '1px solid var(--accent)',
              borderRadius: 12, boxShadow: 'var(--shadow-lg)',
              zIndex: 200, minWidth: 230, overflow: 'hidden',
            }}>
              <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                Select Model
              </div>
              {MODELS.map((m) => (
                <button key={m.id} onClick={() => switchModel(m.id)}
                  onMouseEnter={(e) => { if (modelId !== m.id) e.currentTarget.style.background = 'var(--border)'; }}
                  onMouseLeave={(e) => { if (modelId !== m.id) e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: modelId === m.id ? 'var(--border)' : 'transparent',
                    borderLeft: modelId === m.id ? '3px solid var(--border)' : '3px solid transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1.3 }}>{m.badge}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', color: modelId === m.id ? 'var(--border)' : 'var(--accent)' }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {m.provider} · {m.description}
                    </div>
                  </div>
                  {modelId === m.id && <span style={{ color: 'var(--border)', fontSize: 14 }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading && <span className="spinner" style={{ width: 14, height: 14, color: 'var(--accent)', flexShrink: 0 }} />}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {!loaded ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <span className="spinner" style={{ color: 'var(--accent)' }} />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>Loading chat history…</p>
          </div>
        ) : !hasMessages ? (
          <div className="chat-empty">
            <div className="empty-icon">💬</div>
            <p>Ask anything about your uploaded documents.</p>
            <p style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)' }}>Using {activeModel.badge} {activeModel.label}</p>
          </div>
        ) : messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role === 'user' ? 'user' : 'ai'}`}>
            <div className={`msg-avatar ${msg.role === 'user' ? 'user' : 'ai'}`} style={{ border: '1px solid #ccc', borderRadius: '50%', padding: '10px' }}>
              {msg.role === 'user' ? userInitial : activeModel.badge}
            </div>
            {msg.role === 'user' ? (
              <div className="msg-bubble" style={{ fontSize: readability.fontSize, lineHeight: readability.lineHeight, letterSpacing: readability.letterSpacing }}>
                {msg.text}
              </div>
            ) : (
              <div className="msg-bubble">
                <MarkdownRenderer content={msg.text} style={{ fontSize: readability.fontSize, lineHeight: readability.lineHeight, letterSpacing: readability.letterSpacing, color: 'var(--text-primary)' }} />
                {msg.id === messages.length - 1 && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                    {activeModel.badge} {activeModel.label}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-message ai"> 
            <div className="msg-avatar ai">{activeModel.badge} </div>
            <div className="msg-bubble" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{activeModel.label} is thinking…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      <div className="chat-suggestions">
        {!hasMessages && !loading && STARTER_SUGGESTIONS.slice(0, 6).map((s) => (
          <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>{s}</button>
        ))}
        {hasMessages && !loading && (suggestions.length > 0 || loadingSuggestions) && (
          <>
            <div style={{ width: '100%', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
              Follow-up suggestions
            </div>
            {loadingSuggestions && !suggestions.length ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="spinner" style={{ width: 10, height: 10, color: 'var(--accent)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Generating suggestions…</span>
              </div>
            ) : suggestions.map((s) => (
              <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)} style={{ borderColor: 'var(--accent-light)', color: 'var(--accent)' }}>{s}</button>
            ))}
          </>
        )}
      </div>

      {/* Inline Error */}
      {inlineError && (
        <div style={{
          margin: '0 12px 4px', padding: '7px 12px',
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 8, fontSize: 12, color: '#991b1b',
          display: 'flex', alignItems: 'flex-start', gap: 7, lineHeight: 1.5,
        }}>
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span style={{ flex: 1 }}>{inlineError}</span>
          <button onClick={() => setInlineError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: 0, opacity: 0.6 }}>✕</button>
        </div>
      )}

      {/* Input */}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          placeholder={`Ask ${activeModel.label}… (Enter to send, Shift+Enter for new line)`}
          value={input}
          onChange={(e) => { setInput(e.target.value); if (inlineError) setInlineError(''); }}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className="send-btn" onClick={() => sendMessage(input)} disabled={!input.trim() || loading} title="Send">↑</button>
      </div>
    </div>
  );
}