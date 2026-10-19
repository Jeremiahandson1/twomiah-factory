// Moved from templates/crm-homecare/frontend/src/components/admin/LiveBoard.tsx (ported there from CVHC LiveBoard.jsx).
// Real-time shift board: every shift happening today with its live clock status.
//
// Its calls, as the unified server answers them:
//   GET  /api/dashboard/live-board (server/crm/homecare/planning/dashboard.ts, data/homecarePlanning.ts liveBoardShifts)
//        → { shifts, stats, asOf, timezone }. Each shift's keys are camelCase now (scheduleId, caregiverFirst,
//        clockInTime, shiftStatus, gpsTrail …; the template read schedule_id, caregiver_first …), and so are the stats
//        (clockedIn, was clocked_in). The status VALUES are unchanged ('clocked_in', 'late' …). gpsTrail's points and
//        clockInLocation are JSON as stored: { lat, lng, ts }.
//   POST /api/time-entries/:id/admin-force-clockout (server/crm/homecare/visits/timeTracking.ts) — the same body.
import { useState } from 'react'
import { api, errorMessage } from '../lib/http'
import { usePolling } from '../lib/usePolling'
import { useMayWrite } from '../../../../shared'
import VisitGpsMap from './VisitGpsMap'
import { CHIP, EDGE, INK, RING, backdrop, field, panel, type Tone } from './ui'

// EVV change reason codes sent with an office-set clock-out (the Alt-EVV "visit change" reasons).
// 5 and 8 require an explanation memo — the free-text reason field doubles as it.
const EVV_REASONS = [
  { code: '1', label: '1 — Caregiver Error (forgot to clock out)' },
  { code: '2', label: '2 — Member Unavailable' },
  { code: '3', label: '3 — Mobile Device Issue' },
  { code: '4', label: '4 — Telephony Issue' },
  { code: '5', label: '5 — Member Refused Verification (memo required)' },
  { code: '7', label: '7 — Missing in System' },
  { code: '8', label: '8 — Other (memo required)' },
]

type Status = 'clocked_in' | 'completed' | 'late' | 'starting' | 'upcoming'

// The template's fixed colours as light/dark pairs (./ui.ts): the chip, and the card's edge.
const statusConfig: Record<Status, { tone: Tone; label: string; icon: string; pulse: boolean }> = {
  clocked_in: { tone: 'green', label: 'Clocked In', icon: '🟢', pulse: true },
  completed: { tone: 'indigo', label: 'Completed', icon: '✅', pulse: false },
  late: { tone: 'red', label: 'Late', icon: '🔴', pulse: true },
  starting: { tone: 'amber', label: 'Starting Now', icon: '🟡', pulse: true },
  upcoming: { tone: 'gray', label: 'Upcoming', icon: '⏳', pulse: false },
}

interface GpsPoint { lat: number | string | null; lng: number | string | null; ts: string | null }
interface Location { lat?: number | string | null; lng?: number | string | null }

/** One row of GET /api/dashboard/live-board's shifts. */
interface LiveShift {
  scheduleId: string
  caregiverId: string
  clientId: string
  scheduledStart: string | null
  scheduledEnd: string | null
  caregiverFirst: string | null
  caregiverLast: string | null
  caregiverPhone: string | null
  clientFirst: string | null
  clientLast: string | null
  clientAddress: string | null
  clientCity: string | null
  clientLat: string | number | null
  clientLng: string | number | null
  timeEntryId: string | null
  clockInTime: string | null
  clockOutTime: string | null
  clockInLocation: Location | string | null
  durationMinutes: number | string | null
  shiftStatus: Status
  minutesElapsed: number | string | null
  gpsTrail: GpsPoint[] | null
}

interface LiveStats { total?: number; clockedIn?: number; completed?: number; late?: number; upcoming?: number; starting?: number }
interface BoardReply { shifts: LiveShift[]; stats: LiveStats; asOf: string | null; timezone?: string }

