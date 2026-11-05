// Settings › The Book › Team order (salon parity row 1; server crm/salon/bookLayout.ts /api/book-blocks/team-order; feature book_grid).
// Drag the stylists into the order the salon wants (or use the arrows), saved once for the salon. The Book's columns, the stylist pickers and
// the stylists a client may choose online all follow it. Only a manager can change it; everyone else sees the order read-only.
import { useEffect, useState } from 'react'
import { GripVertical, ArrowUp, ArrowDown, Loader2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast } from '../../../shared'
import { fetchStaff, staffName, type StaffMember } from './staff'
import { moveItem } from './bookViews'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'

export default function TeamOrderSection() {
  const toast = useToast()
  const [people, setPeople] = useState<StaffMember[] | null>(null)
  const [mayChange, setMayChange] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try {
      const [list, order] = await Promise.all([fetchStaff(), api.get('/api/book-blocks/team-order')])
      setPeople(list); setMayChange(!!order?.mayChange); setSaved(Array.isArray(order?.order) && order.order.length > 0)
    } catch { setPeople([]) }
  }
  useEffect(() => { load() }, [])

  const save = async (next: StaffMember[], hadOrder = true) => {
    const before = people
    setPeople(next); setBusy(true)
    try { await api.put('/api/book-blocks/team-order', { order: hadOrder ? next.map((p) => p.id) : [] }); setSaved(hadOrder); await (hadOrder ? Promise.resolve() : load()) }
    catch (err: any) { setPeople(before); toast.error(err?.message || 'The order could not be saved.') }
    finally { setBusy(false) }
  }
  const move = (from: number, to: number) => { if (people && from !== to && to >= 0 && to < people.length) save(moveItem(people, from, to)) }

  return (
    <section className={box} aria-labelledby="team-order-title">
      <h2 id="team-order-title" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Team order</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
        The order your stylists run left to right on the Book, in every stylist list, and when a client chooses a stylist online.
        {mayChange ? ' Drag a name, or use the arrows.' : ' A manager can change it.'}
      </p>
      {people === null ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-gray-400" aria-label="Loading" /> : people.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-slate-300">No stylists to order yet.</p>
      ) : (
        <ol className="mt-4 divide-y rounded-lg border dark:divide-slate-700 dark:border-slate-700" aria-label="Stylists, in order">
          {people.map((p, i) => (
            <li key={p.id} draggable={mayChange && !busy}
              onDragStart={() => setDragFrom(i)} onDragEnd={() => setDragFrom(null)}
              onDragOver={(e) => { if (mayChange && dragFrom !== null) e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null) }}
              className={`flex items-center gap-3 px-3 py-2 text-sm ${dragFrom === i ? 'opacity-40' : ''}`}>
              {mayChange && <GripVertical className="h-4 w-4 cursor-grab text-gray-400" aria-hidden="true" />}
              <span className="w-6 text-gray-500 dark:text-slate-400">{i + 1}</span>
              <span className="flex-1 text-gray-900 dark:text-slate-100">{staffName(p)}</span>
              {mayChange && (
                <span className="flex gap-1">
                  <button type="button" disabled={busy || i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${staffName(p)} up`} className="rounded border p-1 hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-slate-800"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" disabled={busy || i === people.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${staffName(p)} down`} className="rounded border p-1 hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-slate-800"><ArrowDown className="h-4 w-4" /></button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {mayChange && saved && <button type="button" disabled={busy} onClick={() => people && save(people, false)} className="mt-3 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-slate-800">Back to name order</button>}
    </section>
  )
}
