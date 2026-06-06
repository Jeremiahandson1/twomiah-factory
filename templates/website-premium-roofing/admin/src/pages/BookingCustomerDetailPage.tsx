import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, MapPin, DollarSign, Calendar, RotateCw } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

interface Booking {
  id: string
  startAt: string
  endAt: string
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  customerName: string
  customerPhone: string | null
  customerAddress: string | null
  serviceName: string | null
  priceCents: number | null
  seriesId: string | null
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
  no_show: 'bg-amber-50 text-amber-700 border-amber-200',
}

export function BookingCustomerDetailPage() {
  const { email } = useParams<{ email: string }>()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!email) return
    api.get<{ email: string; bookings: Booking[] }>(`/api/admin/booking-customers/${encodeURIComponent(email)}`)
      .then(({ bookings }) => setBookings(bookings))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [email])

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (error) return <div className="p-8 text-red-700 text-sm">{error}</div>
  if (bookings.length === 0) return <div className="p-8 text-muted text-sm">No bookings for this customer.</div>

  const latest = bookings[0]
  const completed = bookings.filter(b => b.status === 'completed')
  const revenueCents = completed.reduce((s, b) => s + (b.priceCents || 0), 0)
  const upcoming = bookings.filter(b => new Date(b.startAt).getTime() >= Date.now() && b.status === 'confirmed')
  const decoded = decodeURIComponent(email!)
  const dollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString()

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/customers" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />Customers
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl text-ink">{latest.customerName}</h1>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-ink-soft">
          <a href={`mailto:${decoded}`} className="inline-flex items-center gap-1.5 hover:text-brand"><Mail className="w-4 h-4" />{decoded}</a>
          {latest.customerPhone && <a href={`tel:${latest.customerPhone}`} className="inline-flex items-center gap-1.5 hover:text-brand"><Phone className="w-4 h-4" />{latest.customerPhone}</a>}
          {latest.customerAddress && <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" />{latest.customerAddress}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card card-padding"><div className="text-xs text-muted mb-1">Total visits</div><div className="text-2xl font-bold text-ink">{bookings.length}</div></div>
        <div className="card card-padding"><div className="text-xs text-muted mb-1">Lifetime revenue</div><div className="text-2xl font-bold text-ink">{dollars(revenueCents)}</div></div>
        <div className="card card-padding"><div className="text-xs text-muted mb-1">Upcoming</div><div className="text-2xl font-bold text-ink">{upcoming.length}</div></div>
      </div>

      <section className="card card-padding">
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" />All bookings</h2>
        <ul className="divide-y divide-line">
          {bookings.map(b => (
            <li key={b.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Link to={`/bookings/${b.id}`} className="text-sm text-ink hover:text-brand">
                  {new Date(b.startAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} · {new Date(b.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </Link>
                <div className="text-xs text-muted">{b.serviceName}{b.seriesId && <RotateCw className="inline w-3 h-3 ml-2" aria-label="Recurring" />}</div>
              </div>
              {b.priceCents != null && <div className="text-sm font-mono text-muted">{dollars(b.priceCents)}</div>}
              <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', STATUS_STYLES[b.status])}>{b.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
