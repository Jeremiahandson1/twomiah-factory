import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, Trash2, Clock } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

interface WaitlistEntry {
  id: string
  serviceId: string
  customerName: string
  customerEmail: string
  customerPhone: string | null
  preferredFrom: string | null
  preferredTo: string | null
  notes: string | null
  status: 'open' | 'notified' | 'converted' | 'expired'
  notifiedAt: string | null
  createdAt: string
}
interface Service { id: string; name: string }

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  notified: 'bg-amber-50 text-amber-700 border-amber-200',
  converted: 'bg-green-50 text-green-700 border-green-200',
  expired: 'bg-gray-100 text-gray-600 border-gray-200',
}

export function BookingWaitlistPage() {
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get<{ waitlist: WaitlistEntry[] }>('/api/admin/booking-waitlist'),
      api.get<{ services: Service[] }>('/api/admin/booking-services'),
    ]).then(([w, s]) => { setWaitlist(w.waitlist); setServices(s.services) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const remove = async (e: WaitlistEntry) => {
    if (!confirm(`Remove ${e.customerName} from the waitlist?`)) return
    try { await api.delete(`/api/admin/booking-waitlist/${e.id}`); load() }
    catch (e: any) { setError(e.message) }
  }

  const svcName = (id: string) => services.find(s => s.id === id)?.name || '—'

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link to="/bookings" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />Bookings
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl text-ink flex items-center gap-3"><Clock className="w-6 h-6" />Waitlist</h1>
        <p className="text-muted text-sm mt-1">Customers waiting for a slot to open up. Notified automatically when a confirmed booking is cancelled.</p>
      </div>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
      {loading && <div className="text-muted text-sm">Loading…</div>}
      {!loading && waitlist.length === 0 && <div className="card card-padding text-center text-muted">No one on the waitlist yet.</div>}
      {!loading && waitlist.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Service</th>
                <th className="px-5 py-3 font-semibold">Preferred window</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold w-px"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {waitlist.map(w => (
                <tr key={w.id} className="hover:bg-paper/50">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-ink">{w.customerName}</div>
                    <div className="text-xs text-muted flex items-center gap-2 mt-0.5">
                      <a href={`mailto:${w.customerEmail}`} className="inline-flex items-center gap-1 hover:text-ink"><Mail className="w-3 h-3" />{w.customerEmail}</a>
                      {w.customerPhone && <a href={`tel:${w.customerPhone}`} className="inline-flex items-center gap-1 hover:text-ink"><Phone className="w-3 h-3" />{w.customerPhone}</a>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink">{svcName(w.serviceId)}</td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {w.preferredFrom || '∞'} → {w.preferredTo || '∞'}
                  </td>
                  <td className="px-5 py-3">
                    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', STATUS_STYLES[w.status])}>{w.status}</span>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => remove(w)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
