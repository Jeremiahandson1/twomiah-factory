// A tap's pour sizes — a pint, a pitcher, a taster — each with its ounces and its price, the way every bar POS sells
// draft. Bar Run 1 (10/17): a tap had one price and one pour, so a pitcher could not be rung up.
//
// Stored on bar_tap.sizes as [{ id, name, oz, priceCents }]. A tap with none keeps the one pour it always had
// (bar_tap.pour_oz at bar_tap.price_cents), so every tap made before sizes existed rings up exactly as before. When
// sizes are saved, the FIRST one is also written to pour_oz / price_cents: stock costing and the website's price read
// those, and they then mean "the usual pour".
import { slugify } from './barMenuSizes.ts'

export interface TapSize { id: string; name: string; oz: number; priceCents: number | null }

export const MAX_TAP_SIZES = 6

const ozOf = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 16 }
const ozLabel = (oz: number) => `${Number.isInteger(oz) ? oz : oz.toFixed(1)} oz`

/** The sizes a tap sells: its own list, or the single pour it always had. */
export function tapSizes(t: { sizes?: unknown; pourOz?: unknown; priceCents?: number | null }): TapSize[] {
  const list = Array.isArray(t.sizes) ? (t.sizes as any[]).filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string') : []
  if (list.length) return list.map((s) => ({ id: s.id, name: s.name, oz: ozOf(s.oz), priceCents: Number.isInteger(s.priceCents) ? s.priceCents : null }))
  const oz = ozOf(t.pourOz)
  return [{ id: 'pour', name: ozLabel(oz), oz, priceCents: t.priceCents ?? null }]
}

/**
 * The sizes from the Taps screen: a name, the ounces, the price (dollars typed, or priceCents). Up to six, names
 * unique, 0.5 to 128 oz. An empty list goes back to the single pour. Returns the clean list or the refusal in words.
 */
export function tapSizesInput(raw: unknown): { ok: true; sizes: TapSize[] } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, sizes: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'Sizes are a list' }
  if (raw.length > MAX_TAP_SIZES) return { ok: false, error: `Up to ${MAX_TAP_SIZES} sizes on a tap` }
  const out: TapSize[] = []
  for (const r of raw as any[]) {
    const name = String(r?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
    if (!name) return { ok: false, error: 'Each size needs a name, like Pint or Pitcher' }
    const id = slugify(name)
    if (out.some((s) => s.id === id)) return { ok: false, error: `Two sizes are called ${name}` }
    const oz = Number(r?.oz)
    if (!Number.isFinite(oz) || oz < 0.5 || oz > 128) return { ok: false, error: `${name}: ounces from 0.5 to 128` }
    let priceCents: number | null = null
    if (r?.priceCents !== undefined && r?.priceCents !== null && r?.priceCents !== '') {
      const n = Number(r.priceCents); if (!Number.isInteger(n) || n < 0 || n > 10000000) return { ok: false, error: `${name}: that price is not a price` }
      priceCents = n
    } else if (r?.price !== undefined && r?.price !== null && String(r.price).trim() !== '') {
      const n = Number(String(r.price).replace(/[$,\s]/g, '')); if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: `${name}: that price is not a price` }
      priceCents = Math.round(n * 100)
    }
    out.push({ id, name, oz: Math.round(oz * 100) / 100, priceCents })
  }
  return { ok: true, sizes: out }
}
