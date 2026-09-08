import { TextField, TextAreaField, CtaField, StatsField } from '../Field'

interface Data {
  eyebrow?: string
  title?: string
  subtitle?: string
  primaryCta?: { label: string; href: string }
  stats?: Array<{ value: string; label: string }>
}

export function HeroCenteredStatsForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <TextField
        label="Eyebrow (optional)"
        placeholder="Short tagline above the headline"
        value={data.eyebrow || ''}
        onChange={(e) => update({ eyebrow: e.target.value })}
      />
      <TextField
        label="Headline"
        placeholder="Big centered headline"
        value={data.title || ''}
        onChange={(e) => update({ title: e.target.value })}
      />
      <TextAreaField
        label="Subtitle (optional)"
        rows={2}
        value={data.subtitle || ''}
        onChange={(e) => update({ subtitle: e.target.value })}
      />
      <CtaField
        label="Primary action"
        value={data.primaryCta || { label: '', href: '' }}
        onChange={(v) => update({ primaryCta: v })}
      />
      <StatsField
        label="Stat band"
        hint="4 stats display in a band under the headline. Use realistic, supportable numbers — never fabricated."
        values={data.stats || []}
        onChange={(v) => update({ stats: v })}
      />
    </div>
  )
}
