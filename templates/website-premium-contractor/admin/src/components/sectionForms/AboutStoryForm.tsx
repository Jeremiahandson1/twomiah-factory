import { TextField, ImageUrlField, StringListField, StatsField } from '../Field'

interface Data {
  eyebrow?: string
  title?: string
  portrait?: string
  paragraphs?: string[]
  signature?: string
  stats?: Array<{ value: string; label: string }>
}

export function AboutStoryForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <TextField label="Eyebrow (optional)" placeholder="e.g. From the founder" value={data.eyebrow || ''} onChange={(e) => update({ eyebrow: e.target.value })} />
      <TextField label="Headline" placeholder="Our story" value={data.title || ''} onChange={(e) => update({ title: e.target.value })} />
      <ImageUrlField
        label="Portrait"
        hint="Headshot or team photo — not a building or job site."
        value={data.portrait || ''}
        onChange={(v) => update({ portrait: v })}
      />
      <StringListField
        label="Paragraphs"
        hint="2–4 paragraphs in the founder/principal voice."
        values={data.paragraphs || ['']}
        onChange={(v) => update({ paragraphs: v })}
        multiline
        addLabel="Add paragraph"
      />
      <TextField label="Signature (optional)" placeholder="e.g. Jamie Reyes, Founding partner" value={data.signature || ''} onChange={(e) => update({ signature: e.target.value })} />
      <StatsField label="Stats (optional)" values={data.stats || []} onChange={(v) => update({ stats: v })} />
    </div>
  )
}
