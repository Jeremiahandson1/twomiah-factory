import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Clock, MapPin, Phone, Mail, ExternalLink, Plus, X, Search, Download, RotateCw, LayoutGrid, TrendingUp, Hourglass, Users } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { Label } from '../components/Field'
import { BookingOnboarding } from '../components/BookingOnboarding'

interface Booking {
  id: string
  serviceId: string
  startAt: string
  endAt: string
  customerName: string
  customerEmail: string
  customerPhone: string | null
  customerAddress: string | null
  customerNotes: string | null
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  assignedUserId: string | null
  createdAt: string
}

interface Service { id: string; name: string }

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-800 border-blue-200',
  completed: 'bg-green-50 text-green-800 border-green-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
  no_show: 'bg-amber-50 text-amber-800 border-amber-200',
}

export function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const [query, setQuery] = useState('')
  const [serviceFilter, setServiceFilter] = useState<string>('all')
  const [newOpen, setNewOpen] = useState(false)

  const reload = () => {
    setLoading(true)
    Promise.all([
      api.get<{ bookings: Booking[] }>('/api/admin/bookings'),
      api.get<{ services: Service[] }>('/api/admin/booking-services'),
    ]).then(([b, s]) => {
      setBookings(b.bookings); setServices(s.services)
    }).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const serviceById = (id: string) => services.find(s => s.id === id)?.name || 'Unknown service'
  const now = Date.now()
  const q = query.trim().toLowerCase()
  const filtered = bookings.filter(b => {
    if (filter === 'upcoming' && (new Date(b.startAt).getTime() < now || b.status === 'cancelled')) return false
    if (filter === 'past' && new Date(b.startAt).getTime() >= now) return false
    if (serviceFilter !== 'all' && b.serviceId !== serviceFilter) return false
    if (q && !(
      b.customerName.toLowerCase().includes(q) ||
      b.customerEmail.toLowerCase().includes(q) ||
      (b.customerPhone || '').toLowerCase().includes(q) ||
      (b.customerAddress || '').toLowerCase().includes(q)
    )) return false
    return true
  })

  const exportCsv = () => {
    const headers = ['Date', 'Time', 'Customer', 'Email', 'Phone', 'Address', 'Service', 'Status', 'Notes']
    const rows = filtered.map(b => {
      const d = new Date(b.startAt)
      return [
        d.toLocaleDateString('en-US'),
        d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        b.customerName,
        b.customerEmail,
        b.customerPhone || '',
        b.customerAddress || '',
        serviceById(b.serviceId),
        b.status,
        b.customerNotes || '',
      ]
    })
    const escape = (v: string) => '"' + v.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"'
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bookings-' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <BookingOnboarding />
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Bookings</h1>
          <p className="text-muted text-sm mt-1">Every appointment booked through your public site.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setNewOpen(true)} className="btn-primary btn-md inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />New booking</button>
          <Link to="/bookings-calendar" className="btn-secondary btn-md inline-flex items-center gap-1.5"><LayoutGrid className="w-4 h-4" />Calendar</Link>
          <Link to="/bookings-analytics" className="btn-secondary btn-md inline-flex items-center gap-1.5"><TrendingUp className="w-4 h-4" />Analytics</Link>
          <Link to="/bookings-waitlist" className="btn-secondary btn-md inline-flex items-center gap-1.5"><Hourglass className="w-4 h-4" />Waitlist</Link>
          <Link to="/customers" className="btn-secondary btn-md inline-flex items-center gap-1.5"><Users className="w-4 h-4" />Customers</Link>
          <Link to="/booking-settings" className="btn-secondary btn-md">Settings</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {(['upcoming', 'past', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              'px-4 py-1.5 rounded-full text-sm font-medium border',
              filter === f ? 'bg-ink text-white border-ink' : 'bg-white text-ink-soft border-line hover:border-ink-soft'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="search"
            placeholder="Search name, email, phone, address…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input pl-9"
          />
        </div>
        {services.length > 1 && (
          <select value={serviceFilter} onChange={e => setServiceFilter(e.target.value)} className="input" style={{ width: 'auto' }}>
            <option value="all">All services</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {filtered.length > 0 && (
          <button onClick={exportCsv} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" />CSV
          </button>
        )}
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {!loading && filtered.length === 0 && (
        <div className="card card-padding text-center text-muted">
          No bookings in this view yet.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map(b => (
            <Link key={b.id} to={`/bookings/${b.id}`} className="block card card-padding hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="font-semibold text-ink">{b.customerName}</span>
                    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', STATUS_STYLES[b.status])}>
                      {b.status}
                    </span>
                  </div>
                  <div className="text-sm text-ink-soft mb-2">{serviceById(b.serviceId)}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(b.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(b.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                    {b.customerAddress && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{b.customerAddress}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 text-xs text-muted">
                  {b.customerPhone && <a href={`tel:${b.customerPhone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-ink"><Phone className="w-3 h-3" />{b.customerPhone}</a>}
                  <a href={`mailto:${b.customerEmail}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-ink"><Mail className="w-3 h-3" />{b.customerEmail}</a>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {newOpen && <NewBookingModal services={services} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); reload() }} />}
    </div>
  )
}

function NewBookingModal({ services, onClose, onCreated }: { services: Service[]; onClose: () => void; onCreated: () => void }) {
  const [serviceId, setServiceId] = useState(services[0]?.id || '')
  const [startAt, setStartAt] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Recurring options
  const [isRecurring, setIsRecurring] = useState(false)
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('biweekly')
  const [occurrencesCount, setOccurrencesCount] = useState('8')
  const [seriesResult, setSeriesResult] = useState<{ instancesCreated: number } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setSubmitting(true)
    try {
      if (isRecurring) {
        const res = await api.post<{ instancesCreated: number }>('/api/admin/booking-series', {
          serviceId,
          frequency,
          firstStartAt: new Date(startAt).toISOString(),
          occurrencesCount: parseInt(occurrencesCount, 10) || 8,
          customerName, customerEmail,
          customerPhone: customerPhone || null,
          customerAddress: customerAddress || null,
          customerNotes: customerNotes || null,
        })
        setSeriesResult(res)
        setTimeout(() => onCreated(), 1500)
      } else {
        await api.post('/api/admin/bookings', {
          serviceId,
          startAt: new Date(startAt).toISOString(),
          customerName, customerEmail,
          customerPhone: customerPhone || null,
          customerAddress: customerAddress || null,
          customerNotes: customerNotes || null,
        })
        onCreated()
      }
    } catch (e: any) { setError(e?.message) }
    finally { setSubmitting(false) }
  }

  if (seriesResult) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="card card-padding w-full max-w-md text-center" onClick={e => e.stopPropagation()}>
          <RotateCw className="w-10 h-10 text-green-600 mx-auto mb-3" />
          <h3 className="text-xl text-ink mb-2">Series created</h3>
          <p className="text-muted text-sm">{seriesResult.instancesCreated} appointments scheduled.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card card-padding w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl text-ink">New booking</h3>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        {services.length === 0 ? (
          <div className="text-sm text-muted">No services configured yet. <Link to="/booking-settings" className="text-brand">Add a service first</Link>.</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Service</Label>
              <select className="input" required value={serviceId} onChange={e => setServiceId(e.target.value)}>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Date &amp; time</Label>
              <input type="datetime-local" className="input" required value={startAt} onChange={e => setStartAt(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Customer name</Label><input className="input" required value={customerName} onChange={e => setCustomerName(e.target.value)} autoFocus /></div>
              <div><Label>Email</Label><input type="email" className="input" required value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><input type="tel" className="input" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} /></div>
              <div><Label>Address</Label><input className="input" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} /></div>
            </div>
            <div><Label>Notes</Label><textarea rows={2} className="input" value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm cursor-pointer border-t border-line pt-3">
              <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
              <RotateCw className="w-3.5 h-3.5 text-muted" />
              Make this recurring
            </label>
            {isRecurring && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <Label>Frequency</Label>
                  <select className="input" value={frequency} onChange={e => setFrequency(e.target.value as any)}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every other week</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <Label>Number of appointments</Label>
                  <input type="number" min={2} max={52} className="input" value={occurrencesCount} onChange={e => setOccurrencesCount(e.target.value)} />
                </div>
              </div>
            )}
            {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary btn-md">{submitting ? (isRecurring ? 'Creating series…' : 'Booking…') : (isRecurring ? 'Create series' : 'Confirm booking')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
