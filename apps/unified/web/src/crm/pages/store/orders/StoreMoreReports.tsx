// More reports, on Store › Sales (parity tier 3, store — Shopify's report library; server crm/store/orders/reports.ts /table and
// /export, the tables built by savedSalesReports.ts storeTableFor; behind store_report_schedules, not ready): sales by customer, by
// channel, by place, taxes by month, refunds given, inventory value, and Shopify's inventory reports (sell-through rate, days of
// inventory left, ABC analysis, every stock change — the stock history), for the same days as the rest of the page, each as a
// table and a spreadsheet. A seat that does not see costs (margin:read) gets no cost columns.
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../../../api'
import { errorText } from '../../../../shared'
import { TableView, type Table } from '../../reportKit'

export const MORE_REPORTS: Array<{ id: string; label: string }> = [
  { id: 'customers', label: 'Sales by customer' }, { id: 'channels', label: 'Sales by channel' }, { id: 'places', label: 'Sales by place' },
  { id: 'taxes', label: 'Taxes' }, { id: 'refunds', label: 'Refunds given' }, { id: 'inventory', label: 'Inventory value' },
  // Shopify's inventory reports, on the stock history (server/data/storeStockMoves.ts).
  { id: 'sell_through', label: 'Sell-through rate' }, { id: 'days_left', label: 'Days of inventory left' }, { id: 'abc', label: 'ABC analysis' }, { id: 'stock_moves', label: 'Stock changes' },
  { id: 'staff', label: 'Sales by staff' },
]

export function StoreMoreReports({ from, to }: { from: string; to: string }) {
  const [tab, setTab] = useState('customers')
  const [table, setTable] = useState<Table | null>(null)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let live = true
    setTable(null); setError('')
    api.get('/api/admin/sales-reports/table', { tab, from, to })
      .then((r: any) => { if (live) setTable({ ...r, shown: (r.columns || []).filter((c: any) => c.default !== false).map((c: any) => c.key) }) })
      .catch((e: unknown) => { if (live) setError(errorText(e, "Couldn't load that report")) })
    return () => { live = false }
  }, [tab, from, to])

  const toCsv = async () => {
    setExporting(true)
    try {
      const res = await api.raw(`/api/admin/sales-reports/export?report=${tab}&from=${from}&to=${to}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url; a.download = `${tab}-${from}-to-${to}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) { setError(errorText(e, "Couldn't make the spreadsheet")) } finally { setExporting(false) }
  }

  return (
    <section className="card p-5 space-y-3" aria-label="More reports">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">More reports</h2>
          <p className="text-sm text-gray-600 dark:text-slate-400">For the same days as above{tab === 'inventory' ? ' — except inventory value, which is your stock right now' : ''}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-700 dark:text-slate-300">Report
            <select className="input ml-1 w-auto" value={tab} onChange={(e) => setTab(e.target.value)}>{MORE_REPORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          </label>
          <button type="button" className="btn-secondary inline-flex items-center gap-1" disabled={exporting || !table} onClick={toCsv}><Download className="h-4 w-4" aria-hidden="true" />{exporting ? 'Making…' : 'Spreadsheet'}</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <TableView table={table} error={error} onDrill={() => { /* these tables have no drill-down */ }} emptyText="Nothing in these days." />
    </section>
  )
}
