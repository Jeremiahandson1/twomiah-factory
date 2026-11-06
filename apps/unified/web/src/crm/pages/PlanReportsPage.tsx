// Plan Reports (server crm/field/planReportRoutes.ts, /api/plan-reports): one table-driven page over eight views of the
// service plans — who sold them, which were made, the summary (active at the start and end, renewed, suspended, ended),
// the history of every change, what is coming due, what ended, recurring and collected revenue by month, and the payments
// behind it. Every view takes a period (or a custom range), filters, the columns you choose, and downloads as CSV; a
// number that has records behind it opens them; any view can be saved and mailed on a schedule. (The table, column chooser,
// CSV and saved reports are reportKit.tsx's.)
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api'
import { RangePicker, rangeParams, Problem, type RangeValue } from './reportBits'
import { ColumnChooser, ColumnsButton, DownloadButton, SavedReports, TableView, btn, queryOf, sel, type Table } from './reportKit'

interface Filters { planNames: string[]; sellers: Array<{ id: string; name: string }>; customers: Array<{ id: string; name: string }> }

const TABS: Array<[string, string]> = [['sold', 'Sold by'], ['plans', 'Plans made'], ['summary', 'Summary'], ['events', 'History'], ['renewals', 'Coming due'], ['ended', 'Ended'], ['revenue', 'Revenue'], ['payments', 'Payments']]
const STATUSES: Array<[string, string]> = [['active', 'Active'], ['pending', 'Pending'], ['suspended', 'Suspended'], ['cancelled', 'Cancelled'], ['expired', 'Expired']]
const EVENT_KINDS: Array<[string, string]> = [['created', 'Made'], ['renewed', 'Renewed'], ['suspended', 'Suspended'], ['reactivated', 'Reactivated'], ['cancelled', 'Cancelled'], ['expired', 'Expired']]
const FILTER_KEYS = ['planName', 'sellerId', 'contactId', 'status'] as const

interface View {
  tab: string; range: RangeValue; planName: string; sellerId: string; contactId: string; status: string
  kind: string; measure: 'recurring' | 'collected'; month: string; days: 30 | 60; columns: string[]
}
const START: View = { tab: 'sold', range: { period: 'year', startDate: '', endDate: '' }, planName: '', sellerId: '', contactId: '', status: '', kind: '', measure: 'recurring', month: '', days: 30, columns: [] }

const monthWords = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })


/** The settings the server stores and reads: only what is set, a custom range as two days, a named period by name. */
function paramsOf(v: View): Record<string, any> {
  const p: Record<string, any> = { tab: v.tab }
  if (v.tab === 'renewals') p.days = v.days
  else Object.assign(p, rangeParams(v.range))
  for (const k of FILTER_KEYS) if (v[k]) p[k] = v[k]
  if (v.tab === 'events' && v.kind) p.kind = v.kind
  if (v.tab === 'revenue') p.measure = v.measure
  if (v.tab === 'payments' && v.month) p.month = v.month
  if (v.columns.length) p.columns = v.columns
  return p
}
function viewOf(p: Record<string, any>): View {
  const named = !!p.period
  return {
    ...START, tab: p.tab || 'sold',
    range: named ? { period: p.period, startDate: '', endDate: '' } : (p.startDate || p.endDate) ? { period: 'custom', startDate: p.startDate || '', endDate: p.endDate || '' } : START.range,
    planName: p.planName || '', sellerId: p.sellerId || '', contactId: p.contactId || '', status: p.status || '', kind: p.kind || '',
    measure: p.measure || 'recurring', month: p.month || '', days: p.days === 60 ? 60 : 30, columns: Array.isArray(p.columns) ? p.columns : [],
  }
}

