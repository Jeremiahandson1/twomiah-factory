// Moved from templates/crm-homecare/frontend/src/components/admin/NotificationCenter.tsx.
// My notification inbox (new → handled → archived) and my delivery preferences (channels, alert types, quiet hours):
// /api/notifications and /api/notification-settings (server/crm/homecare/portals/notifications.ts).
//
// The bell counts exactly what the New tab shows (status = 'new'). Handling a row, archiving it or marking it read
// from the bell all move both together, so the two never disagree.
//
// Changes from the template:
//   · the inbox and the three tab counts read the list reply's rows ({ data }); the template read a bare array, which
//     the unified server no longer sends, so every list and count would have been empty;
//   · rows and preferences are camelCase only (createdAt, handledAt, emailEnabled, …); the snake_case fallbacks are gone;
//   · "Send Notification" shows for whoever holds care-portal:create (what POST /send asks), not for the admin/owner role;
//   · the caregiver picker reads firstName/lastName from GET /api/users/caregivers' rows;
//   · a date older than a week prints on the agency's clock (lib/agencyClock), not the browser's toLocaleDateString;
//   · both themes: every colour is a frame token or a light/dark Tailwind pair; the btn/card classes are hc-*.
import { useState, useEffect, type FormEvent } from 'react';
import { api, rows, errorMessage } from '../lib/http';
import { usePermissions } from '../../../../shared';
import { parseLocalDate } from '../lib/date';
import { formatAgencyDate } from '../lib/agencyClock';

type Status = 'new' | 'handled' | 'archived';
type Tab = Status | 'settings';

/** A row of GET /api/notifications (the notifications table). */
interface Notification {
  id: string;
  type: string | null;
  title: string;
  message: string | null;
  status: Status;
  isRead: boolean;
  handledAt: string | null;
  createdAt: string;
}

/** GET /api/notification-settings: the stored row, or the defaults for a person who never saved any. */
interface Settings {
  emailEnabled?: boolean;
  smsEnabled?: boolean;
  pushEnabled?: boolean;
  scheduleAlerts?: boolean;
  shiftReminderAlerts?: boolean;
  absenceAlerts?: boolean;
  payrollAlerts?: boolean;
  paymentAlerts?: boolean;
  billingAlerts?: boolean;
  lowAuthAlerts?: boolean;
  expiringCertAlerts?: boolean;
  messageAlerts?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursSkipEmergency?: boolean;
}
type SwitchKey = Exclude<keyof Settings, 'quietHoursStart' | 'quietHoursEnd'>;

/** A row of GET /api/users/caregivers. */
interface Caregiver { id: string; firstName: string | null; lastName: string | null }

const CHANNELS: Array<[SwitchKey, string]> = [
  ['emailEnabled', '✉️ Email'],
  ['smsEnabled', '📱 Text message (SMS)'],
  ['pushEnabled', '🔔 Push notifications'],
];
const ALERTS: Array<[SwitchKey, string]> = [
  ['scheduleAlerts', '📅 Schedule changes'],
  ['shiftReminderAlerts', '⏰ Shift reminders'],
  ['absenceAlerts', '🚫 Absence / no-show'],
  ['payrollAlerts', '💵 Payroll updates'],
  ['paymentAlerts', '💳 Payments received'],
  ['billingAlerts', '🧾 Billing / invoices'],
  ['lowAuthAlerts', '⚠️ Authorizations running low'],
  ['expiringCertAlerts', '📜 Certifications expiring'],
  ['messageAlerts', '💬 New messages'],
];

const hhmm = (v: string | null | undefined) => (v ? String(v).slice(0, 5) : '');

// Small action buttons: each ground with its ink and border, light and dark.
const SMALL_BTN = 'rounded-md border px-2.5 py-1 text-xs font-semibold cursor-pointer';
const SMALL = {
  green: `${SMALL_BTN} bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800`,
  gray: `${SMALL_BTN} bg-gray-100 text-gray-700 border-gray-300 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600`,
  blue: `${SMALL_BTN} bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800`,
  red: `${SMALL_BTN} bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800`,
};
// Bulk bar buttons: white on a fixed ground dark enough in both themes.
const BULK_BTN = 'rounded-md border-0 px-3 py-1.5 text-[0.82rem] font-semibold text-white cursor-pointer';

