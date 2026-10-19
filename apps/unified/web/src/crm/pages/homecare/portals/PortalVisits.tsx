// The client portal's My Schedule: upcoming visits, with a note, cancel and reschedule, and the answer to an office
// counter-offer. Moved from templates/crm-homecare/frontend/src/components/portal/PortalVisits.tsx.
//
// Server (server/crm/homecare/portals/portalVisits.ts, on /api/portal):
//   GET  /visits                          a list of { id, scheduledDate, startTime, endTime ('HH:MM:SS'), status, notes,
//                                         clientNotes, caregiverId, scheduleId, caregiverFirstName, caregiverLastName,
//                                         caregiverPhone, source ('schedule' | 'scheduled_visit'), canChange }
//   GET  /change-requests                 a list of open requests (VCR_COLS, camelCase: visitDate, originalStartTime,
//                                         caregiverId, requestType, status, counterDate, counterStartTime, counterEndTime,
//                                         counterMessage)
//   PUT  /visits/note                     { source, visitId, scheduleId, visitDate, caregiverId, startTime, endTime, note }
//   POST /visits/cancel-request           the same identity + { reason } → the request + { autoApplied }
//   GET  /caregivers/:id/availability     ?durationMinutes → a list of { date, dayOfWeek, startTime, endTime }
//   POST /visits/reschedule-request       the identity + { proposedDate, proposedStartTime, proposedEndTime }
//   PUT  /change-requests/:id/respond     { accept } → { success, status }
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useToast } from '../../../../shared'
import { formatDate as formatDay, parseLocalDate, toLocalYMD } from '../lib/date'
import { listRows, usePortal } from './portalHttp'

interface Visit {
  id: string
  scheduledDate: string
  startTime: string
  endTime: string
  status: string
  notes?: string | null
  clientNotes?: string | null
  caregiverId: string
  scheduleId?: string | null
  caregiverFirstName?: string | null
  caregiverLastName?: string | null
  caregiverPhone?: string | null
  source: string
  canChange?: boolean
}

interface ChangeRequest {
  id: string
  requestType: string
  status: string
  visitDate: string
  originalStartTime: string
  caregiverId: string
  counterDate?: string | null
  counterStartTime?: string | null
  counterEndTime?: string | null
  counterMessage?: string | null
}

