// A new material order (POST /api/materials, inventory:create — server/crm/roof/field/materials.ts): which job, the
// supplier, its status and dates, and the lines (description, quantity, unit, unit price). The server prices the order
// from its lines; the form shows the same sum. The Materials page and a job's Materials card both open it — neither had
// any way to add an order (live test 2026-10-22). On a job's card the job is fixed; on the Materials page it is picked.
import { useEffect, useState } from 'react'
import { Plus, Trash2, Package } from 'lucide-react'
import { api } from '../../../../api'
import { money } from '@twomiah/tenant-ui/src/money'
import { errorText, useToast } from '../../../../shared'
import { listOf } from './http'

const STATUSES = ['not_ordered', 'ordered', 'partial', 'delivered', 'cancelled'] as const
const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** The supply houses a roofer names most (lib/supplier.ts KNOWN), offered as they type; anything typed is kept. */
const SUPPLIERS = ['ABC Supply', 'Beacon Building Products', 'SRS Distribution', 'Allied Building Products', 'Home Depot', "Lowe's", 'Bradco Supply', 'Gulfeagle Supply', 'Roofers Supply']

interface Line { description: string; qty: string; unit: string; unitPrice: string }
const blankLine = (): Line => ({ description: '', qty: '', unit: 'ea', unitPrice: '' })

interface JobOption { id: string; number?: string | null; address?: string | null }

export default function MaterialOrderForm({ jobId, jobAddress, onClose, onSaved }: {
  /** Fixed on a job's card; absent on the Materials page, where the job is picked. */
  jobId?: string
  jobAddress?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [form, setForm] = useState({
    jobId: jobId || '', supplier: '', orderStatus: 'not_ordered', orderDate: '', deliveryDate: '',
    supplierOrderNumber: '', deliveryAddress: jobAddress || '', notes: '',
  })
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const [saving, setSaving] = useState(false)
  // What is wrong is worked out from the form as it stands, shown once Save has been pressed: a message stored at Save
  // stayed ("Enter the job.") after the job was chosen (live re-test 2026-10-23). The server's refusal is kept until the
  // next edit.
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState('')
  useEffect(() => { setServerError('') }, [form, lines])

  useEffect(() => {
    if (jobId) return
    api.get('/api/jobs', { limit: 200 }).then((r) => setJobs(listOf<JobOption>(r))).catch(() => setJobs([]))
  }, [jobId])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const filled = lines.filter((l) => l.description.trim() || l.qty || l.unitPrice)
  const total = filled.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0)

  // What the server refuses, said first in the form's own words.
  const problem = (() => {
    const missing = [!form.jobId && 'the job', !form.supplier.trim() && 'the supplier'].filter(Boolean) as string[]
    if (missing.length) return `Enter ${missing.join(' and ')}.`
    if (!filled.length) return 'Add at least one material line.'
    const bad = filled.findIndex((l) => !l.description.trim() || !(Number(l.qty) > 0))
    if (bad >= 0) return `Line ${bad + 1}: enter what it is and how many.`
    return ''
  })()
  const error = serverError || (tried ? problem : '')

  const save = async () => {
    setTried(true)
    if (problem) return
    setServerError(''); setSaving(true)
    try {
      await api.post('/api/materials', {
        jobId: form.jobId, supplier: form.supplier.trim(), orderStatus: form.orderStatus,
        ...(form.orderDate ? { orderDate: form.orderDate } : {}), ...(form.deliveryDate ? { deliveryDate: form.deliveryDate } : {}),
        ...(form.supplierOrderNumber.trim() ? { supplierOrderNumber: form.supplierOrderNumber.trim() } : {}),
        ...(form.deliveryAddress.trim() ? { deliveryAddress: form.deliveryAddress.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        lineItems: filled.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), unit: l.unit.trim() || 'ea', unitPrice: Number(l.unitPrice) || 0 })),
      })
      toast.success('Material order added')
      onSaved()
      onClose()
    } catch (err) {
      setServerError(errorText(err, 'Could not save the material order'))
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-900 dark:border-slate-700'
  const lab = 'text-xs text-gray-600 block mb-1 dark:text-slate-400'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="New material order" className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
          <Package className="w-5 h-5 text-orange-600 dark:text-orange-400" /> New material order
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!jobId && (
            <div className="sm:col-span-2">
              <label htmlFor="mo-job" className={lab}>Job *</label>
              <select id="mo-job" value={form.jobId} onChange={(e) => {
                const j = jobs.find((x) => x.id === e.target.value)
                setForm((f) => ({ ...f, jobId: e.target.value, deliveryAddress: f.deliveryAddress || j?.address || '' }))
              }} className={input}>
                <option value="">Select a job…</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.number}{j.address ? ` — ${j.address}` : ''}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="mo-supplier" className={lab}>Supplier *</label>
            <input id="mo-supplier" list="mo-suppliers" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} placeholder="e.g. ABC Supply" className={input} />
            <datalist id="mo-suppliers">{SUPPLIERS.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label htmlFor="mo-status" className={lab}>Status</label>
            <select id="mo-status" value={form.orderStatus} onChange={(e) => set('orderStatus', e.target.value)} className={input}>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mo-ordered" className={lab}>Order date</label>
            <input id="mo-ordered" type="date" value={form.orderDate} onChange={(e) => set('orderDate', e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="mo-delivery" className={lab}>Delivery date</label>
            <input id="mo-delivery" type="date" value={form.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="mo-ref" className={lab}>Supplier order #</label>
            <input id="mo-ref" value={form.supplierOrderNumber} onChange={(e) => set('supplierOrderNumber', e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="mo-address" className={lab}>Deliver to</label>
            <input id="mo-address" value={form.deliveryAddress} onChange={(e) => set('deliveryAddress', e.target.value)} className={input} />
          </div>
        </div>

        <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-2 dark:text-slate-100">Materials</h3>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 sm:col-span-5">
                <label htmlFor={`mo-desc-${i}`} className={lab}>Description</label>
                <input id={`mo-desc-${i}`} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="e.g. Architectural shingles" className={input} />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <label htmlFor={`mo-qty-${i}`} className={lab}>Qty</label>
                <input id={`mo-qty-${i}`} type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} className={input} />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <label htmlFor={`mo-unit-${i}`} className={lab}>Unit</label>
                <input id={`mo-unit-${i}`} value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} placeholder="sq, bundle, roll" className={input} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label htmlFor={`mo-price-${i}`} className={lab}>Unit price</label>
                <input id={`mo-price-${i}`} type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} placeholder="0.00" className={input} />
              </div>
              <div className="col-span-2 sm:col-span-1 flex justify-end">
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">
            <Plus className="w-4 h-4" /> Add a line
          </button>
          <span className="text-sm text-gray-700 dark:text-slate-300">Total {money(total)}</span>
        </div>
        <div className="mt-3">
          <label htmlFor="mo-notes" className={lab}>Notes</label>
          <textarea id="mo-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={input} />
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save order'}
          </button>
        </div>
      </div>
    </div>
  )
}
