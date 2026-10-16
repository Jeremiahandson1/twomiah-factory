// src/components/admin/NotificationCenter.tsx — my notification inbox (new → handled →
// archived) and my delivery preferences (channels, alert types, quiet hours).
//
// The bell counts exactly what the New tab shows (status = 'new'). Handling a row,
// archiving it or marking it read from the bell all move both together, so the two
// never disagree.
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { parseLocalDate } from '../../utils/date';

const pickBool = (s, camel, snake) => (s?.[camel] ?? s?.[snake]);

const NotificationCenter = () => {
  const { token, user } = useAuth() as any;
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const [tab, setTab] = useState('new'); // new, handled, archived, settings
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [counts, setCounts] = useState({ new: 0, handled: 0, archived: 0 });
  const [showSend, setShowSend] = useState(false);
  const [caregivers, setCaregivers] = useState([]);
  const [draft, setDraft] = useState({ recipientId: '', notificationType: 'general', subject: '', message: '' });

  const headers = { Authorization: `Bearer ${token}` };
  const flash = (text, ms = 3000) => { setMessage(text); setTimeout(() => setMessage(''), ms); };

  useEffect(() => { loadNotifications(); }, [tab]);

  const loadNotifications = async () => {
    setLoading(true);
    setSelectedIds([]);
    try {
      const statusParam = ['new', 'handled', 'archived'].includes(tab) ? `?status=${tab}` : '';
      const [notifRes, settingsRes] = await Promise.all([
        tab === 'settings' ? Promise.resolve(null) : fetch(`${API_BASE_URL}/api/notifications${statusParam}`, { headers }),
        tab === 'settings' ? fetch(`${API_BASE_URL}/api/notification-settings`, { headers }) : Promise.resolve(null),
      ]);
      if (notifRes) {
        let data = notifRes.ok ? await notifRes.json() : [];
        if (!Array.isArray(data)) data = [];
        setNotifications(data);
      }
      if (settingsRes?.ok) setSettings(await settingsRes.json());

      const [newRes, handledRes, archivedRes] = await Promise.all(
        ['new', 'handled', 'archived'].map(st => fetch(`${API_BASE_URL}/api/notifications?status=${st}`, { headers })),
      );
      const n = async (r) => { if (!r.ok) return 0; const d = await r.json(); return Array.isArray(d) ? d.length : 0; };
      setCounts({ new: await n(newRes), handled: await n(handledRes), archived: await n(archivedRes) });
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed');
      loadNotifications();
    } catch (error) {
      flash('Error: ' + error.message);
    }
  };

  const bulkUpdateStatus = async (status) => {
    if (!selectedIds.length) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ids: selectedIds, status })
      });
      if (!res.ok) throw new Error('Failed');
      flash(`${selectedIds.length} notification(s) marked as ${status}`);
      loadNotifications();
    } catch (error) {
      flash('Error: ' + error.message);
    }
  };

  const deleteNotification = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Failed');
      loadNotifications();
    } catch (error) {
      flash('Error: ' + error.message);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const payload = {
        emailEnabled:        pickBool(settings, 'emailEnabled', 'email_enabled'),
        smsEnabled:          pickBool(settings, 'smsEnabled', 'sms_enabled'),
        pushEnabled:         pickBool(settings, 'pushEnabled', 'push_enabled'),
        scheduleAlerts:      pickBool(settings, 'scheduleAlerts', 'schedule_alerts'),
        payrollAlerts:       pickBool(settings, 'payrollAlerts', 'payroll_alerts'),
        absenceAlerts:       pickBool(settings, 'absenceAlerts', 'absence_alerts'),
        paymentAlerts:       pickBool(settings, 'paymentAlerts', 'payment_alerts'),
        shiftReminderAlerts: pickBool(settings, 'shiftReminderAlerts', 'shift_reminder_alerts'),
        billingAlerts:       pickBool(settings, 'billingAlerts', 'billing_alerts'),
        lowAuthAlerts:       pickBool(settings, 'lowAuthAlerts', 'low_auth_alerts'),
        expiringCertAlerts:  pickBool(settings, 'expiringCertAlerts', 'expiring_cert_alerts'),
        messageAlerts:       pickBool(settings, 'messageAlerts', 'message_alerts'),
        quietHoursStart:     (settings.quietHoursStart ?? settings.quiet_hours_start) ? String(settings.quietHoursStart ?? settings.quiet_hours_start).slice(0, 5) : null,
        quietHoursEnd:       (settings.quietHoursEnd ?? settings.quiet_hours_end) ? String(settings.quietHoursEnd ?? settings.quiet_hours_end).slice(0, 5) : null,
        quietHoursSkipEmergency: pickBool(settings, 'quietHoursSkipEmergency', 'quiet_hours_skip_emergency'),
      };
      const res = await fetch(`${API_BASE_URL}/api/notification-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSettings(data);
      flash('Settings saved!', 2000);
    } catch (error) { setMessage('Error: ' + error.message); }
  };

  const openSend = async () => {
    setShowSend(s => !s);
    if (!caregivers.length) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/users/caregivers`, { headers });
        const data = res.ok ? await res.json() : [];
        setCaregivers(Array.isArray(data) ? data : (data?.caregivers || data?.data || []));
      } catch { /* the list just stays empty */ }
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!draft.recipientId || !draft.subject.trim() || !draft.message.trim()) {
      return flash('Recipient, subject, and message are required');
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send notification');
      setDraft({ recipientId: '', notificationType: 'general', subject: '', message: '' });
      setShowSend(false);
      flash('Notification sent!');
    } catch (error) {
      flash('Error: ' + error.message);
    }
  };

  const setting = (camel, snake) => (settings[camel] ?? settings[snake]);
  const setSetting = (camel, snake, value) => setSettings({ ...settings, [camel]: value, [snake]: value });

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.length === notifications.length ? [] : notifications.map(n => n.id));
  };

  const typeIcon = (type) => ({
    time_off_request: '🏖️',
    schedule_alert: '📅',
    absence_alert: '🚫',
    incident_alert: '⚠️',
    certification_warning: '📜',
    billing_alert: '🧾',
    general: '📬'
  }[type] || '📬');

  const typeLabel = (type) => ({
    time_off_request: 'Time Off Request',
    schedule_alert: 'Schedule',
    absence_alert: 'Absence',
    incident_alert: 'Incident',
    certification_warning: 'Certification',
    billing_alert: 'Billing',
    general: 'General'
  }[type] || type || 'General');

  const timeAgo = (dateStr) => {
    const diff = Date.now() - parseLocalDate(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return parseLocalDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const tabs = [
    { id: 'new', label: 'New', count: counts.new, color: '#DC2626' },
    { id: 'handled', label: 'Handled', count: counts.handled, color: '#047857' },
    { id: 'archived', label: 'Archived', count: counts.archived, color: '#4B5563' },
    { id: 'settings', label: 'Settings', count: null, color: null }
  ];

  const smallBtn = (bg, fg, border) => ({ padding: '0.25rem 0.6rem', background: bg, color: fg, border: `1px solid ${border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 });

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2>Notifications</h2>
        {isAdmin && (
          <button className="btn btn-primary" onClick={openSend}>{showSend ? 'Cancel' : 'Send Notification'}</button>
        )}
      </div>

      {message && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '8px', background: message.startsWith('Error') ? '#FEE2E2' : '#D1FAE5', color: message.startsWith('Error') ? '#B91C1C' : '#047857', fontWeight: 500 }}>
          {message}
        </div>
      )}

      {isAdmin && showSend && (
        <div className="card card-form" style={{ marginBottom: '1rem' }}>
          <h3>Send a Notification</h3>
          <form onSubmit={handleSend}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={draft.recipientId} onChange={e => setDraft({ ...draft, recipientId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map(cg => (
                    <option key={cg.id} value={cg.id}>{cg.first_name || cg.firstName} {cg.last_name || cg.lastName}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={draft.notificationType} onChange={e => setDraft({ ...draft, notificationType: e.target.value })}>
                  <option value="general">General</option>
                  <option value="schedule_alert">Schedule</option>
                  <option value="absence_alert">Absence</option>
                  <option value="incident_alert">Incident</option>
                  <option value="certification_warning">Certification</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Subject *</label>
              <input type="text" value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Message *</label>
              <textarea value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })} rows={4} required />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Send</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowSend(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
              border: tab === t.id ? '2px solid #2563EB' : '1px solid #D1D5DB',
              background: tab === t.id ? '#EFF6FF' : '#fff',
              color: tab === t.id ? '#1D4ED8' : '#374151',
              display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span style={{
                background: tab === t.id ? '#2563EB' : t.color, color: '#fff',
                borderRadius: '99px', fontSize: '0.72rem', fontWeight: 700,
                padding: '1px 6px', minWidth: '18px', textAlign: 'center'
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk actions bar */}
      {selectedIds.length > 0 && tab !== 'settings' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1D4ED8' }}>
            {selectedIds.length} selected
          </span>
          {tab === 'new' && (
            <button onClick={() => bulkUpdateStatus('handled')}
              style={{ padding: '0.35rem 0.75rem', background: '#047857', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
              Mark Handled
            </button>
          )}
          {tab !== 'archived' && (
            <button onClick={() => bulkUpdateStatus('archived')}
              style={{ padding: '0.35rem 0.75rem', background: '#4B5563', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
              Archive
            </button>
          )}
          {tab === 'archived' && (
            <button onClick={() => bulkUpdateStatus('new')}
              style={{ padding: '0.35rem 0.75rem', background: '#2563EB', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
              Move to New
            </button>
          )}
          <button onClick={() => setSelectedIds([])}
            style={{ padding: '0.35rem 0.75rem', background: 'none', border: '1px solid #D1D5DB', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', color: '#4B5563' }}>
            Clear
          </button>
        </div>
      )}

      {/* Notification list */}
      {tab !== 'settings' && (
        loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#555' }}>Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#555' }}>
            No {tab} notifications
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={selectedIds.length === notifications.length && notifications.length > 0} onChange={toggleSelectAll} />
              <span style={{ fontSize: '0.82rem', color: '#4B5563' }}>Select all</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {notifications.map(n => {
                const isSelected = selectedIds.includes(n.id);
                const created = n.created_at || n.createdAt;
                const handled = n.handled_at || n.handledAt;
                return (
                  <div key={n.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    padding: '0.875rem 1rem', borderRadius: '8px',
                    border: isSelected ? '2px solid #2563EB' : '1px solid #E5E7EB',
                    background: isSelected ? '#EFF6FF' : '#fff',
                  }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(n.id)} style={{ marginTop: '0.2rem' }} />

                    <div style={{ fontSize: '1.3rem', marginTop: '0.1rem' }}>{typeIcon(n.type)}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#111827' }}>{n.title}</div>
                          <span style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '4px',
                            fontSize: '0.72rem', fontWeight: 600, background: '#F3F4F6', color: '#374151', marginTop: '0.2rem'
                          }}>{typeLabel(n.type)}</span>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: '#6B7280', whiteSpace: 'nowrap' }}>{timeAgo(created)}</span>
                      </div>
                      {n.message && (
                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.9rem', color: '#4B5563', lineHeight: '1.4' }}>{n.message}</p>
                      )}
                      {handled && (
                        <div style={{ fontSize: '0.78rem', color: '#6B7280', marginTop: '0.3rem' }}>
                          Handled {timeAgo(handled)}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        {tab === 'new' && (
                          <button onClick={() => updateStatus(n.id, 'handled')} style={smallBtn('#D1FAE5', '#047857', '#A7F3D0')}>
                            Mark Handled
                          </button>
                        )}
                        {tab !== 'archived' && (
                          <button onClick={() => updateStatus(n.id, 'archived')} style={smallBtn('#F3F4F6', '#4B5563', '#D1D5DB')}>
                            Archive
                          </button>
                        )}
                        {tab === 'handled' && (
                          <button onClick={() => updateStatus(n.id, 'new')} style={smallBtn('#DBEAFE', '#1D4ED8', '#BFDBFE')}>
                            Reopen
                          </button>
                        )}
                        {tab === 'archived' && (
                          <button onClick={() => updateStatus(n.id, 'new')} style={smallBtn('#DBEAFE', '#1D4ED8', '#BFDBFE')}>
                            Move to New
                          </button>
                        )}
                        <button onClick={() => deleteNotification(n.id)} style={smallBtn('#FEE2E2', '#B91C1C', '#FECACA')}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Settings Tab — MY delivery preferences */}
      {tab === 'settings' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>📥 My Delivery Preferences</h3>
          <p style={{ color: '#4B5563', fontSize: '0.85rem', marginTop: 0 }}>How and when YOU receive notifications.</p>

          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Channels</strong>
            {[
              ['emailEnabled', 'email_enabled', '✉️ Email'],
              ['smsEnabled',   'sms_enabled',   '📱 Text message (SMS)'],
              ['pushEnabled',  'push_enabled',  '🔔 Push notifications'],
            ].map(([camel, snake, label]) => (
              <label key={camel} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={setting(camel, snake) !== false}
                  onChange={e => setSetting(camel, snake, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Which alerts</strong>
            {[
              ['scheduleAlerts',      'schedule_alerts',       '📅 Schedule changes'],
              ['shiftReminderAlerts', 'shift_reminder_alerts', '⏰ Shift reminders'],
              ['absenceAlerts',       'absence_alerts',        '🚫 Absence / no-show'],
              ['payrollAlerts',       'payroll_alerts',        '💵 Payroll updates'],
              ['paymentAlerts',       'payment_alerts',        '💳 Payments received'],
              ['billingAlerts',       'billing_alerts',        '🧾 Billing / invoices'],
              ['lowAuthAlerts',       'low_auth_alerts',       '⚠️ Authorizations running low'],
              ['expiringCertAlerts',  'expiring_cert_alerts',  '📜 Certifications expiring'],
              ['messageAlerts',       'message_alerts',        '💬 New messages'],
            ].map(([camel, snake, label]) => (
              <label key={camel} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={setting(camel, snake) !== false}
                  onChange={e => setSetting(camel, snake, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>🌙 Quiet hours <span style={{ fontWeight: 400, color: '#4B5563', fontSize: '0.85rem' }}>(no notifications during this window)</span></strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', maxWidth: 380 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#4B5563' }}>From</label>
                <input type="time" value={String(setting('quietHoursStart', 'quiet_hours_start') || '').slice(0, 5)}
                  onChange={e => setSetting('quietHoursStart', 'quiet_hours_start', e.target.value || null)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#4B5563' }}>Until</label>
                <input type="time" value={String(setting('quietHoursEnd', 'quiet_hours_end') || '').slice(0, 5)}
                  onChange={e => setSetting('quietHoursEnd', 'quiet_hours_end', e.target.value || null)} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={setting('quietHoursSkipEmergency', 'quiet_hours_skip_emergency') !== false}
                onChange={e => setSetting('quietHoursSkipEmergency', 'quiet_hours_skip_emergency', e.target.checked)} />
              <span>Still send urgent alerts (no-show, emergency button) during quiet hours</span>
            </label>
          </div>

          <button className="btn btn-primary" onClick={handleSaveSettings}>Save Settings</button>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