interface Slot { date: string; dayOfWeek: number; startTime: string; endTime: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

// Ink and ground in pairs (homecare.css and ./portals.css tokens).
const STATUS: Record<string, { bg: string; color: string; label: string }> = {
  scheduled: { bg: 'var(--hcp-tint)', color: 'var(--hcp-navy)', label: 'Scheduled' },
  in_progress: { bg: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)', label: 'In Progress' },
  completed: { bg: 'var(--hc-subtle)', color: 'var(--hc-ink-soft)', label: 'Completed' },
  cancelled: { bg: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', label: 'Cancelled' },
  no_show: { bg: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', label: 'No Show' },
}

const pill = (bg: string, color: string, label: string) => (
  <span style={{ background: bg, color, padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>{label}</span>
)

const statusBadge = (status: string) => {
  const s = STATUS[status] || STATUS.scheduled
  return pill(s.bg, s.color, s.label)
}

const requestBadge = (cr: ChangeRequest) => {
  if (cr.status === 'counter_offered') return pill('var(--hcp-violet-bg)', 'var(--hcp-violet-ink)', 'Counter-Offer')
  return pill('var(--hc-warning-bg)', 'var(--hc-warning-ink)', cr.requestType === 'cancel' ? 'Cancel Pending' : 'Reschedule Pending')
}

// A visit's date is a calendar day (lib/date: that day, never UTC midnight).
const formatDate = (dateStr: string | null | undefined) =>
  dateStr ? formatDay(dateStr, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''

const formatShortDate = (dateStr: string | null | undefined) =>
  dateStr ? formatDay(dateStr, { weekday: 'short', month: 'short', day: 'numeric' }) : ''

const formatTime = (timeStr: string | null | undefined) => {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${ampm}`
}

const isToday = (dateStr: string) => toLocalYMD(new Date()) === dateStr
const isTomorrow = (dateStr: string) => toLocalYMD(new Date(Date.now() + 86400000)) === dateStr
const dayLabel = (dateStr: string) => {
  if (isToday(dateStr)) return 'Today'
  if (isTomorrow(dateStr)) return 'Tomorrow'
  return formatDate(dateStr)
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The visit's identity, as the server's visitIdentity reads it.
const visitPayload = (visit: Visit) => ({
  source: visit.source,
  visitId: visit.source === 'scheduled_visit' ? visit.id : null,
  scheduleId: visit.scheduleId || null,
  visitDate: visit.scheduledDate,
  caregiverId: visit.caregiverId,
  startTime: visit.startTime,
  endTime: visit.endTime,
})

// ── Buttons ─────────────────────────────────────────────────────────────────

const actionBtn = (color: string): CSSProperties => ({
  background: 'none', border: `1px solid ${color}`, color,
  padding: '5px 12px', borderRadius: '6px', cursor: 'pointer',
  fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
})

const primaryBtn: CSSProperties = {
  background: 'var(--hcp-navy-fill)', border: 'none', color: '#fff',
  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
}

const secondaryBtn: CSSProperties = {
  background: 'var(--hc-subtle)', border: 'none', color: 'var(--hc-ink-soft)',
  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
}

// The template's #e74c3c held white at 3.8:1; #c0392b is 5.4:1, in both themes.
const dangerBtn: CSSProperties = {
  background: '#c0392b', border: 'none', color: '#fff',
  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
}

const textarea: CSSProperties = {
  width: '100%', padding: '12px', borderRadius: '8px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box',
}

// ── Overlay / modal base ────────────────────────────────────────────────────

const Overlay = ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
  <div
    onClick={onClose}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '16px', padding: '28px',
        width: '100%', maxWidth: '480px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}
    >
      {children}
    </div>
  </div>
)

// ── Component ────────────────────────────────────────────────────────────────

export default function PortalVisits() {
  const portal = usePortal()
  const toast = useToast()
  const [visits, setVisits] = useState<Visit[]>([])
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modal, setModal] = useState<'note' | 'cancel' | 'reschedule' | null>(null)
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [availSlots, setAvailSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)

  // ── Data loading ────────────────────────────────────────────────────────

  const loadVisits = () =>
    portal.get('/api/portal/visits')
      .then((reply) => { if (reply) setVisits(listRows<Visit>(reply)) })
      .catch((err: Error) => setError(err.message))

  const loadChangeRequests = () =>
    portal.get('/api/portal/change-requests')
      .then((reply) => { if (reply) setChangeRequests(listRows<ChangeRequest>(reply)) })
      .catch(() => {})

  useEffect(() => {
    Promise.all([loadVisits(), loadChangeRequests()]).finally(() => setLoading(false))
  }, [portal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Change requests by visit: date + start time + caregiver.
  const crByKey: Record<string, ChangeRequest> = {}
  changeRequests.forEach((cr) => { crByKey[`${cr.visitDate}|${cr.originalStartTime}|${cr.caregiverId}`] = cr })
  const getRequestForVisit = (visit: Visit) => crByKey[`${visit.scheduledDate}|${visit.startTime}|${visit.caregiverId}`] || null

  // ── Open modals ─────────────────────────────────────────────────────────

  const openNote = (visit: Visit) => {
    setSelectedVisit(visit)
    setNoteText(visit.clientNotes || '')
    setModal('note')
  }

  const openCancel = (visit: Visit) => {
    setSelectedVisit(visit)
    setCancelReason('')
    setModal('cancel')
  }

  const openReschedule = (visit: Visit) => {
    setSelectedVisit(visit)
    setSelectedSlot(null)
    setAvailSlots([])
    setModal('reschedule')
    loadAvailability(visit.caregiverId, visit)
  }

  const closeModal = () => {
    setModal(null)
    setSelectedVisit(null)
    setSubmitting(false)
  }

  // ── API actions ─────────────────────────────────────────────────────────

  const submitNote = async () => {
    if (!noteText.trim() || !selectedVisit) return
    setSubmitting(true)
    try {
      await portal.send('PUT', '/api/portal/visits/note', { ...visitPayload(selectedVisit), note: noteText.trim() })
      setVisits((prev) => prev.map((v) => (v.id === selectedVisit.id ? { ...v, clientNotes: noteText.trim() } : v)))
      closeModal()
    } catch (err) {
      setError((err as Error).message)
      setSubmitting(false)
    }
  }

  // The server's rule (visits/visitChanges.ts, CANCEL_NOTICE_HOURS): a reason is required; with 24+ hours' notice the
  // visit comes off the schedule at once, with less the office confirms it. A refusal (no reason, visit already
  // started) is shown here and the pop-up stays open.
  const submitCancel = async () => {
    if (!selectedVisit) return
    if (!cancelReason.trim()) { toast.error('Please tell us why you are cancelling.'); return }
    setSubmitting(true)
    try {
      const resp = await portal.send<{ autoApplied?: boolean }>('POST', '/api/portal/visits/cancel-request', { ...visitPayload(selectedVisit), reason: cancelReason.trim() })
      // An applied cancel takes effect at once: reload the visits so it disappears now, not just the requests.
      if (resp?.autoApplied) await loadVisits()
      await loadChangeRequests()
      closeModal()
      toast.success(resp?.autoApplied
        ? 'Your visit has been cancelled and removed from the schedule. Your caregiver and the office have been told.'
        : "Your cancellation request was sent. With less than 24 hours' notice the office confirms it; until then the visit stays on your schedule.")
    } catch (err) {
      toast.error((err as Error).message || 'The cancellation could not be sent.')
      setSubmitting(false)
    }
  }

  const visitMinutes = (v: Visit) => {
    const toMin = (t: string | null | undefined) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m }
    let n = toMin(v.endTime) - toMin(v.startTime)
    if (n <= 0) n += 1440
    return Math.min(Math.max(n, 15), 720)
  }

  const loadAvailability = async (caregiverId: string, visit: Visit) => {
    setSlotsLoading(true)
    try {
      const reply = await portal.get(`/api/portal/caregivers/${caregiverId}/availability?durationMinutes=${visitMinutes(visit)}`)
      setAvailSlots(listRows<Slot>(reply))
    } catch {
      setAvailSlots([])
    } finally {
      setSlotsLoading(false)
    }
  }

  const submitReschedule = async () => {
    if (!selectedSlot || !selectedVisit) return
    setSubmitting(true)
    try {
      await portal.send('POST', '/api/portal/visits/reschedule-request', {
        ...visitPayload(selectedVisit),
        proposedDate: selectedSlot.date,
        proposedStartTime: selectedSlot.startTime,
        proposedEndTime: selectedSlot.endTime,
      })
      await loadChangeRequests()
      closeModal()
      toast.success('Your reschedule request was sent. The office will confirm it or suggest another time.')
    } catch (err) {
      toast.error((err as Error).message || 'The reschedule request could not be sent.')
      setSubmitting(false)
    }
  }

  const respondToCounter = async (crId: string, accept: boolean) => {
    setSubmitting(true)
    try {
      await portal.send('PUT', `/api/portal/change-requests/${crId}/respond`, { accept })
      await Promise.all([loadVisits(), loadChangeRequests()])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>Loading your schedule...</div>
  if (error) return <div className="alert alert-error">{error}</div>

  // Available slots by date, for the reschedule picker.
  const slotsByDate: Record<string, Slot[]> = {}
  availSlots.forEach((s) => { (slotsByDate[s.date] ||= []).push(s) })

  const when = (v: Visit) => `${dayLabel(v.scheduledDate)} · ${formatTime(v.startTime)} – ${formatTime(v.endTime)}`

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: 'var(--hcp-navy)' }}>Upcoming Visits</h2>

      {visits.length === 0 ? (
        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '48px', textAlign: 'center', color: 'var(--hc-muted)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📭</div>
          <div style={{ fontSize: '1rem', fontWeight: 500 }}>No upcoming visits scheduled</div>
          <div style={{ fontSize: '0.85rem', marginTop: '8px' }}>Contact your care coordinator if you have questions.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {visits.map((visit) => {
            const cr = getRequestForVisit(visit)
            const hasPending = !!cr && (cr.status === 'pending' || cr.status === 'counter_offered')
            const isCounterOffer = !!cr && cr.status === 'counter_offered'
            const today = isToday(visit.scheduledDate)

            return (
              <div
                key={visit.id}
                style={{
                  background: today ? 'var(--hcp-today)' : 'var(--hc-surface)',
                  borderRadius: '12px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  borderLeft: today ? '4px solid #f39c12' : '4px solid var(--hcp-mark)',
                }}
              >
                {/* Header: date + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hcp-navy)', marginBottom: '4px' }}>{dayLabel(visit.scheduledDate)}</div>
                    <div style={{ color: 'var(--hc-ink-soft)', fontSize: '0.9rem' }}>{formatTime(visit.startTime)} – {formatTime(visit.endTime)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {hasPending && cr && requestBadge(cr)}
                    {statusBadge(visit.status)}
                  </div>
                </div>

                {/* Caregiver */}
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--hc-line)', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: '2px' }}>CAREGIVER</div>
                    <div style={{ fontWeight: 600, color: 'var(--hc-ink)' }}>{visit.caregiverFirstName} {visit.caregiverLastName}</div>
                  </div>
                  {visit.caregiverPhone && (
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: '2px' }}>PHONE</div>
                      <a href={`tel:${visit.caregiverPhone}`} style={{ fontWeight: 600, color: 'var(--hc-blue-ink)', textDecoration: 'none' }}>{visit.caregiverPhone}</a>
                    </div>
                  )}
                </div>

                {/* Notes */}
                {visit.notes && (
                  <div style={{ marginTop: '12px', background: 'var(--hc-subtle)', borderRadius: '8px', padding: '10px 14px', fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>
                    {visit.notes}
                  </div>
                )}
                {visit.clientNotes && (
                  <div style={{ marginTop: '8px', background: 'var(--hcp-tint)', borderRadius: '8px', padding: '10px 14px', fontSize: '0.85rem', color: 'var(--hcp-navy)' }}>
                    <span style={{ fontWeight: 600 }}>Your note:</span> {visit.clientNotes}
                  </div>
                )}

                {/* Counter-offer */}
                {isCounterOffer && cr && (
                  <div style={{ marginTop: '12px', background: 'var(--hcp-violet-bg)', border: '1px solid var(--hcp-violet-line)', borderRadius: '10px', padding: '14px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--hcp-violet-ink)', fontSize: '0.9rem', marginBottom: '6px' }}>Your caregiver suggested a different time:</div>
                    <div style={{ fontWeight: 600, color: 'var(--hc-ink)', marginBottom: '4px' }}>
                      {formatShortDate(cr.counterDate)} &middot; {formatTime(cr.counterStartTime)} – {formatTime(cr.counterEndTime)}
                    </div>
                    {cr.counterMessage && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)', marginBottom: '10px', fontStyle: 'italic' }}>"{cr.counterMessage}"</div>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={primaryBtn} disabled={submitting} onClick={() => respondToCounter(cr.id, true)}>Accept</button>
                      <button style={secondaryBtn} disabled={submitting} onClick={() => respondToCounter(cr.id, false)}>Decline</button>
                    </div>
                  </div>
                )}

                {/* A note on any scheduled visit; reschedule and cancel only while the server says the visit can still
                    change (canChange: not started, not worked) and no request is already waiting. */}
                {visit.status === 'scheduled' && !hasPending && (
                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--hc-line)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button style={actionBtn('var(--hc-blue-ink)')} onClick={() => openNote(visit)}>Add Note</button>
                    {visit.canChange && (
                      <>
                        <button style={actionBtn('var(--hc-warning-ink)')} onClick={() => openReschedule(visit)}>Reschedule</button>
                        <button style={actionBtn('var(--hc-red-ink)')} onClick={() => openCancel(visit)}>Request Cancel</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Note ─────────────────────────────────────────────────────────── */}
      {modal === 'note' && selectedVisit && (
        <Overlay onClose={closeModal}>
          <h3 style={{ margin: '0 0 4px', color: 'var(--hcp-navy)' }}>Add a Note</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>{when(selectedVisit)}</p>
          <textarea className="hcp-field" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note for your caregiver..." rows={4} style={textarea} />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button style={secondaryBtn} onClick={closeModal}>Cancel</button>
            <button style={primaryBtn} disabled={submitting || !noteText.trim()} onClick={submitNote}>{submitting ? 'Saving...' : 'Save Note'}</button>
          </div>
        </Overlay>
      )}

      {/* ── Cancel ───────────────────────────────────────────────────────── */}
      {modal === 'cancel' && selectedVisit && (
        <Overlay onClose={closeModal}>
          <h3 style={{ margin: '0 0 4px', color: 'var(--hc-red-ink)' }}>Request Cancellation</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>
            {when(selectedVisit)}
            <br />with {selectedVisit.caregiverFirstName} {selectedVisit.caregiverLastName}
          </p>
          <p style={{ margin: '0 0 12px', color: 'var(--hc-muted)', fontSize: '0.82rem' }}>
            With at least 24 hours' notice the visit is cancelled straight away. With less notice the office
            confirms it, and the visit stays on your schedule until then. Your caregiver and the office are told either way.
          </p>
          <label htmlFor="portal-cancel-reason" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--hc-ink-soft)', marginBottom: '4px' }}>
            Reason (required)
          </label>
          <textarea id="portal-cancel-reason" className="hcp-field" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why are you cancelling?" rows={3} style={textarea} />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button style={secondaryBtn} onClick={closeModal}>Go Back</button>
            <button style={dangerBtn} disabled={submitting || !cancelReason.trim()} onClick={submitCancel}>{submitting ? 'Submitting...' : 'Request Cancellation'}</button>
          </div>
        </Overlay>
      )}

      {/* ── Reschedule ───────────────────────────────────────────────────── */}
      {modal === 'reschedule' && selectedVisit && (
        <Overlay onClose={closeModal}>
          <h3 style={{ margin: '0 0 4px', color: 'var(--hcp-navy)' }}>Request Reschedule</h3>
          <p style={{ margin: '0 0 4px', color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>Currently: {when(selectedVisit)}</p>
          <p style={{ margin: '0 0 16px', color: 'var(--hc-muted)', fontSize: '0.82rem' }}>Pick an available time below. The office will confirm it or suggest a different time.</p>

          {slotsLoading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--hc-muted)' }}>Loading availability...</div>
          ) : Object.keys(slotsByDate).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--hc-muted)', background: 'var(--hc-subtle)', borderRadius: '10px' }}>
              No available time slots found in the next 2 weeks.
              <br /><span style={{ fontSize: '0.82rem' }}>Contact your care coordinator for help.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '300px', overflowY: 'auto' }}>
              {Object.entries(slotsByDate).map(([date, slots]) => (
                <div key={date}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--hcp-navy)', marginBottom: '6px' }}>
                    {DOW_NAMES[parseLocalDate(date).getDay()]} &middot; {formatShortDate(date)}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {slots.map((slot, i) => {
                      const isSelected = !!selectedSlot && selectedSlot.date === slot.date && selectedSlot.startTime === slot.startTime
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedSlot(slot)}
                          style={{
                            background: isSelected ? 'var(--hcp-navy-fill)' : 'var(--hcp-tint)',
                            color: isSelected ? '#fff' : 'var(--hcp-navy)',
                            border: isSelected ? '2px solid var(--hcp-navy-fill)' : '1px solid var(--hc-line)',
                            padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                          }}
                        >
                          {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedSlot && (
            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--hc-success-bg)', borderRadius: '8px', fontSize: '0.88rem', color: 'var(--hc-success-ink)', fontWeight: 600 }}>
              New time: {formatShortDate(selectedSlot.date)} &middot; {formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button style={secondaryBtn} onClick={closeModal}>Cancel</button>
            <button style={primaryBtn} disabled={submitting || !selectedSlot} onClick={submitReschedule}>{submitting ? 'Submitting...' : 'Request Reschedule'}</button>
          </div>
        </Overlay>
      )}
    </div>
  )
}
