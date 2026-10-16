// components/portal/FamilyPortal.tsx
// Family member portal — what a relative may see of their loved one's care, tab by
// tab, as the office has allowed (schedule, care plan, medications, messaging).
import React, { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../config';
import CaregiverBackgroundChecks from './CaregiverBackgroundChecks';
import { formatAgencyDateTime, setAgencyTimezone } from '../../utils/agencyClock';
import { serviceLabel } from '../../utils/serviceTypes';

const CARD = {
  background: '#fff',
  borderRadius: '10px',
  padding: '20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  marginBottom: '16px',
};

const BADGE = (color) => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: '12px',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: color === 'green' ? '#d4edda' : color === 'blue' ? '#d1ecf1' : color === 'yellow' ? '#fff3cd' : '#f8d7da',
  color: color === 'green' ? '#155724' : color === 'blue' ? '#0c5460' : color === 'yellow' ? '#856404' : '#721c24',
});

const MUTED = { textAlign: 'center' as const, padding: '40px', color: '#666' };

// A calendar date (YYYY-MM-DD) is that day where the family is, not UTC midnight.
const dayOf = (d) => {
  if (!d) return null;
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return isNaN(dt.getTime()) ? null : dt;
};
const fmtDay = (d, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  dayOf(d)?.toLocaleDateString('en-US', opts) || '';
// An instant (a vitals reading, a visit's clock-in, a message) on the agency's clock — the clock the
// visit times are on — not the browser's (utils/agencyClock.ts).
const fmtDateTime = (d) => formatAgencyDateTime(d);

const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null; };

