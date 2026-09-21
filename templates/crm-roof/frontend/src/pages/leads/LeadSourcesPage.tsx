import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useIsDark } from '../../shared';
import {
  Settings, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check,
  Mail, Webhook, Info
} from 'lucide-react';

interface LeadSource {
  id: string;
  platform: string;
  label: string;
  inboundEmail?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  enabled: boolean;
  config: Record<string, any>;
  createdAt: string;
}

const PLATFORMS = [
  {
    value: 'angi',
    label: 'Angi (Angie\'s List)',
    color: '#2e7d32',
    instructions: [
      'Log in to your Angi for Pros account',
      'Go to Settings > Lead Notifications > Email',
      'Set your notification email to the inbound address below',
      'Angi will forward all new lead emails to your CRM',
    ],
  },
  {
    value: 'homeadvisor',
    label: 'HomeAdvisor',
    color: '#e65100',
    instructions: [
      'Log in to your HomeAdvisor Pro account',
      'Go to My Account > Notification Preferences',
      'Add the inbound email address below as a notification recipient',
      'Enable "New Lead" email notifications',
    ],
  },
  {
    value: 'thumbtack',
    label: 'Thumbtack',
    color: '#1565c0',
    instructions: [
      'Log in to your Thumbtack Pro account',
      'Go to Settings > Notifications',
      'Add the inbound email below to receive lead notifications',
      'Alternatively, set up email forwarding from your registered email',
    ],
  },
  {
    value: 'google_lsa',
    label: 'Google Local Services',
    color: '#c62828',
    instructions: [
      'Google LSA leads arrive via phone calls and messages',
      'Set up email forwarding from your Google LSA notification email',
      'Forward all "New lead" emails to the inbound address below',
      'You can also use the webhook URL with a third-party integration (Zapier, Make)',
    ],
  },
  {
    value: 'houzz',
    label: 'Houzz',
    color: '#6a1b9a',
    instructions: [
      'Log in to your Houzz Pro account',
      'Go to Settings > Email Notifications',
      'Forward lead notification emails to the inbound address below',
      'Houzz does not support direct webhooks — email forwarding is recommended',
    ],
  },
];

// Like its sibling Lead Inbox, this page is painted entirely with inline styles, which no `dark:`
// variant can reach. See LeadInboxPage for the reasoning; the tokens are the same Tailwind values so
// the two pages stay in step.
//
// Two things here are deliberately NOT theme-aware, and both are pairs that carry their own ground:
// the platform table at the top of this file (a brand tint with matching ink) and the Active/Paused
// pill, which stays light in both themes exactly like the bg-green-100/text-green-700 badges used
// across the app. The pill's "Paused" ink did move — #999 on #f5f5f5 measured 2.61:1 and failed in
// light mode, so it is gray-600 (6.93:1) now.
const themeColors = (dark: boolean) => ({
  panel: dark ? '#0f172a' : '#fff',
  code: dark ? '#1e293b' : '#f5f5f5',
  tint: dark ? '#1e293b' : '#f8f9ff',
  tintBorder: dark ? '#334155' : '#e8ecff',
  border: dark ? '#334155' : '#e5e7eb',
  control: dark ? '#334155' : '#ddd',
  divider: dark ? '#1e293b' : '#f0f0f0',
  ink: dark ? '#f1f5f9' : '#111827',
  muted: dark ? '#94a3b8' : '#6b7280',
  // the enabled toggle sits on the panel, so it moves with it: #2e7d32 is 3.48:1 on slate-900
  ok: dark ? '#4ade80' : '#2e7d32',
  // the delete icon was red-500, which is 3.76:1 on white — it failed in light mode, not dark
  danger: dark ? '#f87171' : '#dc2626',
});

