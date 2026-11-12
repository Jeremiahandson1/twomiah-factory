// An option's STOCK HISTORY on the product page (Shopify's inventory adjustment history): every change to its count, newest first —
// what happened (sold, back on the shelf, received, a count typed…), by how much, the count after, who, and the order behind it.
// Over GET /api/admin/products/variants/:id/stock-history (server/crm/store/catalog/products.ts), 50 at a time.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../../../api'
import { errorText } from '../../../../shared'
import { stamp } from '../../reportKit'

interface Move {
  id: string; at: string; what: string; change: number; after: number | null
  by: string | null; note: string | null; orderId: string | null; orderNumber: string | null
}

export function StockHistory({ variantId, sku }: { variantId: string; sku: string }) {
  const [rows, setRows] = useState<Move[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async (before?: string) => {
    setLoading(true); setError('')
    try {
      const r: any = await api.get(`/api/admin/products/variants/${variantId}/stock-history`, before ? { before } : undefined)
      setRows((prev) => [...(before ? prev ?? [] : []), ...(r.data || [])])
      setMore(!!r.more)
    } catch (e) {
      setError(errorText(e, "Couldn't load the stock history"))
    } finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [variantId])

  if (error) return <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>
  if (!rows) return <p className="text-xs text-gray-600 dark:text-slate-400">Loading the stock history…</p>
  if (!rows.length) return <p className="text-xs text-gray-600 dark:text-slate-400">No stock changes kept for {sku} yet. Each sale, refund, delivery and count from now on is listed here.</p>
  return (
    <div className="rounded-md border border-gray-200 dark:border-slate-700">
      <ul aria-label={`Stock history of ${sku}`} className="divide-y divide-gray-100 dark:divide-slate-800">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-xs">
            <span className="w-36 shrink-0 text-gray-600 dark:text-slate-400">{stamp(m.at)}</span>
            <span className="min-w-0 flex-1 text-gray-900 dark:text-slate-100">
              {m.what}
              {m.orderId && <> · <Link className="font-medium text-brand-700 hover:underline dark:text-brand-200" to={`/crm/orders/${m.orderId}`}>{m.orderNumber ? `Order ${m.orderNumber}` : 'the order'}</Link></>}
              {m.note && <span className="text-gray-600 dark:text-slate-400"> · {m.note}</span>}
              {m.by && <span className="text-gray-600 dark:text-slate-400"> · {m.by}</span>}
            </span>
            <span className={`w-12 text-right tabular-nums ${m.change > 0 ? 'text-green-700 dark:text-green-300' : m.change < 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-slate-400'}`}>{m.change > 0 ? `+${m.change}` : m.change}</span>
            <span className="w-20 text-right tabular-nums text-gray-700 dark:text-slate-300">{m.after == null ? 'not counted' : `${m.after} after`}</span>
          </li>
        ))}
      </ul>
      {more && (
        <button type="button" disabled={loading} onClick={() => load(rows[rows.length - 1].at)} className="w-full border-t border-gray-200 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {loading ? 'Loading…' : 'Show older changes'}
        </button>
      )}
    </div>
  )
}
