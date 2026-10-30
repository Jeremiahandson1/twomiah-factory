// A job's material list (GET /api/material-list/jobs/:id, POST …/order — server/crm/roof/field/materialListRoutes.ts, the
// roof_material_list feature, inventory:create to order): the roof's squares and waste → what to order, every figure
// shown with the arithmetic behind it and every assumption the roofer's to change. The lines are editable; "Create
// material order" makes a plain material order from them. Opened from a job's Materials card (./JobMaterials).
import { useCallback, useEffect, useState } from 'react'
import { Calculator, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useMayWrite, useToast } from '../../../../shared'
import { SUPPLIERS } from './MaterialOrderForm'

interface ListLine { code?: string; description: string; qty: number | string; unit: string; basis?: string }
interface Built {
  squares: number; squaresSource: 'job' | 'measurement' | 'typed' | null; orderedSquares: number
  lengths: Record<string, number>; estimated: string[]; lines: ListLine[]; warnings: string[]; assumptions: Record<string, number | string>
}
interface Labels { [k: string]: { label: string; unit: string; help: string } }

const LENGTHS: Array<[string, string]> = [['eaveFt', 'Eave (ft)'], ['rakeFt', 'Rake (ft)'], ['ridgeFt', 'Ridge and hip (ft)'], ['valleyFt', 'Valley (ft)']]
const SOURCE: Record<string, string> = { job: 'entered on the job', measurement: 'from its measurement report', typed: 'typed here' }

