// The store's sales reports at /crm/sales (gap 1 against Shopify's Analytics, 2026-10-30): sales over time, the products
// that sold most, who came back and the average order, for a stretch of days the owner picks.
//
// GET /api/admin/sales-reports (server/crm/store/orders/reports.ts) — behind the store_sales_reports feature and
// revenue:read, as this page's menu row is. The days are the shop's own (its time zone, Settings › Company), and every
// figure counts the orders the Dashboard counts, less what went back.
//   · a failed read says so (PageError), never a report of zeros;
//   · the bars are drawn by the page, no charting library; the table beside them carries the same numbers, so nothing
//     rests on colour or on seeing the bar;
//   · ink pairs: brand text is text-orange-900 dark:text-orange-200 (scripts/check-contrast-measured.ts).
import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText } from '../../../../shared'
import { cents } from './lib'

interface Point { period: string; orders: number; grossCents: number; refundedCents: number; netCents: number }
interface Report {
  from: string; to: string; timeZone: string; bucket: 'day' | 'week' | 'month'
  totals: { orders: number; customers: number; grossCents: number; refundedCents: number; netCents: number; averageOrderCents: number }
  series: Point[]
  topProducts: { productId: string | null; name: string; units: number; salesCents: number }[]
  repeat: { customers: number; repeat: number; firstTime: number; repeatNetCents: number; repeatRate: number; top: { customerId: string; name: string | null; email: string; orders: number; netCents: number }[] }
}

const DAY = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** "Last N days" ending on `to` (the report's own last day, so the shop's clock decides what today is). */
const lastDays = (to: string, n: number) => iso(new Date(Date.parse(`${to}T00:00:00Z`) - (n - 1) * DAY))
const PRESETS = [{ label: 'Last 7 days', days: 7 }, { label: 'Last 30 days', days: 30 }, { label: 'Last 90 days', days: 90 }, { label: 'Last 12 months', days: 365 }]
const BUCKET_WORD = { day: 'Day', week: 'Week of', month: 'Month of' } as const

/** "2026-10-03" → "Oct 3" (a month: "Oct 2026"), written from the text so no clock or zone can move the day. */
function dayLabel(period: string, bucket: Report['bucket']): string {
  const [y, m, d] = period.split('-').map(Number)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return bucket === 'month' ? `${month} ${y}` : `${month} ${d}`
}
const percent = (n: number) => `${Math.round(n * 100)}%`

