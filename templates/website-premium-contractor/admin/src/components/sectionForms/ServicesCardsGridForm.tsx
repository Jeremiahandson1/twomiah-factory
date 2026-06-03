import { Plus, X } from 'lucide-react'
import { Label, TextField, TextAreaField, ImageUrlField, Hint } from '../Field'

interface Item { title?: string; description?: string; image?: string; href?: string }
interface Data { heading?: string; intro?: string; items?: Item[] }

export function ServicesCardsGridForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const items = data.items || []
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  const updateItem = (i: number, patch: Partial<Item>) => {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    update({ items: next })
  }
  const removeItem = (i: number) => update({ items: items.filter((_, j) => j !== i) })
  const addItem = () => update({ items: [...items, { title: '', description: '', image: '', href: 'contact' }] })

  return (
    <div className="space-y-4">
      <TextField
        label="Section heading"
        value={data.heading || ''}
        onChange={(e) => update({ heading: e.target.value })}
      />
      <TextAreaField
        label="Section intro (optional)"
        rows={2}
        value={data.intro || ''}
        onChange={(e) => update({ intro: e.target.value })}
      />
      <div>
        <Label>Services</Label>
        <Hint>3–9 services work best in a card grid. More than that, switch to the alternating layout.</Hint>
        <div className="mt-2 space-y-3">
          {items.map((item, i) => (
            <div key={i} className="card card-padding bg-paper relative">
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="absolute top-2 right-2 btn-secondary btn-sm"
                aria-label="Remove service"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="space-y-3 pr-8">
                <TextField label="Title" value={item.title || ''} onChange={(e) => updateItem(i, { title: e.target.value })} />
                <TextAreaField label="Description" rows={2} value={item.description || ''} onChange={(e) => updateItem(i, { description: e.target.value })} />
                <ImageUrlField label="Image" value={item.image || ''} onChange={(v) => updateItem(i, { image: v })} />
                <TextField label="Learn more link" placeholder="contact, services/foo, https://…" value={item.href || ''} onChange={(e) => updateItem(i, { href: e.target.value })} />
              </div>
            </div>
          ))}
          <button type="button" onClick={addItem} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Add service
          </button>
        </div>
      </div>
    </div>
  )
}
