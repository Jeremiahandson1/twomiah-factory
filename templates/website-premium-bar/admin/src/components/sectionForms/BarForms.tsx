import { Plus, Trash2 } from 'lucide-react'
import { Label, TextField } from '../Field'

interface FormProps<T> { data: T; onChange: (data: any) => void }

/** menu/sections — framing only; items come from the Menu database. */
export function MenuSectionsForm({ data, onChange }: FormProps<{ heading?: string; intro?: string; asHeading?: boolean; kind?: string; showSignatureLinks?: boolean }>) {
  const update = (patch: Partial<typeof data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">
        Items, prices and 86'd status come from the <strong>Menu</strong> database (and Square once it is connected). This section only sets the framing.
      </div>
      <TextField label="Heading" value={data.heading ?? 'The menu'} onChange={(e) => update({ heading: e.target.value })} />
      <TextField label="Intro (optional)" value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <div>
        <Label>Which sections</Label>
        <select className="input" value={data.kind || 'all'} onChange={(e) => update({ kind: e.target.value })}>
          <option value="all">Food and drink</option>
          <option value="food">Food only</option>
          <option value="drink">Drink only</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.asHeading !== false} onChange={(e) => update({ asHeading: e.target.checked })} /> Heading is the page's h1 (on when this is the /menu page)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.showSignatureLinks !== false} onChange={(e) => update({ showSignatureLinks: e.target.checked })} /> Link signature items to their own pages</label>
    </div>
  )
}

/** menu/item-hero — one signature item by slug. */
export function MenuItemHeroForm({ data, onChange }: FormProps<{ slug?: string; section?: string; eyebrow?: string }>) {
  const update = (patch: Partial<typeof data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <TextField label="Item slug (from the Menu database, e.g. peanut-butter-bacon)" value={data.slug || ''} onChange={(e) => update({ slug: e.target.value })} />
      <TextField label="Section slug (optional, e.g. burgers)" value={data.section || ''} onChange={(e) => update({ section: e.target.value })} />
      <TextField label="Eyebrow (optional)" value={data.eyebrow || ''} onChange={(e) => update({ eyebrow: e.target.value })} />
    </div>
  )
}

/** events/recurring — a weekly thing with its own page. */
export function EventsRecurringForm({ data, onChange }: FormProps<{ eyebrow?: string; title?: string; day?: string; startTime?: string; endTime?: string; timeLabel?: string; price?: string; priceCents?: number | null; where?: string; description?: string; details?: string[]; image?: string; asHeading?: boolean; cta?: { label?: string; href?: string } }>) {
  const update = (patch: Partial<typeof data>) => onChange({ ...data, ...patch })
  const details = Array.isArray(data.details) ? data.details : []
  const setDetail = (i: number, v: string) => { const next = [...details]; next[i] = v; update({ details: next }) }
  return (
    <div className="space-y-4">
      <TextField label="Eyebrow" value={data.eyebrow || ''} onChange={(e) => update({ eyebrow: e.target.value })} />
      <TextField label="Title" value={data.title || ''} onChange={(e) => update({ title: e.target.value })} />
      <div className="grid grid-cols-3 gap-3">
        <TextField label="Day (e.g. Friday)" value={data.day || ''} onChange={(e) => update({ day: e.target.value })} />
        <TextField label="Starts (HH:MM, 24h)" value={data.startTime || ''} onChange={(e) => update({ startTime: e.target.value })} />
        <TextField label="Ends (HH:MM, 24h)" value={data.endTime || ''} onChange={(e) => update({ endTime: e.target.value })} />
      </div>
      <TextField label="Time as written (optional, overrides the times above on the page)" value={data.timeLabel || ''} onChange={(e) => update({ timeLabel: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Price as written (e.g. $14)" value={data.price || ''} onChange={(e) => update({ price: e.target.value })} />
        <TextField label="Price in cents (for structured data)" value={data.priceCents ?? ''} onChange={(e) => update({ priceCents: e.target.value === '' ? null : Number(e.target.value) })} />
      </div>
      <TextField label="Where (optional)" value={data.where || ''} onChange={(e) => update({ where: e.target.value })} />
      <TextField label="Description" value={data.description || ''} onChange={(e) => update({ description: e.target.value })} />
      <div>
        <Label>Details (one per line)</Label>
        <div className="space-y-2">
          {details.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input className="input flex-1" value={d} onChange={(e) => setDetail(i, e.target.value)} />
              <button type="button" onClick={() => update({ details: details.filter((_, j) => j !== i) })} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => update({ details: [...details, ''] })} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add detail</button>
      </div>
      <TextField label="Image URL (optional)" value={data.image || ''} onChange={(e) => update({ image: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Button label" value={data.cta?.label || ''} onChange={(e) => update({ cta: { ...(data.cta || {}), label: e.target.value } })} />
        <TextField label="Button link" value={data.cta?.href || ''} onChange={(e) => update({ cta: { ...(data.cta || {}), href: e.target.value } })} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.asHeading !== false} onChange={(e) => update({ asHeading: e.target.checked })} /> Title is the page's h1</label>
    </div>
  )
}
