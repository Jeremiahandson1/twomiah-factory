// Settings › The Book › Blocked time types (salon parity row 2; server crm/salon/bookBlocks.ts /api/book-blocks/types; feature book_grid).
// The preset kinds of blocked time the owner keeps — Lunch, Training, Day off — each with a colour, a usual length and a paid or unpaid mark.
// A block made from one keeps what it was made with, so changing or deleting a type here never changes blocks already on the Book.
import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm } from '../../../shared'

type BlockType = { id: string; name: string; color: string; defaultMin: number; paid: boolean }
const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const input = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900'

export default function BlockTypesSection({ mayEdit }: { mayEdit: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [types, setTypes] = useState<BlockType[] | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#94a3b8')
  const [minutes, setMinutes] = useState('60')
  const [paid, setPaid] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = () => api.get('/api/book-blocks/types').then((r: any) => setTypes(((r?.data ?? r) || []) as BlockType[])).catch(() => setTypes([]))
  useEffect(() => { load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/api/book-blocks/types', { name, color, defaultMin: Number(minutes), paid })
      setName(''); setMinutes('60'); setPaid(false)
      toast.success('Blocked-time type added')
      await load()
    } catch (err: any) { toast.error(err?.message || 'The type could not be saved.') } finally { setSaving(false) }
  }
  const change = async (t: BlockType, patch: Partial<BlockType>) => {
    try { await api.put(`/api/book-blocks/types/${t.id}`, patch); await load() } catch (err: any) { toast.error(err?.message || 'The type could not be saved.') }
  }
  const remove = async (t: BlockType) => {
    if (!(await confirm(`Delete "${t.name}"? Blocked time already on the Book stays exactly as it is.`, { title: 'Delete blocked-time type', confirmText: 'Delete it' }))) return
    try { await api.delete(`/api/book-blocks/types/${t.id}`); toast.success('Type deleted'); await load() } catch (err: any) { toast.error(err?.message || 'The type could not be deleted.') }
  }

  if (types === null) return <div className="flex h-16 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-500 dark:text-slate-300" /></div>
  return (
    <section className={box} aria-label="Blocked time types">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Blocked time types</h2>
      <p className={hint}>
        The kinds of time you take a chair off the Book — lunch, training, a day off. Mark each paid or unpaid; paid time off the chair counts toward hours.
        Deleting a type never removes blocks already made from it.
      </p>
      {types.length === 0 && <p className={hint}>None yet. You can still block time with just a reason.</p>}
      <ul className="mt-3 space-y-2">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2">
            <span className="inline-block h-4 w-4 rounded" style={{ backgroundColor: t.color }} aria-hidden="true" />
            <span className="min-w-[8rem] font-medium text-gray-900 dark:text-slate-100">{t.name}</span>
            <span className="text-sm text-gray-600 dark:text-slate-300">{t.defaultMin} min</span>
            <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-slate-200">
              <input type="checkbox" checked={t.paid} disabled={!mayEdit} onChange={(e) => change(t, { paid: e.target.checked })} /> Paid
            </label>
            {mayEdit && <button type="button" onClick={() => remove(t)} aria-label={`Delete ${t.name}`} className="ml-auto p-1 text-red-700 hover:bg-red-50 dark:text-red-400"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
          </li>
        ))}
      </ul>
      {mayEdit && (
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`mt-1 block ${input}`} placeholder="Lunch" required /></label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Colour<input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 block h-10 w-14 rounded-lg border border-gray-300" /></label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Usual length (min)<input type="number" min={5} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`mt-1 block w-28 ${input}`} /></label>
          <label className="flex items-center gap-1 pb-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Paid</label>
          <button type="submit" disabled={saving || !name.trim()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50">{saving ? 'Adding...' : 'Add type'}</button>
        </form>
      )}
    </section>
  )
}