// ── Schedule Tab ──────────────────────────────────────────────
const ScheduleView = ({ token }) => {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('/api/family-portal/portal/schedule', { method: 'GET' }, token)
      .then(data => { if (Array.isArray(data)) setVisits(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={MUTED}>Loading schedule...</div>;

  if (visits.length === 0) {
    return <div style={{ ...CARD, ...MUTED }}>No upcoming visits scheduled.</div>;
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Upcoming Visits</h3>
      {visits.map(v => {
        const date = dayOf(v.date || v.scheduled_date);
        const isToday = !!date && date.toDateString() === new Date().toDateString();
        const start = pick(v, 'start_time', 'startTime');
        const end = pick(v, 'end_time', 'endTime');
        const first = pick(v, 'caregiver_first', 'caregiverFirst');
        const last = pick(v, 'caregiver_last', 'caregiverLast');
        return (
          <div key={v.id} style={{
            ...CARD,
            borderLeft: isToday ? '4px solid #27ae60' : '4px solid #3498db',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
              <strong style={{ fontSize: '0.95rem' }}>
                {date ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                {isToday && <span style={{ ...BADGE('green'), marginLeft: '8px' }}>Today</span>}
              </strong>
              <span style={{ color: '#555', fontSize: '0.85rem' }}>
                {String(start || '').slice(0, 5)} - {String(end || '').slice(0, 5)}
              </span>
            </div>
            {(first || last) && (
              <div style={{ color: '#555', fontSize: '0.88rem' }}>
                Caregiver: {first} {last}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Caregivers Tab ────────────────────────────────────────────
const CaregiversView = ({ token, agencyState }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('/api/family-portal/portal/caregivers', { method: 'GET' }, token)
      .then(data => { if (Array.isArray(data)) setCaregivers(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={MUTED}>Loading caregivers...</div>;

  if (caregivers.length === 0) {
    return <div style={{ ...CARD, ...MUTED }}>No caregivers currently assigned.</div>;
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Assigned Caregivers</h3>
      {caregivers.map(cg => (
        <div key={cg.caregiver_id} style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #2d5016, #4a8c1c)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, flexShrink: 0,
            }}>
              {cg.first_name?.[0]}{cg.last_name?.[0]}
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
              {cg.first_name} {cg.last_name}
            </div>
          </div>

          {Array.isArray(cg.certifications) && cg.certifications.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
              {cg.certifications.map((cert, i) => (
                <span key={i} style={BADGE('blue')}>{typeof cert === 'string' ? cert : (cert?.name || '')}</span>
              ))}
            </div>
          )}

          <CaregiverBackgroundChecks
            token={token}
            caregiverId={cg.caregiver_id}
            apiBase="/api/family-portal"
            agencyState={agencyState}
          />
        </div>
      ))}
    </div>
  );
};

// ── Care Plan Tab ─────────────────────────────────────────────
const CarePlanView = ({ token }) => {
  const [plan, setPlan] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiCall('/api/family-portal/portal/care-plan', { method: 'GET' }, token).catch(() => null),
      apiCall('/api/family-portal/portal/notes', { method: 'GET' }, token).catch(() => []),
    ]).then(([p, n]) => {
      if (p) setPlan(p);
      if (Array.isArray(n)) setNotes(n);
    }).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={MUTED}>Loading care plan...</div>;

  const section = (label, text) => text ? (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontWeight: 600, color: '#333', marginBottom: '4px', fontSize: '0.85rem' }}>{label}</div>
      <div style={{ color: '#555', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  ) : null;

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Care Plan</h3>
      {plan ? (
        <div style={CARD}>
          {pick(plan, 'service_type', 'serviceType') && (
            <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '1rem' }}>
              {serviceLabel(pick(plan, 'service_type', 'serviceType'))}
              {pick(plan, 'frequency') && <span style={{ fontWeight: 400, color: '#555' }}> · {plan.frequency}</span>}
            </div>
          )}
          {section('Goals', pick(plan, 'care_goals', 'careGoals'))}
          {section('Instructions', pick(plan, 'special_instructions', 'specialInstructions'))}
          {section('Precautions', pick(plan, 'precautions'))}
        </div>
      ) : (
        <div style={{ ...CARD, textAlign: 'center', color: '#666' }}>No active care plan found.</div>
      )}

      {notes.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 16px', fontSize: '1.1rem' }}>Recent Visit Notes</h3>
          {notes.slice(0, 10).map(n => {
            const minutes = pick(n, 'duration_minutes', 'durationMinutes');
            return (
              <div key={n.id} style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                  <strong style={{ fontSize: '0.88rem' }}>
                    {pick(n, 'caregiver_first', 'caregiverFirst')} {pick(n, 'caregiver_last', 'caregiverLast')}
                  </strong>
                  <span style={{ color: '#666', fontSize: '0.8rem' }}>
                    {fmtDateTime(pick(n, 'start_time', 'startTime'))}
                    {minutes ? ` · ${minutes} min` : ''}
                  </span>
                </div>
                {n.notes && <div style={{ color: '#555', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{n.notes}</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};

// ── Medications Tab ───────────────────────────────────────────
const MedicationsView = ({ token }) => {
  const [meds, setMeds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('/api/family-portal/portal/medications', { method: 'GET' }, token)
      .then(data => { if (Array.isArray(data)) setMeds(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={MUTED}>Loading medications...</div>;

  if (meds.length === 0) {
    return <div style={{ ...CARD, ...MUTED }}>No active medications on file.</div>;
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Active Medications</h3>
      {meds.map(m => (
        <div key={m.id} style={CARD}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>
            {m.name}{(m.is_prn || m.isPrn) && <span style={{ ...BADGE('yellow'), marginLeft: '8px' }}>As needed</span>}
          </div>
          {m.dosage && <div style={{ color: '#555', fontSize: '0.85rem' }}>Dosage: {m.dosage}</div>}
          {m.frequency && <div style={{ color: '#555', fontSize: '0.85rem' }}>Frequency: {m.frequency}</div>}
          {m.route && <div style={{ color: '#555', fontSize: '0.85rem' }}>Route: {m.route}</div>}
          {pick(m, 'prescribed_by', 'prescribedBy') && <div style={{ color: '#555', fontSize: '0.85rem' }}>Prescriber: {pick(m, 'prescribed_by', 'prescribedBy')}</div>}
          {m.instructions && <div style={{ color: '#555', fontSize: '0.85rem' }}>Instructions: {m.instructions}</div>}
          {m.notes && <div style={{ color: '#666', fontSize: '0.82rem', marginTop: '6px', fontStyle: 'italic' }}>{m.notes}</div>}
        </div>
      ))}
    </div>
  );
};

// ── Vitals Tab (same permission as medications) ───────────────
const VITAL_FIELDS = [
  { k: 'systolic_bp',       label: 'BP (sys)', unit: '' },
  { k: 'diastolic_bp',      label: 'BP (dia)', unit: '' },
  { k: 'pulse',             label: 'Pulse',    unit: 'bpm' },
  { k: 'respirations',      label: 'Resp',     unit: '/min' },
  { k: 'oxygen_saturation', label: 'O₂ Sat',   unit: '%' },
  { k: 'temperature_f',     label: 'Temp',     unit: '°F' },
  { k: 'blood_glucose',     label: 'Glucose',  unit: 'mg/dL' },
  { k: 'weight_lbs',        label: 'Weight',   unit: 'lbs' },
  { k: 'pain_scale',        label: 'Pain',     unit: '/10' },
];

const VitalsView = ({ token }) => {
  const [vitals, setVitals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('/api/family-portal/portal/vitals', { method: 'GET' }, token)
      .then(data => { if (Array.isArray(data)) setVitals(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={MUTED}>Loading vitals...</div>;
  if (vitals.length === 0) return <div style={{ ...CARD, ...MUTED }}>No vitals recorded yet.</div>;

  const latest = vitals[0];
  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Latest Vitals</h3>
      <div style={{ ...CARD, marginBottom: 20 }}>
        <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 8 }}>
          Recorded {fmtDateTime(latest.recorded_at)}
          {latest.caregiver_first && ` by ${latest.caregiver_first} ${latest.caregiver_last?.[0] || ''}.`}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {VITAL_FIELDS.map(f => latest[f.k] != null && (
            <div key={f.k} style={{ background: '#F9FAFB', padding: '8px 10px', borderRadius: 6 }}>
              <div style={{ fontSize: '0.7rem', color: '#4B5563', fontWeight: 700 }}>{f.label}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>
                {latest[f.k]} <span style={{ fontSize: '0.7rem', color: '#4B5563', fontWeight: 400 }}>{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
        {latest.notes && <div style={{ marginTop: 12, color: '#555', fontSize: '0.85rem', fontStyle: 'italic' }}>{latest.notes}</div>}
      </div>

      <h4 style={{ margin: '20px 0 12px', fontSize: '0.95rem', color: '#555' }}>History ({vitals.length})</h4>
      <div style={{ ...CARD, overflowX: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', color: '#111827' }}>
          <thead>
            <tr style={{ background: '#F9FAFB' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>When</th>
              {VITAL_FIELDS.map(f => <th key={f.k} style={{ padding: '6px 8px', textAlign: 'right' }}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {vitals.map(v => (
              <tr key={v.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{fmtDateTime(v.recorded_at)}</td>
                {VITAL_FIELDS.map(f => <td key={f.k} style={{ padding: '5px 8px', textAlign: 'right' }}>{v[f.k] != null ? v[f.k] : '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Messages Tab ──────────────────────────────────────────────
const MessagesView = ({ token, canMessage }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const fetchMessages = () => {
    apiCall('/api/family-portal/portal/messages', { method: 'GET' }, token)
      .then(data => { if (Array.isArray(data)) setMessages(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // The office's reply arrives without a reload: the list is re-read every 30 seconds while this tab
  // is open, and when the window comes back into focus.
  useEffect(() => {
    fetchMessages();
    const timer = setInterval(fetchMessages, 30000);
    const onFocus = () => fetchMessages();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiCall('/api/family-portal/portal/messages', {
        method: 'POST',
        body: JSON.stringify({ subject: subject.trim() || 'General Inquiry', message: message.trim() }),
      }, token);
      setSubject('');
      setMessage('');
      fetchMessages();
    } catch (err) {
      setError(err.message === 'SESSION_EXPIRED' ? 'Your session has ended — please sign in again.' : (err.message || 'Your message could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={MUTED}>Loading messages...</div>;

  return (
    <div>
      {canMessage && (
        <>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Send a Message</h3>
          <div style={CARD}>
            {error && <div className="alert alert-error" style={{ marginBottom: '10px' }}>{error}</div>}
            <form onSubmit={handleSend}>
              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Subject (optional)"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', border: '1px solid #ddd',
                    borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ marginBottom: '10px' }}>
                <textarea
                  placeholder="Type your message..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={3}
                  required
                  style={{
                    width: '100%', padding: '8px 12px', border: '1px solid #ddd',
                    borderRadius: '6px', fontSize: '0.88rem', resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={sending || !message.trim()}
                style={{
                  background: '#1e7e34', color: '#fff', border: 'none',
                  padding: '8px 20px', borderRadius: '6px', cursor: 'pointer',
                  fontWeight: 600, fontSize: '0.85rem',
                  opacity: sending || !message.trim() ? 0.6 : 1,
                }}
              >
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
        </>
      )}

      {messages.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 16px', fontSize: '1.1rem' }}>Message History</h3>
          {messages.map(m => {
            const inbound = m.direction === 'inbound';
            return (
              <div key={m.id} style={{
                ...CARD,
                borderLeft: inbound ? '4px solid #3498db' : '4px solid #27ae60',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={BADGE(inbound ? 'blue' : 'green')}>
                    {inbound ? 'You' : 'Care Team'}
                  </span>
                  <span style={{ color: '#666', fontSize: '0.8rem' }}>
                    {fmtDateTime(m.created_at || m.createdAt)}
                  </span>
                </div>
                {m.subject && <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '4px' }}>{m.subject}</div>}
                <div style={{ color: '#555', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{m.message}</div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};

// ── Overview / Home Tab ───────────────────────────────────────
const OverviewView = ({ client, userName, permissions, setActiveTab }) => {
  const quickLinks = [];
  if (permissions.canViewSchedule)    quickLinks.push({ key: 'schedule',    label: 'View Schedule',    icon: '📅', color: '#3498db' });
  if (permissions.canViewCarePlan)    quickLinks.push({ key: 'care-plan',   label: 'View Care Plan',   icon: '📋', color: '#e67e22' });
  if (permissions.canViewMedications) quickLinks.push({ key: 'medications', label: 'View Medications', icon: '💊', color: '#9b59b6' });
  if (permissions.canMessage)         quickLinks.push({ key: 'messages',    label: 'Send Message',     icon: '💬', color: '#27ae60' });

  const first = pick(client, 'first_name', 'firstName');
  const last = pick(client, 'last_name', 'lastName');
  const dob = pick(client, 'date_of_birth', 'dateOfBirth');

  return (
    <div>
      <div style={{ ...CARD, background: 'linear-gradient(135deg, #d5f5e3 0%, #e8f8f5 100%)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: '#2d5016' }}>
          Welcome, {userName}
        </h2>
        {client && (
          <p style={{ margin: 0, color: '#444', fontSize: '0.9rem' }}>
            Viewing care information for <strong>{first} {last}</strong>
          </p>
        )}
      </div>

      {client && (
        <div style={CARD}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Client Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '0.88rem' }}>
            <div><span style={{ color: '#666' }}>Name:</span> {first} {last}</div>
            {dob && <div><span style={{ color: '#666' }}>DOB:</span> {fmtDay(dob)}</div>}
            {client.phone && <div><span style={{ color: '#666' }}>Phone:</span> {client.phone}</div>}
            {client.address && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: '#666' }}>Address:</span> {client.address}
                {client.city && `, ${client.city}`}
                {client.state && `, ${client.state}`}
                {client.zip && ` ${client.zip}`}
              </div>
            )}
          </div>
        </div>
      )}

      {quickLinks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          {quickLinks.map(link => (
            <button
              key={link.key}
              onClick={() => setActiveTab(link.key)}
              style={{
                ...CARD,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                textAlign: 'left',
                marginBottom: 0,
              }}
            >
              <span style={{
                fontSize: '1.5rem',
                width: '44px', height: '44px',
                background: link.color + '18',
                borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {link.icon}
              </span>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#333' }}>{link.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main Family Portal ────────────────────────────────────────
// `user` is the family member; their permissions are re-read from the server on open, on every
// tab change, when the window comes back into view, and each minute — so a box the office unticks
// takes its menu away in a tab that is already open (Run 5: Medications stayed until a reload, though
// the server already refused it).
const FamilyPortal = ({ user, token, onLogout }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [client, setClient] = useState(null);
  const [member, setMember] = useState(user);

  const refreshMember = useCallback(() => {
    apiCall('/api/family-portal/portal/me', { method: 'GET' }, token)
      .then(data => { if (data) setMember(data); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    apiCall('/api/family-portal/portal/client', { method: 'GET' }, token)
      .then(data => { if (data) { setAgencyTimezone(data.timezone); setClient(data); } })
      .catch(() => {});
    refreshMember();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshMember(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(refreshMember, 60000);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [token, refreshMember]);

  useEffect(() => { if (activeTab !== 'overview') refreshMember(); }, [activeTab, refreshMember]);

  const permissions = {
    canViewSchedule: !!(member?.canViewSchedule ?? member?.can_view_schedule),
    canViewCarePlan: !!(member?.canViewCarePlan ?? member?.can_view_care_plan),
    canViewMedications: !!(member?.canViewMedications ?? member?.can_view_medications),
    canMessage: !!(member?.canMessage ?? member?.can_message),
  };

  const tabs = [{ key: 'overview', label: 'Overview', icon: '🏠' }];
  if (permissions.canViewSchedule)    tabs.push({ key: 'schedule',    label: 'Schedule',    icon: '📅' });
  if (permissions.canViewSchedule)    tabs.push({ key: 'caregivers',  label: 'Caregivers',  icon: '👤' });
  if (permissions.canViewCarePlan)    tabs.push({ key: 'care-plan',   label: 'Care Plan',   icon: '📋' });
  if (permissions.canViewMedications) tabs.push({ key: 'medications', label: 'Medications', icon: '💊' });
  if (permissions.canViewMedications) tabs.push({ key: 'vitals',      label: 'Vitals',      icon: '❤️' });
  if (permissions.canMessage)         tabs.push({ key: 'messages',    label: 'Messages',    icon: '💬' });

  // A tab whose permission was just taken away closes back to the overview.
  useEffect(() => {
    if (!tabs.some(t => t.key === activeTab)) setActiveTab('overview');
  }, [activeTab, tabs.map(t => t.key).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const userName = member?.name || 'Family Member';
  const agencyState = client?.agency_state || client?.agencyState || null;

  const renderView = () => {
    switch (activeTab) {
      case 'schedule':    return permissions.canViewSchedule ? <ScheduleView token={token} /> : null;
      case 'caregivers':  return permissions.canViewSchedule ? <CaregiversView token={token} agencyState={agencyState} /> : null;
      case 'care-plan':   return permissions.canViewCarePlan ? <CarePlanView token={token} /> : null;
      case 'medications': return permissions.canViewMedications ? <MedicationsView token={token} /> : null;
      case 'vitals':      return permissions.canViewMedications ? <VitalsView token={token} /> : null;
      case 'messages':    return permissions.canMessage ? <MessagesView token={token} canMessage /> : null;
      default:            return <OverviewView client={client} userName={userName} permissions={permissions} setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      <div style={{
        background: 'linear-gradient(135deg, #2d5016 0%, #4a8c1c 100%)',
        color: '#fff',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        minHeight: '60px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <span style={{ fontSize: '1.4rem' }}>🏠</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
              {client?.agency_name || client?.agencyName || 'Family Portal'}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>Family Portal</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontSize: '0.85rem', opacity: 0.95 }}>{userName}</span>
          <button
            onClick={onLogout}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              padding: '5px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e8ecf0',
        display: 'flex',
        padding: '0 12px',
        gap: '4px',
        overflowX: 'auto',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'none',
              border: 'none',
              padding: '14px 14px',
              cursor: 'pointer',
              fontSize: '0.88rem',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#2d5016' : '#555',
              borderBottom: activeTab === tab.key ? '3px solid #2d5016' : '3px solid transparent',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
        {renderView()}
      </div>
    </div>
  );
};

export default FamilyPortal;
