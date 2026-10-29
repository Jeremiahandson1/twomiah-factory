// The site's type and feel, in plain words: a font pairing, how round the corners are, filled or outlined buttons, and how
// much room the page leaves. Each is a choice from a short list, with "the design's own" always one of them, so nothing
// picked here can make the site hard to read. (server/site/feel.ts says what each does on each design.)
import { Label } from './Field'

export interface SiteStyle { fonts?: string; corners?: 'square' | 'soft' | 'round'; buttons?: 'outline'; spacing?: 'compact' | 'airy' }
export interface FontChoice { id: string; label: string; display: string; body: string; blurb: string }

/** A row of choices, one of which is on. `value` undefined is the design's own. */
function Segmented<T extends string>({ label, value, options, onChange, disabled }: {
  label: string
  value: T | undefined
  options: Array<{ value: T | undefined; text: string }>
  onChange: (v: T | undefined) => void
  disabled?: boolean
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-line p-1">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.text}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-50 ${on ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper'}`}
            >
              {o.text}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function FeelPicker({ value, onChange, fonts, bar, disabled }: {
  value: SiteStyle | null
  onChange: (next: SiteStyle | null) => void
  fonts: FontChoice[]
  /** The bar design keeps its own type and shapes. */
  bar: boolean
  disabled?: boolean
}) {
  const v = value || {}
  const set = (patch: Partial<SiteStyle>) => {
    const next: Record<string, unknown> = { ...v, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    onChange(Object.keys(next).length ? (next as SiteStyle) : null)
  }
  if (bar) return <p className="text-sm text-muted">This design keeps its own type and shapes; they are part of how it looks. Colours still apply.</p>
  const off = !!disabled
  return (
    <div className="space-y-5">
      <div>
        <Label>Fonts</Label>
        <div role="radiogroup" aria-label="Fonts" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[{ id: '', label: "The design's own", display: '', body: '', blurb: 'The type this design was made with.' } as FontChoice, ...fonts].map((f) => {
            const on = (v.fonts || '') === f.id
            return (
              <button
                key={f.id || 'own'}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={off}
                onClick={() => set({ fonts: f.id || undefined })}
                className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-50 ${on ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-ink-soft'}`}
              >
                <span className="block text-sm font-semibold text-ink">{f.label}</span>
                {f.display && <span className="block text-xs text-ink-soft">{f.display === f.body ? f.display : `${f.display} and ${f.body}`}</span>}
                <span className="block text-xs text-muted mt-1">{f.blurb}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Segmented label="Corners" disabled={off} value={v.corners}
          options={[{ value: undefined, text: "Design's own" }, { value: 'square', text: 'Square' }, { value: 'soft', text: 'Soft' }, { value: 'round', text: 'Round' }]}
          onChange={(c) => set({ corners: c })} />
        <Segmented label="Buttons" disabled={off} value={v.buttons}
          options={[{ value: undefined, text: 'Filled' }, { value: 'outline', text: 'Outline' }]}
          onChange={(b) => set({ buttons: b })} />
        <Segmented label="Spacing" disabled={off} value={v.spacing}
          options={[{ value: 'compact', text: 'Compact' }, { value: undefined, text: "Design's own" }, { value: 'airy', text: 'Airy' }]}
          onChange={(s) => set({ spacing: s })} />
      </div>
      {(v.fonts || v.corners || v.buttons || v.spacing) && !off && (
        <button type="button" className="btn-secondary btn-sm" onClick={() => onChange(null)}>Back to the design's own type and feel</button>
      )}
    </div>
  )
}
