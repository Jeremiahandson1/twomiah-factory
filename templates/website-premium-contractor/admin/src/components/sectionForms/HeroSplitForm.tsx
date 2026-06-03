import { TextField, TextAreaField, ImageUrlField, CtaField, StatsField } from '../Field'

interface Data {
  image?: string
  eyebrow?: string
  title?: string
  subtitle?: string
  flip?: boolean
  primaryCta?: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
  stats?: Array<{ value: string; label: string }>
}

export function HeroSplitForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <TextField
        label="Headline"
        placeholder="The lead sentence"
        value={data.title || ''}
        onChange={(e) => update({ title: e.target.value })}
      />
      <TextField
        label="Eyebrow (optional)"
        placeholder="Short tagline above the headline"
        value={data.eyebrow || ''}
        onChange={(e) => update({ eyebrow: e.target.value })}
      />
      <TextAreaField
        label="Subtitle (optional)"
        rows={2}
        value={data.subtitle || ''}
        onChange={(e) => update({ subtitle: e.target.value })}
      />
      <ImageUrlField
        label="Side image"
        hint="Sits opposite the copy. Portrait, job site, finished project."
        value={data.image || ''}
        onChange={(v) => update({ image: v })}
      />
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={!!data.flip} onChange={(e) => update({ flip: e.target.checked })} className="rounded border-line" />
        Flip — image on left, copy on right
      </label>
      <CtaField
        label="Primary action"
        value={data.primaryCta || { label: '', href: '' }}
        onChange={(v) => update({ primaryCta: v })}
        optional
      />
      <CtaField
        label="Secondary action"
        value={data.secondaryCta || { label: '', href: '' }}
        onChange={(v) => update({ secondaryCta: v })}
        optional
      />
      <StatsField
        label="Stats"
        hint="Up to 3 stats display under the copy. Leave empty to hide the stat row."
        values={data.stats || []}
        onChange={(v) => update({ stats: v })}
      />
    </div>
  )
}
