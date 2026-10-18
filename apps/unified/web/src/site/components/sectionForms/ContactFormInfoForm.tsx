import { TextField, TextAreaField, StringListField } from '../Field'

interface Data {
  heading?: string
  intro?: string
  phone?: string
  email?: string
  address?: string
  hours?: string[]
  responsePromise?: string
}

export function ContactFormInfoForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <TextField label="Heading" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Intro (optional)" rows={2} value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Phone" value={data.phone || ''} onChange={(e) => update({ phone: e.target.value })} />
        <TextField label="Email" value={data.email || ''} onChange={(e) => update({ email: e.target.value })} />
      </div>
      <TextAreaField label="Office address" rows={2} value={data.address || ''} onChange={(e) => update({ address: e.target.value })} />
      <StringListField
        label="Hours"
        values={data.hours || []}
        onChange={(v) => update({ hours: v })}
        placeholder='e.g. "Monday – Friday: 8am – 5pm"'
        addLabel="Add hours row"
      />
      <TextAreaField
        label="Response promise"
        rows={2}
        placeholder='e.g. "We reply to project inquiries within one business day."'
        value={data.responsePromise || ''}
        onChange={(e) => update({ responsePromise: e.target.value })}
      />
    </div>
  )
}
