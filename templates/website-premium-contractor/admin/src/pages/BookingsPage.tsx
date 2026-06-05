import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Clock, MapPin, Phone, Mail, ExternalLink, Plus, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { Label } from '../components/Field'

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
  const filtered = bookings.filter(b => {
    if (filter === 'upcoming') return new Date(b.startAt).getTime() >= now && b.status !== 'cancelled'
    if (filter === 'past') return new Date(b.startAt).getTime() < now
    return true
  })

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Bookings</h1>
          <p className="text-muted text-sm mt-1">Every appointment booked through your public site.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setNewOpen(true)} className="btn-primary btn-md inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />New booking</button>
          <Link to="/booking-settings" className="btn-secondary btn-md">Settings</Link>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setSubmitting(true)
    try {
      await api.post('/api/admin/bookings', {
        serviceId,
        startAt: new Date(startAt).toISOString(),
        customerName, customerEmail,
        customerPhone: customerPhone || null,
        customerAddress: customerAddress || null,
        customerNotes: customerNotes || null,
      })
      onCreated()
    } catch (e: any) { setError(e?.message) }
    finally { setSubmitting(false) }
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
            {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary btn-md">{submitting ? 'Booking…' : 'Confirm booking'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
