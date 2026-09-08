import { TextField } from '../Field'

interface Props {
  data: { slug?: string; backHref?: string; backLabel?: string }
  onChange: (data: any) => void
}

/**
 * One era of THE ARCHIVE on its own page (/story/<slug>). The slug picks
 * the era out of Timeline; the year, title, story and photos come from
 * there. Prev/next links follow the timeline order automatically.
 */
export function TimelineEraForm({ data, onChange }: Props) {
  const update = (patch: Partial<Props['data']>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">
        Renders one era from <strong>Timeline</strong> as a full page with an h1, prev/next era links and a link back to the story. If the slug does not match a published era the page shows "This chapter is being written" instead of an error.
      </div>
      <TextField
        label="Era slug"
        value={data.slug || ''}
        placeholder="1920"
        hint="Must match an era slug under Timeline, e.g. 1881, 1920, oldest-bar-in-wisconsin. Letters, numbers, dashes."
        onChange={(e) => update({ slug: e.target.value.replace(/[^a-z0-9_-]/gi, '') })}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Back link" value={data.backHref ?? '/story'} onChange={(e) => update({ backHref: e.target.value })} />
        <TextField label="Back link label" value={data.backLabel ?? 'Back to the story'} onChange={(e) => update({ backLabel: e.target.value })} />
      </div>
    </div>
  )
}
