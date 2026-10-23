// The smaller booking screens: the numbers and the customers, the waitlist, and a repeating booking.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { api } from '../api'
import { PageError, useConfirm, useMayWrite, useToast } from '../shared'
import { useBookingBasics, onClock, StatusPill, dollars, dateWords, type Booking } from './common'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** How it's going (the last 90 days, on the business's clock) and who books. */
export function BookingInsightsPage() {
  const [tab, setTab] = useState<'numbers' | 'customers'>('numbers')
  const [stats, setStats] = useState<any>(null)
  const [customers, setCustomers] = useState<any[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { api.get('/api/booking/analytics').then(setStats).catch((e: Error) => setError(e.message)) }, [])
  useEffect(() => { if (tab === 'customers' && !customers) api.get('/api/booking/customers').then((r: any) => setCustomers(r.data)).catch((e: Error) => setError(e.message)) }, [tab, customers])
  const peak = (arr: number[]) => Math.max(1, ...arr)
  const chip = (on: boolean) => 'px-4 py-1.5 rounded-full text-sm font-medium border ' + (on ? 'bg-ink text-white dark:text-slate-900 border-ink' : 'bg-white dark:bg-slate-900 text-ink-soft border-line hover:border-ink-soft')
  const shown = (customers || []).filter((c) => !q.trim() || [c.name, c.email, c.phone].some((v: string) => (v || '').toLowerCase().includes(q.trim().toLowerCase())))
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-ink mb-1">Booking insights</h1>
      <p className="text-muted text-sm mb-5">The last 90 days.{stats ? ` Days and hours are ${stats.timezone.replace(/_/g, ' ')} time.` : ''}</p>
      <div className="flex gap-2 mb-5" role="group" aria-label="Show">
        <button type="button" aria-pressed={tab === 'numbers'} className={chip(tab === 'numbers')} onClick={() => setTab('numbers')}>Numbers</button>
        <button type="button" aria-pressed={tab === 'customers'} className={chip(tab === 'customers')} onClick={() => setTab('customers')}>Customers</button>
      </div>
      <PageError message={error} className="mb-4" />
      {tab === 'numbers' && stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              ['Bookings', String(stats.total)],
              ['Completed', String(stats.byStatus.completed || 0)],
              ['Booked value', dollars(stats.bookedValue) || '$0'],
              ['No-show rate', stats.noShowRate == null ? '—' : Math.round(stats.noShowRate * 100) + '%'],
            ].map(([label, value]) => (
              <div key={label} className="card card-padding"><div className="text-sm text-muted">{label}</div><div className="text-2xl font-semibold text-ink mt-1">{value}</div></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="card card-padding">
              <h2 className="text-sm font-semibold text-ink mb-3">Busiest days</h2>
              {stats.byWeekday.map((n: number, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm py-0.5"><span className="w-10 text-ink-soft">{WEEKDAYS[i]}</span><span className="h-3 rounded bg-brand-500" style={{ width: `${(n / peak(stats.byWeekday)) * 70}%` }} aria-hidden="true" /><span className="text-ink">{n}</span></div>
              ))}
            </div>
            <div className="card card-padding">
              <h2 className="text-sm font-semibold text-ink mb-3">Top services</h2>
              {!stats.topServices.length && <p className="text-sm text-muted">No bookings yet.</p>}
              {stats.topServices.map((s: any) => <div key={s.name} className="flex justify-between text-sm py-1 border-b border-line last:border-0 text-ink"><span>{s.name}</span><span>{s.count}</span></div>)}
              <h2 className="text-sm font-semibold text-ink mt-5 mb-2">Where they came from</h2>
              {Object.entries(stats.bySource).map(([k, n]) => <div key={k} className="flex justify-between text-sm py-1 text-ink"><span>{k === 'public' ? 'Online' : k === 'staff' ? 'At the desk' : 'Repeating'}</span><span>{n as number}</span></div>)}
            </div>
          </div>
          <p className="text-xs text-muted">Booked value is the price of completed visits; payments are kept in the CRM.</p>
        </>
      )}
      {tab === 'customers' && (
        <>
          <input type="search" aria-label="Search customers" placeholder="Search name, email, phone…" className="input mb-4" value={q} onChange={(e) => setQ(e.target.value)} />
          {customers === null && !error && <p className="text-muted text-sm">Loading…</p>}
          {customers && !shown.length && <div className="card card-padding text-center text-muted">No customers yet.</div>}
          {shown.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper border-b border-line"><tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">Customer</th><th className="px-4 py-3">Bookings</th><th className="px-4 py-3">Completed</th><th className="px-4 py-3">No-shows</th><th className="px-4 py-3">Booked value</th><th className="px-4 py-3">Last visit</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {shown.map((c) => (
                    <tr key={c.email} className="text-ink">
                      <td className="px-4 py-3"><div className="font-semibold">{c.name}</div><div className="text-xs text-muted">{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>{Array.isArray(c.names) && c.names.length > 1 && <div className="text-xs text-muted">Also booked as {c.names.slice(1).join(', ')}</div>}</td>
                      <td className="px-4 py-3">{c.bookings}</td><td className="px-4 py-3">{c.completed}</td><td className="px-4 py-3">{c.noShows}</td>
                      <td className="px-4 py-3">{dollars(c.bookedValue) || '$0'}</td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{c.lastVisit ? new Date(c.lastVisit).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: stats?.timezone }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** People waiting for a time to open; they are emailed when one does. */
export function BookingWaitlistPage() {
  const confirm = useConfirm()
  const mayUpdate = useMayWrite('bookings:update')
  const [rows, setRows] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => api.get('/api/booking/waitlist').then((r: any) => setRows(r.data)).catch((e: Error) => setError(e.message))
  useEffect(() => { load() }, [])
  const remove = async (id: string) => {
    if (!(await confirm('They won’t be told when a time opens.', { title: 'Take them off the waitlist?', confirmText: 'Remove' }))) return
    try { await api.delete(`/api/booking/waitlist/${id}`); load() } catch (e: any) { setError(e.message) }
  }
  const label: Record<string, string> = { open: 'Waiting', notified: 'Told a time opened', booked: 'Booked', expired: 'Dates passed' }
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-ink mb-1">Waitlist</h1>
      <p className="text-muted text-sm mb-5">Customers who asked to hear when a time opens. They're emailed when a booking that fits their dates is cancelled or moved.</p>
      <PageError message={error} className="mb-4" />
      {rows === null && !error && <p className="text-muted text-sm">Loading…</p>}
      {rows && !rows.length && <div className="card card-padding text-center text-muted">Nobody is waiting.</div>}
      {rows && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((w) => (
            <li key={w.id} className="card card-padding flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink">{w.customerName} <span className="text-xs font-normal text-muted">· {label[w.status] || w.status}</span></div>
                <div className="text-sm text-ink-soft">{w.serviceName} · {w.preferredFrom || w.preferredTo ? `${w.preferredFrom ? dateWords(w.preferredFrom) : 'any time'} to ${w.preferredTo ? dateWords(w.preferredTo) : 'any time'}` : 'any day'}</div>
                <div className="text-xs text-muted mt-1">{w.customerEmail}{w.customerPhone ? ` · ${w.customerPhone}` : ''}</div>
                {w.notes && <p className="text-sm text-ink mt-2 whitespace-pre-wrap">{w.notes}</p>}
              </div>
              {mayUpdate && <button type="button" onClick={() => remove(w.id)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label={`Remove ${w.customerName}`}><Trash2 className="w-3.5 h-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One repeating booking: its visits, and ending it. */
export function BookingSeriesPage() {
  const { id } = useParams<{ id: string }>()
  const { settings } = useBookingBasics()
  const confirm = useConfirm()
  const toast = useToast()
  const mayUpdate = useMayWrite('bookings:update')
  const [series, setSeries] = useState<any>(null)
  const [visits, setVisits] = useState<Booking[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = () => Promise.all([api.get(`/api/booking/series/${id}`), api.get('/api/booking/bookings', { seriesId: id, limit: 100 })])
    .then(([s, v]: [any, { data: Booking[] }]) => { setSeries(s); setVisits([...v.data].sort((a, b) => a.startAt.localeCompare(b.startAt))) }).catch((e: Error) => setError(e.message))
  useEffect(() => { load() }, [id])
  const end = async () => {
    if (!(await confirm('Every visit still to come is cancelled, and each customer is emailed.', { title: 'End this repeating booking?', confirmText: 'End it' }))) return
    try { const r = await api.delete(`/api/booking/series/${id}`); toast.success(`Ended — ${r.cancelledVisits} visit${r.cancelledVisits === 1 ? '' : 's'} cancelled.`); load() } catch (e: any) { setError(e.message) }
  }
  if (!series || !settings) return error ? <PageError message={error} /> : <div className="text-muted text-sm">Loading…</div>
  const clock = onClock(settings.timezone)
  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/crm/bookings" className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-sm mb-5"><ArrowLeft className="w-4 h-4" />All bookings</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">{series.customerName}</h1>
          <p className="text-muted text-sm mt-1">{series.frequency === 'monthly' ? (series.intervalCount > 1 ? `Every ${series.intervalCount} months` : 'Every month') : series.intervalCount === 2 ? 'Every other week' : series.intervalCount > 1 ? `Every ${series.intervalCount} weeks` : 'Every week'} · {series.status === 'active' ? 'active' : 'ended'}</p>
        </div>
        {mayUpdate && series.status === 'active' && <button type="button" onClick={end} className="btn-secondary btn-md text-red-700 dark:text-red-300">End it</button>}
      </div>
      <PageError message={error} className="mb-4" />
      <ul className="card divide-y divide-line">
        {visits.map((b) => (
          <li key={b.id}><Link to={`/crm/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper">
            <span className="text-xs text-muted w-8">#{b.seriesIndex}</span>
            <span className="flex-1 text-sm text-ink">{clock.day(b.startAt)} · {clock.time(b.startAt)}</span>
            <StatusPill status={b.status} />
          </Link></li>
        ))}
      </ul>
    </div>
  )
}
