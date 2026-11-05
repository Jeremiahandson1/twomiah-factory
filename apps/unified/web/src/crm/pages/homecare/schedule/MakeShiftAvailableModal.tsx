// Moved from templates/crm-homecare/frontend/src/components/admin/MakeShiftAvailableModal.tsx.
//
// The office takes ONE visit off the schedule and offers it as an open shift: who can see and accept it, whether the
// first to accept gets it right away, and whether to text them. `date` is the visit's own date — a repeating shift has
// none of its own, and posting without one is what made "Mark Available" fail for weekly visits.
//
// Server (server/crm/homecare/scheduling/openShifts.ts):
//   GET  /api/open-shifts/caregivers-available?date&startTime&endTime&excludeScheduleId — a list reply of
//        { id, firstName, lastName, phone, email, available, busy, timeOff, notified, expiredCertifications, blockedByCredential } (data: caregiversForSlot)
//   POST /api/open-shifts/from-schedule/:scheduleId { date, visibleTo, autoAssign, bonusAmount, urgency } — the open shift
//   POST /api/open-shifts/:id/notify { caregiverIds, customMessage, sms } — { success, notified, texted, total }
import { useEffect, useState, type CSSProperties } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatDate } from '../lib/date'
import { C, dialog, field, overlay, tint } from './theme'

/** The visit being offered: a schedule row, or the Schedule Hub's edit box (its date may be the edited day). */
export interface OfferedVisit {
  id: string
  date?: string | null
  startTime?: string | null
  endTime?: string | null
  caregiverId?: string | null
}

export interface OfferResult {
  openShift: { id: string } | null
  notified: number
  texted: number
  warning?: string
}

interface Props {
  schedule: OfferedVisit
  date?: string | null
  clientName?: string
  caregiverName?: string
  onClose: () => void
  onDone?: (r: OfferResult) => void
}

interface Candidate {
  id: string
  firstName: string
  lastName: string
  phone?: string | null
  available: boolean
  busy: boolean
  timeOff: boolean
  /** 'CPR (expired 2026-10-01)' — only for an agency with credential tracking on. */
  expiredCertifications?: string[]
  /** The agency does not let an expired caregiver take a shift. */
  blockedByCredential?: boolean
}

const fmtTime = (t: string) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const fmtDate = (d: string) => (d ? formatDate(d, { weekday: 'long', month: 'short', day: 'numeric' }) : '')

