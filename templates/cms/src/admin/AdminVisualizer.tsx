import { useState, useEffect } from 'react';
import { getSiteSettings, saveSiteSettings } from './api';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function AdminVisualizer() {
  const [visionUrl, setVisionUrl] = useState<string>('');
  const [savedUrl, setSavedUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const settings = await getSiteSettings();
        const url = settings?.visionUrl || '';
        setVisionUrl(url);
        setSavedUrl(url);
      } catch {
        // Settings may not have visionUrl yet
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const settings = await getSiteSettings();
      await saveSiteSettings({ ...settings, visionUrl });
      setSavedUrl(visionUrl);
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1>Exterior Visualizer</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Exterior Visualizer</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
          AI-powered home visualization tool embedded on your website
        </p>
      </div>

      {!savedUrl ? (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, maxWidth: 600 }}>
          <h3 style={{ marginBottom: 8 }}>Configure Visualizer URL</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
            Enter your Exterior Visualizer deployment URL. If you don't have one yet, contact support to complete setup.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="url"
              value={visionUrl}
              onChange={e => setVisionUrl(e.target.value)}
              placeholder="https://your-visualizer.onrender.com"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }}
            />
            <button onClick={handleSave} disabled={saving || !visionUrl} className="admin-btn primary">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button
              onClick={() => { setVisionUrl(''); setSavedUrl(''); handleSave(); }}
              className="admin-btn"
              style={{ fontSize: 13 }}
            >
              Change URL
            </button>
            <a href={savedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>
              Open in new tab
            </a>
          </div>
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', height: 'calc(100vh - 220px)' }}>
            <iframe
              src={`${savedUrl}/embed?tenant=${window.location.hostname.split('.')[0]}`}
              style={{ width: '100%', height: '100%', border: 0 }}
              allow="camera"
              title="Exterior Visualizer"
            />
          </div>
        </>
      )}
    </div>
  );
}