export default function PlanReportsPage() {
  const [view, setView] = useState<View>(START)
  const [table, setTable] = useState<Table | null>(null)
  const [filters, setFilters] = useState<Filters>({ planNames: [], sellers: [], customers: [] })
  const [error, setError] = useState('')
  const [pickColumns, setPickColumns] = useState(false)

  const params = useMemo(() => paramsOf(view), [view])
  const query = queryOf(params)
  const change = (patch: Partial<View>) => setView((v) => ({ ...v, ...patch }))
  const customIncomplete = view.tab !== 'renewals' && view.range.period === 'custom' && (!view.range.startDate || !view.range.endDate)

  useEffect(() => { api.get('/api/plan-reports/filters').then((r: any) => setFilters((r?.data ?? r) as Filters)).catch(() => undefined) }, [])
  useEffect(() => {
    if (customIncomplete) return
    let live = true
    setTable(null); setError('')
    api.get(`/api/plan-reports/table?${query}`)
      .then((r: any) => { if (live) setTable((r?.data ?? r) as Table) })
      .catch((e: Error) => { if (live) setError(e.message || 'The report could not be loaded.') })
    return () => { live = false }
  }, [query, customIncomplete])

  /** A number with records behind it: the same range, the filters the number carries. */
  const drill = (to: Record<string, string>) => {
    const next: Partial<View> = { columns: [], kind: '', month: '' }
    for (const [k, v] of Object.entries(to)) (next as any)[k] = v
    if (!('planName' in to)) next.planName = view.planName
    setView((v) => ({ ...v, ...next }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Plan Reports</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">Who sells your service plans, how many are active, what is coming up for renewal, what ended, and what the plans bring in.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ColumnsButton open={pickColumns} onClick={() => setPickColumns((o) => !o)} />
          <DownloadButton url={`/api/plan-reports/table?${query}&format=csv`} filename={`plan-reports-${view.tab}.csv`} disabled={customIncomplete} onError={setError} />
        </div>
      </div>

      <div role="tablist" aria-label="Plan reports" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={view.tab === id} onClick={() => setView((v) => ({ ...v, tab: id, columns: [], kind: '', month: '' }))}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${view.tab === id ? 'border-blue-700 text-blue-800 dark:border-blue-400 dark:text-blue-300' : 'border-transparent text-gray-700 dark:text-slate-300'}`}>{label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {view.tab === 'renewals'
          ? <div role="group" aria-label="Look ahead" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm dark:border-slate-600">
              {([30, 60] as const).map((d) => <button key={d} type="button" aria-pressed={view.days === d} onClick={() => change({ days: d })} className={`px-3 py-1.5 ${view.days === d ? 'bg-blue-700 text-white' : 'bg-white text-gray-800 dark:bg-slate-800 dark:text-slate-200'}`}>Next {d} days</button>)}
            </div>
          : <RangePicker value={view.range} onChange={(range) => change({ range })} />}
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Plan
          <select className={sel} value={view.planName} onChange={(e) => change({ planName: e.target.value })}><option value="">All plans</option>{filters.planNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Sold by
          <select className={sel} value={view.sellerId} onChange={(e) => change({ sellerId: e.target.value })}><option value="">Anyone</option><option value="none">No one recorded</option>{filters.sellers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Customer
          <select className={sel} value={view.contactId} onChange={(e) => change({ contactId: e.target.value })}><option value="">All customers</option>{filters.customers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Status
          <select className={sel} value={view.status} onChange={(e) => change({ status: e.target.value })}><option value="">Any status</option>{STATUSES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        {view.tab === 'events' && (
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">What happened
            <select className={sel} value={view.kind} onChange={(e) => change({ kind: e.target.value })}><option value="">Everything</option>{EVENT_KINDS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        )}
        {view.tab === 'revenue' && (
          <div role="group" aria-label="Revenue measure" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm dark:border-slate-600">
            {([['recurring', 'Recurring (billed)'], ['collected', 'Collected (paid)']] as const).map(([id, l]) => <button key={id} type="button" aria-pressed={view.measure === id} onClick={() => change({ measure: id })} className={`px-3 py-1.5 ${view.measure === id ? 'bg-blue-700 text-white' : 'bg-white text-gray-800 dark:bg-slate-800 dark:text-slate-200'}`}>{l}</button>)}
          </div>
        )}
        {view.tab === 'payments' && view.month && (
          <button type="button" className={btn} onClick={() => change({ month: '' })}>{monthWords(view.month)}<X className="h-4 w-4" aria-label="Show every month" /></button>
        )}
      </div>

      {pickColumns && table && <ColumnChooser table={table} chosen={view.columns} onChange={(columns) => change({ columns })} />}
      {error && <Problem text={error} />}
      <TableView table={table} error={error} waiting={customIncomplete ? 'Choose a first and last day.' : undefined} onDrill={drill} />
      <SavedReports base="/api/plan-reports/saved" params={params} disabled={customIncomplete} onError={setError} onOpen={(p) => setView(viewOf(p))}
        describe={(p) => `${TABS.find(([id]) => id === p.tab)?.[1] ?? 'Report'}${p.sellerId && p.sellerId !== 'none' ? ` · sold by ${filters.sellers.find((s) => s.id === p.sellerId)?.name ?? ''}` : ''}`} />
      <p className="text-xs text-gray-600 dark:text-slate-300">Underlined numbers and names open the plans, invoices or customers behind them.</p>
    </div>
  )
}
