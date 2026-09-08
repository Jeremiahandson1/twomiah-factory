import { Label, TextField } from '../Field'

interface Props {
  data: { eyebrow?: string; title?: string; intro?: string; asHeading?: boolean; showTaps?: boolean; showRoom?: boolean; tapsHref?: string; menuHref?: string }
  onChange: (data: any) => void
}

/**
 * The Tonight Board has almost no editable copy on purpose: its content is
 * LIVE (kitchen, bar, taps, game, special, room) and comes from the console
 * and the hours engine, never from this form.
 */
export function TonightBoardForm({ data, onChange }: Props) {
  const update = (patch: Partial<Props['data']>) => onChange({ ...data, ...patch })
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted bg-paper border border-line rounded-lg p-3">
        Kitchen and bar status, taps, tonight's game, today's special and how busy it is are <strong>live</strong>. Staff change them from the console (<code>/console</code>); hours live under Settings → Hours. This form only controls the framing.
      </div>
      <TextField label="Eyebrow" value={data.eyebrow ?? 'Tonight at'} onChange={(e) => update({ eyebrow: e.target.value })} />
      <TextField label="Title (defaults to the business name)" value={data.title || ''} onChange={(e) => update({ title: e.target.value })} />
      <TextField label="Intro line (optional)" value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Taps link" value={data.tapsHref ?? '/taps'} onChange={(e) => update({ tapsHref: e.target.value })} />
        <TextField label="Menu link" value={data.menuHref ?? '/menu'} onChange={(e) => update({ menuHref: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Rows</Label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.showTaps !== false} onChange={(e) => update({ showTaps: e.target.checked })} /> Show "On tap"</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.showRoom !== false} onChange={(e) => update({ showRoom: e.target.checked })} /> Show "Room" (how busy)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.asHeading !== false} onChange={(e) => update({ asHeading: e.target.checked })} /> Board title is the page heading (h1) — keep on when the board replaces the hero</label>
      </div>
    </div>
  )
}