export default function SalesPage() {
  const [range, setRange] = useState<{ from?: string; to?: string }>({})
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api.get('/api/admin/sales-reports', { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) })
      .then((r) => { if (live) setReport(r as Report) })
      .catch((e) => { if (live) setError(errorText(e, "Couldn't load the sales report")) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [range])

  const tallest = Math.max(1, ...(report?.series ?? []).map((p) => p.grossCents))

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Sales</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Orders that were paid, by your shop's own days{report ? ` (${report.timeZone.replace(/_/g, ' ')})` : ''}. Money sent back is taken off.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-gray-700 dark:text-slate-300">From
            <input type="date" className="input ml-1" value={report?.from ?? ''} max={report?.to}
              onChange={(e) => e.target.value && setRange({ from: e.target.value, to: report?.to })} />
          </label>
          <label className="text-sm text-gray-700 dark:text-slate-300">To
            <input type="date" className="input ml-1" value={report?.to ?? ''} min={report?.from}
              onChange={(e) => e.target.value && setRange({ from: report?.from, to: e.target.value })} />
          </label>
        </div>
      </div>

      {report && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick ranges">
          {PRESETS.map((p) => (
            <button key={p.days} type="button" className="btn-secondary text-sm" onClick={() => setRange({ from: lastDays(report.to, p.days), to: report.to })}>{p.label}</button>
          ))}
        </div>
      )}

      {loading && !report ? <p className="text-gray-500 dark:text-slate-400">Loading…</p> : error ? (
        <PageError message={`${error} — refresh to try again.`} />
      ) : report && (
        <div className={loading ? 'opacity-60 space-y-6' : 'space-y-6'} aria-busy={loading}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile label="Net sales" value={cents(report.totals.netCents)} note={`${cents(report.totals.grossCents)} paid, ${cents(report.totals.refundedCents)} sent back`} strong />
            <Tile label="Orders" value={String(report.totals.orders)} note={`${report.totals.customers} ${report.totals.customers === 1 ? 'customer' : 'customers'}`} />
            <Tile label="Average order" value={cents(report.totals.averageOrderCents)} note="Paid per order, before refunds" />
            <Tile label="Came back" value={report.repeat.customers ? percent(report.repeat.repeatRate) : '—'} note={`${report.repeat.repeat} of ${report.repeat.customers} ${report.repeat.customers === 1 ? 'customer' : 'customers'} had ordered before`} />
          </div>

          <section className="card p-4 sm:p-6" aria-labelledby="sales-over-time">
            <h2 id="sales-over-time" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Sales over time</h2>
            {report.series.length === 0 ? (
              <div className="py-8 text-center">
                <BarChart3 className="h-10 w-10 mx-auto text-gray-400 dark:text-slate-400" aria-hidden="true" />
                <p className="mt-3 text-gray-500 dark:text-slate-400">No paid orders in these days.</p>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">{BUCKET_WORD[report.bucket]}</th>
                      <th className="py-2 pr-3 font-medium text-right">Orders</th>
                      <th className="py-2 pr-3 font-medium text-right">Paid</th>
                      <th className="py-2 pr-3 font-medium text-right">Sent back</th>
                      <th className="py-2 pr-3 font-medium text-right">Net</th>
                      <th className="py-2 font-medium w-1/3"><span className="sr-only">Bar</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.series.map((p) => (
                      <tr key={p.period} className="border-t border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                        <td className="py-2 pr-3 whitespace-nowrap">{dayLabel(p.period, report.bucket)}</td>
                        <td className="py-2 pr-3 text-right">{p.orders}</td>
                        <td className="py-2 pr-3 text-right">{cents(p.grossCents)}</td>
                        <td className="py-2 pr-3 text-right">{p.refundedCents ? cents(p.refundedCents) : '—'}</td>
                        <td className="py-2 pr-3 text-right font-medium">{cents(p.netCents)}</td>
                        <td className="py-2" aria-hidden="true">
                          <div className="h-3 rounded bg-gray-100 dark:bg-slate-700">
                            <div className="h-3 rounded bg-orange-700 dark:bg-orange-300" style={{ width: `${Math.max(2, Math.round((p.grossCents / tallest) * 100))}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid lg:grid-cols-2 gap-6">
            <section className="card p-4 sm:p-6" aria-labelledby="top-products">
              <h2 id="top-products" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Top products</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">What each brought in, before shipping, tax and discount codes. Returned items are taken off.</p>
              {report.topProducts.length === 0 ? <p className="mt-3 text-gray-500 dark:text-slate-400">Nothing sold in these days.</p> : (
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-2 font-medium">Product</th><th className="py-2 font-medium text-right">Sold</th><th className="py-2 font-medium text-right">Brought in</th></tr></thead>
                  <tbody>
                    {report.topProducts.map((p) => (
                      <tr key={p.productId ?? p.name} className="border-t border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                        <td className="py-2 pr-3">{p.name}</td>
                        <td className="py-2 text-right">{p.units}</td>
                        <td className="py-2 text-right font-medium">{cents(p.salesCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card p-4 sm:p-6" aria-labelledby="repeat-customers">
              <h2 id="repeat-customers" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Customers who came back</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">Ordered before these days, or more than once in them.</p>
              {report.repeat.customers === 0 ? <p className="mt-3 text-gray-500 dark:text-slate-400">No customers ordered in these days.</p> : (
                <>
                  <p className="mt-3 text-sm text-gray-900 dark:text-slate-100">
                    {report.repeat.repeat} came back, {report.repeat.firstTime} ordered for the first time. Those who came back paid {cents(report.repeat.repeatNetCents)}.
                  </p>
                  {report.repeat.top.length > 0 && (
                    <table className="mt-3 w-full text-sm">
                      <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-2 font-medium">Customer</th><th className="py-2 font-medium text-right">Orders</th><th className="py-2 font-medium text-right">Spent</th></tr></thead>
                      <tbody>
                        {report.repeat.top.map((r) => (
                          <tr key={r.customerId} className="border-t border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                            <td className="py-2 pr-3">{r.name || r.email}</td>
                            <td className="py-2 text-right">{r.orders}</td>
                            <td className="py-2 text-right font-medium">{cents(r.netCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, note, strong }: { label: string; value: string; note: string; strong?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${strong ? 'text-orange-900 dark:text-orange-200' : 'text-gray-900 dark:text-slate-100'}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{note}</p>
    </div>
  )
}
