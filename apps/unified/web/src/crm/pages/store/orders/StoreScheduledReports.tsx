// Saved and emailed sales reports, on Store › Sales (parity tier 3, store; server crm/store/orders/savedSalesReports.ts,
// /api/admin/sales-reports/saved; feature store_report_schedules, not ready). Choose a table and a period by its name ("last
// month"), save it, and have it emailed as a spreadsheet every week or month — through the shared saved-reports panel the field
// trades' reports use (../../reportKit.tsx SavedReports).
import { useState } from 'react'
import { SavedReports } from '../../reportKit'

const TABS: Array<{ id: string; label: string }> = [
  { id: 'over_time', label: 'Sales over time' }, { id: 'products', label: 'By product' }, { id: 'variants', label: 'By option' }, { id: 'discounts', label: 'Discount codes' },
]
const PERIODS: Array<{ id: string; label: string }> = [
  { id: 'month', label: 'This month' }, { id: 'last_month', label: 'Last month' }, { id: '30', label: 'Last 30 days' }, { id: 'quarter', label: 'This quarter' }, { id: 'year', label: 'This year' }, { id: 'all', label: 'All time' },
]
const labelOf = (list: Array<{ id: string; label: string }>, id: string) => list.find((x) => x.id === id)?.label ?? id

export function StoreScheduledReports() {
  const [tab, setTab] = useState('over_time')
  const [period, setPeriod] = useState('last_month')
  const [error, setError] = useState('')
  return (
    <section className="card p-5 space-y-3" aria-label="Saved and emailed reports">
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Saved and emailed reports</h2>
        <p className="text-sm text-gray-600 dark:text-slate-400">Save a report and have it emailed as a spreadsheet every week or month. A period is kept by its name, so &ldquo;Last month&rdquo; is always the month just gone.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-gray-700 dark:text-slate-300">Report
          <select className="input ml-1 w-auto" value={tab} onChange={(e) => setTab(e.target.value)}>{TABS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        </label>
        <label className="text-sm text-gray-700 dark:text-slate-300">Period
          <select className="input ml-1 w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <SavedReports base="/api/admin/sales-reports/saved" params={{ tab, period }} onError={setError}
        describe={(p) => `${labelOf(TABS, String(p.tab))} · ${labelOf(PERIODS, String(p.period))}`}
        onOpen={(p) => { if (p.tab) setTab(String(p.tab)); if (p.period) setPeriod(String(p.period)) }} />
    </section>
  )
}
