// Retail by brand, category, supplier, SKU and stylist, with cost, margin and margin %, and what the stock on hand is worth (salon parity row 13;
// server crm/salon/retailMargins.ts, GET /api/salon-reports/retail-products). Figures are net of the sale's discount and any refund.
import { useEffect, useState } from 'react'
import { api, money } from '../../../shared'

interface Row { key: string; name: string; units: number; grossCents: number; discountCents: number; refundedCents: number; netCents: number; costCents: number; uncostedNetCents: number; marginCents: number | null; marginPercent: number | null }
interface Result {
  total: Omit<Row, 'key' | 'name'>
  byBrand: Row[]; byCategory: Row[]; bySupplier: Row[]; bySku: Row[]; byStylist: Row[]
  stock: { costCents: number; retailCents: number; units: number; productsWithoutCost: number; products: number }
}
const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const cents = (n: number) => money(n / 100)
const VIEWS = [{ id: 'byBrand', label: 'Brand' }, { id: 'byCategory', label: 'Category' }, { id: 'bySupplier', label: 'Supplier' }, { id: 'bySku', label: 'Product (SKU)' }, { id: 'byStylist', label: 'Stylist' }] as const

export function RetailMarginsSection({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<Result | null>(null)
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('byBrand')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    api.get(`/api/salon-reports/retail-products?from=${from}&to=${to}`)
      .then((r: Result) => { if (live) setData(r) })
      .catch((e: any) => { if (live) { setData(null); setError(e?.message || 'The retail margins could not be loaded.') } })
    return () => { live = false }
  }, [from, to])

  const rows = data ? data[view] : []
  const t = data?.total
  return (
    <section className={box} aria-label="Retail margins">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Retail margins</h2>
      <p className={hint}>
        What retail really brought in: the price less the sale's discount and any refund, against what the units cost when they were sold.
        Units put back on the shelf after a refund cost nothing. Margin counts only lines with a cost entered.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {data && t && (
        <>
          <p className="mt-2 text-sm text-gray-900 dark:text-slate-100">
            <strong>{cents(t.netCents)}</strong> net from {t.units} item{t.units === 1 ? '' : 's'}
            {t.marginCents != null && <> · margin <strong>{cents(t.marginCents)}</strong>{t.marginPercent != null && <> ({t.marginPercent}%)</>}</>}
            {t.uncostedNetCents > 0 && <> · {cents(t.uncostedNetCents)} of it has no cost entered, so it is not in the margin</>}
          </p>
          <div role="tablist" aria-label="Group retail by" className="mt-3 flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${view === v.id ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-300 text-gray-800 dark:border-slate-600 dark:text-slate-200'}`}>{v.label}</button>
            ))}
          </div>
          {rows.length === 0 ? <p className={hint}>No retail sold in this period.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm text-gray-900 dark:text-slate-100">
                <thead><tr className="text-left text-gray-700 dark:text-slate-300">
                  <th scope="col" className="py-1 pr-4">{VIEWS.find((v) => v.id === view)!.label}</th>
                  <th scope="col" className="py-1 pr-4 text-right">Units</th><th scope="col" className="py-1 pr-4 text-right">Sold</th>
                  <th scope="col" className="py-1 pr-4 text-right">Discounts</th><th scope="col" className="py-1 pr-4 text-right">Refunds</th>
                  <th scope="col" className="py-1 pr-4 text-right">Net</th><th scope="col" className="py-1 pr-4 text-right">Cost</th>
                  <th scope="col" className="py-1 pr-4 text-right">Margin</th><th scope="col" className="py-1 text-right">Margin %</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 pr-4">{r.name}{r.uncostedNetCents > 0 && r.costCents === 0 && <span className="ml-2 text-xs text-gray-600 dark:text-slate-400">no cost entered</span>}</td>
                      <td className="py-1 pr-4 text-right">{r.units}</td><td className="py-1 pr-4 text-right">{cents(r.grossCents)}</td>
                      <td className="py-1 pr-4 text-right">{r.discountCents ? `−${cents(r.discountCents)}` : '—'}</td><td className="py-1 pr-4 text-right">{r.refundedCents ? `−${cents(r.refundedCents)}` : '—'}</td>
                      <td className="py-1 pr-4 text-right font-medium">{cents(r.netCents)}</td><td className="py-1 pr-4 text-right">{cents(r.costCents)}</td>
                      <td className="py-1 pr-4 text-right font-medium">{r.marginCents == null ? '—' : cents(r.marginCents)}</td>
                      <td className="py-1 text-right">{r.marginPercent == null ? '—' : `${r.marginPercent}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view === 'bySku' && rows.some((r) => r.name.endsWith('(not linked to a product)')) && (
            <p className={hint}>A retail line typed in by hand is not linked to a product, so it has revenue but no brand, supplier or cost.</p>
          )}
          <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Stock on hand now</h3>
            <p className="text-sm text-gray-900 dark:text-slate-100">
              {data.stock.units} unit{data.stock.units === 1 ? '' : 's'} · <strong>{cents(data.stock.costCents)}</strong> at cost · <strong>{cents(data.stock.retailCents)}</strong> at the shelf price
            </p>
            {data.stock.productsWithoutCost > 0 && <p className="text-xs text-gray-600 dark:text-slate-400">{data.stock.productsWithoutCost} product{data.stock.productsWithoutCost === 1 ? ' has' : 's have'} stock but no cost entered, so the cost figure is a floor.</p>}
          </div>
        </>
      )}
    </section>
  )
}