export default function MaterialListBuilder({ jobId, onClose, onSaved }: { jobId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const mayOrder = useMayWrite('inventory:create') // what POST …/order asks
  const [built, setBuilt] = useState<Built | null>(null)
  const [labels, setLabels] = useState<Labels>({})
  const [squares, setSquares] = useState('')
  const [lengths, setLengths] = useState<Record<string, string>>({})
  const [changed, setChanged] = useState<Record<string, string>>({})
  const [lines, setLines] = useState<ListLine[]>([])
  const [supplier, setSupplier] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const work = useCallback(async (sq: string, ls: Record<string, string>, over: Record<string, string>) => {
    setError('')
    try {
      const params: Record<string, string> = { ...over }
      if (sq) params.squares = sq
      for (const [k, v] of Object.entries(ls)) if (v !== '') params[k] = v
      const r = (await api.get(`/api/material-list/jobs/${jobId}`, params)) as Built
      setBuilt(r); setLines(r.lines)
      if (!sq) setSquares(r.squares ? String(r.squares) : '')
    } catch (err) { setError(errorText(err, 'Could not work out the list')) }
  }, [jobId])

  useEffect(() => {
    work('', {}, {})
    api.get('/api/material-list/assumptions').then((r: any) => setLabels(r?.labels || {})).catch(() => setLabels({}))
  }, [work])

  const recalc = () => work(squares, lengths, changed)
  const setLine = (i: number, k: keyof ListLine, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const wasteNow = changed.wastePercent ?? String(built?.assumptions.wastePercent ?? 10)

  const problem = !supplier.trim() ? 'Enter the supplier.' : !lines.length ? 'The list is empty.'
    : lines.some((l) => !l.description.trim() || !(Number(l.qty) > 0)) ? 'Every line needs what it is and how many.' : ''

  const create = async () => {
    if (problem) { setError(problem); return }
    setSaving(true); setError('')
    try {
      await api.post(`/api/material-list/jobs/${jobId}/order`, {
        supplier: supplier.trim(), squares: built?.squares, wastePercent: Number(wasteNow),
        lines: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), unit: l.unit || 'ea', ...(l.code ? { code: l.code } : {}) })),
      })
      toast.success('Material order created from the list')
      onSaved(); onClose()
    } catch (err) { setError(errorText(err, 'Could not create the material order')) } finally { setSaving(false) }
  }

  const input = 'w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-900 dark:border-slate-700'
  const lab = 'text-xs text-gray-600 block mb-1 dark:text-slate-400'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Material list" data-testid="material-list" className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2 dark:text-slate-100"><Calculator className="w-5 h-5 text-orange-600" /> Material list</h2>
        <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
          {built?.squaresSource ? `${built.squares} squares, ${SOURCE[built.squaresSource]}.` : 'This job has no squares yet — type them below.'} Change anything; the list is yours to edit before it becomes an order.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div><label htmlFor="ml-squares" className={lab}>Squares</label><input id="ml-squares" type="number" min={0} step="any" value={squares} onChange={(e) => setSquares(e.target.value)} className={input} /></div>
          <div><label htmlFor="ml-waste" className={lab}>Waste %</label><input id="ml-waste" type="number" min={0} step="any" value={wasteNow} onChange={(e) => setChanged((c) => ({ ...c, wastePercent: e.target.value }))} className={input} /></div>
          {LENGTHS.map(([k, text]) => (
            <div key={k}><label htmlFor={`ml-${k}`} className={lab}>{text}</label>
              <input id={`ml-${k}`} type="number" min={0} step="any" placeholder={built?.estimated.includes(k) ? `~${built.lengths[k]}` : ''} value={lengths[k] ?? ''} onChange={(e) => setLengths((l) => ({ ...l, [k]: e.target.value }))} className={input} /></div>
          ))}
        </div>
        <details className="mt-3">
          <summary className="text-sm font-medium text-orange-700 cursor-pointer dark:text-orange-300">What the list assumes</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {Object.entries(labels).filter(([k]) => k !== 'wastePercent').map(([k, meta]) => (
              <div key={k}>
                <label htmlFor={`ml-a-${k}`} className={lab}>{meta.label}{meta.unit ? ` (${meta.unit})` : ''}</label>
                {k === 'ventType' ? (
                  <select id={`ml-a-${k}`} value={changed[k] ?? String(built?.assumptions[k] ?? 'box')} onChange={(e) => setChanged((c) => ({ ...c, [k]: e.target.value }))} className={input}>
                    <option value="box">Box vents</option><option value="ridge">Ridge vent</option><option value="none">None</option>
                  </select>
                ) : (
                  <input id={`ml-a-${k}`} type="number" min={0} step="any" value={changed[k] ?? String(built?.assumptions[k] ?? '')} onChange={(e) => setChanged((c) => ({ ...c, [k]: e.target.value }))} className={input} />
                )}
                <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{meta.help}</p>
              </div>
            ))}
          </div>
        </details>
        <button type="button" onClick={recalc} className="mt-3 px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700">Work out the list</button>

        {built?.warnings.map((w) => <p key={w} role="status" className="mt-3 text-sm text-amber-800 dark:text-amber-300">{w}</p>)}

        {lines.length > 0 && (
          <div className="mt-4 space-y-2" data-testid="material-list-lines">
            {lines.map((l, i) => (
              <div key={`${l.code ?? 'x'}-${i}`} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 sm:col-span-6"><label htmlFor={`ml-d-${i}`} className={lab}>Material</label><input id={`ml-d-${i}`} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} className={input} /></div>
                <div className="col-span-5 sm:col-span-2"><label htmlFor={`ml-q-${i}`} className={lab}>Qty</label><input id={`ml-q-${i}`} type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} className={input} /></div>
                <div className="col-span-5 sm:col-span-3"><label htmlFor={`ml-u-${i}`} className={lab}>Unit</label><input id={`ml-u-${i}`} value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} className={input} /></div>
                <div className="col-span-2 sm:col-span-1 flex justify-end"><button type="button" aria-label={`Remove ${l.description}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"><Trash2 className="w-4 h-4" /></button></div>
                {l.basis && <p className="col-span-12 text-xs text-gray-500 dark:text-slate-400">{l.basis}</p>}
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setLines((ls) => [...ls, { description: '', qty: '', unit: 'ea' }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300"><Plus className="w-4 h-4" /> Add a line</button>

        <div className="mt-4">
          <label htmlFor="ml-supplier" className={lab}>Supplier *</label>
          <input id="ml-supplier" list="ml-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. ABC Supply" className={input} />
          <datalist id="ml-suppliers">{SUPPLIERS.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          {mayOrder && <button type="button" onClick={create} disabled={saving} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">{saving ? 'Creating…' : 'Create material order'}</button>}
        </div>
      </div>
    </div>
  )
}
