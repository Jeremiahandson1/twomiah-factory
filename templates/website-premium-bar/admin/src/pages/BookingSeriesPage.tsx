import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, RotateCw, X, Calendar, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

interface Series {
  id: string
  serviceId: string
  frequency: 'weekly' | 'biweekly' | 'monthly'
  intervalCount: number
  firstStartAt: string
  occurrencesCount: number | null
  untilDate: string | null
  customerName: string
  customerEmail: string
  customerPhone: string | null
  customerAddress: string | null
  status: 'active' | 'cancelled'
  cancelledAt: string | null
  createdAt: string
}

interface Instance {
  id: string
  seriesIndex: number | null
  startAt: string
  endAt: string
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'
}

const FREQ_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every other week',
  monthly: 'Monthly',
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
  no_show: 'bg-amber-50 text-amber-700 border-amber-200',
}

export function BookingSeriesPage() {
  const { id } = useParams<{ id: string }>()
  const [series, setSeries] = useState<Series | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const load = () => {
    if (!id) return
    setLoading(true)
    api.get<{ series: Series; instances: Instance[] }>(`/api/admin/booking-series/${id}`)
      .then(({ series, instances }) => { setSeries(series); setInstances(instances) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [id])

  const cancelFuture = async () => {
    if (!confirm('Cancel all future appointments in this series? Past + today\'s appointments stay as-is.')) return
    setWorking(true); setError(null); setOkMsg(null)
    try {
      await api.delete(`/api/admin/booking-series/${id}`)
      setOkMsg('Series cancelled.')
      load()
    } catch (e: any) { setError(e?.message) }
    finally { setWorking(false) }
  }

  const cancelInstance = async (instanceId: string) => {
    if (!confirm('Cancel just this one appointment? The rest of the series stays.')) return
    setWorking(true); setError(null); setOkMsg(null)
    try {
      await api.patch(`/api/admin/bookings/${instanceId}`, { status: 'cancelled' })
      load()
    } catch (e: any) { setError(e?.message) }
    finally { setWorking(false) }
  }

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (error && !series) return <div className="p-8 text-red-700 text-sm">{error}</div>
  if (!series) return null

  const upcoming = instances.filter(i => new Date(i.startAt).getTime() >= Date.now() && i.status === 'confirmed')
  const completed = instances.filter(i => i.status === 'completed').length
  const totalConfirmed = instances.filter(i => i.status !== 'cancelled').length

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/bookings" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        All bookings
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <RotateCw className="w-5 h-5 text-brand" />
            <h1 className="text-3xl text-ink">{series.customerName}</h1>
          </div>
          <p className="text-muted text-sm">Recurring series · {FREQ_LABEL[series.frequency]}{series.intervalCount > 1 && series.frequency === 'monthly' ? ` (every ${series.intervalCount} months)` : ''}</p>
        </div>
        <span className={clsx('px-3 py-1 rounded-full border text-xs font-medium', series.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200')}>
          {series.status === 'active' ? 'Active' : 'Cancelled'}
        </span>
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
      {okMsg && <div className="text-green-800 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">{okMsg}</div>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card card-padding">
          <div className="text-xs text-muted uppercase tracking-wider mb-1">Completed</div>
          <div className="text-2xl text-ink font-bold">{completed} <span className="text-sm text-muted font-normal">/ {totalConfirmed}</span></div>
        </div>
        <div className="card card-padding">
          <div className="text-xs text-muted uppercase tracking-wider mb-1">Upcoming</div>
          <div className="text-2xl text-ink font-bold">{upcoming.length}</div>
        </div>
        <div className="card card-padding">
          <div className="text-xs text-muted uppercase tracking-wider mb-1">Customer</div>
          <div className="text-sm text-ink truncate"><a href={`mailto:${series.customerEmail}`} className="hover:text-brand">{series.customerEmail}</a></div>
          {series.customerPhone && <div className="text-xs text-muted mt-1"><a href={`tel:${series.customerPhone}`}>{series.customerPhone}</a></div>}
        </div>
      </div>

      <section className="card card-padding mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            All appointments
          </h2>
          {series.status === 'active' && upcoming.length > 0 && (
            <button onClick={cancelFuture} disabled={working} className="btn-secondary btn-sm text-red-600 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Cancel all upcoming
            </button>
          )}
        </div>
        <ul className="divide-y divide-line">
          {instances.map(i => {
            const dt = new Date(i.startAt)
            const isPast = dt.getTime() < Date.now()
            const canCancel = i.status === 'confirmed' && !isPast
            return (
              <li key={i.id} className="py-3 flex items-center gap-3">
                <div className="text-xs text-muted w-6 text-center font-mono">{i.seriesIndex}</div>
                <div className="flex-1">
                  <Link to={`/bookings/${i.id}`} className="text-sm text-ink hover:text-brand">
                    {dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </Link>
                </div>
                <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', STATUS_STYLES[i.status])}>{i.status}</span>
                {canCancel && (
                  <button onClick={() => cancelInstance(i.id)} disabled={working} className="btn-secondary btn-sm text-red-600" title="Cancel just this one">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
