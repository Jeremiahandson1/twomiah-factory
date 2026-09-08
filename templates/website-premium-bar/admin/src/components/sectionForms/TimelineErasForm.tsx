import { TextAreaField, TextField } from '../Field'

interface Props {
  data: { heading?: string; intro?: string; asHeading?: boolean }
  onChange: (data: any) => void
}

/**
 * THE ARCHIVE — the /story timeline. The eras themselves (years, titles,
 * body copy, photos, then-and-now pairs) live under Timeline, not in this
 * form. This form only sets the framing above the spine.
 */
export function TimelineErasForm({ data, onChange }: Props) {
  const update = (patch: Partial<Props['data']>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">
        Every published era is listed here in order, oldest first. Add or edit eras (year, title, story, photo, then-and-now pair) under <strong>Timeline</strong>. Each era gets its own anchor and a permalink to <code>/story/&lt;slug&gt;</code>.
      </div>
      <TextField label="Heading" value={data.heading || ''} placeholder="145 years on East Madison Street" onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Intro (optional, one plain sentence)" rows={2} value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data.asHeading === true} onChange={(e) => update({ asHeading: e.target.checked })} />
        Heading is the page heading (h1) — keep on when this is the first section of the /story page
      </label>
    </div>
  )
}
