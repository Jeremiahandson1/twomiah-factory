import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Settings, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check,
  ExternalLink, Mail, Webhook, Info
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

export default function LeadSourcesPage() {
  const { token } = useAuth();
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [copiedField, setCopiedField] = useState('');

  const fetchSources = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/leads/sources', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { setLoading(false); return; }
    const json = await res.json();
    setSources(json.data || []);
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const addSource = async (platform: string) => {
    try {
      const info = PLATFORMS.find(p => p.value === platform);
      await fetch('/api/leads/sources', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, label: info?.label || platform }),
      });
      setShowAdd(false);
      setSelectedPlatform('');
      fetchSources();
    } catch (e) {
      console.error('addSource failed:', e);
    }
  };

  const toggleSource = async (source: LeadSource) => {
    try {
      await fetch(`/api/leads/sources/${source.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      fetchSources();
    } catch (e) {
      console.error('toggleSource failed:', e);
    }
  };

  const deleteSource = async (id: string) => {
    if (!confirm('Delete this lead source? Existing leads will be kept.')) return;
    try {
      await fetch(`/api/leads/sources/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchSources();
    } catch (e) {
      console.error('deleteSource failed:', e);
    }
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
          <p style={{ color: '#666', marginTop: 4, fontSize: 14 }}>Connect your lead platforms to receive leads automatically</p>
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
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Add Lead Source</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PLATFORMS.filter(p => !connectedPlatforms.includes(p.value)).map(p => (
                <button
                  key={p.value}
                  onClick={() => addSource(p.value)}
                  style={{ padding: '14px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, transition: 'border-color 0.15s' }}
                  onMouseOver={e => (e.currentTarget.style.borderColor = p.color)}
                  onMouseOut={e => (e.currentTarget.style.borderColor = '#e5e7eb')}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</span>
                </button>
              ))}
              {connectedPlatforms.length === PLATFORMS.length && (
                <p style={{ textAlign: 'center', color: '#999', padding: 16, fontSize: 14 }}>All platforms connected!</p>
              )}
            </div>
            <button onClick={() => setShowAdd(false)} style={{ marginTop: 16, padding: '8px 20px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', width: '100%', fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Source List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading sources...</div>
      ) : sources.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 40, textAlign: 'center' }}>
          <Settings size={48} style={{ marginBottom: 12, opacity: 0.3, color: '#999' }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>No lead sources configured</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Click "Add Source" to connect your first platform</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sources.map(source => {
            const platformInfo = PLATFORMS.find(p => p.value === source.platform);
            const color = platformInfo?.color || '#666';

            return (
              <div key={source.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{source.label}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: source.enabled ? '#e8f5e9' : '#f5f5f5',
                      color: source.enabled ? '#2e7d32' : '#999',
                    }}>
                      {source.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => toggleSource(source)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: source.enabled ? '#2e7d32' : '#999' }}>
                      {source.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                    <button onClick={() => deleteSource(source.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {/* Connection Details */}
                <div style={{ padding: '16px 20px' }}>
                  {/* Inbound Email */}
                  {source.inboundEmail && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666', marginBottom: 6 }}>
                        <Mail size={14} /> Inbound Email Address
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontSize: 13, fontFamily: 'monospace' }}>
                          {source.inboundEmail}
                        </code>
                        <button
                          onClick={() => copyToClipboard(source.inboundEmail!, `email-${source.id}`)}
                          style={{ padding: '8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {copiedField === `email-${source.id}` ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Webhook URL */}
                  {source.webhookUrl && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666', marginBottom: 6 }}>
                        <Webhook size={14} /> Webhook URL
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {source.webhookUrl}
                        </code>
                        <button
                          onClick={() => copyToClipboard(source.webhookUrl!, `webhook-${source.id}`)}
                          style={{ padding: '8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {copiedField === `webhook-${source.id}` ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Webhook Secret */}
                  {source.webhookSecret && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666', marginBottom: 6 }}>
                        Webhook Secret
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontSize: 13, fontFamily: 'monospace' }}>
                          {source.webhookSecret}
                        </code>
                        <button
                          onClick={() => copyToClipboard(source.webhookSecret!, `secret-${source.id}`)}
                          style={{ padding: '8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {copiedField === `secret-${source.id}` ? <Check size={14} color="#2e7d32" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Setup Instructions */}
                  {platformInfo?.instructions && (
                    <div style={{ background: '#f8f9ff', borderRadius: 8, padding: 14, border: '1px solid #e8ecff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
                        <Info size={14} /> Setup Instructions
                      </div>
                      <ol style={{ paddingLeft: 20, margin: 0, fontSize: 13, color: '#555', lineHeight: 1.8 }}>
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
