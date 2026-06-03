import { TextField, TextAreaField, ImageUrlField, CtaField, StringListField } from '../Field'

interface Data {
  heading?: string
  subtitle?: string
  image?: string
  bullets?: string[]
  primaryCta?: { label: string; href: string }
  phone?: string
}

export function CtaSplitForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <TextField label="Heading" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Subtitle (optional)" rows={2} value={data.subtitle || ''} onChange={(e) => update({ subtitle: e.target.value })} />
      <ImageUrlField label="Image" value={data.image || ''} onChange={(v) => update({ image: v })} hint="Sits next to the copy. Face, finished job, or characteristic shot." />
      <StringListField
        label="Bullets"
        values={data.bullets || []}
        onChange={(v) => update({ bullets: v })}
        placeholder="What the customer can expect"
        addLabel="Add bullet"
      />
      <CtaField label="Primary action" value={data.primaryCta || { label: 'Get in touch', href: 'contact' }} onChange={(v) => update({ primaryCta: v })} />
      <TextField label="Phone (optional)" placeholder="Shown next to the button" value={data.phone || ''} onChange={(e) => update({ phone: e.target.value })} />
    </div>
  )
}
