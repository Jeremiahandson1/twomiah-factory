// What one Web presence site may hold, as the Factory knows it (the trade's row, the looks, the layouts) — shipped with the site
// as spec.json for its editor and its cleaner, and used by the Factory to finish every save (canonicalise).
import { SITE_LOOKS, SITE_DESIGN_LABELS } from '../../../unified/server/core/vertical.ts'
import { LAYOUTS, layoutFit } from '../../../unified/server/site/layouts.ts'
import { PRESETS } from '../../../unified/server/site/palette.ts'
import { FONT_PAIRS, CORNERS, SPACINGS } from '../../../unified/server/site/feel.ts'
import { offeredFor, EXTRAS_BY_VERTICAL, EVERYONE } from './sections.ts'
import { verticalFor, type Vertical } from '../config/industryRouting.ts'
import { cleanModel } from './site/clean.mjs'
import { SHAPES, LABELS, LIMITS } from './site/shapes.mjs'

export type SiteSpec = {
  v: 1
  trade: string
  vertical: Vertical
  caps: Record<string, { label: string; type: string; variants: string[]; anchor: string; nav?: string }>
  typeVariants: Record<string, string[]>
  designs: Array<{ id: string; label: string }>
  styles: { fonts: Array<{ id: string; label: string }>; corners: string[]; spacing: string[] }
  presets: Array<{ id: string; label: string; brand: string; band: string; page?: string }>
  limits: typeof LIMITS
  shapes: typeof SHAPES
  labels: typeof LABELS
}

/** Every section type any capability uses → the layouts it may be drawn as. The plan's own sections have the one view they have. */
function variantsOf(type: string, own: string[]): string[] {
  const layouts = (LAYOUTS[type] || []).map((l) => l.id).filter((id) => id !== 'split-form')
  return layouts.length ? layouts : own
}

export function buildSpec(industry: string | null | undefined): SiteSpec {
  const vertical = verticalFor(industry)
  const caps: SiteSpec['caps'] = {}
  const typeVariants: Record<string, string[]> = {}
  for (const c of offeredFor(vertical)) {
    const own = [c.variant]
    const v = variantsOf(c.type, own)
    caps[c.id] = { label: c.label, type: c.type, variants: v, anchor: c.anchor, ...(c.nav ? { nav: c.nav } : {}) }
    typeVariants[c.type] = v
  }
  // A section already on the page whose capability this trade no longer offers keeps its layouts too (nothing is removed).
  for (const rows of [EVERYONE, ...Object.values(EXTRAS_BY_VERTICAL)]) for (const c of rows) typeVariants[c.type] ??= variantsOf(c.type, [c.variant])
  return {
    v: 1, trade: String(industry ?? ''), vertical, caps, typeVariants,
    designs: (SITE_LOOKS as readonly string[]).map((id) => ({ id, label: (SITE_DESIGN_LABELS as any)[id] || id })),
    styles: { fonts: FONT_PAIRS.map((f) => ({ id: f.id, label: (f as any).label || f.id })), corners: [...CORNERS], spacing: [...SPACINGS] },
    presets: PRESETS.map((p) => ({ id: p.id, label: p.label, brand: p.brand, band: p.band, ...(p.page ? { page: p.page } : {}) })),
    limits: LIMITS, shapes: SHAPES, labels: LABELS,
  }
}

/** The shape clean.mjs reads (ids only). */
export function cleanerSpec(spec: SiteSpec) {
  return {
    caps: spec.caps, typeVariants: spec.typeVariants,
    designs: spec.designs.map((d) => d.id),
    styles: { fonts: spec.styles.fonts.map((f) => f.id), corners: spec.styles.corners, spacing: spec.styles.spacing },
    presets: spec.presets.map((p) => p.id),
  }
}

export type Canonical = { model: any; notes: string[] }

/**
 * A save, finished on the Factory's side: cleaned to the spec (clean.mjs), and a layout the content cannot fill (a before/after
 * layout with a photo missing its pair) goes back to the section's last layout — said in `notes`, never silently. The renderer's
 * own guards (palette, style) then run in renderOnePage and the model it returns is what the site keeps.
 */
export function canonicalise(raw: unknown, spec: SiteSpec, prev: any | null): Canonical {
  const model = cleanModel(raw, cleanerSpec(spec), prev)
  const notes: string[] = []
  const had = new Map<string, any>(((prev?.sections as any[]) || []).map((s) => [s.id, s]))
  for (const s of model.sections) {
    // Only a section with a choice of layouts can have picked one its content cannot fill. The rest (contact, hours, hiring…)
    // are drawn one way: layoutFit answers "no such layout" for them, which every save of the live test site printed (10/30).
    if (!LAYOUTS[s.type]) continue
    const why = layoutFit(s.type, s.variant, s.data)
    if (!why) continue
    const before = had.get(s.id)
    const fallback = (before && !layoutFit(s.type, before.variant, s.data) ? before.variant : null) ?? (spec.caps[s.id]?.variants || []).find((v) => !layoutFit(s.type, v, s.data)) ?? s.variant
    notes.push(`${spec.caps[s.id]?.label || s.id}: that layout ${why}.`)
    s.variant = fallback
  }
  return { model, notes }
}
