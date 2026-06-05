import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, List, Plus } from 'lucide-react'
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
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    return d
  })

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    return d
  }, [weekStart])

  useEffect(() => {
    setLoading(true)
    const from = weekStart.toISOString()
    const to = weekEnd.toISOString()
    Promise.all([
      api.get<{ bookings: Booking[] }>(`/api/admin/bookings?from=${from}&to=${to}`),
      api.get<{ services: Service[] }>('/api/admin/booking-services'),
    ])
      .then(([b, s]) => { setBookings(b.bookings); setServices(s.services) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [weekStart])

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
    d.setDate(d.getDate() + 7 * delta)
    setWeekStart(d)
  }
  const goToday = () => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    setWeekStart(d)
  }

  const monthLabel = weekStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = new Date().toDateString()

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl text-ink">Calendar</h1>
          <p className="text-muted text-sm mt-1">{monthLabel}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/bookings" className="btn-secondary btn-md inline-flex items-center gap-1.5"><List className="w-4 h-4" />List view</Link>
          <Link to="/booking-settings" className="btn-secondary btn-md">Settings</Link>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => goWeek(-1)} className="btn-secondary btn-sm"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={goToday} className="btn-secondary btn-sm">Today</button>
        <button onClick={() => goWeek(1)} className="btn-secondary btn-sm"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-sm text-muted ml-2">
          {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

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
        {loading ? (
          <div className="p-8 text-muted text-sm text-center">Loading…</div>
        ) : (
          <div className="grid grid-cols-7 min-h-[480px]">
            {days.map((d, i) => {
              const dayBookings = bookingsForDay(d)
              return (
                <div key={i} className="border-r border-line last:border-r-0 p-2 space-y-1.5">
                  {dayBookings.length === 0 && <div className="text-xs text-muted/60 text-center pt-4">—</div>}
                  {dayBookings.map(b => (
                    <Link
                      key={b.id}
                      to={`/bookings/${b.id}`}
                      className={clsx('block px-2 py-1.5 rounded border text-xs hover:shadow-sm transition-shadow', STATUS_BG[b.status])}
                      title={`${b.customerName} — ${serviceById(b.serviceId)}`}
                    >
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
    </div>
  )
}
