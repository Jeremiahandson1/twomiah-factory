import { Plus, Trash2 } from 'lucide-react'
import { Label, TextField } from '../Field'

interface FormProps<T> { data: T; onChange: (data: any) => void }

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input className="input flex-1" value={v} placeholder={placeholder} onChange={(e) => { const n = [...items]; n[i] = e.target.value; onChange(n) }} />
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...items, ''])} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add</button>
    </div>
  )
}

/** Heading / intro / asHeading — for sections whose content is live. */
export function FramingForm({ data, onChange, note, extra }: FormProps<{ heading?: string; intro?: string; asHeading?: boolean } & Record<string, any>> & { note?: string; extra?: Record<string, string> }) {
  const update = (patch: Record<string, any>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      {note && <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">{note}</div>}
      <TextField label="Heading" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextField label="Intro (optional)" value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!data.asHeading} onChange={(e) => update({ asHeading: e.target.checked })} /> Heading is the page's h1</label>
      {extra && Object.entries(extra).map(([k, lbl]) => (
        <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data[k] !== false} onChange={(e) => update({ [k]: e.target.checked })} /> {lbl}</label>
      ))}
    </div>
  )
}

export function VisitDetailsForm({ data, onChange }: FormProps<{ heading?: string; intro?: string; asHeading?: boolean; parking?: string; accessibility?: string[]; notes?: string[]; showMap?: boolean }>) {
  const update = (patch: Partial<typeof data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">Address, phone and map coordinates come from Settings so every listing matches.</div>
      <TextField label="Heading" value={data.heading ?? 'Find us'} onChange={(e) => update({ heading: e.target.value })} />
      <TextField label="Intro" value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <TextField label="Parking" value={data.parking || ''} onChange={(e) => update({ parking: e.target.value })} />
      <ListEditor label="Accessibility notes" items={Array.isArray(data.accessibility) ? data.accessibility : []} onChange={(v) => update({ accessibility: v })} />
      <ListEditor label="Good to know" items={Array.isArray(data.notes) ? data.notes : []} onChange={(v) => update({ notes: v })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!data.showMap} onChange={(e) => update({ showMap: e.target.checked })} /> Embed a Google map (adds a third-party iframe; off keeps the page fast)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.asHeading !== false} onChange={(e) => update({ asHeading: e.target.checked })} /> Heading is the page's h1</label>
    </div>
  )
}

export function PartiesForm({ data, onChange }: FormProps<{ heading?: string; intro?: string; asHeading?: boolean; minParty?: number; promise?: string; occasions?: string[]; sidebar?: Array<{ num: string; label: string }>; facts?: string[] }>) {
  const update = (patch: Partial<typeof data>) => onChange({ ...data, ...patch })
  const sidebar = Array.isArray(data.sidebar) ? data.sidebar : []
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">Submissions land in the Party inbox and text the owner (OWNER_ALERT_NUMBER). This is an inquiry, not a booking.</div>
      <TextField label="Heading" value={data.heading ?? 'Book the back booths'} onChange={(e) => update({ heading: e.target.value })} />
      <TextField label="Intro" value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Minimum party size" value={data.minParty ?? 6} onChange={(e) => update({ minParty: Number(e.target.value) || 2 })} />
        <TextField label="Promise line under the button" value={data.promise || ''} onChange={(e) => update({ promise: e.target.value })} />
      </div>
      <ListEditor label="Occasions (dropdown)" items={Array.isArray(data.occasions) ? data.occasions : []} onChange={(v) => update({ occasions: v })} />
      <div>
        <Label>Sidebar numbers</Label>
        <div className="space-y-2">
          {sidebar.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end border border-line rounded-lg p-3 bg-paper">
              <TextField label="Number" value={s.num || ''} onChange={(e) => { const n = [...sidebar]; n[i] = { ...n[i], num: e.target.value }; update({ sidebar: n }) }} />
              <TextField label="Label" value={s.label || ''} onChange={(e) => { const n = [...sidebar]; n[i] = { ...n[i], label: e.target.value }; update({ sidebar: n }) }} />
              <button type="button" onClick={() => update({ sidebar: sidebar.filter((_, j) => j !== i) })} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => update({ sidebar: [...sidebar, { num: '', label: '' }] })} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add</button>
      </div>
      <ListEditor label="Facts list" items={Array.isArray(data.facts) ? data.facts : []} onChange={(v) => update({ facts: v })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.asHeading !== false} onChange={(e) => update({ asHeading: e.target.checked })} /> Heading is the page's h1</label>
    </div>
  )
}

export function EventsListForm({ data, onChange }: FormProps<{ heading?: string; intro?: string; asHeading?: boolean; recurring?: Array<{ title: string; when?: string; href?: string; description?: string }>; emptyText?: string }>) {
  const update = (patch: Partial<typeof data>) => onChange({ ...data, ...patch })
  const rec = Array.isArray(data.recurring) ? data.recurring : []
  const set = (i: number, patch: Partial<(typeof rec)[number]>) => { const n = [...rec]; n[i] = { ...n[i], ...patch }; update({ recurring: n }) }
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">Dated events are posted from the console. List the standing weekly things here.</div>
      <TextField label="Heading" value={data.heading ?? "What's on"} onChange={(e) => update({ heading: e.target.value })} />
      <TextField label="Intro" value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <div>
        <Label>Every week</Label>
        <div className="space-y-2">
          {rec.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 border border-line rounded-lg p-3 bg-paper">
              <TextField label="Title" value={r.title || ''} onChange={(e) => set(i, { title: e.target.value })} />
              <TextField label="When" value={r.when || ''} onChange={(e) => set(i, { when: e.target.value })} />
              <TextField label="Link (optional)" value={r.href || ''} onChange={(e) => set(i, { href: e.target.value })} />
              <TextField label="One line" value={r.description || ''} onChange={(e) => set(i, { description: e.target.value })} />
              <button type="button" onClick={() => update({ recurring: rec.filter((_, j) => j !== i) })} className="btn-secondary btn-sm text-red-600 col-span-2 justify-self-end"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => update({ recurring: [...rec, { title: '' }] })} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add</button>
      </div>
      <TextField label="Text when nothing is scheduled" value={data.emptyText || ''} onChange={(e) => update({ emptyText: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.asHeading !== false} onChange={(e) => update({ asHeading: e.target.checked })} /> Heading is the page's h1</label>
    </div>
  )
}

export function TapsWallForm({ data, onChange }: FormProps<{ heading?: string; intro?: string; asHeading?: boolean; leadOrigins?: string[]; showPrices?: boolean; emptyText?: string }>) {
  const update = (patch: Partial<typeof data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">The beers themselves come from the console's tap / blow buttons. Only pouring / just tapped / last keg ever show publicly.</div>
      <TextField label="Heading" value={data.heading ?? 'On tap'} onChange={(e) => update({ heading: e.target.value })} />
      <TextField label="Intro" value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <ListEditor label="Lead with these origins (listed first)" items={Array.isArray(data.leadOrigins) ? data.leadOrigins : []} onChange={(v) => update({ leadOrigins: v })} placeholder="Germany" />
      <TextField label="Text when the list is empty" value={data.emptyText || ''} onChange={(e) => update({ emptyText: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.showPrices !== false} onChange={(e) => update({ showPrices: e.target.checked })} /> Show prices</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.asHeading !== false} onChange={(e) => update({ asHeading: e.target.checked })} /> Heading is the page's h1</label>
    </div>
  )
}
