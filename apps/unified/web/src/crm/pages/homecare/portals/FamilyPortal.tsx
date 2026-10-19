// The family portal once signed in: what a relative may see of their loved one's care, tab by tab, as the office has
// allowed (schedule, care plan, medications, messaging). Moved from
// templates/crm-homecare/frontend/src/components/portal/FamilyPortal.tsx.
//
// Server (server/crm/homecare/portals/familyPortal.ts, every path signed in by the family token — familyAuth):
//   GET  /api/family-portal/portal/me          the member (canViewSchedule, canViewCarePlan, canViewMedications, canMessage, name …)
//   GET  /api/family-portal/portal/client      { id, firstName, lastName, dateOfBirth, address, city, state, zip, phone,
//                                              agencyName, agencyState, timezone }
//   GET  /api/family-portal/portal/schedule    a list of { id, scheduleId, date, startTime, endTime ('HH:MM'), notes,
//                                              caregiverFirst, caregiverLast }
//   GET  /api/family-portal/portal/caregivers  a list of { caregiverId, firstName, lastName, certifications, … } (no phone)
//   GET  /api/family-portal/portal/care-plan   the active plan { id, serviceType, frequency, careGoals,
//                                              specialInstructions, precautions, … } — or {} when there is none
//   GET  /api/family-portal/portal/notes       a list of { id, startTime, durationMinutes, notes, caregiverFirst, caregiverLast }
//   GET  /api/family-portal/portal/medications a list of { id, name, dosage, frequency, route, prescribedBy, instructions, isPrn, notes }
//   GET  /api/family-portal/portal/vitals      a list of { id, recordedAt, systolicBp, diastolicBp, pulse, respirations,
//                                              oxygenSaturation, temperatureF, bloodGlucose, weightLbs, painScale, notes,
//                                              caregiverFirst, caregiverLast }
//   GET  /api/family-portal/portal/messages    a list of { id, direction ('inbound' = the family's), subject, message, createdAt }
//   POST /api/family-portal/portal/messages    { subject, message }
// Each list arrives as { data, pagination }; the template's server sent bare arrays and snake_case vitals keys.
//
// The member's permissions are re-read from the server on open, on every tab change, when the window comes back into
// view, and each minute — so a box the office unticks takes its menu away in a tab that is already open.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { formatAgencyDateTime, setAgencyTimezone } from '../lib/agencyClock'
import { formatDate, toLocalYMD } from '../lib/date'
import { serviceLabel } from '../lib/serviceTypes'
import { createPortalClient, listRows, PortalContext, SESSION_EXPIRED, usePortal } from './portalHttp'
import CaregiverBackgroundChecks from './CaregiverBackgroundChecks'
import './portals.css'

export interface FamilyMember {
  id: string
  clientId?: string
  name?: string | null
  relationship?: string | null
  email?: string | null
  canViewSchedule?: boolean | null
  canViewCarePlan?: boolean | null
  canViewMedications?: boolean | null
  canMessage?: boolean | null
}

interface FamilyClient {
  id?: string
  firstName?: string | null
  lastName?: string | null
  dateOfBirth?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  phone?: string | null
  agencyName?: string | null
  agencyState?: string | null
  timezone?: string | null
}

const CARD: CSSProperties = {
  background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '10px', padding: '20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
}

// The template's badge colours as ink/ground pairs.
const BADGE = (color: 'green' | 'blue' | 'yellow' | 'red'): CSSProperties => {
  const tone = color === 'green' ? 'success' : color === 'blue' ? 'info' : color === 'yellow' ? 'warning' : 'danger'
  return { display: 'inline-block', padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: `var(--hc-${tone}-bg)`, color: `var(--hc-${tone}-ink)` }
}

const MUTED: CSSProperties = { textAlign: 'center', padding: '40px', color: 'var(--hc-ink-soft)' }
const SOFT: CSSProperties = { color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }

// A calendar date (YYYY-MM-DD) is that day where the family is, not UTC midnight (lib/date).
const fmtDay = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  d ? formatDate(String(d).slice(0, 10), opts) : ''
// An instant (a vitals reading, a visit's clock-in, a message) on the agency's clock — the clock the visit times are on.
const fmtDateTime = (d: string | null | undefined) => formatAgencyDateTime(d)

