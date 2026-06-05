import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, List, Plus, Grid3X3, Calendar as CalIcon } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

interface Booking {
  id: string
  serviceId: string
  startAt: string
  endAt: string
  customerName: string
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'
}
interface Service { id: string; name: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const STATUS_BG: Record<string, string> = {
  confirmed: 'bg-blue-100 border-blue-300 text-blue-900',
  completed: 'bg-green-100 border-green-300 text-green-900',
  cancelled: 'bg-gray-100 border-gray-300 text-gray-500 line-through',
  no_show: 'bg-amber-100 border-amber-300 text-amber-900',
}

export function BookingsCalendarPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'week' | 'month'>('week')
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    return d
  })

  // Month view anchors at the first of the displayed month
  const monthStart = useMemo(() => {
    const d = new Date(weekStart)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }, [weekStart])

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    return d
  }, [weekStart])

  // Month grid: starts on Sunday on or before the 1st, runs 6 weeks (42 cells)
  const monthGrid = useMemo(() => {
    const start = new Date(monthStart)
    start.setDate(start.getDate() - start.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [monthStart])

  useEffect(() => {
    setLoading(true)
    const from = view === 'week' ? weekStart : monthGrid[0]
    const to = view === 'week' ? weekEnd : new Date(monthGrid[41].getTime() + 86400000)
    Promise.all([
      api.get<{ bookings: Booking[] }>(`/api/admin/bookings?from=${from.toISOString()}&to=${to.toISOString()}`),
      api.get<{ services: Service[] }>('/api/admin/booking-services'),
    ])
      .then(([b, s]) => { setBookings(b.bookings); setServices(s.services) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [view, weekStart, monthStart])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  }), [weekStart])

  const serviceById = (id: string) => services.find(s => s.id === id)?.name || '—'

  const bookingsForDay = (date: Date) =>
    bookings
      .filter(b => new Date(b.startAt).toDateString() === date.toDateString())
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

  const goWeek = (delta: number) => {
    const d = new Date(weekStart)
    if (view === 'week') d.setDate(d.getDate() + 7 * delta)
    else { d.setMonth(d.getMonth() + delta); d.setDate(1); d.setDate(d.getDate() - d.getDay()) }
    setWeekStart(d)
  }
  const goToday = () => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    setWeekStart(d)
  }

  const monthLabel = (view === 'week' ? weekStart : monthStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = new Date().toDateString()

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl text-ink">Calendar</h1>
          <p className="text-muted text-sm mt-1">{monthLabel}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/bookings" className="btn-secondary btn-md inline-flex items-center gap-1.5"><List className="w-4 h-4" />List</Link>
          <Link to="/booking-settings" className="btn-secondary btn-md">Settings</Link>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => goWeek(-1)} className="btn-secondary btn-sm"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={goToday} className="btn-secondary btn-sm">Today</button>
        <button onClick={() => goWeek(1)} className="btn-secondary btn-sm"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-sm text-muted ml-2">
          {view === 'week'
            ? `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <div className="ml-auto flex gap-1 p-1 bg-paper rounded-lg">
          <button onClick={() => setView('week')} className={clsx('px-3 py-1 rounded text-xs font-medium inline-flex items-center gap-1', view === 'week' ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}>
            <CalIcon className="w-3 h-3" />Week
          </button>
          <button onClick={() => setView('month')} className={clsx('px-3 py-1 rounded text-xs font-medium inline-flex items-center gap-1', view === 'month' ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}>
            <Grid3X3 className="w-3 h-3" />Month
          </button>
        </div>
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {view === 'week' ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line">
            {days.map((d, i) => (
              <div key={i} className={clsx('px-3 py-2 text-center border-r border-line last:border-r-0',
                d.toDateString() === today ? 'bg-brand text-white' : 'bg-paper text-ink-soft'
              )}>
                <div className="text-xs uppercase tracking-wider">{WEEKDAYS[i]}</div>
                <div className="text-lg font-bold">{d.getDate()}</div>
              </div>
            ))}
          </div>
          {loading ? <div className="p-8 text-muted text-sm text-center">Loading…</div> : (
            <div className="grid grid-cols-7 min-h-[480px]">
              {days.map((d, i) => {
                const dayBookings = bookingsForDay(d)
                return (
                  <div key={i} className="border-r border-line last:border-r-0 p-2 space-y-1.5">
                    {dayBookings.length === 0 && <div className="text-xs text-muted/60 text-center pt-4">—</div>}
                    {dayBookings.map(b => (
                      <Link key={b.id} to={`/bookings/${b.id}`}
                        className={clsx('block px-2 py-1.5 rounded border text-xs hover:shadow-sm transition-shadow', STATUS_BG[b.status])}
                        title={`${b.customerName} — ${serviceById(b.serviceId)}`}>
                        <div className="font-mono text-[10px] opacity-70">
                          {new Date(b.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </div>
                        <div className="font-semibold truncate">{b.customerName}</div>
                        <div className="opacity-80 truncate">{serviceById(b.serviceId)}</div>
                      </Link>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map(d => (
              <div key={d} className="px-2 py-1.5 text-center border-r border-line last:border-r-0 bg-paper text-ink-soft text-xs uppercase tracking-wider">{d}</div>
            ))}
          </div>
          {loading ? <div className="p-8 text-muted text-sm text-center">Loading…</div> : (
            <div className="grid grid-cols-7">
              {monthGrid.map((d, i) => {
                const inMonth = d.getMonth() === monthStart.getMonth()
                const dayBookings = bookingsForDay(d)
                return (
                  <div key={i} className={clsx('border-r border-b border-line last:border-r-0 p-1.5 min-h-[88px]', !inMonth && 'bg-paper/40')}>
                    <div className={clsx('text-xs font-mono mb-1', d.toDateString() === today ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white' : inMonth ? 'text-ink-soft' : 'text-muted/50')}>
                      {d.getDate()}
                    </div>
                    {dayBookings.slice(0, 3).map(b => (
                      <Link key={b.id} to={`/bookings/${b.id}`}
                        className={clsx('block px-1.5 py-0.5 rounded mb-0.5 text-[10px] truncate hover:underline', STATUS_BG[b.status])}
                        title={`${b.customerName} — ${serviceById(b.serviceId)}`}>
                        <span className="font-mono opacity-60 mr-1">{new Date(b.startAt).toLocaleTimeString('en-US', { hour: 'numeric' })}</span>
                        {b.customerName}
                      </Link>
                    ))}
                    {dayBookings.length > 3 && (
                      <div className="text-[10px] text-muted px-1">+{dayBookings.length - 3} more</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