export default function MakeShiftAvailableModal({ schedule, date, clientName, caregiverName, onClose, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [bonus, setBonus] = useState('0')
  const [urgency, setUrgency] = useState('normal')
  const [customMessage, setCustomMessage] = useState('')
  const [eligible, setEligible] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [autoAssign, setAutoAssign] = useState(true)
  const [sendText, setSendText] = useState(true)
  const [error, setError] = useState('')
  // A refusal clears once they change what it was about — never left over a caregiver now ticked or a bonus now fixed.
  useEffect(() => { setError('') }, [selected, bonus])
  const [submitting, setSubmitting] = useState(false)

  const visitDate = date || schedule.date || ''
  const startTime = (schedule.startTime || '').slice(0, 5)
  const endTime = (schedule.endTime || '').slice(0, 5)
  const currentCaregiverId = schedule.caregiverId

  useEffect(() => {
    if (!visitDate) { setLoading(false); setError('Open the shift from the day you want to post, so it knows which date.'); return }
    let live = true
    const fetchEligible = async () => {
      try {
        const params: Record<string, string> = { date: visitDate, startTime, endTime }
        if (schedule.id) params.excludeScheduleId = schedule.id
        const reply = await api.get('/api/open-shifts/caregivers-available', params)
        const filtered = rows<Candidate>(reply).filter((c) => c.id !== currentCaregiverId)
        if (!live) return
        setEligible(filtered)
        setSelected(new Set(filtered.filter((c) => c.available).map((c) => c.id)))
      } catch (e) {
        if (live) setError(`Failed to load caregivers: ${errorMessage(e)}`)
      } finally {
        if (live) setLoading(false)
      }
    }
    fetchEligible()
    return () => { live = false }
  }, [schedule, visitDate, startTime, endTime, currentCaregiverId])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAllAvailable = () => setSelected(new Set(eligible.filter((c) => c.available).map((c) => c.id)))
  const clearAll = () => setSelected(new Set())

  const submit = async () => {
    setError('')
    if (selected.size === 0) { setError('Pick at least one caregiver who can see and accept this shift.'); return }
    const bonusNum = bonus.trim() === '' ? 0 : Number(bonus)
    if (!Number.isFinite(bonusNum) || bonusNum < 0) { setError('Pickup bonus must be a dollar amount of 0 or more.'); return }
    setSubmitting(true)
    try {
      const ids = Array.from(selected)
      const posted = await api.post(`/api/open-shifts/from-schedule/${schedule.id}`, {
        date: visitDate, visibleTo: ids, autoAssign, bonusAmount: bonusNum, urgency,
      }) as { id: string }

      // The shift IS posted at this point — say so even if telling people failed.
      let data: { notified?: number; texted?: number }
      try {
        data = await api.post(`/api/open-shifts/${posted.id}/notify`, {
          caregiverIds: ids, customMessage: customMessage.trim() || undefined, sms: sendText,
        })
      } catch (e) {
        onDone?.({ openShift: posted, notified: 0, texted: 0, warning: `Posted, but notifying failed: ${errorMessage(e)}` })
        onClose()
        return
      }
      onDone?.({ openShift: posted, notified: data.notified || 0, texted: data.texted || 0 })
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Failed to post the shift'))
    } finally {
      setSubmitting(false)
    }
  }

  const header: CSSProperties = {
    padding: '1rem 1.25rem', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  }
  const footer: CSSProperties = {
    padding: '0.75rem 1.25rem', borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap',
  }
  const blue = tint('blue')
  const radio = (on: boolean): CSSProperties => ({
    display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.55rem 0.75rem', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${on ? blue.ink : C.line}`, background: on ? blue.bg : C.surface, marginBottom: '0.4rem', fontSize: '0.88rem',
  })
  const smallBtn: CSSProperties = {
    background: 'none', border: `1px solid ${C.line}`, borderRadius: '6px', padding: '0.25rem 0.5rem', fontSize: '0.78rem', cursor: 'pointer', color: C.ink,
  }
  const red = tint('red')
  const amber = tint('amber')

  return (
    <div style={overlay(2100)} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...dialog, maxWidth: '600px', overflow: 'hidden', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={header}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>📋 Move to Available Shifts</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: C.muted }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '1.25rem' }}>
          <div style={{ background: C.subtle, padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
            <div style={{ fontWeight: 600 }}>{clientName || 'Client'}</div>
            <div style={{ color: C.ink }}><strong>{fmtDate(visitDate)}</strong> · {fmtTime(startTime)} – {fmtTime(endTime)}</div>
            {caregiverName && (
              <div style={{ color: C.inkSoft, fontSize: '0.82rem', marginTop: '0.25rem' }}>
                Now assigned to <strong>{caregiverName}</strong> — it stays with them until someone takes it. Only this one day is offered.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <strong style={{ fontSize: '0.95rem' }}>Who can see and accept it ({selected.size})</strong>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={selectAllAvailable} style={smallBtn}>All available</button>
              <button type="button" onClick={clearAll} style={smallBtn}>Clear</button>
            </div>
          </div>

          <div style={{ border: `1px solid ${C.line}`, borderRadius: '8px', maxHeight: '240px', overflow: 'auto', marginBottom: '1rem' }}>
            {loading && <div style={{ padding: '1rem', color: C.muted, textAlign: 'center' }}>Loading caregivers…</div>}
            {!loading && eligible.length === 0 && !error && <div style={{ padding: '1rem', color: C.muted, textAlign: 'center' }}>No other active caregivers found.</div>}
            {!loading && eligible.map((c) => {
              const isSelected = selected.has(c.id)
              return (
                <label key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem',
                  borderBottom: `1px solid ${C.subtle}`, cursor: 'pointer',
                  background: isSelected ? blue.bg : C.surface, opacity: c.available ? 1 : 0.6,
                }}>
                  <input type="checkbox" checked={isSelected} disabled={!!c.blockedByCredential} onChange={() => toggle(c.id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                      {c.firstName} {c.lastName}
                      {c.timeOff && <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: amber.ink, fontWeight: 600 }}>TIME OFF</span>}
                      {c.busy && <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: red.ink, fontWeight: 600 }}>BUSY THIS TIME</span>}
                      {c.expiredCertifications && c.expiredCertifications.length > 0 && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: red.ink, fontWeight: 600 }} title={c.expiredCertifications.join(', ')}>
                          {c.blockedByCredential ? 'EXPIRED CREDENTIAL — CANNOT TAKE SHIFTS' : 'EXPIRED CREDENTIAL'}
                        </span>
                      )}
                    </div>
                    {c.expiredCertifications && c.expiredCertifications.length > 0 && <div style={{ fontSize: '0.74rem', color: red.ink }}>{c.expiredCertifications.join(', ')}</div>}
                    {c.phone && <div style={{ fontSize: '0.78rem', color: C.inkSoft }}>{c.phone}</div>}
                  </div>
                </label>
              )
            })}
          </div>

          <strong style={{ display: 'block', fontSize: '0.95rem', marginBottom: '0.4rem' }}>When someone accepts</strong>
          <label style={radio(autoAssign)}>
            <input type="radio" checked={autoAssign} onChange={() => setAutoAssign(true)} />
            <span><strong>Give it to the first one who accepts</strong><br /><span style={{ color: C.inkSoft, fontSize: '0.8rem' }}>It moves onto their schedule right away and you get a notification.</span></span>
          </label>
          <label style={radio(!autoAssign)}>
            <input type="radio" checked={!autoAssign} onChange={() => setAutoAssign(false)} />
            <span><strong>Wait for my approval</strong><br /><span style={{ color: C.inkSoft, fontSize: '0.8rem' }}>Approve it in Schedule Hub → Staffing → Open Shifts.</span></span>
          </label>

          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.75rem 0', fontSize: '0.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={sendText} onChange={(e) => setSendText(e.target.checked)} />
            <span><strong>Also text them</strong> (a text message to their phone)</span>
          </label>
          {/* The picked caregivers are always told IN THE APP (bell and phone notification) — that is how they find the
              offer. This box only adds a text; unticked, no text is sent (the server's notify texts only when sms is
              true). */}
          <div style={{ margin: '-0.5rem 0 0.75rem 1.6rem', fontSize: '0.78rem', color: C.inkSoft }}>
            Either way, the caregivers you picked get an in-app notification and see it under Open Shifts.
          </div>

          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Optional message</label>
          <textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)}
            placeholder="e.g. Easy client, no transfers needed" rows={2}
            style={{ ...field, resize: 'vertical', marginBottom: '0.75rem', fontFamily: 'inherit', fontSize: '0.9rem', boxSizing: 'border-box' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Pickup bonus ($)</label>
              <input type="number" step="0.01" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)}
                style={{ ...field, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>Urgency</label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} style={field}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {error && (
            <div style={{ marginTop: '0.75rem', background: red.bg, color: red.ink, padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem' }}>{error}</div>
          )}
        </div>

        <div style={footer}>
          <button onClick={onClose} className="hc-btn hc-btn-secondary" disabled={submitting}>Cancel</button>
          <button onClick={submit} className="hc-btn hc-btn-primary" disabled={submitting || loading || selected.size === 0 || !visitDate}>
            {submitting ? 'Posting…' : `Post to ${selected.size} caregiver${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
