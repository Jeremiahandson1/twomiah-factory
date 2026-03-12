import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/AIReceptionist.tsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';

interface Rule {
  id: number;
  name: string;
  trigger: string;
  channel: string;
  keywords: string;
  delay_minutes: number;
  message_template: string;
  active: boolean;
}

interface Call {
  id: number;
  call_type: string;
  caller_number: string;
  duration_seconds: number;
  ai_summary: string;
  created_at: string;
}

interface Settings {
  enabled: boolean;
  business_hours_start: string;
  business_hours_end: string;
  timezone: string;
  greeting_text: string;
  forwarding_number: string;
}

const defaultSettings: Settings = {
  enabled: false,
  business_hours_start: '09:00',
  business_hours_end: '17:00',
  timezone: 'America/New_York',
  greeting_text: '',
  forwarding_number: '',
};

const defaultRule: Omit<Rule, 'id'> = {
  name: '',
  trigger: 'missed_call',
  channel: 'sms',
  keywords: '',
  delay_minutes: 5,
  message_template: '',
  active: true,
};

const AIReceptionist = () => {
  const { token } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('rules');
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [ruleForm, setRuleForm] = useState(defaultRule);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    loadRules();
    loadSettings();
    loadCalls();
  }, []);

  const loadRules = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai-receptionist/rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai-receptionist/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...defaultSettings, ...data });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadCalls = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/calltracking/calls`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCalls(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load calls:', error);
    }
  };

  const saveRule = async () => {
    try {
      const url = editingRule
        ? `${API_BASE_URL}/api/ai-receptionist/rules/${editingRule.id}`
        : `${API_BASE_URL}/api/ai-receptionist/rules`;
      const res = await fetch(url, {
        method: editingRule ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(ruleForm),
      });
      if (res.ok) {
        toast.success(editingRule ? 'Rule updated' : 'Rule created');
        setShowRuleModal(false);
        setEditingRule(null);
        setRuleForm(defaultRule);
        loadRules();
      } else {
        toast.error('Failed to save rule');
      }
    } catch (error) {
      toast.error('Failed to save rule');
    }
  };

  const deleteRule = async (id: number) => {
    const ok = await confirm('Delete this rule?');
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai-receptionist/rules/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success('Rule deleted');
        loadRules();
      }
    } catch (error) {
      toast.error('Failed to delete rule');
    }
  };

  const toggleRule = async (rule: Rule) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai-receptionist/rules/${rule.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...rule, active: !rule.active }),
      });
      if (res.ok) {
        toast.success(rule.active ? 'Rule disabled' : 'Rule enabled');
        loadRules();
      }
    } catch (error) {
      toast.error('Failed to toggle rule');
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai-receptionist/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        toast.success('Settings saved');
      } else {
        toast.error('Failed to save settings');
      }
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const openEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setRuleForm({
      name: rule.name,
      trigger: rule.trigger,
      channel: rule.channel,
      keywords: rule.keywords || '',
      delay_minutes: rule.delay_minutes,
      message_template: rule.message_template,
      active: rule.active,
    });
    setShowRuleModal(true);
  };

  const openNewRule = () => {
    setEditingRule(null);
    setRuleForm(defaultRule);
    setShowRuleModal(true);
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString();
  };

  const callTypeIcon = (type: string) => {
    switch (type) {
      case 'inbound': return '📞';
      case 'outbound': return '📲';
      case 'missed': return '❌';
      case 'voicemail': return '📩';
      default: return '📞';
    }
  };

  const activeRules = rules.filter(r => r.active);

  // Styles
  const cardStyle: React.CSSProperties = {
    background: '#1e293b',
    borderRadius: '12px',
    padding: '1.25rem',
    border: '1px solid #334155',
  };

  const statCardStyle: React.CSSProperties = {
    ...cardStyle,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  };

  const statLabel: React.CSSProperties = {
    fontSize: '0.78rem',
    color: '#94a3b8',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  const statValue: React.CSSProperties = {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#f1f5f9',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1.25rem',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.875rem',
    background: active ? '#3b82f6' : '#334155',
    color: active ? '#fff' : '#94a3b8',
    transition: 'all 0.15s',
  });

  const btnPrimary: React.CSSProperties = {
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.85rem',
    background: '#3b82f6',
    color: '#fff',
  };

  const btnDanger: React.CSSProperties = {
    padding: '0.35rem 0.75rem',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.78rem',
    background: '#ef4444',
    color: '#fff',
  };

  const btnSecondary: React.CSSProperties = {
    padding: '0.35rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid #475569',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.78rem',
    background: 'transparent',
    color: '#cbd5e1',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #475569',
    background: '#1e293b',
    color: '#f1f5f9',
    fontSize: '0.875rem',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#94a3b8',
    marginBottom: '0.35rem',
    display: 'block',
  };

  const thStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #334155',
  };

  const tdStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    color: '#e2e8f0',
    borderBottom: '1px solid #1e293b',
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: '#94a3b8', textAlign: 'center' }}>
        Loading AI Receptionist...
      </div>
    );
  }

  return (
    <div style={{ color: '#f1f5f9' }}>
      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={statCardStyle}>
          <span style={statLabel}>Status</span>
          <span style={{ ...statValue, color: settings.enabled ? '#22c55e' : '#ef4444', fontSize: '1.1rem' }}>
            {settings.enabled ? '🟢 Active' : '🔴 Inactive'}
          </span>
        </div>
        <div style={statCardStyle}>
          <span style={statLabel}>Auto-Reply Rules</span>
          <span style={statValue}>{rules.length}</span>
        </div>
        <div style={statCardStyle}>
          <span style={statLabel}>Active Rules</span>
          <span style={statValue}>{activeRules.length}</span>
        </div>
        <div style={statCardStyle}>
          <span style={statLabel}>Recent Calls</span>
          <span style={statValue}>{calls.length}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button style={tabStyle(activeTab === 'rules')} onClick={() => setActiveTab('rules')}>Rules</button>
        <button style={tabStyle(activeTab === 'calls')} onClick={() => setActiveTab('calls')}>Call Log</button>
        <button style={tabStyle(activeTab === 'settings')} onClick={() => setActiveTab('settings')}>Settings</button>
      </div>

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Auto-Reply Rules</h3>
            <button style={btnPrimary} onClick={openNewRule}>+ New Rule</button>
          </div>

          {rules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🤖</div>
              <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No rules yet</p>
              <p style={{ fontSize: '0.85rem' }}>Create an auto-reply rule to get started.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Trigger</th>
                    <th style={thStyle}>Channel</th>
                    <th style={thStyle}>Delay</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(rule => (
                    <tr key={rule.id}>
                      <td style={tdStyle}>{rule.name}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#334155', fontSize: '0.78rem' }}>
                          {rule.trigger}
                        </span>
                      </td>
                      <td style={tdStyle}>{rule.channel}</td>
                      <td style={tdStyle}>{rule.delay_minutes}m</td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => toggleRule(rule)}
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '12px',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            background: rule.active ? '#166534' : '#44403c',
                            color: rule.active ? '#86efac' : '#a8a29e',
                          }}
                        >
                          {rule.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button style={btnSecondary} onClick={() => openEditRule(rule)}>Edit</button>
                          <button style={btnDanger} onClick={() => deleteRule(rule.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Call Log Tab */}
      {activeTab === 'calls' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Call Log</h3>
            <button style={btnSecondary} onClick={loadCalls}>Refresh</button>
          </div>

          {calls.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📞</div>
              <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No calls recorded</p>
              <p style={{ fontSize: '0.85rem' }}>Call data will appear here once the AI receptionist is active.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Number</th>
                    <th style={thStyle}>Duration</th>
                    <th style={thStyle}>AI Summary</th>
                    <th style={thStyle}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map(call => (
                    <tr key={call.id}>
                      <td style={tdStyle}>
                        <span title={call.call_type}>{callTypeIcon(call.call_type)} {call.call_type}</span>
                      </td>
                      <td style={tdStyle}>{call.caller_number || '—'}</td>
                      <td style={tdStyle}>{formatDuration(call.duration_seconds)}</td>
                      <td style={{ ...tdStyle, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {call.ai_summary || '—'}
                      </td>
                      <td style={tdStyle}>{formatTime(call.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', fontWeight: 700 }}>AI Receptionist Settings</h3>

          <div style={{ display: 'grid', gap: '1.25rem', maxWidth: '600px' }}>
            {/* Enable / Disable */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label style={{ ...labelStyle, margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={e => setSettings(s => ({ ...s, enabled: e.target.checked }))}
                  style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }}
                />
                Enable AI Receptionist
              </label>
            </div>

            {/* Business Hours */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Business Hours Start</label>
                <input
                  type="time"
                  value={settings.business_hours_start}
                  onChange={e => setSettings(s => ({ ...s, business_hours_start: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Business Hours End</label>
                <input
                  type="time"
                  value={settings.business_hours_end}
                  onChange={e => setSettings(s => ({ ...s, business_hours_end: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Timezone */}
            <div>
              <label style={labelStyle}>Timezone</label>
              <select
                value={settings.timezone}
                onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}
                style={inputStyle}
              >
                <option value="America/New_York">Eastern (America/New_York)</option>
                <option value="America/Chicago">Central (America/Chicago)</option>
                <option value="America/Denver">Mountain (America/Denver)</option>
                <option value="America/Los_Angeles">Pacific (America/Los_Angeles)</option>
                <option value="America/Anchorage">Alaska (America/Anchorage)</option>
                <option value="Pacific/Honolulu">Hawaii (Pacific/Honolulu)</option>
              </select>
            </div>

            {/* Greeting */}
            <div>
              <label style={labelStyle}>Greeting Text</label>
              <textarea
                value={settings.greeting_text}
                onChange={e => setSettings(s => ({ ...s, greeting_text: e.target.value }))}
                placeholder="Hello! Thank you for calling. How can I help you today?"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            {/* Forwarding Number */}
            <div>
              <label style={labelStyle}>Forwarding Number</label>
              <input
                type="tel"
                value={settings.forwarding_number}
                onChange={e => setSettings(s => ({ ...s, forwarding_number: e.target.value }))}
                placeholder="+1 (555) 123-4567"
                style={inputStyle}
              />
            </div>

            <div>
              <button style={{ ...btnPrimary, padding: '0.65rem 1.5rem' }} onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rule Modal */}
      {showRuleModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setShowRuleModal(false)}
        >
          <div
            style={{
              background: '#0f172a',
              borderRadius: '16px',
              border: '1px solid #334155',
              padding: '1.75rem',
              width: '100%',
              maxWidth: '520px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1.25rem 0', fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>
              {editingRule ? 'Edit Rule' : 'New Auto-Reply Rule'}
            </h3>

            <div style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Rule Name</label>
                <input
                  value={ruleForm.name}
                  onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Missed call auto-reply"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Trigger</label>
                <select
                  value={ruleForm.trigger}
                  onChange={e => setRuleForm(f => ({ ...f, trigger: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="missed_call">Missed Call</option>
                  <option value="voicemail">Voicemail</option>
                  <option value="after_hours">After Hours</option>
                  <option value="keyword">Keyword Match</option>
                  <option value="all_calls">All Calls</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Channel</label>
                <select
                  value={ruleForm.channel}
                  onChange={e => setRuleForm(f => ({ ...f, channel: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="both">Both</option>
                </select>
              </div>

              {ruleForm.trigger === 'keyword' && (
                <div>
                  <label style={labelStyle}>Keywords (comma-separated)</label>
                  <input
                    value={ruleForm.keywords}
                    onChange={e => setRuleForm(f => ({ ...f, keywords: e.target.value }))}
                    placeholder="e.g., pricing, appointment, emergency"
                    style={inputStyle}
                  />
                </div>
              )}

              <div>
                <label style={labelStyle}>Delay (minutes)</label>
                <input
                  type="number"
                  min={0}
                  value={ruleForm.delay_minutes}
                  onChange={e => setRuleForm(f => ({ ...f, delay_minutes: parseInt(e.target.value) || 0 }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Message Template</label>
                <textarea
                  value={ruleForm.message_template}
                  onChange={e => setRuleForm(f => ({ ...f, message_template: e.target.value }))}
                  placeholder="Hi! We noticed we missed your call. How can we help?"
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="rule-active"
                  checked={ruleForm.active}
                  onChange={e => setRuleForm(f => ({ ...f, active: e.target.checked }))}
                  style={{ width: '16px', height: '16px', accentColor: '#3b82f6' }}
                />
                <label htmlFor="rule-active" style={{ fontSize: '0.875rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  Active
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                style={{ ...btnSecondary, padding: '0.5rem 1rem' }}
                onClick={() => { setShowRuleModal(false); setEditingRule(null); }}
              >
                Cancel
              </button>
              <button style={btnPrimary} onClick={saveRule}>
                {editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIReceptionist;