const NotificationCenter = () => {
  const { can } = usePermissions();
  const maySend = can('care-portal:create');
  const [tab, setTab] = useState<Tab>('new');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<Status, number>>({ new: 0, handled: 0, archived: 0 });
  const [showSend, setShowSend] = useState(false);
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [draft, setDraft] = useState({ recipientId: '', notificationType: 'general', subject: '', message: '' });

  const flash = (text: string, ms = 3000) => { setMessage(text); setTimeout(() => setMessage(''), ms); };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadNotifications(); }, [tab]);

  const loadNotifications = async () => {
    setLoading(true);
    setSelectedIds([]);
    try {
      if (tab === 'settings') {
        try { setSettings((await api.get('/api/notification-settings')) || {}); } catch { /* the form keeps what it had */ }
      } else {
        try { setNotifications(rows<Notification>(await api.get('/api/notifications', { status: tab }))); } catch { setNotifications([]); }
      }
      const statuses: Status[] = ['new', 'handled', 'archived'];
      const lengths = await Promise.all(statuses.map((st) =>
        api.get('/api/notifications', { status: st }).then((r) => rows(r).length).catch(() => 0)));
      setCounts({ new: lengths[0], handled: lengths[1], archived: lengths[2] });
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: Status) => {
    try {
      await api.patch(`/api/notifications/${id}/status`, { status });
      loadNotifications();
    } catch (error) {
      flash('Error: ' + errorMessage(error, 'Failed'));
    }
  };

  const bulkUpdateStatus = async (status: Status) => {
    if (!selectedIds.length) return;
    try {
      await api.post('/api/notifications/bulk-status', { ids: selectedIds, status });
      flash(`${selectedIds.length} notification(s) marked as ${status}`);
      loadNotifications();
    } catch (error) {
      flash('Error: ' + errorMessage(error, 'Failed'));
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await api.delete(`/api/notifications/${id}`);
      loadNotifications();
    } catch (error) {
      flash('Error: ' + errorMessage(error, 'Failed'));
    }
  };

  const handleSaveSettings = async () => {
    try {
      const payload = {
        emailEnabled: settings.emailEnabled,
        smsEnabled: settings.smsEnabled,
        pushEnabled: settings.pushEnabled,
        scheduleAlerts: settings.scheduleAlerts,
        payrollAlerts: settings.payrollAlerts,
        absenceAlerts: settings.absenceAlerts,
        paymentAlerts: settings.paymentAlerts,
        shiftReminderAlerts: settings.shiftReminderAlerts,
        billingAlerts: settings.billingAlerts,
        lowAuthAlerts: settings.lowAuthAlerts,
        expiringCertAlerts: settings.expiringCertAlerts,
        messageAlerts: settings.messageAlerts,
        quietHoursStart: hhmm(settings.quietHoursStart) || null,
        quietHoursEnd: hhmm(settings.quietHoursEnd) || null,
        quietHoursSkipEmergency: settings.quietHoursSkipEmergency,
      };
      const saved: Settings = await api.put('/api/notification-settings', payload);
      setSettings(saved || {});
      flash('Settings saved!', 2000);
    } catch (error) { setMessage('Error: ' + errorMessage(error, 'Failed to save')); }
  };

  const openSend = async () => {
    setShowSend((s) => !s);
    if (!caregivers.length) {
      try {
        setCaregivers(rows<Caregiver>(await api.get('/api/users/caregivers')));
      } catch { /* the list just stays empty */ }
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.recipientId || !draft.subject.trim() || !draft.message.trim()) {
      flash('Recipient, subject, and message are required');
      return;
    }
    try {
      await api.post('/api/notifications/send', draft);
      setDraft({ recipientId: '', notificationType: 'general', subject: '', message: '' });
      setShowSend(false);
      flash('Notification sent!');
    } catch (error) {
      flash('Error: ' + errorMessage(error, 'Failed to send notification'));
    }
  };

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.length === notifications.length ? [] : notifications.map((n) => n.id)));
  };

  const typeIcon = (type: string | null) => ({
    time_off_request: '🏖️',
    schedule_alert: '📅',
    absence_alert: '🚫',
    incident_alert: '⚠️',
    certification_warning: '📜',
    billing_alert: '🧾',
    general: '📬',
  } as Record<string, string>)[type || ''] || '📬';

  const typeLabel = (type: string | null) => ({
    time_off_request: 'Time Off Request',
    schedule_alert: 'Schedule',
    absence_alert: 'Absence',
    incident_alert: 'Incident',
    certification_warning: 'Certification',
    billing_alert: 'Billing',
    general: 'General',
  } as Record<string, string>)[type || ''] || type || 'General';

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - parseLocalDate(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return formatAgencyDate(dateStr, { month: 'short', day: 'numeric' });
  };

  // Each count chip: white on a fixed colour dark enough in both themes.
  const tabs: Array<{ id: Tab; label: string; count: number | null; color: string | null }> = [
    { id: 'new', label: 'New', count: counts.new, color: '#DC2626' },
    { id: 'handled', label: 'Handled', count: counts.handled, color: '#047857' },
    { id: 'archived', label: 'Archived', count: counts.archived, color: '#4B5563' },
    { id: 'settings', label: 'Settings', count: null, color: null },
  ];

  const isError = message.startsWith('Error') || message.endsWith('required');

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2>Notifications</h2>
        {maySend && (
          <button className="hc-btn hc-btn-primary" onClick={openSend}>{showSend ? 'Cancel' : 'Send Notification'}</button>
        )}
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '8px', fontWeight: 500,
          background: isError ? 'var(--hc-danger-bg)' : 'var(--hc-success-bg)',
          color: isError ? 'var(--hc-danger-ink)' : 'var(--hc-success-ink)',
        }}>
          {message}
        </div>
      )}

      {maySend && showSend && (
        <div className="hc-card hc-card-form" style={{ marginBottom: '1rem' }}>
          <h3>Send a Notification</h3>
          <form onSubmit={handleSend}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={draft.recipientId} onChange={(e) => setDraft({ ...draft, recipientId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map((cg) => (
                    <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={draft.notificationType} onChange={(e) => setDraft({ ...draft, notificationType: e.target.value })}>
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
              <input type="text" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Message *</label>
              <textarea value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} rows={4} required />
            </div>
            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary">Send</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowSend(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
              border: tab === t.id ? '2px solid var(--hc-blue-ink)' : '1px solid var(--hc-line)',
              background: tab === t.id ? 'var(--hc-info-bg)' : 'var(--hc-surface)',
              color: tab === t.id ? 'var(--hc-info-ink)' : 'var(--hc-ink)',
              display: 'flex', alignItems: 'center', gap: '0.4rem',
            }}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span style={{
                background: tab === t.id ? '#1D4ED8' : (t.color || '#4B5563'), color: '#fff',
                borderRadius: '99px', fontSize: '0.72rem', fontWeight: 700,
                padding: '1px 6px', minWidth: '18px', textAlign: 'center',
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk actions bar */}
      {selectedIds.length > 0 && tab !== 'settings' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', background: 'var(--hc-info-bg)', border: '1px solid var(--hc-info-line)', borderRadius: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--hc-info-ink)' }}>
            {selectedIds.length} selected
          </span>
          {tab === 'new' && (
            <button onClick={() => bulkUpdateStatus('handled')} className={BULK_BTN} style={{ background: '#047857' }}>
              Mark Handled
            </button>
          )}
          {tab !== 'archived' && (
            <button onClick={() => bulkUpdateStatus('archived')} className={BULK_BTN} style={{ background: '#4B5563' }}>
              Archive
            </button>
          )}
          {tab === 'archived' && (
            <button onClick={() => bulkUpdateStatus('new')} className={BULK_BTN} style={{ background: '#1D4ED8' }}>
              Move to New
            </button>
          )}
          <button onClick={() => setSelectedIds([])}
            style={{ padding: '0.35rem 0.75rem', background: 'none', border: '1px solid var(--hc-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--hc-ink-soft)' }}>
            Clear
          </button>
        </div>
      )}

      {/* Notification list */}
      {tab !== 'settings' && (
        loading ? (
          <div className="hc-card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-ink-soft)' }}>Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="hc-card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-ink-soft)' }}>
            No {tab} notifications
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={selectedIds.length === notifications.length && notifications.length > 0} onChange={toggleSelectAll} />
              <span style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)' }}>Select all</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {notifications.map((n) => {
                const isSelected = selectedIds.includes(n.id);
                return (
                  <div key={n.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    padding: '0.875rem 1rem', borderRadius: '8px',
                    border: isSelected ? '2px solid var(--hc-blue-ink)' : '1px solid var(--hc-line)',
                    background: isSelected ? 'var(--hc-info-bg)' : 'var(--hc-surface)',
                  }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(n.id)} style={{ marginTop: '0.2rem' }} />

                    <div style={{ fontSize: '1.3rem', marginTop: '0.1rem' }}>{typeIcon(n.type)}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--hc-ink)' }}>{n.title}</div>
                          <span style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '4px',
                            fontSize: '0.72rem', fontWeight: 600, background: 'var(--hc-subtle)', color: 'var(--hc-ink)', marginTop: '0.2rem',
                          }}>{typeLabel(n.type)}</span>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--hc-muted)', whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</span>
                      </div>
                      {n.message && (
                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.9rem', color: 'var(--hc-ink-soft)', lineHeight: '1.4' }}>{n.message}</p>
                      )}
                      {n.handledAt && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--hc-muted)', marginTop: '0.3rem' }}>
                          Handled {timeAgo(n.handledAt)}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        {tab === 'new' && (
                          <button onClick={() => updateStatus(n.id, 'handled')} className={SMALL.green}>Mark Handled</button>
                        )}
                        {tab !== 'archived' && (
                          <button onClick={() => updateStatus(n.id, 'archived')} className={SMALL.gray}>Archive</button>
                        )}
                        {tab === 'handled' && (
                          <button onClick={() => updateStatus(n.id, 'new')} className={SMALL.blue}>Reopen</button>
                        )}
                        {tab === 'archived' && (
                          <button onClick={() => updateStatus(n.id, 'new')} className={SMALL.blue}>Move to New</button>
                        )}
                        <button onClick={() => deleteNotification(n.id)} className={SMALL.red}>Delete</button>
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
        <div className="hc-card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>📥 My Delivery Preferences</h3>
          <p style={{ color: 'var(--hc-ink-soft)', fontSize: '0.85rem', marginTop: 0 }}>How and when YOU receive notifications.</p>

          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Channels</strong>
            {CHANNELS.map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings[key] !== false} onChange={(e) => setSetting(key, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Which alerts</strong>
            {ALERTS.map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings[key] !== false} onChange={(e) => setSetting(key, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.5rem' }}>🌙 Quiet hours <span style={{ fontWeight: 400, color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>(no notifications during this window)</span></strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', maxWidth: 380 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--hc-ink-soft)' }}>From</label>
                <input type="time" value={hhmm(settings.quietHoursStart)}
                  onChange={(e) => setSetting('quietHoursStart', e.target.value || null)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--hc-ink-soft)' }}>Until</label>
                <input type="time" value={hhmm(settings.quietHoursEnd)}
                  onChange={(e) => setSetting('quietHoursEnd', e.target.value || null)} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.quietHoursSkipEmergency !== false}
                onChange={(e) => setSetting('quietHoursSkipEmergency', e.target.checked)} />
              <span>Still send urgent alerts (no-show, emergency button) during quiet hours</span>
            </label>
          </div>

          <button className="hc-btn hc-btn-primary" onClick={handleSaveSettings}>Save Settings</button>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
