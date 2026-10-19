// Moved from templates/crm-homecare/frontend/src/components/admin/ClientWeekHours.tsx (ported there from CVHC
// ClientWeekHours.jsx).
// Who was at each client, and when — one Sunday–Saturday week at a time, every scheduled visit beside
// its actual clock-in/out. Built for entering hours into an insurer's portal. Read-only: corrections
// are made in Payroll → Shift Review and shown here.
//
// GET /api/reports/client-week[?weekStart] (server/crm/homecare/planning/reports.ts, care-billing:read) →
// { weekStart, weekEnd, timezone, clients: [{ clientId, name, isPrivatePay, scheduledMinutes, clockedMinutes,
// missingClockIns, rows: [{ type, day, caregiverName, isTraining, schedStart, schedEnd, schedMinutes, clockIn, clockOut,
// clockedMinutes, flags, cancelReason?, payroll: { kind, payableMinutes, note } | null }] }] } — every key camelCase
// now (the template read client_id, sched_minutes, payroll.payable_minutes …).
import { useState, useEffect, useCallback, useRef } from 'react'
import { api, errorMessage } from '../lib/http'
import { cancelReasonLabel } from '../lib/cancelReasons'

interface PayrollNote { kind: 'manual' | 'excused' | 'paid_no_clock_in' | 'adjusted' | 'note'; payableMinutes: number | null; note: string | null }

interface WeekRow {
  type: 'visit' | 'unscheduled' | 'cancelled'
  day: string
  caregiverName: string | null
  isTraining: boolean
  schedStart: string | null
  schedEnd: string | null
  schedMinutes: number | null
  clockIn: string | null
  clockOut: string | null
  clockedMinutes: number | null
  flags: string[]
  cancelReason?: string | null
  payroll: PayrollNote | null
}

interface WeekClient {
  clientId: string
  name: string
  isPrivatePay: boolean
  rows: WeekRow[]
  scheduledMinutes: number
  clockedMinutes: number
  missingClockIns: number
}

interface WeekReply { weekStart: string; weekEnd: string; timezone?: string; clients: WeekClient[] }

