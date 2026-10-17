import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Label, TextField, TextAreaField } from '../Field'

interface Item { question: string; answer: string }

interface Props {
  data: { heading?: string; intro?: string; items?: Item[] }
  onChange: (data: any) => void
}

export function FaqAccordionForm({ data, onChange }: Props) {
  const items = Array.isArray(data.items) ? data.items : []
  const update = (patch: Partial<Props['data']>) => onChange({ ...data, ...patch })
  const updateItem = (i: number, patch: Partial<Item>) => {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    update({ items: next })
  }
  const addItem = () => update({ items: [...items, { question: '', answer: '' }] })
  const removeItem = (i: number) => update({ items: items.filter((_, j) => j !== i) })
  const moveItem = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    update({ items: next })
  }

  return (
    <div className="space-y-4">
      <TextField label="Heading (optional)" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Intro (optional)" rows={2} value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />

      <div>
        <Label>Questions</Label>
        <p className="text-xs text-muted mb-3">5–8 questions hits the SEO sweet spot. Write the questions your phone gets every week — those are the ones buyers are searching for.</p>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="border border-line rounded-lg p-3 bg-paper">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-mono text-muted">{String(i + 1).padStart(2, '0')}</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="btn-secondary btn-sm disabled:opacity-30"><ChevronUp className="w-3 h-3" /></button>
                  <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} className="btn-secondary btn-sm disabled:opacity-30"><ChevronDown className="w-3 h-3" /></button>
                  <button type="button" onClick={() => removeItem(i)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <TextField label="Question" value={it.question || ''} onChange={(e) => updateItem(i, { question: e.target.value })} />
              <div className="mt-2">
                <TextAreaField label="Answer" rows={3} value={it.answer || ''} onChange={(e) => updateItem(i, { answer: e.target.value })} />
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="text-sm text-muted bg-paper border border-line rounded-lg p-4 text-center">
              No questions yet. Click below to add the first one.
            </div>
          )}
        </div>
        <button type="button" onClick={addItem} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add question
        </button>
      </div>
    </div>
  )
}