// Clocked time in hours and minutes: a 2-minute visit reads "2m", never "0.0h".
const fmtDuration = (mins: unknown) => {
  const m = Math.max(0, Math.round(Number(mins) || 0))
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`
}

const parseLoc = (v: Location | string | null | undefined): Location | null => {
  if (!v) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) as Location } catch { return null }
}

type CloseMode = 'scheduled' | 'now' | 'time'

const LiveBoard = () => {
  // Closing a visit for the caregiver is the office's EVV verb (POST …/admin-force-clockout asks evv:delete).
  const mayClose = useMayWrite('evv:delete')
  const [data, setData] = useState<BoardReply>({ shifts: [], stats: {}, asOf: null, timezone: undefined })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [selectedShift, setSelectedShift] = useState<LiveShift | null>(null)
  const [mapShift, setMapShift] = useState<LiveShift | null>(null)
  // Force clock-out modal
  const [closeTarget, setCloseTarget] = useState<LiveShift | null>(null)
  const [closeMode, setCloseMode] = useState<CloseMode>('scheduled')
  const [closeEndTime, setCloseEndTime] = useState('')
  const [closeReason, setCloseReason] = useState('')
  const [closeEvvReason, setCloseEvvReason] = useState('1')
  const [closing, setClosing] = useState(false)
  // A refusal is shown in the dialog, beside the field it is about — not in a native pop-up.
  const [closeError, setCloseError] = useState('')

  const loadBoard = async () => {
    try {
      const reply = (await api.get('/api/dashboard/live-board')) as BoardReply
      if (reply) setData({ shifts: Array.isArray(reply.shifts) ? reply.shifts : [], stats: reply.stats || {}, asOf: reply.asOf ?? null, timezone: reply.timezone })
    } catch (e) {
      console.error('Live board load error:', e)
    } finally {
      setLoading(false)
    }
  }

  // Refresh every 60s, paused while the tab is hidden (refreshes when it comes back).
  usePolling(loadBoard, 60000)

  const submitForceClose = async () => {
    if (!closeTarget || !closeTarget.timeEntryId) return
    setCloseError('')
    if (['5', '8'].includes(closeEvvReason) && !closeReason.trim()) {
      setCloseError('EVV reason codes 5 and 8 require a reason note — please fill in the reason field.')
      return
    }
    const body: { reason: string | null; evvReasonCode: string; evvReasonMemo: string | null; scheduled?: boolean; endTime?: string } =
      { reason: closeReason || null, evvReasonCode: closeEvvReason, evvReasonMemo: closeReason || null }
    if (closeMode === 'scheduled') body.scheduled = true
    else if (closeMode === 'time') {
      if (!closeEndTime) { setCloseError('Pick an end time.'); return }
      body.endTime = new Date(closeEndTime).toISOString()
    } // 'now' → neither (the server uses now)
    setClosing(true)
    try {
      await api.post(`/api/time-entries/${encodeURIComponent(closeTarget.timeEntryId)}/admin-force-clockout`, body)
      setCloseTarget(null)
      loadBoard()
    } catch (err) {
      setCloseError('Failed to close shift: ' + errorMessage(err, 'Failed'))
    } finally {
      setClosing(false)
    }
  }

  // Times on the agency's clock: scheduled times arrive as HH:MM:SS, punches as UTC instants.
  const formatTime = (t?: string | null) => {
    if (!t) return '--:--'
    if (t.includes('T')) return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: data.timezone || undefined })
    const [h, m] = t.split(':').map(Number)
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  }

  const shifts = data.shifts
  const filteredShifts = shifts.filter((s) => filter === 'all' || s.shiftStatus === filter)

  if (loading) return <div className="loading"><div className="spinner"></div></div>

  const tiles: Array<{ key: 'all' | Status; label: string; val: number; tone: Tone }> = [
    { key: 'all', label: 'Total Shifts', val: data.stats.total || 0, tone: 'indigo' },
    { key: 'clocked_in', label: 'Clocked In', val: data.stats.clockedIn || 0, tone: 'green' },
    { key: 'late', label: 'Late / No-Show', val: data.stats.late || 0, tone: 'red' },
    { key: 'starting', label: 'Starting Now', val: data.stats.starting || 0, tone: 'amber' },
    { key: 'upcoming', label: 'Upcoming', val: data.stats.upcoming || 0, tone: 'gray' },
    { key: 'completed', label: 'Completed', val: data.stats.completed || 0, tone: 'indigo' },
  ]

  return (
    <div>
      <div className="page-header">
        <h2>Live Shift Board</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)' }}>
            Auto-refreshes every minute {data.asOf && `| Last: ${formatTime(data.asOf)}`}
          </span>
          <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={loadBoard}>Refresh Now</button>
        </div>
      </div>

      {/* Status summary — click to filter */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tiles.map((s) => (
          <div key={s.key} onClick={() => setFilter(s.key)}
            className={`border-l-4 ${EDGE[s.tone]} ${filter === s.key ? RING[s.tone] : ''}`}
            style={{ flex: 1, minWidth: 110, padding: '0.75rem 1rem', background: filter === s.key ? 'var(--hc-info-bg)' : 'var(--hc-subtle)',
              borderRadius: 12, cursor: 'pointer' }}>
            <div className={INK[s.tone]} style={{ fontSize: '1.5rem', fontWeight: 800 }}>{s.val}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {filteredShifts.length === 0 ? (
        <div className="hc-card hc-card-centered"><p>No shifts match this filter.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: '0.75rem' }}>
          {filteredShifts.map((shift) => {
            const sc = statusConfig[shift.shiftStatus] || statusConfig.upcoming
            const loc = parseLoc(shift.clockInLocation)
            const trail: GpsPoint[] = Array.isArray(shift.gpsTrail) ? shift.gpsTrail : []
            return (
              <div key={shift.scheduleId + (shift.timeEntryId || '')}
                onClick={() => setSelectedShift(selectedShift?.scheduleId === shift.scheduleId ? null : shift)}
                className={`border-2 ${EDGE[sc.tone]}`}
                style={{
                  background: 'var(--hc-surface)', borderRadius: 12, color: 'var(--hc-ink)',
                  padding: '1rem', cursor: 'pointer', position: 'relative', overflow: 'hidden',
                  boxShadow: shift.shiftStatus === 'late' ? '0 0 12px rgba(239,68,68,0.2)' : '0 1px 3px rgba(0,0,0,0.08)',
                  animation: sc.pulse && shift.shiftStatus === 'late' ? 'pulse-red 2s infinite' : undefined,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>{shift.caregiverFirst} {shift.caregiverLast}</span>
                  <span className={CHIP[sc.tone]} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700 }}>
                    {sc.icon} {sc.label}
                  </span>
                </div>

                <div style={{ fontSize: '0.88rem', color: 'var(--hc-ink-soft)', marginBottom: '0.35rem' }}>
                  {shift.clientFirst} {shift.clientLast}
                  {shift.clientAddress && <span style={{ color: 'var(--hc-muted)', fontSize: '0.78rem' }}> — {shift.clientCity}</span>}
                </div>

                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.82rem', color: 'var(--hc-ink-soft)', flexWrap: 'wrap' }}>
                  <span>Scheduled: {formatTime(shift.scheduledStart)} - {formatTime(shift.scheduledEnd)}</span>
                  {shift.clockInTime && (
                    <span style={{ color: 'var(--hc-green-ink)', fontWeight: 600 }}>
                      In: {formatTime(shift.clockInTime)}
                      {shift.clockOutTime && <> | Out: {formatTime(shift.clockOutTime)}</>}
                    </span>
                  )}
                </div>

                {shift.shiftStatus === 'clocked_in' && shift.minutesElapsed != null && (
                  <div className={INK.teal} style={{ marginTop: '0.35rem', fontSize: '0.82rem', fontWeight: 700 }}>
                    {Math.floor(Number(shift.minutesElapsed) / 60)}h {Math.round(Number(shift.minutesElapsed) % 60)}m elapsed
                  </div>
                )}

                {mayClose && shift.shiftStatus === 'clocked_in' && shift.timeEntryId && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCloseTarget(shift); setCloseMode('scheduled'); setCloseEndTime(''); setCloseReason(''); setCloseEvvReason('1'); setCloseError('') }}
                    className="bg-white text-amber-800 border border-amber-300 dark:bg-slate-900 dark:text-amber-300 dark:border-amber-700"
                    style={{ marginTop: '0.5rem', width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                  >🛑 Force Clock Out</button>
                )}

                {shift.timeEntryId && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setMapShift(shift) }}
                    className="bg-white text-violet-800 border border-violet-300 dark:bg-slate-900 dark:text-violet-300 dark:border-violet-700"
                    style={{ marginTop: '0.5rem', width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                    title="View GPS trail on map"
                  >🗺️ View on Map</button>
                )}

                {shift.shiftStatus === 'late' && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', fontWeight: 700, color: 'var(--hc-red-ink)' }}>
                    No clock-in — shift was scheduled to start at {formatTime(shift.scheduledStart)}
                  </div>
                )}

                {shift.shiftStatus === 'completed' && shift.durationMinutes != null && (
                  <div className={INK.indigo} style={{ marginTop: '0.35rem', fontSize: '0.82rem' }}>
                    Clocked: {fmtDuration(shift.durationMinutes)}
                  </div>
                )}

                {trail.length > 0 && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--hc-muted)' }}>{trail.length} GPS points tracked</div>
                )}

                {selectedShift?.scheduleId === shift.scheduleId && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--hc-line)', fontSize: '0.82rem' }}>
                    {shift.caregiverPhone && <div style={{ color: 'var(--hc-ink-soft)' }}>Phone: {shift.caregiverPhone}</div>}
                    {shift.clientAddress && <div style={{ color: 'var(--hc-ink-soft)' }}>Address: {shift.clientAddress}, {shift.clientCity}</div>}
                    {loc && loc.lat != null && (
                      <div style={{ color: 'var(--hc-ink-soft)' }}>Clock-in GPS: {Number(loc.lat).toFixed(4)}, {Number(loc.lng).toFixed(4)}</div>
                    )}
                    {trail.length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <strong>GPS Trail ({trail.length} points)</strong>
                        <div style={{ maxHeight: 100, overflow: 'auto', fontSize: '0.72rem', color: 'var(--hc-muted)', marginTop: '0.25rem' }}>
                          {trail.map((pt, i) => (
                            <div key={i}>{formatTime(pt.ts)} — {Number(pt.lat).toFixed(5)}, {Number(pt.lng).toFixed(5)}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes pulse-red {
          0%, 100% { box-shadow: 0 0 12px rgba(239,68,68,0.2); }
          50% { box-shadow: 0 0 20px rgba(239,68,68,0.4); }
        }
      `}</style>

      {closeTarget && (
        <div onClick={() => !closing && setCloseTarget(null)} style={backdrop}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...panel, maxWidth: 440, width: '95%', padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Close shift — {closeTarget.caregiverFirst} {closeTarget.caregiverLast}</h3>
            <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', marginBottom: '0.9rem' }}>
              {closeTarget.clientFirst} {closeTarget.clientLast} · in {formatTime(closeTarget.clockInTime)}
              {closeTarget.scheduledStart && ` · scheduled ${formatTime(closeTarget.scheduledStart)}–${formatTime(closeTarget.scheduledEnd)}`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.88rem', cursor: 'pointer' }}><input type="radio" name="closemode" checked={closeMode === 'scheduled'} onChange={() => setCloseMode('scheduled')} /> Bill the scheduled amount</label>
              <label style={{ fontSize: '0.88rem', cursor: 'pointer' }}><input type="radio" name="closemode" checked={closeMode === 'now'} onChange={() => setCloseMode('now')} /> Clock out now (actual elapsed)</label>
              <label style={{ fontSize: '0.88rem', cursor: 'pointer' }}><input type="radio" name="closemode" checked={closeMode === 'time'} onChange={() => setCloseMode('time')} /> Specific end time</label>
              {closeMode === 'time' && (
                <input type="datetime-local" value={closeEndTime} onChange={(e) => setCloseEndTime(e.target.value)} style={{ ...field, padding: '0.4rem', fontSize: '0.88rem' }} />
              )}
            </div>
            <label style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)', display: 'block', marginBottom: '0.2rem' }}>EVV change reason (reported to the state EVV aggregator)</label>
            <select value={closeEvvReason} onChange={(e) => setCloseEvvReason(e.target.value)} style={{ ...field, padding: '0.4rem', fontSize: '0.88rem', marginBottom: '0.6rem' }}>
              {EVV_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <input type="text" placeholder={['5', '8'].includes(closeEvvReason) ? 'Reason (required for this EVV code)' : 'Reason (optional)'} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} style={{ ...field, padding: '0.4rem', fontSize: '0.88rem', marginBottom: '0.6rem' }} />
            <div style={{ fontSize: '0.75rem', color: 'var(--hc-warning-ink)', marginBottom: '0.9rem' }}>The shift will be flagged for approval before billing/payroll.</div>
            {closeError && (
              <div role="alert" style={{ background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', border: '1px solid var(--hc-danger-line)', borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                {closeError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setCloseTarget(null)} disabled={closing} className="hc-btn hc-btn-sm hc-btn-secondary">Cancel</button>
              <button onClick={submitForceClose} disabled={closing} className="hc-btn hc-btn-sm hc-btn-primary">{closing ? 'Closing…' : 'Close shift'}</button>
            </div>
          </div>
        </div>
      )}

      {mapShift && mapShift.timeEntryId && (
        <div onClick={() => setMapShift(null)} style={backdrop}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...panel, maxWidth: 900, width: '95%', maxHeight: '90vh', overflow: 'auto', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>
                🗺️ GPS — {mapShift.caregiverFirst} {mapShift.caregiverLast} → {mapShift.clientFirst} {mapShift.clientLast}
              </h3>
              <button onClick={() => setMapShift(null)} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--hc-ink-soft)' }}>×</button>
            </div>
            <VisitGpsMap
              timeEntryId={mapShift.timeEntryId}
              clientLat={mapShift.clientLat}
              clientLng={mapShift.clientLng}
              clientName={`${mapShift.clientFirst} ${mapShift.clientLast}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default LiveBoard
