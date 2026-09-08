import { TextField, TextAreaField, CtaField } from '../Field'

interface Data {
  heading?: string
  subtitle?: string
  primaryCta?: { label: string; href: string }
}

export function CtaBannerForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <TextField label="Heading" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Subtitle (optional)" rows={2} value={data.subtitle || ''} onChange={(e) => update({ subtitle: e.target.value })} />
      <CtaField label="Primary action" value={data.primaryCta || { label: 'Get in touch', href: 'contact' }} onChange={(v) => update({ primaryCta: v })} />
    </div>
  )
}
