import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, TrendingUp, DollarSign, Users, AlertTriangle, Calendar } from 'lucide-react'
import { api } from '../api/client'

interface Analytics {
  rangeDays: number
  totalBookings: number
  byStatus: { confirmed: number; completed: number; cancelled: number; no_show: number }
  revenueCents: number
  avgBookingValueCents: number
  noShowRate: number
  byDayOfWeek: number[]
  byHour: number[]
  topServices: Array<{ id: string; name: string; count: number }>
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function BookingsAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<30 | 90 | 365>(30)

  useEffect(() => {
    setLoading(true)
    api.get<Analytics>(`/api/admin/bookings/analytics?days=${range}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [range])

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (error) return <div className="p-8 text-red-700 text-sm">{error}</div>
  if (!data) return null

  const dollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString()
  const pct = (n: number) => Math.round(n * 1000) / 10 + '%'
  const maxDay = Math.max(...data.byDayOfWeek, 1)
  const maxHour = Math.max(...data.byHour, 1)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link to="/bookings" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />Bookings
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl text-ink">Analytics</h1>
          <p className="text-muted text-sm mt-1">Trends and aggregates from your booking activity.</p>
        </div>
        <div className="flex gap-1 p-1 bg-paper rounded-lg">
          {([30, 90, 365] as const).map(d => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-3 py-1.5 rounded text-sm font-medium ${range === d ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {d === 365 ? '1 yr' : d + 'd'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Stat icon={<Calendar className="w-4 h-4" />} label="Total bookings" value={data.totalBookings.toString()} />
        <Stat icon={<DollarSign className="w-4 h-4" />} label="Revenue (completed)" value={dollars(data.revenueCents)} />
        <Stat icon={<TrendingUp className="w-4 h-4" />} label="Avg booking value" value={dollars(data.avgBookingValueCents)} />
        <Stat icon={<AlertTriangle className="w-4 h-4" />} label="No-show rate" value={pct(data.noShowRate)} accent={data.noShowRate > 0.1 ? 'bad' : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <section className="card card-padding">
          <h2 className="text-sm font-semibold text-ink mb-4">Status breakdown</h2>
          <div className="space-y-2">
            {(['confirmed', 'completed', 'cancelled', 'no_show'] as const).map(s => {
              const c = data.byStatus[s] || 0
              const p = data.totalBookings > 0 ? c / data.totalBookings : 0
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className="w-20 text-xs text-ink-soft capitalize">{s.replace('_', ' ')}</div>
                  <div className="flex-1 h-6 bg-paper rounded overflow-hidden">
                    <div className="h-full bg-brand" style={{ width: (p * 100) + '%' }} />
                  </div>
                  <div className="w-12 text-right text-sm text-ink font-mono">{c}</div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="card card-padding">
          <h2 className="text-sm font-semibold text-ink mb-4">Top services</h2>
          {data.topServices.length === 0 ? (
            <p className="text-sm text-muted">No bookings in this range.</p>
          ) : (
            <ul className="space-y-2">
              {data.topServices.map(s => (
                <li key={s.id} className="flex items-center gap-3">
                  <div className="flex-1 text-sm text-ink truncate">{s.name}</div>
                  <div className="w-12 text-right text-sm text-muted font-mono">{s.count}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card card-padding mb-6">
        <h2 className="text-sm font-semibold text-ink mb-4">By day of week</h2>
        <div className="flex items-end gap-2 h-32">
          {data.byDayOfWeek.map((count, i) => {
            const h = count > 0 ? Math.max((count / maxDay) * 100, 6) : 0
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                <div className="text-xs text-muted">{count > 0 ? count : ''}</div>
                <div className="w-full bg-brand rounded-t" style={{ height: h + '%' }} />
                <div className="text-xs text-ink-soft">{DAYS[i]}</div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card card-padding">
        <h2 className="text-sm font-semibold text-ink mb-4">By hour of day</h2>
        <div className="flex items-end gap-0.5 h-32">
          {data.byHour.map((count, i) => {
            const h = count > 0 ? Math.max((count / maxHour) * 100, 4) : 0
            const showLabel = i % 3 === 0
            const hour12 = i === 0 ? '12a' : i < 12 ? i + 'a' : i === 12 ? '12p' : (i - 12) + 'p'
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                <div className="w-full bg-brand rounded-t" style={{ height: h + '%' }} title={`${hour12}: ${count}`} />
                {showLabel && <div className="text-[10px] text-ink-soft">{hour12}</div>}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: 'good' | 'bad' }) {
  return (
    <div className="card card-padding">
      <div className="flex items-center gap-2 text-muted text-xs mb-2">{icon}<span>{label}</span></div>
      <div className={`text-2xl font-bold ${accent === 'bad' ? 'text-red-700' : accent === 'good' ? 'text-green-700' : 'text-ink'}`}>{value}</div>
    </div>
  )
}
