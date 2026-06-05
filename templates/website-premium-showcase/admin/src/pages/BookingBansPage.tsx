import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, ShieldAlert, Mail, Phone } from 'lucide-react'
import { api } from '../api/client'
import { Label } from '../components/Field'

interface Ban {
  id: string
  email: string | null
  phone: string | null
  reason: string | null
  createdAt: string
}

export function BookingBansPage() {
  const [bans, setBans] = useState<Ban[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')

  const load = () => {
    setLoading(true)
    api.get<{ bans: Ban[] }>('/api/admin/booking-bans')
      .then(({ bans }) => setBans(bans))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    try {
      await api.post('/api/admin/booking-bans', { email, phone, reason })
      setEmail(''); setPhone(''); setReason(''); load()
    } catch (e: any) { setError(e?.message) }
  }
  const remove = async (b: Ban) => {
    if (!confirm('Remove the ban? This customer will be able to book again.')) return
    try { await api.delete(`/api/admin/booking-bans/${b.id}`); load() }
    catch (e: any) { setError(e.message) }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Link to="/bookings" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />Bookings
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl text-ink flex items-center gap-3"><ShieldAlert className="w-6 h-6 text-red-600" />Banned customers</h1>
        <p className="text-muted text-sm mt-1">Block repeat no-shows. Their booking attempts get a fake success page but no actual booking is recorded.</p>
      </div>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      <section className="card card-padding mb-6">
        <h2 className="text-sm font-semibold text-ink mb-3">Add a ban</h2>
        <form onSubmit={add} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Email</Label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="problem@example.com" className="input" /></div>
            <div><Label>Phone</Label><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+15555550100" className="input" /></div>
          </div>
          <div><Label>Reason (internal)</Label><input value={reason} onChange={e => setReason(e.target.value)} placeholder="3 no-shows in a row" className="input" /></div>
          <button type="submit" disabled={!email && !phone} className="btn-primary btn-md inline-flex items-center gap-1.5 disabled:opacity-40"><Plus className="w-4 h-4" />Ban</button>
        </form>
        <p className="text-xs text-muted mt-3">At least one of email or phone is required. Customer's booking attempt silently fails — they get a generic success page so they don't try to work around the ban.</p>
      </section>

      <section className="card card-padding">
        <h2 className="text-sm font-semibold text-ink mb-3">Active bans</h2>
        {loading && <div className="text-muted text-sm">Loading…</div>}
        {!loading && bans.length === 0 && <div className="text-muted text-sm">No banned customers.</div>}
        {!loading && bans.length > 0 && (
          <ul className="divide-y divide-line">
            {bans.map(b => (
              <li key={b.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 text-sm text-ink">
                    {b.email && <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-muted" />{b.email}</span>}
                    {b.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-muted" />{b.phone}</span>}
                  </div>
                  {b.reason && <div className="text-xs text-muted mt-0.5">{b.reason}</div>}
                </div>
                <button onClick={() => remove(b)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
