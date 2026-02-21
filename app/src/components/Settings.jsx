import { useState } from 'react';
import { MODELS, DEFAULT_MODEL } from '../lib/ai';

export default function Settings({ darkMode, onToggleDark, readability, onReadabilityChange }) {
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('selected_model') || DEFAULT_MODEL
  );

  function handleRange(key, value) {
    onReadabilityChange({ ...readability, [key]: value });
  }

  function handleModelSelect(id) {
    setSelectedModel(id);
    localStorage.setItem('selected_model', id);
  }

  return (
    <div>
      <div className="welcome-section">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>
          Settings
        </h2>
        <p>Customize your AI models, appearance, and reading experience.</p>
      </div>

      {/* AI Model Selection */}
      <div className="settings-section">
        <div className="settings-section-title">AI Model</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, marginTop: -8 }}>
          Choose which model powers your summaries and chat. You can also switch mid-conversation in the chat panel.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MODELS.map((m) => {
            const active = selectedModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleModelSelect(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 18px',
                  border: active ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                  borderRadius: 12,
                  background: active ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  width: '100%',
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: active ? 'var(--border)' : 'var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, flexShrink: 0, transition: 'background 0.2s',
                }}>
                  {m.badge}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,
                    color: active ? 'var(--accent)' : 'var(--text-primary)',
                    //Name of model
                  }}>
                    {m.label}
                    {/* //provider name */}
                    <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                      by {m.provider}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {m.description}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                    {m.id}
                  </div>
                </div>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
                  background: active ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all 0.2s',
                }}>
                  {active && <span style={{ color: 'white', fontSize: 11, fontWeight: 700 }}>✓</span>}
                </div>
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
          Powered by{' '}
          <a href="https://openrouter.ai" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            OpenRouter.ai
          </a>
        </p>
      </div>

      {/* Appearance */}
      <div className="settings-section">
        <div className="settings-section-title">Appearance</div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Dark Mode</div>
            <div className="setting-desc">Switch between light and dark themes</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={darkMode} onChange={onToggleDark} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* Readability */}
      <div className="settings-section">
        <div className="settings-section-title">Readability</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, marginTop: -8 }}>
          Adjust font size, line height, and letter spacing in summaries and chat.
        </p>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Font Size</div>
            <div className="setting-desc">Text size in summaries and chat</div>
          </div>
          <div className="range-control">
            <input
              type="range" min={12} max={22} step={1}
              value={parseInt(readability.fontSize)}
              onChange={(e) => handleRange('fontSize', e.target.value + 'px')}
            />
            <span className="range-value">{readability.fontSize}</span>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Line Height</div>
            <div className="setting-desc">Space between lines</div>
          </div>
          <div className="range-control">
            <input
              type="range" min={1.2} max={2.4} step={0.1}
              value={parseFloat(readability.lineHeight)}
              onChange={(e) => handleRange('lineHeight', parseFloat(e.target.value))}
            />
            <span className="range-value">{parseFloat(readability.lineHeight).toFixed(1)}</span>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Letter Spacing</div>
            <div className="setting-desc">Space between characters</div>
          </div>
          <div className="range-control">
            <input
              type="range" min={-0.02} max={0.1} step={0.01}
              value={parseFloat(readability.letterSpacing)}
              onChange={(e) => handleRange('letterSpacing', parseFloat(e.target.value) + 'em')}
            />
            <span className="range-value">{readability.letterSpacing}</span>
          </div>
        </div>
      </div>

      {/* Live Preview */}
      <div className="settings-section">
        <div className="settings-section-title">Preview</div>
        <div style={{
          fontSize: readability.fontSize,
          lineHeight: readability.lineHeight,
          letterSpacing: readability.letterSpacing,
          color: 'var(--text-primary)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 20,
        }}>
          This is how your summaries and chat messages will look. The AI Summary App extracts
          key insights from PDFs, Word docs, and PowerPoint files using the selected model.
          Adjust the sliders above to find your perfect reading experience.
        </div>
      </div>

      {/* About */}
      <div className="settings-section">
        <div className="settings-section-title">About</div>
        <div className="setting-row">
          <div className="setting-info"><div className="setting-label">Version</div></div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>1.0.0</span>
        </div>
        <div className="setting-row">
          <div className="setting-info"><div className="setting-label">Supported Files</div></div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>PDF, DOCX, DOC, PPTX, PPT, TXT</span>
        </div>
        <div className="setting-row">
          <div className="setting-info"><div className="setting-label">AI Provider</div></div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>OpenRouter.ai</span>
        </div>
        <div className="setting-row">
          <div className="setting-info"><div className="setting-label">Storage</div></div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Supabase (app-files)</span>
        </div>
      </div>
    </div>
  );
}
