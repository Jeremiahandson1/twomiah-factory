// Team Revenue (server crm/field/teamReportRoutes.ts, /api/team-revenue): what each person's jobs brought in — a job with several
// people on it is shared between them — with billable hours and revenue per hour; and how many of each salesperson's, writer's
// or tech's quotes turned into work, counted on the date you choose (drafted, sent, approved, converted, job completed).
// Custom range, filter by customer or person, choose the columns, download CSV, open the invoices, jobs and quotes behind a
// number, and save a view to be emailed on a schedule. (The table, column chooser, CSV and saved reports are reportKit.tsx's.)
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { RangePicker, rangeParams, Problem, type RangeValue } from './reportBits'
import { ColumnChooser, ColumnsButton, DownloadButton, SavedReports, TableView, queryOf, sel, type Table } from './reportKit'

const TABS: Array<[string, string]> = [['revenue', 'Revenue per person'], ['invoices', 'Invoices'], ['jobs', 'Jobs'], ['quotes', 'Quote conversion'], ['quote_list', 'Quotes']]
const BASES: Array<[string, string]> = [['drafted', 'Drafted'], ['sent', 'Sent'], ['approved', 'Approved'], ['converted', 'Converted to a job'], ['completed', 'Job completed']]
const GROUPS: Array<[string, string]> = [['salesperson', 'Salesperson'], ['writer', 'Who wrote the quote'], ['tech', 'Tech on the job']]
const STATUSES: Array<[string, string]> = [['approved', 'Approved'], ['declined', 'Turned down or expired'], ['open', 'Waiting']]
const QUOTE_TABS = ['quotes', 'quote_list']

interface Filters { people: Array<{ key: string; name: string }>; customers: Array<{ id: string; name: string }> }
interface View { tab: string; range: RangeValue; contactId: string; person: string; by: string; basis: string; status: string; columns: string[] }
const START: View = { tab: 'revenue', range: { period: 'month', startDate: '', endDate: '' }, contactId: '', person: '', by: 'salesperson', basis: 'drafted', status: '', columns: [] }

function paramsOf(v: View): Record<string, any> {
  const p: Record<string, any> = { tab: v.tab, ...rangeParams(v.range) }
  if (v.contactId) p.contactId = v.contactId
  if (v.person) p.person = v.person
  if (QUOTE_TABS.includes(v.tab)) { p.by = v.by; p.basis = v.basis }
  if (v.tab === 'quote_list' && v.status) p.status = v.status
  if (v.columns.length) p.columns = v.columns
  return p
}
function viewOf(p: Record<string, any>): View {
  return {
    ...START, tab: p.tab || 'revenue',
    range: p.period ? { period: p.period, startDate: '', endDate: '' } : (p.startDate || p.endDate) ? { period: 'custom', startDate: p.startDate || '', endDate: p.endDate || '' } : START.range,
    contactId: p.contactId || '', person: p.person || '', by: p.by || 'salesperson', basis: p.basis || 'drafted', status: p.status || '', columns: Array.isArray(p.columns) ? p.columns : [],
  }
}

export default function TeamRevenuePage() {
  const [view, setView] = useState<View>(START)
  const [table, setTable] = useState<Table | null>(null)
  const [filters, setFilters] = useState<Filters>({ people: [], customers: [] })
  const [error, setError] = useState('')
  const [pickColumns, setPickColumns] = useState(false)

  const params = useMemo(() => paramsOf(view), [view])
  const query = queryOf(params)
  const change = (patch: Partial<View>) => setView((v) => ({ ...v, ...patch }))
  const quotes = QUOTE_TABS.includes(view.tab)
  const customIncomplete = view.range.period === 'custom' && (!view.range.startDate || !view.range.endDate)

  useEffect(() => { api.get('/api/team-revenue/filters').then((r: any) => setFilters((r?.data ?? r) as Filters)).catch(() => undefined) }, [])
  useEffect(() => {
    if (customIncomplete) return
    let live = true
    setTable(null); setError('')
    api.get(`/api/team-revenue/table?${query}`)
      .then((r: any) => { if (live) setTable((r?.data ?? r) as Table) })
      .catch((e: Error) => { if (live) setError(e.message || 'The report could not be loaded.') })
    return () => { live = false }
  }, [query, customIncomplete])

  /** A number with records behind it: the same period and filters, the tab and person it carries. */
  const drill = (to: Record<string, string>) => setView((v) => ({ ...v, columns: [], status: '', ...to }))
  const buckets: Array<[string, string]> = quotes ? [['none', view.by === 'writer' ? 'Written before we kept track' : view.by === 'salesperson' ? 'No salesperson' : 'No one on the job']] : [['unassigned', 'No one on the job'], ['no_job', 'Not on a job (office sales)']]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Team Revenue</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">What each person’s jobs brought in, shared between the people on a job, with billable hours and revenue per hour — and how many quotes each person turns into work.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ColumnsButton open={pickColumns} onClick={() => setPickColumns((o) => !o)} />
          <DownloadButton url={`/api/team-revenue/table?${query}&format=csv`} filename={`team-revenue-${view.tab}.csv`} disabled={customIncomplete} onError={setError} />
        </div>
      </div>

      <div role="tablist" aria-label="Team revenue" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={view.tab === id} onClick={() => setView((v) => ({ ...v, tab: id, columns: [], status: '' }))}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${view.tab === id ? 'border-blue-700 text-blue-800 dark:border-blue-400 dark:text-blue-300' : 'border-transparent text-gray-700 dark:text-slate-300'}`}>{label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <RangePicker value={view.range} onChange={(range) => change({ range })} />
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Customer
          <select className={sel} value={view.contactId} onChange={(e) => change({ contactId: e.target.value })}><option value="">All customers</option>{filters.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Person
          <select className={sel} value={view.person} onChange={(e) => change({ person: e.target.value })}>
            <option value="">Everyone</option>
            {filters.people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            {buckets.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select></label>
        {quotes && (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Group by
              <select className={sel} value={view.by} onChange={(e) => change({ by: e.target.value, person: '' })}>{GROUPS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Count quotes by the date they were
              <select className={sel} value={view.basis} onChange={(e) => change({ basis: e.target.value })}>{BASES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
          </>
        )}
        {view.tab === 'quote_list' && (
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Result
            <select className={sel} value={view.status} onChange={(e) => change({ status: e.target.value })}><option value="">Any</option>{STATUSES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        )}
      </div>

      {pickColumns && table && <ColumnChooser table={table} chosen={view.columns} onChange={(columns) => change({ columns })} />}
      {error && <Problem text={error} />}
      <TableView table={table} error={error} waiting={customIncomplete ? 'Choose a first and last day.' : undefined} onDrill={drill} />
      <SavedReports base="/api/team-revenue/saved" params={params} disabled={customIncomplete} onError={setError} onOpen={(p) => setView(viewOf(p))}
        describe={(p) => `${TABS.find(([id]) => id === p.tab)?.[1] ?? 'Report'}${QUOTE_TABS.includes(p.tab) ? ` · by ${GROUPS.find(([id]) => id === (p.by ?? 'salesperson'))?.[1]?.toLowerCase()} · ${BASES.find(([id]) => id === (p.basis ?? 'drafted'))?.[1]?.toLowerCase()}` : ''}`} />
      <p className="text-xs text-gray-600 dark:text-slate-300">Underlined numbers and names open the invoices, jobs, quotes or customers behind them. Share a job between several people from the job itself.</p>
    </div>
  )
}
