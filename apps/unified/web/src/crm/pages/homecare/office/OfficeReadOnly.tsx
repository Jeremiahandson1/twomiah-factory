// The read-only office seat's screens (care-office:read — home care's viewer; verticals/homecare/settings.ts). Live role
// check, 2026-10-23: the viewer's dashboard was blank and its menu held only Contacts and the Lead Inbox, because every
// office screen opens on a write verb (Clients on care-clients:update, the Schedule Hub on care-schedule:update, EVV on
// evv:delete) or on an area read that also opens the clinical record, the pay or the HR files.
//
// These are the same addresses as the office's own screens (/crm/clients, /crm/scheduling, /crm/caregivers, /crm/evv):
// OfficeOr draws the office's screen for whoever holds its verb, and this read-only one for a seat that holds only
// care-office:read. Each reads one route that answers that seat with exactly what it may see (the server shapes it):
//   ClientDirectory   GET /api/clients               the directory entry and who is assigned (clients/clients.ts)
//   ScheduleWeek      GET /api/scheduling/week-view  the week's visits (scheduling/schedulingHub.ts)
//   CaregiverRoster   GET /api/users/caregivers      name, phone, email, active (hr/caregivers.ts)
//   EvvStatus         GET /api/time-tracking         times and EVV status (visits/timeTracking.ts)
// Nothing here writes.
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { formatAgencyDateTime, agencyToday } from '../lib/agencyClock'
import { usePermissions } from '../../../../shared'

/** The office's screen for whoever holds `office`; the read-only one for a seat holding only care-office:read. */
export function OfficeOr({ office, Full, View }: { office: string; Full: ComponentType; View: ComponentType }) {
  const { known, can } = usePermissions()
  // Not until the permission list has arrived: drawing the office's screen first would fire its office-only reads.
  if (!known) return null
  return !can(office) && can('care-office:read') ? <View /> : <Full />
}

const READ_ONLY_NOTE = 'Read-only: your seat views the office\'s records and changes nothing.'
const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined) =>
  p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || '—' : '—'
const muted = { color: 'var(--hc-muted)', fontSize: '0.8rem' }

function Header({ title, onRefresh }: { title: string; onRefresh?: () => void }) {
  return (
    <>
      <div className="page-header">
        <h2>{title}</h2>
        {onRefresh && <button type="button" className="hc-btn hc-btn-secondary" onClick={onRefresh}>Refresh</button>}
      </div>
      <p style={{ ...muted, marginBottom: '1rem' }} data-testid="read-only-note">{READ_ONLY_NOTE}</p>
    </>
  )
}

function Problem({ text }: { text: string | null }) {
  return text ? <div role="alert" className="hc-card" style={{ color: 'var(--hc-danger-ink)', background: 'var(--hc-danger-bg)' }}>{text}</div> : null
}

interface DirectoryClient {
  id: string; firstName: string; lastName: string; phone: string | null; email: string | null
  address: string | null; city: string | null; state: string | null; zip: string | null
  isActive: boolean; status: string | null; serviceType: string | null
  assignments?: { caregiver?: { firstName?: string | null; lastName?: string | null } }[]
}

