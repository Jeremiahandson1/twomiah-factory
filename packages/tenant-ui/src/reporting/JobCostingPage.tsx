// Job Costing — estimate vs ACTUAL cost, for every CRM that sells the feature.
//
// The backend (services/jobCosting.ts, exposed at /api/job-costing) has computed this for a long time
// and had no screen, so the feature shipped in the business tier with no way to open it. This is that
// screen: a roll-up of every job's margin, a month-by-month trend, and the full cost breakdown for one
// job when you pick it.
//
// The noun is the VERTICAL'S, never "Job" hardcoded — a field-service tenant runs Service Calls. The
// page title is an explicit `costingLabel` rather than `${jobsLabel} Costing`, because jobsLabel is
// plural and that construction produces "Service Calls Costing".
import React, { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { StatusBadge, inputCls, money, selectCls } from '../invoicing/ui'
import type { JobCostingPageProps } from './types'
import { resolveJobCostingConfig } from './types'

interface JobRow {
  id: string; number: string; title: string; status: string; contact?: string | null
  estimatedRevenue: number; invoicedRevenue: number; totalCost: number
  profit: number; margin: number; laborHours: number; isProfitable: boolean; variance: number
}
interface Totals {
  estimatedRevenue: number; invoicedRevenue: number; totalCost: number; profit: number
  laborHours: number; profitableCount: number; margin: number; profitablePercent: number
}
interface CategoryRow { key: string; jobCount: number; revenue: number; cost: number; profit: number; margin: number; avgJobRevenue: number }
interface CostSide { revenue: number; laborCost: number; materialCost: number; totalCost: number; profit: number; margin: number; laborHours: number; collected?: number; expenseCost?: number; subcontractorCost?: number }
interface Detail {
  job: { id: string; number: string; title: string; status: string; contact?: { name?: string } | null; project?: { name?: string } | null }
  estimated: CostSide
  actual: CostSide
  variance: { cost: number; labor: number; material: number; hours: number; costPercent: number }
  laborDetail?: Array<{ userName?: string; hours?: number; cost?: number; date?: string }>
  materialDetail?: Array<{ name?: string; quantity?: number; cost?: number }>
  expenseDetail?: Array<{ description?: string; category?: string; amount?: number }>
}

const card = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6'
const h3 = 'font-semibold text-gray-900 dark:text-slate-100 mb-4'
const muted = 'text-gray-500 dark:text-slate-400'
const STATUSES: Array<[string, string]> = [['', 'All statuses'], ['completed', 'Completed'], ['in_progress', 'In progress'], ['scheduled', 'Scheduled']]

/** Margin is the number people scan for, so it carries the colour — green above zero, red below. */
const marginTone = (m: number) => (m > 0 ? 'text-emerald-700 dark:text-emerald-400' : m < 0 ? 'text-red-700 dark:text-red-400' : muted)
const pct = (n: number) => `${n > 0 ? '' : ''}${n.toFixed(1)}%`

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className={`text-xs uppercase tracking-wide ${muted}`}>{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone || 'text-gray-900 dark:text-slate-100'}`}>{value}</p>
    </div>
  )
}

export function JobCostingPage({ api, config }: JobCostingPageProps) {
  const cfg = resolveJobCostingConfig(config)
  const noun = cfg.jobsLabel
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<JobRow[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [count, setCount] = useState(0)
  const [trend, setTrend] = useState<CategoryRow[]>([])
  const [status, setStatus] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    const q: Record<string, any> = { limit: 100 }
    if (status) q.status = status
    if (startDate) q.startDate = startDate
    if (endDate) q.endDate = endDate
    Promise.all([
      api.get('/api/job-costing/summary', q),
      api.get('/api/job-costing/by-category', { groupBy: 'month', ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }).catch(() => []),
    ])
      .then(([s, t]: any[]) => {
        if (cancelled) return
        setRows(s?.jobs || [])
        setTotals(s?.totals || null)
        setCount(typeof s?.count === "number" ? s.count : (s?.jobs || []).length)
        setTrend(Array.isArray(t) ? t : [])
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Could not load costing') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, status, startDate, endDate])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true)
    api.get(`/api/job-costing/job/${selected}`)
      .then((d: any) => { if (!cancelled) setDetail(d) })
      .catch(() => { if (!cancelled) setDetail(null) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [api, selected])

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  }

  // ── one job: estimate against actual, and what made up the actual ──────────────────────────────
  if (selected) {
    return (
      <div className="space-y-6">
        <button onClick={() => setSelected(null)} className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100">
          <ArrowLeft className="w-4 h-4" /> Back to all {noun.toLowerCase()}
        </button>
        {detailLoading && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}
        {!detailLoading && !detail && <div className={card}><p className={muted}>That {noun.toLowerCase()} could not be loaded.</p></div>}
        {!detailLoading && detail && (
          <>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{detail.job.number} — {detail.job.title}</h2>
              <p className={`text-sm ${muted}`}>
                {detail.job.contact?.name || 'No client'}{detail.job.project?.name ? ` · ${detail.job.project.name}` : ''}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([['Estimated', detail.estimated], ['Actual', detail.actual]] as Array<[string, CostSide]>).map(([label, side]) => (
                <div key={label} className={card}>
                  <h3 className={h3}>{label}</h3>
                  <dl className="space-y-2 text-sm">
                    {([
                      ['Revenue', side.revenue],
                      ['Labour', side.laborCost],
                      ['Materials', side.materialCost],
                      ...(side.expenseCost != null ? [['Expenses', side.expenseCost]] as Array<[string, number]> : []),
                      ...(side.subcontractorCost != null ? [['Subcontractors', side.subcontractorCost]] as Array<[string, number]> : []),
                      ['Total cost', side.totalCost],
                    ] as Array<[string, number]>).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <dt className={muted}>{k}</dt><dd className="tabular-nums text-gray-900 dark:text-slate-100">{money(v)}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-gray-200 dark:border-slate-800 pt-2">
                      <dt className="font-medium text-gray-900 dark:text-slate-100">Profit</dt>
                      <dd className={`tabular-nums font-semibold ${marginTone(side.profit)}`}>{money(side.profit)} <span className="font-normal">({pct(side.margin)})</span></dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className={muted}>Labour hours</dt><dd className="tabular-nums text-gray-900 dark:text-slate-100">{side.laborHours}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>

            <div className={card}>
              <h3 className={h3}>Variance</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="Cost" value={money(detail.variance.cost)} tone={marginTone(-detail.variance.cost)} />
                <Stat label="Labour" value={money(detail.variance.labor)} tone={marginTone(-detail.variance.labor)} />
                <Stat label="Materials" value={money(detail.variance.material)} tone={marginTone(-detail.variance.material)} />
                <Stat label="Hours" value={String(detail.variance.hours)} />
              </div>
              <p className={`text-xs mt-3 ${muted}`}>
                Positive cost variance means the {noun.toLowerCase().replace(/s$/, '')} ran over its estimate.
              </p>
            </div>

            {([['Labour', detail.laborDetail, (r: any) => [r.userName || 'Unassigned', `${r.hours ?? 0} h`, money(r.cost ?? 0)]],
               ['Materials', detail.materialDetail, (r: any) => [r.name || 'Item', String(r.quantity ?? ''), money(r.cost ?? 0)]],
               ['Expenses', detail.expenseDetail, (r: any) => [r.description || 'Expense', r.category || '', money(r.amount ?? 0)]]] as Array<[string, any[] | undefined, (r: any) => string[]]>)
              .filter(([, list]) => list && list.length)
              .map(([label, list, cols]) => (
                <div key={label} className={card}>
                  <h3 className={h3}>{label}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {list!.map((r, i) => {
                          const c = cols(r)
                          return (
                            <tr key={i} className="border-b border-gray-100 dark:border-slate-800 last:border-0">
                              <td className="py-2 text-gray-900 dark:text-slate-100">{c[0]}</td>
                              <td className={`py-2 ${muted}`}>{c[1]}</td>
                              <td className="py-2 text-right tabular-nums text-gray-900 dark:text-slate-100">{c[2]}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
          </>
        )}
      </div>
    )
  }

  // ── the roll-up ────────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">{cfg.costingLabel}</h1>
        <p className={`text-sm ${muted}`}>What each {noun.toLowerCase().replace(/s$/, '')} was estimated to cost, against what it actually cost.</p>
      </div>

      {/* The shared inputCls is w-full, so each date needs its own width or the three controls stretch,
          wrap onto separate rows and push the heading down the page. */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="w-40"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} aria-label="From date" /></div>
        <div className="w-40"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} aria-label="To date" /></div>
        {(status || startDate || endDate) && (
          <button onClick={() => { setStatus(''); setStartDate(''); setEndDate('') }} className={`text-sm underline ${muted} hover:text-gray-700 dark:hover:text-slate-200`}>
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {totals && (
        <div className={card}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="Invoiced" value={money(totals.invoicedRevenue)} />
            <Stat label="Cost" value={money(totals.totalCost)} />
            <Stat label="Profit" value={money(totals.profit)} tone={marginTone(totals.profit)} />
            <Stat label="Margin" value={pct(totals.margin)} tone={marginTone(totals.margin)} />
            <Stat label="Profitable" value={`${totals.profitableCount} of ${count}`} />
          </div>
        </div>
      )}

      {trend.length > 0 && (
        <div className={card}>
          <h3 className={h3}>By month</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left text-xs uppercase tracking-wide ${muted}`}>
                  <th className="pb-2 pr-4 font-medium">Month</th>
                  <th className="pb-2 pr-4 font-medium">{noun}</th>
                  <th className="pb-2 pr-4 font-medium text-right">Revenue</th>
                  <th className="pb-2 pr-4 font-medium text-right">Cost</th>
                  <th className="pb-2 pr-4 font-medium text-right">Profit</th>
                  <th className="pb-2 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((t) => (
                  <tr key={t.key} className="border-t border-gray-100 dark:border-slate-800">
                    <td className="py-2 pr-4 text-gray-900 dark:text-slate-100">{t.key}</td>
                    <td className={`py-2 pr-4 ${muted}`}>{t.jobCount}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-slate-100">{money(t.revenue)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-slate-100">{money(t.cost)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${marginTone(t.profit)}`}>{money(t.profit)}</td>
                    <td className={`py-2 text-right tabular-nums ${marginTone(t.margin)}`}>{pct(t.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={card}>
        <h3 className={h3}>{noun}</h3>
        {rows.length === 0 && <p className={muted}>No {noun.toLowerCase()} in this period.</p>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left text-xs uppercase tracking-wide ${muted}`}>
                  <th className="pb-2 pr-4 font-medium">Number</th>
                  <th className="pb-2 pr-4 font-medium">Title</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium text-right">Invoiced</th>
                  <th className="pb-2 pr-4 font-medium text-right">Cost</th>
                  <th className="pb-2 pr-4 font-medium text-right">Profit</th>
                  <th className="pb-2 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className="border-t border-gray-100 dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/60"
                  >
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-slate-100">{r.number}</td>
                    <td className="py-2 pr-4 text-gray-900 dark:text-slate-100">{r.title}</td>
                    <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-slate-100">{money(r.invoicedRevenue)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-900 dark:text-slate-100">{money(r.totalCost)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${marginTone(r.profit)}`}>{money(r.profit)}</td>
                    <td className={`py-2 text-right tabular-nums ${marginTone(r.margin)}`}>
                      <span className="inline-flex items-center gap-1">
                        {r.margin > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : r.margin < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : null}
                        {pct(r.margin)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default JobCostingPage
