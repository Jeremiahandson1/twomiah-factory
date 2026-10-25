// The book: every booking, upcoming first, searchable, exportable; and a new one (once, or repeating).
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Download, Calendar, Clock, MapPin, X, Repeat } from 'lucide-react'
import { api } from '../api'
import { PageError, useMayWrite } from '../shared'
import { useBookingBasics, onClock, StatusPill, bookable, type Booking } from './common'
import { TimePicker, type PickedTime } from './TimePicker'
import { verticalScreens } from '../crm/vertical'

/** The vertical's own book, when its online bookings land there beside the desk's (VerticalScreens.booking). */
const OWN_BOOK = verticalScreens().booking.calendarPath

type View = 'upcoming' | 'past' | 'all'

export function BookingsPage() {
  const { settings, services, people, error: basicsError } = useBookingBasics()
  const mayCreate = useMayWrite('bookings:create')
  // The CSV is the whole book in a file: the office's (bookings:export, manager and up), not a crew seat's (2026-10-24).
  const mayExport = useMayWrite('bookings:export')
  const [view, setView] = useState<View>('upcoming')
  const [rows, setRows] = useState<Booking[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [serviceId, setServiceId] = useState('all')
  const [creating, setCreating] = useState(false)
  // Opening hours, for "can a customer book yet?" below: a business with a service and no hours is closed every day.
  const [hoursCount, setHoursCount] = useState<number | null>(null)
  useEffect(() => { api.get('/api/booking/hours').then((r: { data: unknown[] }) => setHoursCount(r.data.length)).catch(() => setHoursCount(null)) }, [])

  const load = () => {
    setRows(null); setError(null)
    const now = new Date().toISOString()
    const params: Record<string, string | number> = { limit: 500 }
    if (view === 'upcoming') params.from = now
    if (view === 'past') params.to = now
    api.get('/api/booking/bookings', params)
      .then((r: { data: Booking[]; pagination: { total: number } }) => {
        const data = view === 'upcoming' ? r.data.filter((b) => b.status !== 'cancelled') : r.data
        setRows(data); setTotal(r.pagination.total)
      })
      .catch((e: Error) => setError(e.message))
  }
  useEffect(load, [view])

  const clock = settings ? onClock(settings.timezone) : null
  const nameOf = (b: Booking) => (b.assignedUserId ? b.assignedName || 'Someone' : 'Anyone')
  /** Booked under a name the contact record doesn't carry (one email, a household): say whose record it is on. */
  const differs = (b: Booking) => !!b.contactName && b.contactName.trim().toLowerCase() !== b.customerName.trim().toLowerCase()
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => (rows || []).filter((b) => (serviceId === 'all' || b.serviceId === serviceId) && (!q || [b.customerName, b.customerEmail, b.customerPhone, b.customerAddress].some((v) => (v || '').toLowerCase().includes(q)))), [rows, serviceId, q])

  const exportCsv = () => {
    if (!clock) return
    const head = ['Date', 'Time', 'Customer', 'Email', 'Phone', 'Address', 'Service', 'Who', 'Status', 'Notes']
    const esc = (v: string) => '"' + v.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"'
    const lines = shown.map((b) => [clock.date(b.startAt), clock.time(b.startAt), b.customerName, b.customerEmail, b.customerPhone || '', b.customerAddress || '', b.serviceName || '', nameOf(b), b.status, b.customerNotes || ''])
    const blob = new Blob([[head, ...lines].map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bookings-${clock.today()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const chip = (on: boolean) => 'px-4 py-1.5 rounded-full text-sm font-medium border ' + (on ? 'bg-ink text-white dark:text-slate-900 border-ink' : 'bg-white dark:bg-slate-900 text-ink-soft border-line hover:border-ink-soft')

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Bookings</h1>
          {/* A vertical whose online bookings land in its own book (a salon's The Book) keeps the desk's appointments
              there, not here: said, with the way to the one place both are seen (salon live test, 2026-10-25). */}
          {typeof OWN_BOOK === 'string'
            ? <p className="text-muted text-sm mt-1">Every online booking. Each is also in <Link to={OWN_BOOK} className="underline">your book</Link>, with the appointments made at the desk.{clock ? ` Times are ${clock.zone()}.` : ''}</p>
            : <p className="text-muted text-sm mt-1">Every appointment, online and made at the desk.{clock ? ` Times are ${clock.zone()}.` : ''}</p>}
        </div>
        {mayCreate && <button type="button" onClick={() => setCreating(true)} className="btn-primary btn-md" disabled={!services.some(bookable)}><Plus className="w-4 h-4" />New booking</button>}
      </div>

      <PageError message={basicsError || error} className="mb-4" />
      {settings && <NotBookableYet enabled={settings.enabled} services={services.filter(bookable).length} hours={hoursCount} />}

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div role="group" aria-label="Show" className="flex gap-2">
          {(['upcoming', 'past', 'all'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={chip(view === v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
          <input type="search" aria-label="Search bookings" placeholder="Search name, email, phone, address…" value={query} onChange={(e) => setQuery(e.target.value)} className="input pl-9" />
        </div>
        {services.length > 1 && (
          <select aria-label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="input w-auto">
            <option value="all">All services</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {mayExport && shown.length > 0 && <button type="button" onClick={exportCsv} className="btn-secondary btn-sm"><Download className="w-3.5 h-3.5" />CSV</button>}
      </div>

      {rows === null && !error && <div className="text-muted text-sm">Loading…</div>}
      {rows && !shown.length && <div className="card card-padding text-center text-muted">No bookings in this view.</div>}
      {total > 500 && <p className="text-xs text-muted mb-3">Showing the first 500 of {total}. Search or narrow the view to find older ones.</p>}
      {clock && shown.length > 0 && (
        <ul className="space-y-3">
          {shown.map((b) => (
            <li key={b.id}>
              <Link to={`/crm/bookings/${b.id}`} className="block card card-padding hover:border-brand-500 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-ink">{b.customerName}</span>
                      <StatusPill status={b.status} />
                      {b.job && <span className="text-xs font-medium text-ink-soft border border-line rounded px-1.5 py-0.5">{b.job.number}</span>}
                      {b.seriesId && <span className="text-xs text-muted inline-flex items-center gap-1"><Repeat className="w-3 h-3" aria-hidden="true" />repeating</span>}
                    </div>
                    <div className="text-sm text-ink-soft">{b.serviceName || 'Service removed'} · {nameOf(b)}</div>
                    {differs(b) && <div className="text-xs text-muted mt-0.5">On the contact {b.contactName}</div>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted">
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" aria-hidden="true" />{clock.day(b.startAt)}</span>
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden="true" />{clock.time(b.startAt)} – {clock.time(b.endAt)}</span>
                      {b.customerAddress && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden="true" />{b.customerAddress}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-muted text-right">{b.customerPhone && <div>{b.customerPhone}</div>}<div>{b.customerEmail}</div></div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && settings && <NewBookingDialog services={services.filter(bookable)} people={people} zone={onClock(settings.timezone).zone()} requirePhone={settings.requirePhone} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
    </div>
  )
}

/**
 * What stands between the business and its first online booking, said plainly. Live test 2026-10-22: a new business
 * with no service and no hours had a website saying "Bookings opening soon" and a Bookings screen that said only
 * "No services yet" — nothing about the hours, so every day stayed closed after the service was added.
 */
function NotBookableYet({ enabled, services, hours }: { enabled: boolean; services: number; hours: number | null }) {
  const todo = [
    ...(!enabled ? ['switch online booking on'] : []),
    ...(!services ? [typeof verticalScreens().booking.serviceMenuPath === 'string'
      ? 'tick “Bookable online” on a service on your Service Menu'
      : 'add a service customers can book (for example a 30-minute consultation)'] : []),
    ...(hours === 0 ? ['set your opening hours — with none, every day shows as closed'] : []),
  ]
  if (!todo.length) return null
  return (
    <div role="status" className="card card-padding mb-6 text-sm border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100">
      <p className="font-semibold">Customers can’t book online yet.</p>
      <p className="mt-1">To open your booking page:</p>
      <ul className="list-disc pl-5 mt-1 space-y-0.5">{todo.map((t) => <li key={t}>{t}</li>)}</ul>
      <Link to="/crm/bookings/settings" className="inline-block mt-2 font-semibold underline">Go to booking settings</Link>
    </div>
  )
}

function NewBookingDialog({ services, people, zone, requirePhone, onClose, onDone }: { services: { id: string; name: string }[]; people: { id: string; name: string }[]; zone?: string; requirePhone: boolean; onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate()
  const [serviceId, setServiceId] = useState(services[0]?.id || '')
  const [when, setWhen] = useState<PickedTime | null>(null)
  const [f, setF] = useState({ name: '', email: '', phone: '', address: '', zip: '', notes: '', assignedUserId: '' })
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('biweekly')
  const [count, setCount] = useState('8')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A refusal clears once the booking is changed — never left over a day and time now chosen.
  useEffect(() => { setError(null) }, [when, f, serviceId, repeat, frequency, count])
  const [result, setResult] = useState<{ summary: string; booked: number; skipped: Array<{ date: string; reason: string }> } | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!when?.date || !when.time) { setError('Choose a day and time.'); return }
    setBusy(true); setError(null)
    const base = { serviceId, date: when.date, time: when.time, override: when.override, ...f, assignedUserId: f.assignedUserId || null }
    try {
      if (repeat) {
        setResult(await api.post('/api/booking/series', { ...base, frequency, occurrencesCount: Number(count) || 8 }))
      } else {
        const b = await api.post('/api/booking/bookings', base)
        navigate(`/crm/bookings/${b.id}`)
        onDone()
      }
    } catch (x: any) { setError(x.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="nb-title" className="card card-padding w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 id="nb-title" className="text-xl font-semibold text-ink">New booking</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {result ? (
          <div className="space-y-3">
            <p className="text-ink"><strong>{result.summary}</strong> — {result.booked} visit{result.booked === 1 ? '' : 's'} booked.</p>
            {result.skipped.length > 0 && (
              <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
                <p className="font-semibold mb-1">Not booked ({result.skipped.length}):</p>
                <ul className="list-disc pl-5">{result.skipped.map((s) => <li key={s.date}>{s.date}: {s.reason}</li>)}</ul>
              </div>
            )}
            <div className="flex justify-end"><button type="button" onClick={onDone} className="btn-primary btn-md">Done</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="nb-service" className="label">Service</label>
              <select id="nb-service" className="input" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setWhen(null) }}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <TimePicker serviceId={serviceId} value={when} onChange={setWhen} zone={zone} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label htmlFor="nb-name" className="label">Customer name</label><input id="nb-name" className="input" required value={f.name} onChange={set('name')} /></div>
              <div><label htmlFor="nb-email" className="label">Email</label><input id="nb-email" type="email" className="input" required value={f.email} onChange={set('email')} /></div>
              {/* The business's "Phone number required" holds at the desk too (the server refuses without it). */}
              <div><label htmlFor="nb-phone" className="label">Phone{requirePhone ? ' (required)' : ''}</label><input id="nb-phone" type="tel" className="input" required={requirePhone} value={f.phone} onChange={set('phone')} /></div>
              <div><label htmlFor="nb-zip" className="label">ZIP</label><input id="nb-zip" className="input" value={f.zip} onChange={set('zip')} /></div>
            </div>
            <div><label htmlFor="nb-address" className="label">Address</label><input id="nb-address" className="input" value={f.address} onChange={set('address')} /></div>
            {people.length > 1 && (
              <div>
                <label htmlFor="nb-who" className="label">Who</label>
                <select id="nb-who" className="input" value={f.assignedUserId} onChange={set('assignedUserId')}>
                  <option value="">Whoever is free</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div><label htmlFor="nb-notes" className="label">Notes</label><textarea id="nb-notes" rows={2} className="input" value={f.notes} onChange={set('notes')} /></div>
            <label className="flex items-center gap-2 text-sm text-ink border-t border-line pt-3">
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              <Repeat className="w-3.5 h-3.5 text-muted" aria-hidden="true" />Make it repeat
            </label>
            {repeat && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <label htmlFor="nb-freq" className="label">How often</label>
                  <select id="nb-freq" className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                    <option value="weekly">Every week</option>
                    <option value="biweekly">Every other week</option>
                    <option value="monthly">Every month</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="nb-count" className="label">Visits</label>
                  <input id="nb-count" type="number" min={2} max={52} className="input" value={count} onChange={(e) => setCount(e.target.value)} />
                </div>
              </div>
            )}
            <PageError message={error} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
              <button type="submit" disabled={busy || !when} className="btn-primary btn-md disabled:opacity-40">{busy ? 'Booking…' : repeat ? 'Book the visits' : 'Book it'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