export function ClientDirectory() {
  const [clients, setClients] = useState<DirectoryClient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const load = () => {
    setError(null)
    listAll<DirectoryClient>('/api/clients', { isActive: 'true' })
      .then((r) => setClients(r.data))
      .catch((e) => { setClients([]); setError(errorMessage(e, 'Could not load the clients.')) })
  }
  useEffect(load, [])
  const shown = useMemo(() => (clients || []).filter((c) => !q.trim() || [c.firstName, c.lastName, c.phone, c.email, c.city].some((v) => (v || '').toLowerCase().includes(q.trim().toLowerCase()))), [clients, q])
  return (
    <div className="container">
      <Header title="👥 Clients" onRefresh={load} />
      <Problem text={error} />
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <label htmlFor="ro-client-search" className="sr-only">Search clients</label>
        <input id="ro-client-search" type="search" placeholder="Search name, phone, email, city…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {clients === null ? <div className="loading"><div className="spinner" /></div> : (
        <div className="hc-card" style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead><tr><th>Client</th><th>Phone</th><th>Address</th><th>Service</th><th>Caregivers</th></tr></thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No active clients</td></tr>
              ) : shown.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{fullName(c)}{c.email && <div style={muted}>{c.email}</div>}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{[c.address, c.city, c.state, c.zip].filter(Boolean).join(', ') || '—'}</td>
                  <td>{c.serviceType ? c.serviceType.replace(/_/g, ' ') : '—'}</td>
                  <td>{(c.assignments || []).map((a) => fullName(a.caregiver)).filter((n) => n !== '—').join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const hhmm = (t: string | null | undefined) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

interface WeekVisit { id: string; clientFirstName: string | null; clientLastName: string | null; startTime: string | null; endTime: string | null; notes?: string | null }
interface WeekRow { caregiver: { id: string; firstName: string; lastName: string }; days: Record<string, WeekVisit[]> }

export function ScheduleWeek() {
  const [weekOf, setWeekOf] = useState(agencyToday())
  const [week, setWeek] = useState<{ weekStart: string; weekEnd: string; caregivers: WeekRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setError(null)
    api.get('/api/scheduling/week-view', { weekOf } as any)
      .then((r: any) => setWeek(r))
      .catch((e: unknown) => { setWeek({ weekStart: weekOf, weekEnd: weekOf, caregivers: [] }); setError(errorMessage(e, 'Could not load the schedule.')) })
  }
  useEffect(load, [weekOf])
  const start = week?.weekStart || weekOf
  return (
    <div className="container">
      <Header title="📅 Schedule" onRefresh={load} />
      <Problem text={error} />
      <div className="hc-card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setWeekOf(addDays(start, -7))}>← Previous week</button>
        <strong style={{ padding: '0 0.5rem' }}>Week of {dayLabel(start)}</strong>
        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setWeekOf(addDays(start, 7))}>Next week →</button>
        <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setWeekOf(agencyToday())}>This week</button>
      </div>
      {!week ? <div className="loading"><div className="spinner" /></div> : (
        <div className="hc-card" style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead><tr><th>Caregiver</th>{WEEKDAYS.map((d, i) => <th key={d}>{d} {dayLabel(addDays(start, i))}</th>)}</tr></thead>
            <tbody>
              {week.caregivers.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No caregivers on the schedule</td></tr>
              ) : week.caregivers.map((row) => (
                <tr key={row.caregiver.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fullName(row.caregiver)}</td>
                  {WEEKDAYS.map((_, i) => (
                    <td key={i} style={{ verticalAlign: 'top', minWidth: '7rem' }}>
                      {(row.days[i] || []).length === 0 ? <span style={muted}>—</span> : (row.days[i] || []).map((v, k) => (
                        <div key={`${v.id}-${k}`} style={{ marginBottom: '0.4rem' }}>
                          <div style={{ fontWeight: 600 }}>{fullName({ firstName: v.clientFirstName, lastName: v.clientLastName })}</div>
                          <div style={muted}>{hhmm(v.startTime)}–{hhmm(v.endTime)}</div>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface RosterRow { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; isActive: boolean }

export function CaregiverRoster() {
  const [people, setPeople] = useState<RosterRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setError(null)
    api.get('/api/users/caregivers', { isActive: 'all' } as any)
      .then((r: unknown) => setPeople(rows<RosterRow>(r)))
      .catch((e: unknown) => { setPeople([]); setError(errorMessage(e, 'Could not load the caregivers.')) })
  }
  useEffect(load, [])
  return (
    <div className="container">
      <Header title="🧑‍⚕️ Caregivers" onRefresh={load} />
      <Problem text={error} />
      {people === null ? <div className="loading"><div className="spinner" /></div> : (
        <div className="hc-card" style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead><tr><th>Caregiver</th><th>Phone</th><th>Email</th><th>Status</th></tr></thead>
            <tbody>
              {people.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No caregivers yet</td></tr>
              ) : people.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{fullName(p)}</td>
                  <td>{p.phone || '—'}</td>
                  <td>{p.email || '—'}</td>
                  <td>{p.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface VisitRow {
  id: string; startTime: string | null; endTime: string | null; durationMinutes: number | null; isComplete: boolean; needsApproval: boolean | null
  caregiver: { firstName: string | null; lastName: string | null }; client: { firstName: string | null; lastName: string | null }
  evvVisit: { sandataStatus: string | null; isVerified: boolean | null } | null
}
const evvWords = (v: VisitRow) => {
  if (!v.isComplete) return 'Visit in progress'
  if (!v.evvVisit) return 'No EVV record'
  const status = (v.evvVisit.sandataStatus || 'pending').replace(/_/g, ' ')
  return `${v.evvVisit.isVerified ? 'Verified' : 'Not verified'} · ${status}`
}

export function EvvStatus() {
  const [visits, setVisits] = useState<VisitRow[] | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setError(null)
    api.get('/api/time-tracking', { page, limit: 50 } as any)
      .then((r: any) => { setVisits(rows<VisitRow>(r)); setPages(Number(r?.pagination?.pages) || 1) })
      .catch((e: unknown) => { setVisits([]); setError(errorMessage(e, 'Could not load the visits.')) })
  }
  useEffect(load, [page])
  return (
    <div className="container">
      <Header title="📍 EVV Status" onRefresh={load} />
      <Problem text={error} />
      {visits === null ? <div className="loading"><div className="spinner" /></div> : (
        <div className="hc-card" style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead><tr><th>Clock in</th><th>Clock out</th><th>Caregiver</th><th>Client</th><th>Hours</th><th>EVV</th></tr></thead>
            <tbody>
              {visits.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>No visits yet</td></tr>
              ) : visits.map((v) => (
                <tr key={v.id}>
                  <td>{v.startTime ? formatAgencyDateTime(v.startTime) : '—'}</td>
                  <td>{v.endTime ? formatAgencyDateTime(v.endTime) : '—'}</td>
                  <td>{fullName(v.caregiver)}</td>
                  <td>{fullName(v.client)}</td>
                  <td>{v.durationMinutes != null ? (v.durationMinutes / 60).toFixed(1) : '—'}</td>
                  <td>{evvWords(v)}{v.needsApproval ? <div style={muted}>Awaiting the office's approval</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '1rem 0' }}>
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span style={{ fontSize: '0.9rem', color: 'var(--hc-ink-soft)' }}>Page {page} of {pages}</span>
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
