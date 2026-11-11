// Marketing ROI (parity tier 3, field service; server crm/field/marketingRoi.ts, /api/marketing-roi; feature marketing_roi, not
// ready): per lead source, the calls on its tracking numbers, the leads, the customers and jobs they became, the money those
// customers paid, against the spend — entered here per source per month; and the heat map, the period's customers by ZIP (every
// customer or one source's), sized by what they paid (or their jobs, for a seat that does not see money).
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Target } from 'lucide-react'
import { money } from '@twomiah/tenant-ui/src/money'
import PinMap, { type Pin } from '@twomiah/tenant-ui/src/maps/PinMap'
import { companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Row { source: string; label: string; calls: number; leads: number; customers: number; jobs: number; revenue?: number; spend?: number; costPerLead?: number | null; returnPerDollar?: number | null }
interface ZipCell { zip: string; customers: number; jobs: number; revenue?: number; lat: number | null; lng: number | null }
/** The heat scale: light to deep (fixed colours — the bubbles sit on the map's own light tiles in both themes). */
const HEAT = ['#fed7aa', '#fdba74', '#fb923c', '#ea580c', '#9a3412']
const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
/** The first of the month two months back, from a day key ('2026-11-10' → '2026-09-01'): calendar arithmetic on the key alone. */
const monthsBack = (key: string, n: number) => { const [y, m] = key.split('-').map(Number); const t = (y * 12 + (m - 1)) - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01` }

export default function MarketingRoiPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const maySpend = !known || can('invoices:update')
  // Today on the business's clock (never the reader's), and the start of the month two back.
  const [to, setTo] = useState(() => companyTodayKey())
  const [from, setFrom] = useState(() => monthsBack(companyTodayKey(), 2))
  const [data, setData] = useState<{ money: boolean; rows: Row[] } | null>(null)
  const [error, setError] = useState('')
  const [entry, setEntry] = useState({ source: '', month: to.slice(0, 7), amount: '' })
  const [saving, setSaving] = useState(false)
  const [mapSource, setMapSource] = useState('')
  const [map, setMap] = useState<{ money: boolean; zips: ZipCell[]; unplaced: number } | null>(null)

  const load = () => api.get('/api/marketing-roi', { from, to }).then((r: any) => { setData(r); setError('') }).catch((e: Error) => setError(e.message || 'The report could not be loaded.'))
  useEffect(() => { load() }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true
    api.get('/api/marketing-roi/map', { from, to, ...(mapSource ? { source: mapSource } : {}) }).then((r: any) => { if (live) setMap(r) }).catch(() => { if (live) setMap({ money: false, zips: [], unplaced: 0 }) })
    return () => { live = false }
  }, [from, to, mapSource])

  // Each ZIP a bubble: its size and colour by what its customers paid (or their jobs), against the biggest ZIP.
  const pins: Pin[] = useMemo(() => {
    const placed = (map?.zips || []).filter((z) => z.lat != null && z.lng != null)
    const measure = (z: ZipCell) => (map?.money ? z.revenue ?? 0 : z.jobs)
    const top = Math.max(1, ...placed.map(measure))
    return placed.map((z) => {
      const share = measure(z) / top
      return {
        id: z.zip, lat: z.lat as number, lng: z.lng as number, color: HEAT[Math.min(HEAT.length - 1, Math.floor(share * HEAT.length))], radius: 8 + Math.round(share * 22), title: `ZIP ${z.zip}`,
        lines: [`${z.customers} customer${z.customers === 1 ? '' : 's'} · ${z.jobs} job${z.jobs === 1 ? '' : 's'}`, ...(map?.money ? [`Paid ${money(z.revenue ?? 0)}`] : [])],
      }
    })
  }, [map])

  const saveSpend = async () => {
    setSaving(true)
    try { await api.put('/api/marketing-roi/spend', { source: entry.source, month: entry.month, amountCents: Math.round(Number(entry.amount) * 100) }); toast.success('Spend saved'); setEntry({ ...entry, amount: '' }); await load() }
    catch (e: any) { toast.error(e?.message || 'The spend could not be saved.') } finally { setSaving(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><Target className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Marketing ROI</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">For each lead source: the calls to its tracking numbers, the leads that came in, the customers they became, those customers&rsquo; jobs and what they paid in the period, against what you spent on it. A first-time caller on a tracking number is a lead for that number&rsquo;s source.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-sm text-gray-700 dark:text-slate-300">From <input type="date" className={input} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label className="text-sm text-gray-700 dark:text-slate-300">To <input type="date" className={input} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        </div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {!data && !error && <Loader2 className="h-6 w-6 animate-spin text-gray-500 dark:text-slate-300" />}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-gray-600 dark:text-slate-300">
              <th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 font-medium">Calls</th><th className="px-3 py-2 font-medium">Leads</th><th className="px-3 py-2 font-medium">Customers</th><th className="px-3 py-2 font-medium">Jobs</th>
              {data.money && <><th className="px-3 py-2 font-medium">Paid</th><th className="px-3 py-2 font-medium">Spent</th><th className="px-3 py-2 font-medium">Cost per lead</th><th className="px-3 py-2 font-medium">Back per $1</th></>}
            </tr></thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {data.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-gray-700 dark:text-slate-300">No leads or spend in this period.</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.source} className="text-gray-900 dark:text-slate-100">
                  <td className="px-3 py-2">{r.label}</td><td className="px-3 py-2">{r.calls}</td><td className="px-3 py-2">{r.leads}</td><td className="px-3 py-2">{r.customers}</td><td className="px-3 py-2">{r.jobs}</td>
                  {data.money && <><td className="px-3 py-2">{money(r.revenue ?? 0)}</td><td className="px-3 py-2">{r.spend ? money(r.spend) : '—'}</td><td className="px-3 py-2">{r.costPerLead != null ? money(r.costPerLead) : '—'}</td><td className="px-3 py-2">{r.returnPerDollar != null ? money(r.returnPerDollar) : '—'}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {map && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" aria-label="Where the money came from">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">Where it came from</h2>
              <p className="text-xs text-gray-600 dark:text-slate-300">The period&rsquo;s customers by ZIP: the bigger and deeper the circle, the more they {map.money ? 'paid' : 'booked'}.</p>
            </div>
            <label className="text-sm text-gray-700 dark:text-slate-300">Customers from{' '}
              <select className={input} value={mapSource} onChange={(e) => setMapSource(e.target.value)}>
                <option value="">Every source</option>
                {(data?.rows || []).map((r) => <option key={r.source} value={r.source}>{r.label}</option>)}
              </select>
            </label>
          </div>
          <PinMap api={api} pins={pins} tiles="roadmap" zoom={10} className="h-[26rem] rounded-xl border border-gray-200 dark:border-slate-700" />
          <p className="text-sm text-gray-600 dark:text-slate-300">
            {map.zips.length === 0 ? 'No customers in this period.' : `${pins.length} ZIP${pins.length === 1 ? '' : 's'} on the map${map.unplaced ? `; ${map.unplaced} not on it (no address placed on the map yet)` : ''}.`}
          </p>
          {map.zips.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="text-gray-600 dark:text-slate-300"><th className="px-2 py-1 font-medium">ZIP</th><th className="px-2 py-1 font-medium">Customers</th><th className="px-2 py-1 font-medium">Jobs</th>{map.money && <th className="px-2 py-1 font-medium">Paid</th>}</tr></thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {map.zips.map((z) => <tr key={z.zip} className="text-gray-900 dark:text-slate-100"><td className="px-2 py-1">{z.zip}</td><td className="px-2 py-1">{z.customers}</td><td className="px-2 py-1">{z.jobs}</td>{map.money && <td className="px-2 py-1">{money(z.revenue ?? 0)}</td>}</tr>)}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {data?.money && maySpend && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" aria-label="Enter spend">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">What you spent</h2>
          <p className="text-xs text-gray-600 dark:text-slate-300">Per source per month. Entering it again changes it; 0 takes it away.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input aria-label="Lead source" list="roi-sources" className={input} placeholder="Lead source" value={entry.source} onChange={(e) => setEntry({ ...entry, source: e.target.value })} />
            <datalist id="roi-sources">{(data.rows || []).map((r) => <option key={r.source} value={r.source}>{r.label}</option>)}</datalist>
            <input aria-label="Month" type="month" className={input} value={entry.month} onChange={(e) => setEntry({ ...entry, month: e.target.value })} />
            <input aria-label="Amount" inputMode="decimal" className={`${input} w-28`} placeholder="Amount" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} />
            <button type="button" disabled={saving || !entry.source.trim() || entry.amount === ''} onClick={saveSpend} className="rounded-lg bg-orange-700 px-3 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600">Save</button>
          </div>
        </section>
      )}
    </div>
  )
}