/** A caregiver's certifications as text: the column is a JSON list (names, or { name } objects). */
const certNames = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((c) => (typeof c === 'string' ? c : (c as { name?: string })?.name || '')).filter(Boolean) : []

// ── Schedule ──────────────────────────────────────────────────
interface ScheduleRow { id: string; date: string; startTime: string | null; endTime: string | null; caregiverFirst: string | null; caregiverLast: string | null }

function ScheduleView() {
  const portal = usePortal()
  const [visits, setVisits] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portal.get('/api/family-portal/portal/schedule')
      .then((reply) => { if (reply) setVisits(listRows<ScheduleRow>(reply)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portal])

  if (loading) return <div style={MUTED}>Loading schedule...</div>
  if (visits.length === 0) return <div style={{ ...CARD, ...MUTED }}>No upcoming visits scheduled.</div>

  const today = toLocalYMD(new Date())
  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Upcoming Visits</h3>
      {visits.map((v) => {
        const isToday = String(v.date).slice(0, 10) === today
        return (
          <div key={v.id} style={{ ...CARD, borderLeft: isToday ? '4px solid #27ae60' : '4px solid #3498db' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
              <strong style={{ fontSize: '0.95rem' }}>
                {fmtDay(v.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                {isToday && <span style={{ ...BADGE('green'), marginLeft: '8px' }}>Today</span>}
              </strong>
              <span style={SOFT}>{String(v.startTime || '').slice(0, 5)} - {String(v.endTime || '').slice(0, 5)}</span>
            </div>
            {(v.caregiverFirst || v.caregiverLast) && <div style={{ ...SOFT, fontSize: '0.88rem' }}>Caregiver: {v.caregiverFirst} {v.caregiverLast}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ── Caregivers ────────────────────────────────────────────────
interface CaregiverRow { caregiverId: string; firstName: string | null; lastName: string | null; certifications: unknown }

function CaregiversView({ agencyState }: { agencyState: string | null }) {
  const portal = usePortal()
  const [caregivers, setCaregivers] = useState<CaregiverRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portal.get('/api/family-portal/portal/caregivers')
      .then((reply) => { if (reply) setCaregivers(listRows<CaregiverRow>(reply)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portal])

  if (loading) return <div style={MUTED}>Loading caregivers...</div>
  if (caregivers.length === 0) return <div style={{ ...CARD, ...MUTED }}>No caregivers currently assigned.</div>

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Assigned Caregivers</h3>
      {caregivers.map((cg) => {
        const certs = certNames(cg.certifications)
        return (
          <div key={cg.caregiverId} style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* White initials on a fixed green gradient, in both themes. */}
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%', background: 'linear-gradient(135deg, #2d5016, #4a8c1c)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, flexShrink: 0,
              }}>
                {cg.firstName?.[0]}{cg.lastName?.[0]}
              </div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{cg.firstName} {cg.lastName}</div>
            </div>
            {certs.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                {certs.map((cert, i) => <span key={i} style={BADGE('blue')}>{cert}</span>)}
              </div>
            )}
            <CaregiverBackgroundChecks caregiverId={cg.caregiverId} apiBase="/api/family-portal" agencyState={agencyState} />
          </div>
        )
      })}
    </div>
  )
}

// ── Care Plan ─────────────────────────────────────────────────
interface Plan { id?: string; serviceType?: string | null; frequency?: string | null; careGoals?: string | null; specialInstructions?: string | null; precautions?: string | null }
interface Note { id: string; startTime: string | null; durationMinutes: number | null; notes: string | null; caregiverFirst: string | null; caregiverLast: string | null }

function CarePlanView() {
  const portal = usePortal()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      portal.get<Plan>('/api/family-portal/portal/care-plan').catch(() => null),
      portal.get('/api/family-portal/portal/notes').catch(() => null),
    ]).then(([p, n]) => {
      // No active plan is {} (one record is an object, RULEBOOK §3): only a plan with an id is one.
      if (p && p.id) setPlan(p)
      setNotes(listRows<Note>(n))
    }).finally(() => setLoading(false))
  }, [portal])

  if (loading) return <div style={MUTED}>Loading care plan...</div>

  const section = (label: string, text: string | null | undefined) => text ? (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontWeight: 600, color: 'var(--hc-ink)', marginBottom: '4px', fontSize: '0.85rem' }}>{label}</div>
      <div style={{ color: 'var(--hc-ink-soft)', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  ) : null

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Care Plan</h3>
      {plan ? (
        <div style={CARD}>
          {plan.serviceType && (
            <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '1rem' }}>
              {serviceLabel(plan.serviceType)}
              {plan.frequency && <span style={{ fontWeight: 400, color: 'var(--hc-ink-soft)' }}> · {plan.frequency}</span>}
            </div>
          )}
          {section('Goals', plan.careGoals)}
          {section('Instructions', plan.specialInstructions)}
          {section('Precautions', plan.precautions)}
        </div>
      ) : (
        <div style={{ ...CARD, textAlign: 'center', color: 'var(--hc-ink-soft)' }}>No active care plan found.</div>
      )}

      {notes.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 16px', fontSize: '1.1rem' }}>Recent Visit Notes</h3>
          {notes.slice(0, 10).map((n) => (
            <div key={n.id} style={CARD}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                <strong style={{ fontSize: '0.88rem' }}>{n.caregiverFirst} {n.caregiverLast}</strong>
                <span style={{ color: 'var(--hc-ink-soft)', fontSize: '0.8rem' }}>
                  {fmtDateTime(n.startTime)}
                  {n.durationMinutes ? ` · ${n.durationMinutes} min` : ''}
                </span>
              </div>
              {n.notes && <div style={{ ...SOFT, whiteSpace: 'pre-wrap' }}>{n.notes}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── Medications ───────────────────────────────────────────────
interface Med { id: string; name: string; dosage: string | null; frequency: string | null; route: string | null; prescribedBy: string | null; instructions: string | null; isPrn: boolean | null; notes: string | null }

function MedicationsView() {
  const portal = usePortal()
  const [meds, setMeds] = useState<Med[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portal.get('/api/family-portal/portal/medications')
      .then((reply) => { if (reply) setMeds(listRows<Med>(reply)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portal])

  if (loading) return <div style={MUTED}>Loading medications...</div>
  if (meds.length === 0) return <div style={{ ...CARD, ...MUTED }}>No active medications on file.</div>

  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Active Medications</h3>
      {meds.map((m) => (
        <div key={m.id} style={CARD}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>
            {m.name}{m.isPrn && <span style={{ ...BADGE('yellow'), marginLeft: '8px' }}>As needed</span>}
          </div>
          {m.dosage && <div style={SOFT}>Dosage: {m.dosage}</div>}
          {m.frequency && <div style={SOFT}>Frequency: {m.frequency}</div>}
          {m.route && <div style={SOFT}>Route: {m.route}</div>}
          {m.prescribedBy && <div style={SOFT}>Prescriber: {m.prescribedBy}</div>}
          {m.instructions && <div style={SOFT}>Instructions: {m.instructions}</div>}
          {m.notes && <div style={{ color: 'var(--hc-ink-soft)', fontSize: '0.82rem', marginTop: '6px', fontStyle: 'italic' }}>{m.notes}</div>}
        </div>
      ))}
    </div>
  )
}

// ── Vitals (the medications permission) ───────────────────────
type VitalKey = 'systolicBp' | 'diastolicBp' | 'pulse' | 'respirations' | 'oxygenSaturation' | 'temperatureF' | 'bloodGlucose' | 'weightLbs' | 'painScale'
const VITAL_FIELDS: Array<{ k: VitalKey; label: string; unit: string }> = [
  { k: 'systolicBp', label: 'BP (sys)', unit: '' },
  { k: 'diastolicBp', label: 'BP (dia)', unit: '' },
  { k: 'pulse', label: 'Pulse', unit: 'bpm' },
  { k: 'respirations', label: 'Resp', unit: '/min' },
  { k: 'oxygenSaturation', label: 'O₂ Sat', unit: '%' },
  { k: 'temperatureF', label: 'Temp', unit: '°F' },
  { k: 'bloodGlucose', label: 'Glucose', unit: 'mg/dL' },
  { k: 'weightLbs', label: 'Weight', unit: 'lbs' },
  { k: 'painScale', label: 'Pain', unit: '/10' },
]
type Vital = { id: string; recordedAt: string | null; notes: string | null; caregiverFirst: string | null; caregiverLast: string | null } & Partial<Record<VitalKey, string | number | null>>

function VitalsView() {
  const portal = usePortal()
  const [vitals, setVitals] = useState<Vital[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portal.get('/api/family-portal/portal/vitals')
      .then((reply) => { if (reply) setVitals(listRows<Vital>(reply)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portal])

  if (loading) return <div style={MUTED}>Loading vitals...</div>
  if (vitals.length === 0) return <div style={{ ...CARD, ...MUTED }}>No vitals recorded yet.</div>

  const latest = vitals[0]
  return (
    <div>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Latest Vitals</h3>
      <div style={{ ...CARD, marginBottom: 20 }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)', marginBottom: 8 }}>
          Recorded {fmtDateTime(latest.recordedAt)}
          {latest.caregiverFirst && ` by ${latest.caregiverFirst} ${latest.caregiverLast?.[0] || ''}.`}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {VITAL_FIELDS.map((f) => latest[f.k] != null && (
            <div key={f.k} style={{ background: 'var(--hc-subtle)', padding: '8px 10px', borderRadius: 6 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)', fontWeight: 700 }}>{f.label}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--hc-ink)' }}>
                {latest[f.k]} <span style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)', fontWeight: 400 }}>{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
        {latest.notes && <div style={{ marginTop: 12, color: 'var(--hc-ink-soft)', fontSize: '0.85rem', fontStyle: 'italic' }}>{latest.notes}</div>}
      </div>

      <h4 style={{ margin: '20px 0 12px', fontSize: '0.95rem', color: 'var(--hc-ink-soft)' }}>History ({vitals.length})</h4>
      <div style={{ ...CARD, overflowX: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', color: 'var(--hc-ink)' }}>
          <thead>
            <tr style={{ background: 'var(--hc-subtle)' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>When</th>
              {VITAL_FIELDS.map((f) => <th key={f.k} style={{ padding: '6px 8px', textAlign: 'right' }}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {vitals.map((v) => (
              <tr key={v.id} style={{ borderTop: '1px solid var(--hc-line)' }}>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{fmtDateTime(v.recordedAt)}</td>
                {VITAL_FIELDS.map((f) => <td key={f.k} style={{ padding: '5px 8px', textAlign: 'right' }}>{v[f.k] != null ? v[f.k] : '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Messages ──────────────────────────────────────────────────
interface FamilyMessage { id: string; direction: 'inbound' | 'outbound'; subject: string | null; message: string; createdAt: string }

function MessagesView({ canMessage }: { canMessage: boolean }) {
  const portal = usePortal()
  const [messages, setMessages] = useState<FamilyMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const fetchMessages = useCallback(() => {
    portal.get('/api/family-portal/portal/messages')
      .then((reply) => { if (reply) setMessages(listRows<FamilyMessage>(reply)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portal])

  // The office's reply arrives without a reload: re-read every 30 seconds while this tab is open, and on focus.
  useEffect(() => {
    fetchMessages()
    const timer = setInterval(fetchMessages, 30000)
    const onFocus = () => fetchMessages()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [fetchMessages])

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    setError('')
    try {
      await portal.send('POST', '/api/family-portal/portal/messages', { subject: subject.trim() || 'General Inquiry', message: message.trim() })
      setSubject('')
      setMessage('')
      fetchMessages()
    } catch (err) {
      const m = (err as Error).message
      setError(m === SESSION_EXPIRED ? 'Your session has ended — please sign in again.' : (m || 'Your message could not be sent.'))
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div style={MUTED}>Loading messages...</div>

  const input: CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' }
  return (
    <div>
      {canMessage && (
        <>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Send a Message</h3>
          <div style={CARD}>
            {error && <div className="alert alert-error" style={{ marginBottom: '10px' }}>{error}</div>}
            <form onSubmit={handleSend}>
              <div style={{ marginBottom: '10px' }}>
                <input className="hcp-field" type="text" placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} style={input} />
              </div>
              <div style={{ marginBottom: '10px' }}>
                <textarea className="hcp-field" placeholder="Type your message..." value={message} onChange={(e) => setMessage(e.target.value)} rows={3} required style={{ ...input, resize: 'vertical' }} />
              </div>
              <button
                type="submit"
                disabled={sending || !message.trim()}
                style={{
                  background: '#1e7e34', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer',
                  fontWeight: 600, fontSize: '0.85rem', opacity: sending || !message.trim() ? 0.6 : 1,
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
          {messages.map((m) => {
            const inbound = m.direction === 'inbound'
            return (
              <div key={m.id} style={{ ...CARD, borderLeft: inbound ? '4px solid #3498db' : '4px solid #27ae60' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={BADGE(inbound ? 'blue' : 'green')}>{inbound ? 'You' : 'Care Team'}</span>
                  <span style={{ color: 'var(--hc-ink-soft)', fontSize: '0.8rem' }}>{fmtDateTime(m.createdAt)}</span>
                </div>
                {m.subject && <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '4px' }}>{m.subject}</div>}
                <div style={{ ...SOFT, whiteSpace: 'pre-wrap' }}>{m.message}</div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────
type TabKey = 'overview' | 'schedule' | 'caregivers' | 'care-plan' | 'medications' | 'vitals' | 'messages'
interface Permissions { canViewSchedule: boolean; canViewCarePlan: boolean; canViewMedications: boolean; canMessage: boolean }

function OverviewView({ client, userName, permissions, setActiveTab }: { client: FamilyClient | null; userName: string; permissions: Permissions; setActiveTab: (k: TabKey) => void }) {
  const quickLinks: Array<{ key: TabKey; label: string; icon: string; color: string }> = []
  if (permissions.canViewSchedule) quickLinks.push({ key: 'schedule', label: 'View Schedule', icon: '📅', color: '#3498db' })
  if (permissions.canViewCarePlan) quickLinks.push({ key: 'care-plan', label: 'View Care Plan', icon: '📋', color: '#e67e22' })
  if (permissions.canViewMedications) quickLinks.push({ key: 'medications', label: 'View Medications', icon: '💊', color: '#9b59b6' })
  if (permissions.canMessage) quickLinks.push({ key: 'messages', label: 'Send Message', icon: '💬', color: '#27ae60' })

  const first = client?.firstName
  const last = client?.lastName
  const dob = client?.dateOfBirth

  return (
    <div>
      <div style={{ ...CARD, background: 'linear-gradient(135deg, var(--hcp-forest-tint) 0%, var(--hcp-forest-tint-end) 100%)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: 'var(--hcp-forest)' }}>Welcome, {userName}</h2>
        {client && (
          <p style={{ margin: 0, color: 'var(--hc-ink-soft)', fontSize: '0.9rem' }}>
            Viewing care information for <strong>{first} {last}</strong>
          </p>
        )}
      </div>

      {client && (
        <div style={CARD}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Client Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '0.88rem' }}>
            <div><span style={{ color: 'var(--hc-ink-soft)' }}>Name:</span> {first} {last}</div>
            {dob && <div><span style={{ color: 'var(--hc-ink-soft)' }}>DOB:</span> {fmtDay(dob)}</div>}
            {client.phone && <div><span style={{ color: 'var(--hc-ink-soft)' }}>Phone:</span> {client.phone}</div>}
            {client.address && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: 'var(--hc-ink-soft)' }}>Address:</span> {client.address}
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
          {quickLinks.map((link) => (
            <button
              key={link.key}
              onClick={() => setActiveTab(link.key)}
              style={{ ...CARD, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', marginBottom: 0 }}
            >
              <span style={{
                fontSize: '1.5rem', width: '44px', height: '44px', background: link.color + '18', borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {link.icon}
              </span>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--hc-ink)' }}>{link.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── The family portal ─────────────────────────────────────────
export interface FamilyPortalProps {
  user: FamilyMember
  token: string
  onLogout: () => void
  onPaused?: () => void
}

export default function FamilyPortal({ user, token, onLogout, onPaused }: FamilyPortalProps) {
  const portal = useMemo(() => createPortalClient(token, { expired: onLogout, paused: () => onPaused?.() }), [token, onLogout, onPaused])
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [client, setClient] = useState<FamilyClient | null>(null)
  const [member, setMember] = useState<FamilyMember>(user)

  const refreshMember = useCallback(() => {
    portal.get<FamilyMember>('/api/family-portal/portal/me')
      .then((data) => { if (data) setMember(data) })
      .catch(() => {})
  }, [portal])

  useEffect(() => {
    portal.get<FamilyClient>('/api/family-portal/portal/client')
      .then((data) => { if (data) { setAgencyTimezone(data.timezone); setClient(data) } })
      .catch(() => {})
    refreshMember()
    const onVisible = () => { if (document.visibilityState === 'visible') refreshMember() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(refreshMember, 60000)
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(timer) }
  }, [portal, refreshMember])

  useEffect(() => { if (activeTab !== 'overview') refreshMember() }, [activeTab, refreshMember])

  const permissions: Permissions = {
    canViewSchedule: !!member?.canViewSchedule,
    canViewCarePlan: !!member?.canViewCarePlan,
    canViewMedications: !!member?.canViewMedications,
    canMessage: !!member?.canMessage,
  }

  const tabs: Array<{ key: TabKey; label: string; icon: string }> = [{ key: 'overview', label: 'Overview', icon: '🏠' }]
  if (permissions.canViewSchedule) tabs.push({ key: 'schedule', label: 'Schedule', icon: '📅' })
  if (permissions.canViewSchedule) tabs.push({ key: 'caregivers', label: 'Caregivers', icon: '👤' })
  if (permissions.canViewCarePlan) tabs.push({ key: 'care-plan', label: 'Care Plan', icon: '📋' })
  if (permissions.canViewMedications) tabs.push({ key: 'medications', label: 'Medications', icon: '💊' })
  if (permissions.canViewMedications) tabs.push({ key: 'vitals', label: 'Vitals', icon: '❤️' })
  if (permissions.canMessage) tabs.push({ key: 'messages', label: 'Messages', icon: '💬' })
  const tabKeys = tabs.map((t) => t.key).join()

  // A tab whose permission was just taken away closes back to the overview.
  useEffect(() => {
    if (!tabKeys.split(',').includes(activeTab)) setActiveTab('overview')
  }, [activeTab, tabKeys])

  const userName = member?.name || 'Family Member'
  const agencyState = client?.agencyState || null

  const renderView = () => {
    switch (activeTab) {
      case 'schedule': return permissions.canViewSchedule ? <ScheduleView /> : null
      case 'caregivers': return permissions.canViewSchedule ? <CaregiversView agencyState={agencyState} /> : null
      case 'care-plan': return permissions.canViewCarePlan ? <CarePlanView /> : null
      case 'medications': return permissions.canViewMedications ? <MedicationsView /> : null
      case 'vitals': return permissions.canViewMedications ? <VitalsView /> : null
      case 'messages': return permissions.canMessage ? <MessagesView canMessage /> : null
      default: return <OverviewView client={client} userName={userName} permissions={permissions} setActiveTab={setActiveTab} />
    }
  }

  return (
    <PortalContext.Provider value={portal}>
      <div style={{ minHeight: '100vh', background: 'var(--hc-ground)' }}>
        {/* White on a fixed green gradient, in both themes. */}
        <div style={{
          background: 'linear-gradient(135deg, #2d5016 0%, #4a8c1c 100%)', color: '#fff', padding: '0 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: '60px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <span style={{ fontSize: '1.4rem' }}>🏠</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>{client?.agencyName || 'Family Portal'}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>Family Portal</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            <span style={{ fontSize: '0.85rem', opacity: 0.95 }}>{userName}</span>
            <button
              onClick={onLogout}
              style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Sign Out
            </button>
          </div>
        </div>

        <div style={{ background: 'var(--hc-surface)', borderBottom: '1px solid var(--hc-line)', display: 'flex', padding: '0 12px', gap: '4px', overflowX: 'auto' }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: 'none', border: 'none', padding: '14px 14px', cursor: 'pointer', fontSize: '0.88rem',
                  fontWeight: active ? 600 : 400, color: active ? 'var(--hcp-forest)' : 'var(--hc-ink-soft)',
                  borderBottom: active ? '3px solid var(--hcp-forest)' : '3px solid transparent',
                  whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            )
          })}
        </div>

        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
          {renderView()}
        </div>
      </div>
    </PortalContext.Provider>
  )
}
