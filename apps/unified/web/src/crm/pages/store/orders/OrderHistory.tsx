// The order's HISTORY (Shopify's order timeline; server crm/store/orders/orders.ts GET /:id/history): what happened to it, newest
// first — made, paid, packed, shipped, refunded, its address changed, its label bought or voided — and who did it.
// Read again whenever the order changes (`version`: its updatedAt).
import { useEffect, useState } from 'react'
import { api } from '../../../../api'
import { errorText } from '../../../../shared'
import { stamp } from '../../reportKit'
import { listOf } from './lib'

interface Entry { id: string; at: string; what: string; who: string | null }

export function OrderHistory({ orderId, version }: { orderId: string; version?: string | null }) {
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    api.get(`/api/admin/orders/${orderId}/history`).then((r) => { if (live) setRows(listOf<Entry>(r)) }).catch((e) => { if (live) setError(errorText(e, "Couldn't load the order's history")) })
    return () => { live = false }
  }, [orderId, version])
  if (error) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>
  if (!rows || !rows.length) return null
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">History</h2>
      <ol className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="text-sm">
            <div className="text-gray-900 dark:text-slate-100">{r.what}</div>
            <div className="text-xs text-gray-600 dark:text-slate-400">{stamp(r.at)}{r.who ? ` · ${r.who}` : ''}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}
