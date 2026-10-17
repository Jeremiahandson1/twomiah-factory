import { Plus, Trash2 } from 'lucide-react'
import { Label, TextField } from '../Field'

interface Stat { value: string; label?: string }

interface Props {
  data: { heading?: string; items?: Stat[] }
  onChange: (data: any) => void
}

export function StatsBarForm({ data, onChange }: Props) {
  const items = Array.isArray(data.items) ? data.items : []
  const update = (patch: Partial<Props['data']>) => onChange({ ...data, ...patch })
  const updateItem = (i: number, patch: Partial<Stat>) => {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    update({ items: next })
  }
  const addItem = () => update({ items: [...items, { value: '', label: '' }] })
  const removeItem = (i: number) => update({ items: items.filter((_, j) => j !== i) })

  return (
    <div className="space-y-4">
      <TextField label="Heading (optional, small label above the row)" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />

      <div>
        <Label>Stats (3–4 works best)</Label>
        <p className="text-xs text-muted mb-3">Use only real numbers from your actual operation. Fake stats kill trust permanently.</p>
        <div className="space-y-2">
          {items.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end border border-line rounded-lg p-3 bg-paper">
              <TextField label="Value" value={s.value || ''} onChange={(e) => updateItem(i, { value: e.target.value })} />
              <TextField label="Label" value={s.label || ''} onChange={(e) => updateItem(i, { label: e.target.value })} />
              <button type="button" onClick={() => removeItem(i)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add stat
        </button>
      </div>
    </div>
  )
}
