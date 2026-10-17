import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, Mail, Phone, Award, Calendar } from 'lucide-react'
import { api } from '../api/client'

interface Customer {
  email: string
  name: string
  phone: string | null
  totalBookings: number
  completed: number
  cancelled: number
  revenueCents: number
  firstAt: string
  lastAt: string
}

export function BookingCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'revenue' | 'visits'>('recent')

  useEffect(() => {
    api.get<{ customers: Customer[] }>('/api/admin/booking-customers')
      .then(({ customers }) => setCustomers(customers))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let arr = customers.filter(c => !q ||
      c.email.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    )
    if (sort === 'recent') arr = arr.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
    if (sort === 'revenue') arr = arr.sort((a, b) => b.revenueCents - a.revenueCents)
    if (sort === 'visits') arr = arr.sort((a, b) => b.totalBookings - a.totalBookings)
    return arr
  }, [customers, query, sort])

  const dollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString()

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link to="/bookings" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />Bookings
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl text-ink">Customers</h1>
        <p className="text-muted text-sm mt-1">Every customer who has booked. Repeat customers are gold.</p>
      </div>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input type="search" placeholder="Search by name, email, phone…" value={query} onChange={e => setQuery(e.target.value)} className="input pl-9" />
        </div>
        <div className="flex gap-1 p-1 bg-paper rounded-lg">
          {(['recent', 'revenue', 'visits'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)} className={`px-3 py-1.5 rounded text-sm font-medium ${sort === s ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {s === 'recent' ? 'Most recent' : s === 'revenue' ? 'By revenue' : 'By visits'}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      {!loading && filtered.length === 0 && (
        <div className="card card-padding text-center text-muted">No customers yet.</div>
      )}
      {!loading && filtered.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold text-right">Visits</th>
                <th className="px-5 py-3 font-semibold text-right">Revenue</th>
                <th className="px-5 py-3 font-semibold text-right">Last visit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map(c => (
                <tr key={c.email} className="hover:bg-paper/50">
                  <td className="px-5 py-3">
                    <Link to={`/customers/${encodeURIComponent(c.email)}`} className="font-semibold text-ink hover:text-brand">
                      {c.name}
                      {c.totalBookings >= 3 && <Award className="inline w-3.5 h-3.5 text-amber-500 ml-2" aria-label="Repeat customer" />}
                    </Link>
                    <div className="text-xs text-muted flex items-center gap-3 mt-0.5">
                      <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>
                      {c.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-ink font-mono">{c.totalBookings}</td>
                  <td className="px-5 py-3 text-right text-ink font-mono">{dollars(c.revenueCents)}</td>
                  <td className="px-5 py-3 text-right text-muted text-xs">{new Date(c.lastAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
