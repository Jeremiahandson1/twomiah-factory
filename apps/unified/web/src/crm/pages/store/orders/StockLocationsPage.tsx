// Stock by location (parity tier 2 #11; server crm/store/stock/locations.ts, GET /api/admin/stock-locations; the rule is
// server/data/storeStock.ts): the store's locations and each counted option's count at each. The storefront sells against the
// total, which is the sum; a sale takes from the first location first, and a restock or a delivery goes to the first.
import { useEffect, useState } from 'react'
import { ArrowRightLeft, Loader2, MapPin, Plus } from 'lucide-react'
import { api } from '../../../../api'
import { useToast, usePermissions } from '../../../../shared'

interface Loc { id: string; name: string; address: string | null }
interface Opt { id: string; sku: string; name: string | null; productName: string; total: number; byLocation: Record<string, number> | null }

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const button = 'inline-flex items-center gap-1.5 rounded-lg bg-orange-700 px-3 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600'

export default function StockLocationsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('products:update')
  const [data, setData] = useState<{ locations: Loc[]; options: Opt[] } | null>(null)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [moving, setMoving] = useState<{ id: string; fromId: string; toId: string; quantity: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/api/admin/stock-locations').then(setData).catch((e: Error) => setError(e.message || 'Stock by location could not be loaded.'))
  useEffect(() => { load() }, [])

  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>
  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try { await what(); toast.success(done); await load() } catch (e: any) { toast.error(e?.message || 'That could not be saved.') } finally { setBusy(false) }
  }
  const addLocation = () => run(async () => { await api.post('/api/admin/stock-locations/locations', { name: newName }); setNewName('') }, 'Location added')
  const saveCount = (o: Opt, l: Loc) => run(async () => {
    await api.put(`/api/admin/stock-locations/variants/${o.id}/levels`, { locationId: l.id, quantity: Number(edits[`${o.id}:${l.id}`]) })
    setEdits((e) => { const n = { ...e }; delete n[`${o.id}:${l.id}`]; return n })
  }, 'Count saved')
  const saveMove = () => moving && run(async () => {
    await api.post(`/api/admin/stock-locations/variants/${moving.id}/transfer`, { fromId: moving.fromId, toId: moving.toId, quantity: Number(moving.quantity) })
    setMoving(null)
  }, 'Moved')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><MapPin className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Stock by location</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Count each product where it is kept. Your store sells against the total of all your locations. A sale takes from your first
          location first, then the next; a refund&rsquo;s restock and a delivery go to the first.
        </p>
      </div>

      <section className={box} aria-label="Locations">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Locations</h2>
        {data.locations.length === 0
          ? <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">No locations yet. Add the first: it is where sales take from first.</p>
          : <ol className="mt-2 list-decimal pl-5 text-sm text-gray-900 dark:text-slate-100">{data.locations.map((l) => <li key={l.id}>{l.name}</li>)}</ol>}
        {mayEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <label htmlFor="new-loc" className="sr-only">New location name</label>
            <input id="new-loc" className={input} placeholder="e.g. Back room, Warehouse" maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="button" className={button} disabled={busy || !newName.trim()} onClick={addLocation}><Plus className="h-4 w-4" aria-hidden="true" />Add location</button>
          </div>
        )}
      </section>

      {data.locations.length > 0 && (
        <section className={box} aria-label="Counts">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">Counts</h2>
          {data.options.length === 0 ? <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">No products count their stock yet.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="text-gray-600 dark:text-slate-300"><th className="py-1 pr-3 font-medium">Product</th>{data.locations.map((l) => <th key={l.id} className="py-1 pr-3 font-medium">{l.name}</th>)}<th className="py-1 pr-3 font-medium">Total</th><th /></tr></thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {data.options.map((o) => (
                    <tr key={o.id} className="text-gray-900 dark:text-slate-100">
                      <td className="py-2 pr-3">{o.productName}{o.name ? ` — ${o.name}` : ''}<span className="block text-xs text-gray-600 dark:text-slate-400">{o.sku}</span></td>
                      {data.locations.map((l) => {
                        const k = `${o.id}:${l.id}`
                        const shown = edits[k] ?? (o.byLocation ? String(o.byLocation[l.id] ?? 0) : '')
                        return (
                          <td key={l.id} className="py-2 pr-3">
                            {mayEdit ? (
                              <span className="inline-flex items-center gap-1">
                                <input aria-label={`${o.productName} at ${l.name}`} type="number" min="0" inputMode="numeric" className={`${input} w-20`} placeholder={o.byLocation ? '0' : '—'} value={shown} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
                                {edits[k] !== undefined && edits[k] !== '' && <button type="button" className={button} disabled={busy} onClick={() => saveCount(o, l)}>Save</button>}
                              </span>
                            ) : (o.byLocation ? (o.byLocation[l.id] ?? 0) : '—')}
                          </td>
                        )
                      })}
                      <td className="py-2 pr-3 font-medium">{o.total}</td>
                      <td className="py-2">{mayEdit && data.locations.length > 1 && o.byLocation && (
                        <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300" onClick={() => setMoving({ id: o.id, fromId: data.locations[0].id, toId: data.locations[1].id, quantity: '1' })}>
                          <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />Move
                        </button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">A product not yet counted by location (—) keeps its single count. Its first count here keeps what it had at your first location.</p>
        </section>
      )}

      {moving && (
        <section className={box} aria-label="Move stock">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">Move stock</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
            <label htmlFor="mv-q" className="sr-only">How many</label>
            <input id="mv-q" type="number" min="1" className={`${input} w-20`} value={moving.quantity} onChange={(e) => setMoving({ ...moving, quantity: e.target.value })} />
            <span>from</span>
            <select aria-label="From" className={input} value={moving.fromId} onChange={(e) => setMoving({ ...moving, fromId: e.target.value })}>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <span>to</span>
            <select aria-label="To" className={input} value={moving.toId} onChange={(e) => setMoving({ ...moving, toId: e.target.value })}>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <button type="button" className={button} disabled={busy} onClick={saveMove}>Move</button>
            <button type="button" className="text-sm text-gray-700 hover:underline dark:text-slate-300" onClick={() => setMoving(null)}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  )
}
