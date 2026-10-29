// The site's colours, in plain words: pick a palette, then change any one colour. (server/site/palette.ts says what each
// colour does and keeps the result readable: the dark bands stay dark, and the page's text, cards and lines are worked out
// from the page ground, so nothing picked here makes the site hard to read.)
import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Label } from './Field'

export interface Palette { brand?: string; band?: string; page?: string; preset?: string }
export interface Preset { id: string; label: string; brand: string; accent: string; band: string; page?: string }
export interface PaletteInfo {
  presets: Preset[]
  designs: Record<string, { page: boolean }>
  defaults: { brand: string | null; band: string | null; accent: string }
}
export interface PaletteValue { accentColor: string | null; palette: Palette | null }

const HEX = /^#[0-9a-fA-F]{6}$/
/** What someone types or pastes as a colour — 1f6b46, #1F6B46, #abc, abc — as #rrggbb; null when it is not one. */
function toHex(v: string): string | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return ('#' + h).toLowerCase()
}
const same = (a?: string | null, b?: string | null) => (a || '').toLowerCase() === (b || '').toLowerCase()

/** The four colours of a preset as the page shows them, in the order a painter would lay them down. */
function Swatches({ colours }: { colours: Array<string | undefined | null> }) {
  return (
    <span className="flex h-7 w-full overflow-hidden rounded-md border border-line" aria-hidden="true">
      {colours.filter(Boolean).map((c, i) => <span key={i} className="flex-1" style={{ background: c! }} />)}
    </span>
  )
}

/** One colour: a picker and its hex, "Reset" to go back to the design's own. */
function ColourRow({ id, label, hint, value, shown, onChange, resetLabel, disabled }: {
  id: string; label: string; hint: string
  /** What the owner set, or null. */
  value: string | null
  /** What the site is using now when nothing is set (the design's own, or the business's colour). */
  shown: string | null
  onChange: (v: string | null) => void
  resetLabel: string
  disabled?: boolean
}) {
  const [text, setText] = useState(value || '')
  useEffect(() => setText(value || ''), [value])
  const bad = text.trim() !== '' && !toHex(text)
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2 items-center">
        <input
          type="color"
          aria-label={`Pick the ${label.toLowerCase()}`}
          disabled={disabled}
          value={HEX.test(value || '') ? value! : HEX.test(shown || '') ? shown! : '#888888'}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 h-10 rounded border border-line cursor-pointer disabled:opacity-40"
        />
        <input
          id={id}
          type="text"
          disabled={disabled}
          inputMode="text"
          spellCheck={false}
          placeholder={shown ? `${shown} — ${resetLabel}` : resetLabel}
          value={text}
          aria-invalid={bad}
          onChange={(e) => {
            const v = e.target.value
            setText(v)
            if (v.trim() === '') onChange(null)
            else if (toHex(v)) onChange(toHex(v))
          }}
          onBlur={() => { if (toHex(text)) setText(toHex(text)!) }}
          className="input"
        />
        {value && !disabled && (
          <button type="button" onClick={() => onChange(null)} className="btn-secondary btn-sm shrink-0" aria-label={`Reset the ${label.toLowerCase()}: ${resetLabel}`} title={resetLabel}>
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {bad
        ? <div className="text-xs text-red-700 mt-1" role="alert">Type a colour code like #1f6b46 (or 1f6b46, or #abc).</div>
        : <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  )
}

export function PalettePicker({ value, onChange, info, design, disabled }: {
  value: PaletteValue
  onChange: (next: PaletteValue) => void
  info: PaletteInfo | null
  /** The design in use (its id), or null for the business type's own. */
  design: string | null
  disabled?: boolean
}) {
  if (!info) return null
  const p = value.palette || {}
  const canPage = design ? info.designs[design]?.page !== false : true
  const set = (patch: Partial<Palette>) => {
    const next: Palette = { ...p, ...patch }
    delete next.preset
    for (const k of ['brand', 'band', 'page'] as const) if (!next[k]) delete next[k]
    onChange({ accentColor: value.accentColor, palette: Object.keys(next).length ? next : null })
  }
  const chosen = info.presets.find((x) => x.id === p.preset)
  const matches = (x: Preset) =>
    same(x.accent, value.accentColor) && same(x.brand, p.brand) && same(x.band, p.band) && same(x.page, p.page)

  return (
    <div className="space-y-5">
      <div>
        <Label>Palette</Label>
        <div role="radiogroup" aria-label="Palette" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {info.presets.map((x) => {
            const on = chosen?.id === x.id && matches(x)
            const needsPage = !!x.page && !canPage
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onChange({
                  accentColor: x.accent,
                  palette: { brand: x.brand, band: x.band, ...(x.page && canPage ? { page: x.page } : {}), preset: x.id },
                })}
                className={`text-left rounded-lg border p-2 transition-colors disabled:opacity-50 ${on ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-ink-soft'}`}
              >
                <Swatches colours={[x.page && canPage ? x.page : '#ffffff', x.brand, x.accent, x.band]} />
                <span className="block text-sm font-medium text-ink mt-1.5">{x.label}</span>
                {needsPage && <span className="block text-xs text-muted">Page colour not used on this design</span>}
              </button>
            )
          })}
        </div>
        {(value.accentColor || value.palette) && !disabled && (
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => onChange({ accentColor: null, palette: null })}>
            <RotateCcw className="w-3.5 h-3.5" />
            Back to the design's own colours
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ColourRow
          id="site-brand" label="Main colour" resetLabel="your business colour" disabled={disabled}
          hint="Buttons, links and lines. Starts as your business colour."
          value={p.brand || null} shown={info.defaults.brand} onChange={(v) => set({ brand: v || undefined })}
        />
        <ColourRow
          id="site-accent" label="Accent colour" resetLabel="the design's own" disabled={disabled}
          hint="The bar under headings, small labels and link underlines."
          value={value.accentColor || null} shown={info.defaults.accent}
          onChange={(v) => onChange({ accentColor: v, palette: value.palette ? { ...value.palette, preset: undefined } : null })}
        />
        <ColourRow
          id="site-band" label="Dark bands" resetLabel="your business's second colour" disabled={disabled}
          hint="The call-to-action, stats and footer. Always kept dark so the white text on them reads."
          value={p.band || null} shown={info.defaults.band} onChange={(v) => set({ band: v || undefined })}
        />
        <ColourRow
          id="site-page" label="Page background" resetLabel="the design's own" disabled={disabled || !canPage}
          hint={canPage ? 'The text, cards and lines are chosen for you, so the page is always easy to read.' : "This design keeps its own page; its look is part of the design."}
          value={canPage ? p.page || null : null} shown={null} onChange={(v) => set({ page: v || undefined })}
        />
      </div>
    </div>
  )
}
