import { TextField, TextAreaField, ImageUrlField, CtaField } from '../Field'

interface Data {
  image?: string
  eyebrow?: string
  title?: string
  subtitle?: string
  primaryCta?: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
}

export function HeroFullBleedForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <ImageUrlField
        label="Background image"
        hint="Full-bleed hero. Use a high-resolution shot — recent project, founder portrait, characteristic environment."
        value={data.image || ''}
        onChange={(v) => update({ image: v })}
      />
      <TextField
        label="Eyebrow (optional)"
        placeholder="e.g. Custom homes since 2008"
        value={data.eyebrow || ''}
        onChange={(e) => update({ eyebrow: e.target.value })}
      />
      <TextField
        label="Headline"
        placeholder="The one sentence above the fold"
        value={data.title || ''}
        onChange={(e) => update({ title: e.target.value })}
      />
      <TextAreaField
        label="Subtitle (optional)"
        rows={2}
        placeholder="One to two sentences that support the headline"
        value={data.subtitle || ''}
        onChange={(e) => update({ subtitle: e.target.value })}
      />
      <CtaField
        label="Primary action"
        value={data.primaryCta || { label: '', href: '' }}
        onChange={(v) => update({ primaryCta: v })}
      />
      <CtaField
        label="Secondary action"
        value={data.secondaryCta || { label: '', href: '' }}
        onChange={(v) => update({ secondaryCta: v })}
        optional
      />
    </div>
  )
}
