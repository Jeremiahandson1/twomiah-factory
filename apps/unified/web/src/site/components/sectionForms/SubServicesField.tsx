import { Plus, X } from 'lucide-react'
import { TextField, Label, Hint } from '../Field'

export interface SubService { title?: string; description?: string }

const asObject = (s: unknown): SubService => (typeof s === 'string' ? { title: s, description: '' } : (s as SubService) || {})

/** The smaller services a service covers: each is linked from its card to a spot on the service's own page. */
export function SubServicesField({ values, onChange }: { values: unknown[]; onChange: (v: SubService[]) => void }) {
  const subs = values.map(asObject)
  const update = (i: number, patch: SubService) => onChange(subs.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div>
      <Label>Parts of this service (optional)</Label>
      <Hint>Each shows as a link on the service's card and as a part of its own page. Only what you list appears.</Hint>
      <div className="mt-2 space-y-2">
        {subs.map((s, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <TextField label="Name" value={s.title || ''} onChange={(e) => update(i, { title: e.target.value })} />
              <TextField label="What it is (optional)" value={s.description || ''} onChange={(e) => update(i, { description: e.target.value })} />
            </div>
            <button type="button" onClick={() => onChange(subs.filter((_, j) => j !== i))} className="btn-secondary btn-sm" aria-label="Remove part">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...subs, { title: '', description: '' }])} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add part
        </button>
      </div>
    </div>
  )
}
