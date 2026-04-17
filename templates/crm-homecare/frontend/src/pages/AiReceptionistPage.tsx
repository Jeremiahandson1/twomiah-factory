/**
 * AI Receptionist Page — Care Agency tier
 * Config + call log view for the AI voice receptionist.
 * Uses inline styles to match AdminDashboard pattern (no Tailwind in Care CRM).
 */
import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

export default function AiReceptionistPage() {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const token = localStorage.getItem('token');
      const h = { Authorization: `Bearer ${token}` };
      const [cfgRes, callsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/ai-receptionist/config`, { headers: h }).then((r) => r.json()).catch(() => null),
        fetch(`${API_BASE_URL}/api/ai-receptionist/calls`, { headers: h }).then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      if (cfgRes) { setEnabled(!!cfgRes.enabled); setGreeting(cfgRes.greeting || ''); }
      setCalls(Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_BASE_URL}/api/ai-receptionist/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled, greeting }),
      });
      load();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#6B7280' }}>Loading...</div>;

  const card: React.CSSProperties = { background: '#fff', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '1.5rem', marginBottom: '1.5rem' };
  const label: React.CSSProperties = { display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.375rem' };
  const btn: React.CSSProperties = { padding: '0.5rem 1.25rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 };
  const primaryBtn: React.CSSProperties = { ...btn, background: 'var(--color-primary, #0D9488)', color: '#fff' };
  const th: React.CSSProperties = { textAlign: 'left' as const, padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' as const, color: '#6B7280', borderBottom: '1px solid #E5E7EB' };
  const td: React.CSSProperties = { padding: '0.75rem 1rem', fontSize: '0.875rem', borderBottom: '1px solid #F3F4F6' };

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          🤖 AI Receptionist
        </h2>
        <p style={{ color: '#6B7280', fontSize: '0.875rem', marginTop: '0.25rem' }}>Automated voice receptionist for after-hours, overflow, and intake</p>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '1rem' }}>Enable AI Receptionist</div>
            <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>Answer calls automatically when you can't</div>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            style={{
              position: 'relative', width: '48px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer',
              background: enabled ? 'var(--color-primary, #0D9488)' : '#D1D5DB', transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: '3px', left: enabled ? '25px' : '3px', width: '20px', height: '20px',
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>

        <div>
          <label style={label}>Greeting</label>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={3}
            placeholder="Thank you for calling [Agency]. How can we help?"
            style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '0.625rem 0.75rem', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <button onClick={save} disabled={saving} style={{ ...primaryBtn, marginTop: '0.75rem', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.75rem' }}>Recent Calls</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={th}>From</th><th style={th}>Duration</th><th style={th}>Outcome</th><th style={th}>Time</th></tr>
          </thead>
          <tbody>
            {calls.length === 0 ? (
              <tr><td colSpan={4} style={{ ...td, textAlign: 'center', padding: '2rem 1rem', color: '#9CA3AF' }}>No calls logged yet.</td></tr>
            ) : calls.map((c: any) => (
              <tr key={c.id}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.fromNumber || c.from_number || c.caller || '—'}</td>
                <td style={td}>{c.duration || 0}s</td>
                <td style={td}>{c.outcome || c.status || '—'}</td>
                <td style={{ ...td, color: '#6B7280' }}>{c.createdAt || c.created_at ? new Date(c.createdAt || c.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
