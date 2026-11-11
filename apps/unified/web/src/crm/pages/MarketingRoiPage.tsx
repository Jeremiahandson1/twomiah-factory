// Marketing ROI (parity tier 3, field service; server crm/field/marketingRoi.ts, /api/marketing-roi; feature marketing_roi, not
// ready): per lead source, the leads, the customers and jobs they became, the money those customers paid, against the spend —
// entered here per source per month.
import { useEffect, useState } from 'react'
import { Loader2, Target } from 'lucide-react'
import { money } from '@twomiah/tenant-ui/src/money'
import { companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Row { source: string; label: string; leads: number; customers: number; jobs: number; revenue?: number; spend?: number; costPerLead?: number | null; returnPerDollar?: number | null }
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

  const load = () => api.get('/api/marketing-roi', { from, to }).then((r: any) => { setData(r); setError('') }).catch((e: Error) => setError(e.message || 'The report could not be loaded.'))
  useEffect(() => { load() }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">For each lead source: the leads that came in, the customers they became, those customers&rsquo; jobs and what they paid in the period, against what you spent on it.</p>
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
              <th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 font-medium">Leads</th><th className="px-3 py-2 font-medium">Customers</th><th className="px-3 py-2 font-medium">Jobs</th>
              {data.money && <><th className="px-3 py-2 font-medium">Paid</th><th className="px-3 py-2 font-medium">Spent</th><th className="px-3 py-2 font-medium">Cost per lead</th><th className="px-3 py-2 font-medium">Back per $1</th></>}
            </tr></thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {data.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-gray-700 dark:text-slate-300">No leads or spend in this period.</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.source} className="text-gray-900 dark:text-slate-100">
                  <td className="px-3 py-2">{r.label}</td><td className="px-3 py-2">{r.leads}</td><td className="px-3 py-2">{r.customers}</td><td className="px-3 py-2">{r.jobs}</td>
                  {data.money && <><td className="px-3 py-2">{money(r.revenue ?? 0)}</td><td className="px-3 py-2">{r.spend ? money(r.spend) : '—'}</td><td className="px-3 py-2">{r.costPerLead != null ? money(r.costPerLead) : '—'}</td><td className="px-3 py-2">{r.returnPerDollar != null ? money(r.returnPerDollar) : '—'}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
