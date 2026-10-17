import { Plus, Trash2 } from 'lucide-react'
import { Label, TextField, TextAreaField, ImageUrlField } from '../Field'

interface Quote { quote: string; author?: string; role?: string; photo?: string }

interface Props {
  data: { heading?: string; intro?: string; items?: Quote[] }
  onChange: (data: any) => void
}

export function TestimonialsQuotesForm({ data, onChange }: Props) {
  const items = Array.isArray(data.items) ? data.items : []
  const update = (patch: Partial<Props['data']>) => onChange({ ...data, ...patch })
  const updateItem = (i: number, patch: Partial<Quote>) => {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    update({ items: next })
  }
  const addItem = () => update({ items: [...items, { quote: '', author: '', role: '', photo: '' }] })
  const removeItem = (i: number) => update({ items: items.filter((_, j) => j !== i) })

  return (
    <div className="space-y-4">
      <TextField label="Heading (optional)" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Intro (optional)" rows={2} value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />

      <div>
        <Label>Testimonials</Label>
        <p className="text-xs text-muted mb-3">1–3 works best. Quote real customers — every fake testimonial readers spot kills trust permanently.</p>
        <div className="space-y-3">
          {items.map((q, i) => (
            <div key={i} className="border border-line rounded-lg p-3 bg-paper">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-mono text-muted">{String(i + 1).padStart(2, '0')}</div>
                <button type="button" onClick={() => removeItem(i)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3 h-3" /></button>
              </div>
              <TextAreaField label="Quote" rows={3} value={q.quote || ''} onChange={(e) => updateItem(i, { quote: e.target.value })} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <TextField label="Author" value={q.author || ''} onChange={(e) => updateItem(i, { author: e.target.value })} />
                <TextField label="Role / context (optional)" value={q.role || ''} onChange={(e) => updateItem(i, { role: e.target.value })} />
              </div>
              <ImageUrlField label="Photo (optional)" value={q.photo || ''} onChange={(v) => updateItem(i, { photo: v })} uploadTag="testimonials" hint="A small headshot rounds out the card. Skip if you don't have one." />
            </div>
          ))}
          {items.length === 0 && (
            <div className="text-sm text-muted bg-paper border border-line rounded-lg p-4 text-center">
              No testimonials yet. Click below to add the first one.
            </div>
          )}
        </div>
        <button type="button" onClick={addItem} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add testimonial
        </button>
      </div>
    </div>
  )
}
