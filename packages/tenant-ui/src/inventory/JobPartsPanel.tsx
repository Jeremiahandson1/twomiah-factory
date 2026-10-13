/**
 * Parts used on a job — the screen the shared inventory module never had. (parts_tracking folded into
 * `inventory`, crm first)
 *
 * The API has always been there in every CRM that mounts /api/inventory: POST /use takes stock off a location
 * and records it against the job, POST /return puts unused stock back, GET /job/:jobId lists what the job used.
 * No page called any of them, so "what went into this job" lived nowhere and job costing could not see parts.
 *
 * ONE stock list: this records against the same items and locations the Inventory page manages, rather than a
 * second "parts" catalogue with its own counts. Adding and returning need inventory:update (manager and up);
 * everyone who can open the job sees what was used. Cost is withheld by the server below margin:read, so the
 * panel shows the retail figure, which every seat may see.
 */
import { useState, useEffect, useCallback } from 'react'
import { Package, Plus, Undo2 } from 'lucide-react'
import { usePermissions } from '../auth/PermissionsContext'
import { Button, Modal, Field, inputCls, money, errMsg } from '../invoicing/ui'

export interface JobPartsApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: unknown) => Promise<any>
}
export interface JobPartsToast { success: (m: string) => void; error: (m: string) => void }

const listOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [])

export function JobPartsPanel({ api, toast, jobId }: { api: JobPartsApi; toast: JobPartsToast; jobId: string }) {
  const { can } = usePermissions()
  const mayUse = can('inventory:update')
  const [usage, setUsage] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [returning, setReturning] = useState<any | null>(null)
  const [form, setForm] = useState({ itemId: '', locationId: '', quantity: '1' })
  const [returnForm, setReturnForm] = useState({ quantity: '1', locationId: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setUsage(listOf(await api.get(`/api/inventory/job/${jobId}`))) } catch { setUsage([]) } finally { setLoaded(true) }
  }, [api, jobId])
  useEffect(() => { load() }, [load])

  const loadChoices = async () => {
    try { setItems(listOf(await api.get('/api/inventory/items', { limit: 200 }))) } catch { setItems([]) }
    try { setLocations(listOf(await api.get('/api/inventory/locations'))) } catch { setLocations([]) }
  }
  const openAdd = async () => { setForm({ itemId: '', locationId: '', quantity: '1' }); setAdding(true); await loadChoices() }
  const openReturn = async (u: any) => {
    setReturning(u)
    setReturnForm({ quantity: String(Math.max(1, Number(u.quantity) - Number(u.returnedQuantity || 0))), locationId: u.locationId || '' })
    if (!locations.length) await loadChoices()
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/api/inventory/use', { jobId, itemId: form.itemId, locationId: form.locationId, quantity: Number(form.quantity) })
      toast.success('Part added to the job')
      setAdding(false)
      load()
    } catch (err) { toast.error(errMsg(err, 'The part could not be added')) } finally { setBusy(false) }
  }
  const giveBack = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!returning) return
    setBusy(true)
    try {
      await api.post('/api/inventory/return', { usageId: returning.id, returnQuantity: Number(returnForm.quantity), locationId: returnForm.locationId })
      toast.success('Returned to stock')
      setReturning(null)
      load()
    } catch (err) { toast.error(errMsg(err, 'The return could not be recorded')) } finally { setBusy(false) }
  }

  const retailTotal = usage.reduce((sum, u) => sum + Number(u.unitPrice || 0) * (Number(u.quantity) - Number(u.returnedQuantity || 0)), 0)

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-slate-900 dark:border-slate-700" aria-label="Parts and materials used">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Package className="w-4 h-4" />Parts and materials used</h3>
        {mayUse && <Button variant="secondary" className="!px-3 !py-1.5" onClick={openAdd}><Plus className="w-4 h-4" />Add</Button>}
      </div>
      {!loaded ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">Loading…</p>
      ) : usage.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">{mayUse ? 'Nothing recorded yet. Add stock as it goes into the job.' : 'Nothing recorded on this job yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead><tr className="text-left text-xs uppercase text-gray-600 dark:text-slate-400"><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Used</th><th className="py-2 pr-2">Returned</th><th className="py-2 pr-2">Retail</th><th className="py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {usage.map((u) => {
                const left = Number(u.quantity) - Number(u.returnedQuantity || 0)
                return (
                  <tr key={u.id} className="border-t border-gray-100 dark:border-slate-800">
                    <td className="py-2 pr-2 text-gray-900 dark:text-slate-100">{u.item?.name || 'Removed item'}{u.item?.sku ? <span className="text-xs text-gray-600 dark:text-slate-400"> · {u.item.sku}</span> : null}</td>
                    <td className="py-2 pr-2 text-gray-700 dark:text-slate-300">{u.quantity}{u.item?.unit ? ` ${u.item.unit}` : ''}</td>
                    <td className="py-2 pr-2 text-gray-700 dark:text-slate-300">{u.returnedQuantity || 0}</td>
                    <td className="py-2 pr-2 text-gray-700 dark:text-slate-300">{money(Number(u.unitPrice || 0) * left)}</td>
                    <td className="py-2 text-right">{mayUse && left > 0 && <button onClick={() => openReturn(u)} className="inline-flex items-center gap-1 text-sm text-gray-700 underline dark:text-slate-300"><Undo2 className="w-3.5 h-3.5" />Return</button>}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr className="border-t border-gray-200 dark:border-slate-700"><td colSpan={3} className="py-2 pr-2 text-right text-gray-600 dark:text-slate-400">Retail total</td><td className="py-2 pr-2 font-semibold text-gray-900 dark:text-slate-100">{money(retailTotal)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add a part to this job">
        <form onSubmit={add} className="space-y-3">
          <Field label="Item">
            <select required value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} className={inputCls}>
              <option value="">Choose an item…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Taken from">
            <select required value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className={inputCls}>
              <option value="">Choose a stock location…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Quantity"><input type="number" min="1" step="1" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={inputCls} /></Field>
          {items.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400">No inventory items yet. Add them on the Inventory page first.</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Add to job</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!returning} onClose={() => setReturning(null)} title={`Return ${returning?.item?.name || 'part'} to stock`}>
        <form onSubmit={giveBack} className="space-y-3">
          <Field label="How many" hint={returning ? `Up to ${Number(returning.quantity) - Number(returning.returnedQuantity || 0)}.` : undefined}>
            <input type="number" min="1" step="1" required value={returnForm.quantity} onChange={(e) => setReturnForm({ ...returnForm, quantity: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Back to">
            <select required value={returnForm.locationId} onChange={(e) => setReturnForm({ ...returnForm, locationId: e.target.value })} className={inputCls}>
              <option value="">Choose a stock location…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setReturning(null)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Return</Button>
          </div>
        </form>
      </Modal>
    </section>
  )
}
