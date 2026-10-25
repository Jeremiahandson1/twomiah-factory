// Finding one of the store's customers by name or email (GET /api/admin/orders/customers?q=, orders:read): a shop with
// thousands of customers cannot pick one from a list. Used by the new-order page and the customer groups' "Add".
import { useEffect, useState } from 'react'
import { api } from '../../../../api'
import { listOf } from './lib'

export interface PickedCustomer { id: string; name: string; email: string | null }

export function CustomerPicker({ id, label, value, onPick, exclude = [] }: {
  id: string; label: string; value: PickedCustomer | null; onPick: (c: PickedCustomer | null) => void; exclude?: string[]
}) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PickedCustomer[]>([])
  useEffect(() => {
    if (!q.trim()) { setFound([]); return }
    let live = true
    const t = setTimeout(() => {
      api.get('/api/admin/orders/customers', { q: q.trim(), limit: '20' })
        .then((r) => { if (live) setFound(listOf<PickedCustomer>(r)) })
        .catch(() => { if (live) setFound([]) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:text-slate-200">
        <span className="min-w-0 break-all">{value.name}{value.email ? ` (${value.email})` : ' (no email)'}</span>
        <button type="button" className="text-xs underline" onClick={() => { onPick(null); setQ('') }}>Change</button>
      </div>
    )
  }
  const shown = found.filter((c) => !exclude.includes(c.id))
  return (
    <div className="space-y-1">
      <input id={id} className="input" placeholder="Search by name or email" aria-label={label} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {q.trim() && (
        <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 dark:border-slate-700 dark:divide-slate-800" role="listbox" aria-label={label}>
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-gray-600 dark:text-slate-400">No customer matches.</li>}
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={false} className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 break-all dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => onPick(c)}>
                {c.name}{c.email ? ` (${c.email})` : ' (no email)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
