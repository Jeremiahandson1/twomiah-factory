// The book as a calendar: a week or a month, on the business's clock. Drag a booking to another day to move it there
// at the same time; the server checks the time is free (the site's calendar moved it with no check at all), and if
// it isn't, says why and offers to move it anyway.
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { PageError, useMayWrite, useToast } from '../shared'
import { useBookingBasics, onClock, addDays, weekdayOf, dateWords, blockStyle, type Booking } from './common'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function BookingCalendarPage() {
  const { settings, error: basicsError } = useBookingBasics()
  const mayUpdate = useMayWrite('bookings:update')
  const toast = useToast()
  const [view, setView] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState<string | null>(null)
  const [rows, setRows] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState<{ id: string; date: string; time: string; message: string } | null>(null)

  const clock = settings ? onClock(settings.timezone) : null
  useEffect(() => { if (clock && !anchor) setAnchor(clock.today()) }, [clock, anchor])

  // The days on screen, as calendar dates in the business's zone.
  const days = useMemo(() => {
    if (!anchor) return []
    if (view === 'week') { const start = addDays(anchor, -weekdayOf(anchor)); return Array.from({ length: 7 }, (_, i) => addDays(start, i)) }
    const first = anchor.slice(0, 8) + '01'
    const start = addDays(first, -weekdayOf(first))
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [anchor, view])

  const load = () => {
    if (!days.length) return
    setLoading(true); setError(null)
    // A day either side, so a booking near midnight in another zone is never missed; placed by the business's date.
    api.get('/api/booking/bookings', { from: new Date(Date.parse(days[0] + 'T00:00:00Z') - 86_400_000).toISOString(), to: new Date(Date.parse(days[days.length - 1] + 'T00:00:00Z') + 2 * 86_400_000).toISOString(), limit: 500 })
      .then((r: { data: Booking[] }) => setRows(r.data)).catch((e: Error) => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [days])

  const onDay = (d: string) => clock ? rows.filter((b) => clock.date(b.startAt) === d).sort((a, b) => a.startAt.localeCompare(b.startAt)) : []

  const move = async (id: string, date: string, time: string, override = false) => {
    try {
      await api.patch(`/api/booking/bookings/${id}`, { date, time, override })
      setRefused(null)
      toast.success('Moved — the customer has been emailed the new time.')
      load()
    } catch (e: any) {
      setRefused({ id, date, time, message: e.message })
    }
  }
  const onDrop = (e: DragEvent, date: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    const b = rows.find((x) => x.id === id)
    if (!b || !clock || clock.date(b.startAt) === date) return
    move(id, date, clock.hm(b.startAt))
  }
  const step = (n: number) => {
    if (!anchor) return
    if (view === 'week') setAnchor(addDays(anchor, 7 * n))
    else { const [y, m] = anchor.split('-').map(Number); setAnchor(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)) }
  }

  if (!clock || !anchor) return basicsError ? <PageError message={basicsError} /> : <div className="text-muted text-sm">Loading…</div>
  const today = clock.today()
  const month = anchor.slice(0, 7)

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Calendar</h1>
          <p className="text-muted text-sm mt-1">{dateWords(anchor, { month: 'long', year: 'numeric' })} · times {clock.zone()}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} className="btn-secondary btn-sm" aria-label={view === 'week' ? 'Previous week' : 'Previous month'}><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" onClick={() => setAnchor(today)} className="btn-secondary btn-sm">Today</button>
          <button type="button" onClick={() => step(1)} className="btn-secondary btn-sm" aria-label={view === 'week' ? 'Next week' : 'Next month'}><ChevronRight className="w-4 h-4" /></button>
          <div className="flex gap-1 p-1 bg-paper rounded-lg ml-2" role="group" aria-label="View">
            {(['week', 'month'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={'px-3 py-1 rounded text-xs font-medium ' + (view === v ? 'bg-white dark:bg-slate-900 text-ink shadow-sm' : 'text-ink-soft hover:text-ink')}>{v === 'week' ? 'Week' : 'Month'}</button>)}
          </div>
        </div>
      </div>

      <PageError message={error} className="mb-4" />
      {refused && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 flex flex-wrap items-center gap-3">
          <span className="flex-1">Not moved: {refused.message}</span>
          <button type="button" className="btn-secondary btn-sm" onClick={() => move(refused.id, refused.date, refused.time, true)}>Move it anyway</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setRefused(null)}>Leave it</button>
        </div>
      )}
      {mayUpdate && <p className="text-xs text-muted mb-3">Drag a booking to another day to move it there at the same time.</p>}

      <div className="card overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 border-b border-line">
            {(view === 'week' ? days : days.slice(0, 7)).map((d, i) => (
              <div key={d} className={'px-2 py-2 text-center border-r border-line last:border-r-0 ' + (view === 'week' && d === today ? 'bg-brand-600 text-white' : 'bg-paper text-ink-soft')}>
                <div className="text-xs uppercase tracking-wider">{WEEKDAYS[i]}</div>
                {view === 'week' && <div className="text-lg font-bold">{Number(d.slice(8))}</div>}
              </div>
            ))}
          </div>
          {loading ? <div className="p-8 text-muted text-sm text-center">Loading…</div> : (
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = onDay(d)
                const out = view === 'month' && d.slice(0, 7) !== month
                return (
                  <div key={d} onDragOver={(e) => { if (mayUpdate) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }} onDrop={(e) => mayUpdate && onDrop(e, d)}
                    className={'border-r border-b border-line last:border-r-0 p-1.5 space-y-1 ' + (view === 'week' ? 'min-h-[420px]' : 'min-h-[96px]') + (out ? ' bg-paper/50' : '')}>
                    {view === 'month' && <div className={'text-xs mb-1 ' + (d === today ? 'inline-flex w-6 h-6 items-center justify-center rounded-full bg-brand-600 text-white' : out ? 'text-muted' : 'text-ink-soft')}>{Number(d.slice(8))}</div>}
                    {(view === 'month' ? list.slice(0, 3) : list).map((b) => (
                      <Link key={b.id} to={`/crm/bookings/${b.id}`} draggable={mayUpdate && (b.status === 'confirmed' || b.status === 'pending')}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', b.id)}
                        className={'block px-2 py-1 rounded border text-xs ' + blockStyle(b.status)} title={`${b.customerName} — ${b.serviceName || ''}`}>
                        <span className="font-mono">{clock.time(b.startAt)}</span>{' '}
                        <span className="font-semibold">{b.customerName}</span>
                        {view === 'week' && <span className="block truncate">{b.serviceName}</span>}
                      </Link>
                    ))}
                    {view === 'month' && list.length > 3 && <div className="text-[11px] text-ink-soft px-1">+{list.length - 3} more</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
