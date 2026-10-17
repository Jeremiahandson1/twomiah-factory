import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Phone, Mail, MapPin, FileText, AlertTriangle, RotateCw } from 'lucide-react'
import { api } from '../api/client'
import { Label } from '../components/Field'

interface Booking {
  id: string
  serviceId: string
  seriesId: string | null
  seriesIndex: number | null
  startAt: string
  endAt: string
  customerName: string
  customerEmail: string
  customerPhone: string | null
  customerAddress: string | null
  customerNotes: string | null
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  assignedUserId: string | null
  source: string
  createdAt: string
}

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.get<{ booking: Booking }>(`/api/admin/bookings/${id}`)
      .then(({ booking }) => setBooking(booking))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const update = async (patch: Partial<Booking>) => {
    if (!id) return
    setSaving(true); setError(null); setOkMsg(null)
    try {
      const { booking } = await api.patch<{ booking: Booking }>(`/api/admin/bookings/${id}`, patch)
      setBooking(booking)
      setOkMsg('Saved.')
      setTimeout(() => setOkMsg(null), 2500)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (error && !booking) return <div className="p-8 text-red-700 text-sm">{error}</div>
  if (!booking) return null

  const start = new Date(booking.startAt)
  const end = new Date(booking.endAt)

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Link to="/bookings" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        All bookings
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl text-ink">{booking.customerName}</h1>
          <p className="text-muted text-sm mt-1">Booked {new Date(booking.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} · {booking.source}</p>
          {booking.seriesId && (
            <Link to={`/series/${booking.seriesId}`} className="inline-flex items-center gap-1.5 mt-2 text-xs text-brand hover:underline">
              <RotateCw className="w-3 h-3" />
              Part of a recurring series ({booking.seriesIndex && <span>#{booking.seriesIndex}</span>})
            </Link>
          )}
        </div>
        <select
          value={booking.status}
          onChange={(e) => update({ status: e.target.value as Booking['status'] })}
          className="input"
          style={{ width: 'auto' }}
        >
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="no_show">No-show</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
      {okMsg && <div className="text-green-800 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">{okMsg}</div>}

      <section className="card card-padding mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">When</h2>
        <div className="text-lg text-ink">
          {start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="text-muted text-sm mt-1">
          {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} — {end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
      </section>

      <section className="card card-padding mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Customer</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted" />
            <a className="text-ink hover:text-brand" href={`mailto:${booking.customerEmail}`}>{booking.customerEmail}</a>
          </div>
          {booking.customerPhone && (
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-muted" />
              <a className="text-ink hover:text-brand" href={`tel:${booking.customerPhone}`}>{booking.customerPhone}</a>
            </div>
          )}
          {booking.customerAddress && (
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted" />
              <span className="text-ink">{booking.customerAddress}</span>
            </div>
          )}
        </div>
      </section>

      {booking.customerNotes && (
        <section className="card card-padding mb-4">
          <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2"><FileText className="w-4 h-4" />Notes from customer</h2>
          <p className="text-sm text-ink whitespace-pre-wrap">{booking.customerNotes}</p>
        </section>
      )}

      <section className="card card-padding">
        <h2 className="text-sm font-semibold text-ink mb-3">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (confirm('Mark as cancelled? The customer will not be notified automatically.')) {
                update({ status: 'cancelled' })
              }
            }}
            disabled={saving || booking.status === 'cancelled'}
            className="btn-secondary btn-sm text-red-600 disabled:opacity-40"
          >
            Cancel booking
          </button>
          {booking.status === 'confirmed' && (
            <button onClick={() => update({ status: 'completed' })} disabled={saving} className="btn-secondary btn-sm">
              Mark complete
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