// Sunday of the week containing `d` (local date), as YYYY-MM-DD.
const sundayOf = (d: Date) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x.toLocaleDateString('en-CA') }
const addDays = (ymd: string, n: number) => { const x = new Date(`${ymd}T12:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA') }
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
const hm = (t?: string | null) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const hrs = (m?: number | null) => m == null ? '' : (m / 60).toFixed(2)
// 15-minute units, same as the claims engine: minutes ÷ 15 to 2 decimals (8, 8.2, 8.27).
const units = (m?: number | null) => m == null ? '' : String(Math.round((m / 15) * 100) / 100)
// Payroll's correction for a shift (Payroll → Shift Review), in plain words.
const payrollText = (p: PayrollNote | null) => {
  if (!p) return ''
  const h = p.payableMinutes != null ? `${(p.payableMinutes / 60).toFixed(2)} h / ${units(p.payableMinutes)} units` : ''
  const head = p.kind === 'manual' ? `✏️ Paid ${h} (manual entry)`
    : p.kind === 'excused' ? '🚫 Excused — not paid'
    : p.kind === 'paid_no_clock_in' ? `✅ Paid ${h}, no clock-in`
    : p.kind === 'adjusted' ? `✏️ Paid ${h}`
    : ''
  return [head, p.note].filter(Boolean).join(' — ')
}
const FLAG_LABELS: Record<string, string> = { offline_punch: 'saved offline', admin_force_clockout: 'office clock-out', excessive_duration: 'very long punch', zero_duration: 'accidental tap' }

const ClientWeekHours = () => {
  // Opens on THIS week on the agency's clock: the first load sends no weekStart and the server answers
  // with the Sunday of the agency's today (not the laptop's, not last week).
  const [weekStart, setWeekStart] = useState('')
  const adopted = useRef('')
  const [clientId, setClientId] = useState('')
  const [data, setData] = useState<WeekReply | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (weekStart && weekStart === adopted.current) return // the week the first load just adopted
    adopted.current = ''
    setLoading(true); setError('')
    try {
      const body = (await api.get('/api/reports/client-week', { weekStart: weekStart || undefined })) as WeekReply
      setData(body)
      if (!weekStart && body?.weekStart) { adopted.current = body.weekStart; setWeekStart(body.weekStart) }
    } catch (e) { setError(errorMessage(e, 'Request failed')); setData(null) }
    setLoading(false)
  }, [weekStart])

  useEffect(() => { load() }, [load])

  // Clock times on the agency's clock (the server names its zone), not the viewer's laptop.
  const clock = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: data?.timezone || undefined }) : ''
  const clients: WeekClient[] = data && Array.isArray(data.clients) ? data.clients : []
  const shown = clientId ? clients.filter((c) => c.clientId === clientId) : clients

  // A figure's ink against the schedule: over by more than 7 minutes is amber, under is red (light and dark).
  const diffInk = (diff: number | null) => diff == null ? undefined : diff > 7 ? 'var(--hc-warning-ink)' : diff < -7 ? 'var(--hc-red-ink)' : undefined

  return (
    <div className="client-week-hours">
      <style>{'@media print { .cwh-controls { display: none !important; } .cwh-client { break-inside: avoid; } }'}</style>
      <h2 style={{ marginTop: 0 }}>🗓️ Client Hours by Week</h2>
      <p className="text-muted" style={{ marginTop: 0 }}>Who was at each client and when — scheduled visits beside the actual clock-in and clock-out, Sunday to Saturday.</p>

      <div className="hc-card cwh-controls" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={!weekStart} onClick={() => setWeekStart(addDays(weekStart, -7))}>← Prev week</button>
        <strong>{weekStart ? `${dayLabel(weekStart)} – ${dayLabel(addDays(weekStart, 6))}` : 'This week'}</strong>
        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={!weekStart} onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week →</button>
        <input type="date" value={weekStart} onChange={(e) => e.target.value && setWeekStart(sundayOf(new Date(`${e.target.value}T12:00:00`)))}
          title="Pick any day — the page shows that day's Sunday–Saturday week" />
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">All clients ({clients.length})</option>
          {clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
        </select>
        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => window.print()}>🖨️ Print</button>
      </div>

      {loading && <div className="hc-card">Loading…</div>}
      {error && <div className="hc-card" style={{ background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', fontWeight: 600 }}>Could not load this week: {error}</div>}
      {!loading && !error && data && shown.length === 0 && <div className="hc-card">No visits or clock-ins this week.</div>}

      {!loading && shown.map((c) => (
        <div key={c.clientId} className="hc-card cwh-client" style={{ maxWidth: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>{c.name}{c.isPrivatePay && <span style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', fontWeight: 400 }}> · private pay</span>}</h3>
            <div style={{ fontSize: '0.9rem' }}>
              Scheduled <strong>{hrs(c.scheduledMinutes)} h ({units(c.scheduledMinutes)} units)</strong> · Clocked <strong>{hrs(c.clockedMinutes)} h ({units(c.clockedMinutes)} units)</strong>
              {c.missingClockIns > 0 && <span style={{ color: 'var(--hc-warning-ink)' }}> · {c.missingClockIns} with no clock-in</span>}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="hc-table" style={{ fontSize: '0.86rem', marginTop: '0.5rem' }}>
              <thead><tr><th>Day</th><th>Caregiver</th><th>Scheduled</th><th>Clocked in – out</th><th style={{ textAlign: 'right' }}>Sched h</th><th style={{ textAlign: 'right' }}>Sched units</th><th style={{ textAlign: 'right' }}>Clocked h</th><th style={{ textAlign: 'right' }}>Clocked units</th><th>Note</th><th>Payroll</th></tr></thead>
              <tbody>
                {(Array.isArray(c.rows) ? c.rows : []).map((r, i) => {
                  const diff = r.type === 'visit' && r.clockedMinutes != null ? r.clockedMinutes - (r.schedMinutes || 0) : null
                  const note = r.type === 'cancelled' ? `Cancelled — ${cancelReasonLabel(r.cancelReason)}`
                    : r.type === 'unscheduled' ? 'Not on the schedule'
                    : !r.clockIn ? 'No clock-in'
                    : r.clockIn && !r.clockOut ? 'Still clocked in'
                    : ''
                  const flags = (r.flags || []).map((f) => FLAG_LABELS[f]).filter(Boolean)
                  const payrollInk = r.payroll && (r.payroll.kind === 'manual' || r.payroll.kind === 'adjusted') ? 'var(--hc-blue-ink)'
                    : r.payroll && r.payroll.kind === 'excused' ? 'var(--hc-red-ink)' : 'var(--hc-ink-soft)'
                  return (
                    <tr key={i} style={{ background: r.type === 'cancelled' ? 'var(--hc-subtle)' : undefined, color: r.type === 'cancelled' ? 'var(--hc-ink-soft)' : undefined }}>
                      <td>{dayLabel(r.day)}</td>
                      <td>{r.caregiverName}{r.isTraining && <span style={{ color: 'var(--hc-ink-soft)' }}> (training)</span>}</td>
                      <td>{r.schedStart ? `${hm(r.schedStart)} – ${hm(r.schedEnd)}` : '—'}</td>
                      <td>{r.clockIn ? `${clock(r.clockIn)} – ${r.clockOut ? clock(r.clockOut) : '…'}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.type === 'visit' ? hrs(r.schedMinutes) : ''}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.type === 'visit' ? units(r.schedMinutes) : ''}</td>
                      <td style={{ textAlign: 'right', color: diffInk(diff) }}>{hrs(r.clockedMinutes)}</td>
                      <td style={{ textAlign: 'right', color: diffInk(diff) }}>{units(r.clockedMinutes)}</td>
                      <td style={{ color: note === 'No clock-in' || note === 'Not on the schedule' ? 'var(--hc-warning-ink)' : 'var(--hc-ink-soft)' }}>
                        {[note, ...flags].filter(Boolean).join(' · ')}
                      </td>
                      <td style={{ color: payrollInk, fontWeight: r.payroll && r.payroll.kind !== 'paid_no_clock_in' ? 600 : 400 }}>
                        {payrollText(r.payroll)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

export default ClientWeekHours
