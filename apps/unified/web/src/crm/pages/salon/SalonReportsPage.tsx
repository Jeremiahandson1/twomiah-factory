// Client reports (server crm/salon/reports.ts, /api/salon-reports; hidden feature `salon_reports`): retention and visit frequency, each
// stylist's rebook rate, and retail sold. Every figure says in words what it counts. Commission statements stay on the Commissions page.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Loader2 } from 'lucide-react'
import { api, useAuth, money, todayKey, dayKeyPlus } from '../../../shared'
import { inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`)

interface Retention {
  truncated: boolean; visits: number; activeClients: number; newClients: number; returningClients: number; visitsPerClient: number | null
  frequency: { once: number; twice: number; threeToFour: number; fivePlus: number }; averageDaysBetweenVisits: number | null
  retention: { priorClients: number; retained: number; ratePercent: number | null }
  bookedAgain: { count: number; ratePercent: number | null }
  firstTimers: { count: number; cameBack: number; ratePercent: number | null }; lapsed: { days: number; count: number }
}
interface Rebook { truncated: boolean; total: { visits: number; rebooked: number; ratePercent: number | null }; stylists: Array<{ name: string; visits: number; rebooked: number; ratePercent: number | null }> }
interface Tips { total: number; payments: number; stylists: Array<{ name: string; tips: number; payments: number }> }
interface Retail { total: number; units: number; byItem: Array<{ name: string; units: number; total: number }>; byStylist: Array<{ name: string; units: number; total: number }> }

const PRESETS = [{ id: '30', label: 'Last 30 days', days: 29 }, { id: '90', label: 'Last 90 days', days: 89 }, { id: '365', label: 'Last 12 months', days: 364 }, { id: 'custom', label: 'Choose dates', days: 0 }]

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
      <p className="text-sm text-gray-700 dark:text-slate-300">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {note && <p className="text-xs text-gray-600 dark:text-slate-400">{note}</p>}
    </div>
  )
}

export default function SalonReportsPage() {
  const { hasFeature } = useAuth()
  const [preset, setPreset] = useState('90')
  const [from, setFrom] = useState(dayKeyPlus(todayKey(), -89))
  const [to, setTo] = useState(todayKey())
  const [data, setData] = useState<{ r: Retention; b: Rebook; t: Retail; tips: Tips } | null>(null)
  const [error, setError] = useState('')

  const pick = (id: string) => {
    setPreset(id)
    const p = PRESETS.find((x) => x.id === id)
    if (p && p.days) { setTo(todayKey()); setFrom(dayKeyPlus(todayKey(), -p.days)) }
  }
  useEffect(() => {
    let live = true
    const qs = `?from=${from}&to=${to}`
    setError('')
    Promise.all([api.get(`/api/salon-reports/retention${qs}`), api.get(`/api/salon-reports/rebook${qs}`), api.get(`/api/salon-reports/retail${qs}`), api.get(`/api/salon-reports/tips${qs}`)])
      .then(([r, b, t, tips]) => { if (live) setData({ r, b, t, tips }) })
      .catch((e: Error) => { if (live) { setData(null); setError(e.message || 'The reports could not be loaded.') } })
    return () => { live = false }
  }, [from, to])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><BarChart3 className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Client reports</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Are clients coming back, and what are your stylists and your shelf earning? {hasFeature('salon_commissions') && <>Commission statements are on <Link to="/crm/commissions" className="underline">Commissions</Link>.</>}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Dates">
        <label className="text-sm font-medium text-gray-900 dark:text-slate-100">Period
          <select value={preset} onChange={(e) => pick(e.target.value)} className={inputCls + ' mt-1'}>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="text-sm font-medium text-gray-900 dark:text-slate-100">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls + ' mt-1'} /></label>
            <label className="text-sm font-medium text-gray-900 dark:text-slate-100">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputCls + ' mt-1'} /></label>
          </>
        )}
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {!data && !error && <div className="flex h-32 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>}

      {data && (
        <>
          {(data.r.truncated || data.b.truncated) && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">This period has more visits than a report can read, so only the earliest are counted. Choose a shorter period.</div>}

          <section className={box} aria-label="Retention">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Retention and visit frequency</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              <Stat label="Clients who came in" value={data.r.activeClients} note={`${data.r.visits} visits · ${data.r.newClients} new · ${data.r.returningClients} returning`} />
              <Stat label="Came back" value={pct(data.r.retention.ratePercent)} note={`${data.r.retention.retained} of the ${data.r.retention.priorClients} clients from the period before also came in this one`} />
              <Stat label="Booked again" value={pct(data.r.bookedAgain.ratePercent)} note={`${data.r.bookedAgain.count} of the ${data.r.activeClients} clients who came in hold an appointment from today on`} />
              <Stat label="First-timers who returned" value={pct(data.r.firstTimers.ratePercent)} note={`${data.r.firstTimers.cameBack} of ${data.r.firstTimers.count} new clients have had a second visit or hold a booking`} />
              <Stat label="Slipped away" value={data.r.lapsed.count} note={`not in for ${data.r.lapsed.days}+ days and nothing booked (set in Automatic messages)`} />
            </div>
            <h3 className="mt-5 text-sm font-semibold text-gray-900 dark:text-slate-100">How often clients came in this period</h3>
            <p className={hint}>{data.r.visitsPerClient != null ? `${data.r.visitsPerClient} visits per client` : 'No visits in this period'}{data.r.averageDaysBetweenVisits != null ? ` · about ${data.r.averageDaysBetweenVisits} days between visits for clients who came more than once` : ''}</p>
            <table className="mt-2 text-sm text-gray-900 dark:text-slate-100">
              <tbody>
                {([['Once', data.r.frequency.once], ['Twice', data.r.frequency.twice], ['3 to 4 times', data.r.frequency.threeToFour], ['5 or more times', data.r.frequency.fivePlus]] as Array<[string, number]>).map(([k, v]) => <tr key={k}><td className="pr-6 py-0.5">{k}</td><td className="font-medium">{v} client{v === 1 ? '' : 's'}</td></tr>)}
              </tbody>
            </table>
          </section>

          <section className={box} aria-label="Rebook rate">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Rebook rate by stylist</h2>
            <p className={hint}>A visit counts as rebooked when the client had another appointment after it (not cancelled, not a no-show) that was booked no later than a day after the visit. {data.b.total.ratePercent != null && <strong>Whole salon: {pct(data.b.total.ratePercent)} ({data.b.total.rebooked} of {data.b.total.visits} visits).</strong>}</p>
            {data.b.stylists.length === 0 ? <p className={hint}>No visits in this period.</p> : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-gray-700 dark:text-slate-300"><tr><th className="py-1 pr-4">Stylist</th><th className="py-1 pr-4 text-right">Visits</th><th className="py-1 pr-4 text-right">Rebooked</th><th className="py-1 text-right">Rate</th></tr></thead>
                  <tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-800 dark:text-slate-100">
                    {data.b.stylists.map((s) => <tr key={s.name}><td className="py-1.5 pr-4">{s.name}</td><td className="py-1.5 pr-4 text-right">{s.visits}</td><td className="py-1.5 pr-4 text-right">{s.rebooked}</td><td className="py-1.5 text-right font-medium">{pct(s.ratePercent)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={box} aria-label="Retail">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Retail sold</h2>
            <p className={hint}>Retail lines on sales paid in this period, before tax. Refunded and void sales are left out. {data.t.units > 0 && <strong>{money(data.t.total)} from {data.t.units} item{data.t.units === 1 ? '' : 's'}.</strong>}</p>
            {data.t.byItem.length === 0 ? <p className={hint}>No retail sold in this period.</p> : (
              <div className="mt-2 grid gap-6 md:grid-cols-2">
                <table className="text-sm"><caption className="pb-1 text-left font-semibold text-gray-900 dark:text-slate-100">By item</caption>
                  <tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-800 dark:text-slate-100">{data.t.byItem.map((i) => <tr key={i.name}><td className="py-1 pr-4">{i.name}</td><td className="py-1 pr-4 text-right">{i.units}</td><td className="py-1 text-right font-medium">{money(i.total)}</td></tr>)}</tbody></table>
                <table className="text-sm"><caption className="pb-1 text-left font-semibold text-gray-900 dark:text-slate-100">By stylist</caption>
                  <tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-800 dark:text-slate-100">{data.t.byStylist.map((i) => <tr key={i.name}><td className="py-1 pr-4">{i.name}</td><td className="py-1 pr-4 text-right">{i.units}</td><td className="py-1 text-right font-medium">{money(i.total)}</td></tr>)}</tbody></table>
              </div>
            )}
          </section>
          <section className={box} aria-label="Tips">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Tips by stylist</h2>
            <p className={hint}>Tips taken in this period — on the card reader or typed in with a payment — each credited to the stylist of the visit the sale closed. {data.tips.payments > 0 && <strong>{money(data.tips.total)} in {data.tips.payments} payment{data.tips.payments === 1 ? '' : 's'}.</strong>}</p>
            {data.tips.stylists.length === 0 ? <p className={hint}>No tips in this period.</p> : (
              <table className="mt-2 text-sm"><tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-800 dark:text-slate-100">{data.tips.stylists.map((s) => <tr key={s.name}><td className="py-1 pr-6">{s.name}</td><td className="py-1 pr-6 text-right">{s.payments} payment{s.payments === 1 ? '' : 's'}</td><td className="py-1 text-right font-medium">{money(s.tips)}</td></tr>)}</tbody></table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
