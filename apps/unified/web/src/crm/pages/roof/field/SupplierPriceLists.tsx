// The company's supplier price lists (/api/material-supply/price-lists, the material_supply feature; margin:read to see them,
// inventory:create / update / delete to change them). A list is typed in or pasted from a spreadsheet (a header row, then one
// item a row: description, price, and optionally sku, unit, code). An order is priced from its supplier's list and locked to it
// (MaterialOrderDetail). Money is typed in dollars and kept as whole cents by the server.
import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useConfirm, usePermissions, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { supplierName } from '../lib/supplier'
import { listOf } from './http'

interface PriceList { id: string; supplier: string; name: string; active: boolean; itemCount: number; updatedAt: string }

export default function SupplierPriceLists({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const can = usePermissions().can
  const [lists, setLists] = useState<PriceList[]>([])
  const [loading, setLoading] = useState(true)
  const [supplier, setSupplier] = useState('')
  const [name, setName] = useState('')
  const [csv, setCsv] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { setLists(listOf<PriceList>(await api.get('/api/material-supply/price-lists'))) } catch (e) { setError(errorText(e, 'Could not load the price lists')) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setSaving(true); setError('')
    try {
      await api.post('/api/material-supply/price-lists', { supplier, name, csv })
      setSupplier(''); setName(''); setCsv(''); toast.success('Price list saved'); await load()
    } catch (e) { setError(errorText(e, 'Could not save the price list')) } finally { setSaving(false) }
  }
  const remove = async (l: PriceList) => {
    if (!(await confirm(`Delete ${l.name} (${supplierName(l.supplier)})? Orders already priced from it keep their prices, but are no longer locked to it.`, { title: 'Delete this price list', confirmText: 'Delete' }))) return
    try { await api.delete(`/api/material-supply/price-lists/${l.id}`); await load() } catch (e) { toast.error(errorText(e, 'Could not delete the price list')) }
  }

  const box = 'w-full border rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600'
  const label = 'block text-xs text-gray-600 mb-1 dark:text-slate-400'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Supplier price lists" data-testid="price-lists" className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Supplier price lists</h2>
        <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">What each supplier charges you. An order is priced from its supplier’s list and the prices are locked to it; changing the supplier on the order clears them.</p>
        {loading ? <p className="text-sm text-gray-500 mt-4 dark:text-slate-400">Loading…</p> : lists.length === 0 ? (
          <p className="text-sm text-gray-500 mt-4 dark:text-slate-400">No price lists yet.</p>
        ) : (
          <ul className="mt-4 divide-y dark:divide-slate-700" data-testid="price-list-rows">
            {lists.map((l) => (
              <li key={l.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span><span className="font-medium text-gray-900 dark:text-slate-100">{l.name}</span> <span className="text-gray-600 dark:text-slate-400">· {supplierName(l.supplier)} · {l.itemCount} {l.itemCount === 1 ? 'item' : 'items'} · updated {formatDate(l.updatedAt)}</span></span>
                {can('inventory:delete') && <button type="button" aria-label={`Delete ${l.name}`} onClick={() => remove(l)} className="p-1.5 text-gray-500 hover:text-red-700 dark:text-slate-400"><Trash2 className="w-4 h-4" /></button>}
              </li>
            ))}
          </ul>
        )}
        {can('inventory:create') && (
          <div className="mt-5 pt-4 border-t space-y-3 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Add a price list</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label htmlFor="pl-supplier" className={label}>Supplier</label><input id="pl-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={box} /></div>
              <div><label htmlFor="pl-name" className={label}>Name</label><input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} className={box} placeholder="2026 contractor pricing" /></div>
            </div>
            <div>
              <label htmlFor="pl-csv" className={label}>Paste the spreadsheet (first row: description, price, and optionally sku, unit, code)</label>
              <textarea id="pl-csv" value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} className={`${box} font-mono`} placeholder={'description,sku,unit,price\nArchitectural shingles,ABC-100,bundle,41.50'} />
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700 mt-3 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg dark:text-slate-300 dark:hover:bg-slate-800">Close</button>
          {can('inventory:create') && <button type="button" onClick={add} disabled={saving || !supplier.trim() || !name.trim() || !csv.trim()} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save price list'}</button>}
        </div>
      </div>
    </div>
  )
}