export default function LeadSourcesPage() {
  const { token } = useAuth();
  const c = themeColors(useIsDark());
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [copiedField, setCopiedField] = useState('');

  const fetchSources = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/leads/sources', { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    setSources(json.data || []);
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const addSource = async (platform: string) => {
    const info = PLATFORMS.find(p => p.value === platform);
    await fetch('/api/leads/sources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, label: info?.label || platform }),
    });
    setShowAdd(false);
    fetchSources();
  };

  const toggleSource = async (source: LeadSource) => {
    await fetch(`/api/leads/sources/${source.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    fetchSources();
  };

  const deleteSource = async (id: string) => {
    if (!confirm('Delete this lead source? Existing leads will be kept.')) return;
    await fetch(`/api/leads/sources/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchSources();
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 2000);
  };

  const connectedPlatforms = sources.map(s => s.platform);

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={24} /> Lead Sources
          </h1>
          <p style={{ color: c.muted, marginTop: 4, fontSize: 14 }}>Connect your lead platforms to receive leads automatically</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Plus size={16} /> Add Source
        </button>
      </div>

      {/* Add Source Modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: c.panel, borderRadius: 12, padding: 24, width: '100%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Add Lead Source</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PLATFORMS.filter(p => !connectedPlatforms.includes(p.value)).map(p => (
                <button
                  key={p.value}
                  onClick={() => addSource(p.value)}
                  style={{ padding: '14px 16px', border: `1px solid ${c.border}`, borderRadius: 8, background: c.panel, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, transition: 'border-color 0.15s' }}
                  onMouseOver={e => (e.currentTarget.style.borderColor = p.color)}
                  onMouseOut={e => (e.currentTarget.style.borderColor = '#e5e7eb')}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</span>
                </button>
              ))}
              {connectedPlatforms.length === PLATFORMS.length && (
                <p style={{ textAlign: 'center', color: c.muted, padding: 16, fontSize: 14 }}>All platforms connected!</p>
              )}
            </div>
            <button onClick={() => setShowAdd(false)} style={{ marginTop: 16, padding: '8px 20px', border: `1px solid ${c.control}`, borderRadius: 6, background: c.panel, cursor: 'pointer', width: '100%', fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Source List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: c.muted }}>Loading sources...</div>
      ) : sources.length === 0 ? (
        <div style={{ background: c.panel, borderRadius: 12, border: `1px solid ${c.border}`, padding: 40, textAlign: 'center' }}>
          <Settings size={48} style={{ marginBottom: 12, opacity: 0.3, color: c.muted }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>No lead sources configured</div>
          <div style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Click "Add Source" to connect your first platform</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sources.map(source => {
            const platformInfo = PLATFORMS.find(p => p.value === source.platform);
            const color = platformInfo?.color || '#666';

            return (
              <div key={source.id} style={{ background: c.panel, borderRadius: 12, border: `1px solid ${c.border}`, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${c.divider}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{source.label}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: source.enabled ? '#e8f5e9' : '#f5f5f5',
                      color: source.enabled ? '#2e7d32' : '#4b5563',
                    }}>
                      {source.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => toggleSource(source)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: source.enabled ? c.ok : c.muted }}>
                      {source.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                    <button onClick={() => deleteSource(source.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.danger }}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div style={{ padding: '16px 20px' }}>
                  {source.inboundEmail && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.muted, marginBottom: 6 }}>
                        <Mail size={14} /> Inbound Email Address
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, padding: '8px 12px', background: c.code, borderRadius: 6, fontSize: 13, fontFamily: 'monospace' }}>
                          {source.inboundEmail}
                        </code>
                        <button
                          onClick={() => copyToClipboard(source.inboundEmail!, `email-${source.id}`)}
                          style={{ padding: '8px', border: `1px solid ${c.control}`, borderRadius: 6, background: c.panel, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {copiedField === `email-${source.id}` ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {source.webhookUrl && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.muted, marginBottom: 6 }}>
                        <Webhook size={14} /> Webhook URL
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, padding: '8px 12px', background: c.code, borderRadius: 6, fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {source.webhookUrl}
                        </code>
                        <button
                          onClick={() => copyToClipboard(source.webhookUrl!, `webhook-${source.id}`)}
                          style={{ padding: '8px', border: `1px solid ${c.control}`, borderRadius: 6, background: c.panel, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {copiedField === `webhook-${source.id}` ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {source.webhookSecret && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.muted, marginBottom: 6 }}>
                        Webhook Secret
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, padding: '8px 12px', background: c.code, borderRadius: 6, fontSize: 13, fontFamily: 'monospace' }}>
                          {source.webhookSecret}
                        </code>
                        <button
                          onClick={() => copyToClipboard(source.webhookSecret!, `secret-${source.id}`)}
                          style={{ padding: '8px', border: `1px solid ${c.control}`, borderRadius: 6, background: c.panel, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {copiedField === `secret-${source.id}` ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {platformInfo?.instructions && (
                    <div style={{ background: c.tint, borderRadius: 8, padding: 14, border: `1px solid ${c.tintBorder}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: c.ink, marginBottom: 8 }}>
                        <Info size={14} /> Setup Instructions
                      </div>
                      <ol style={{ paddingLeft: 20, margin: 0, fontSize: 13, color: c.muted, lineHeight: 1.8 }}>
                        {platformInfo.instructions.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
