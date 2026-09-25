/**
 * lib/inventory/costing.ts — the arithmetic of inventory, pure and tested.
 *
 *   unit cost      = pack cost / pack size          (a $180 ½ bbl keg / 1984 fl oz)
 *   plate cost     = Σ recipe qty × unit cost        (per menu item size, or per pour)
 *   cost %         = plate cost / price
 *   used (actual)  = start count + received − end count
 *   used (should)  = Σ items sold × recipe
 *   variance       = actual − should, in units and dollars
 *
 * Money stays in cents; quantities are plain numbers (numeric columns come
 * back from Postgres as strings, so everything goes through num()).
 */

export const CATEGORIES = [
  { id: 'food', label: 'Food' },
  { id: 'beer', label: 'Beer' },
  { id: 'liquor', label: 'Liquor' },
  { id: 'wine', label: 'Wine' },
  { id: 'na', label: 'Soft drinks & mixers' },
  { id: 'supplies', label: 'Supplies' },
] as const
export const DRINK_CATEGORIES = new Set(['beer', 'liquor', 'wine'])

export const UNITS: Record<string, string> = { each: 'each', oz: 'oz', lb: 'lb', floz: 'fl oz' }

/** Packs people actually buy, so nobody has to know a half barrel is 1,984 fl oz. */
export const PACK_PRESETS = [
  { name: '½ bbl keg', unit: 'floz', size: 1984 },
  { name: '¼ bbl keg', unit: 'floz', size: 992 },
  { name: '⅙ bbl keg', unit: 'floz', size: 661 },
  { name: '50 L keg', unit: 'floz', size: 1690.7 },
  { name: '30 L keg', unit: 'floz', size: 1014.4 },
  { name: '20 L keg', unit: 'floz', size: 676.3 },
  { name: '750 ml bottle', unit: 'floz', size: 25.36 },
  { name: '1 L bottle', unit: 'floz', size: 33.81 },
  { name: '1.75 L bottle', unit: 'floz', size: 59.17 },
  { name: 'case of 24', unit: 'each', size: 24 },
  { name: '10 lb case', unit: 'lb', size: 10 },
] as const

export const num = (v: unknown): number => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0 }

/** Cost of one unit, in cents (fractional). null when the price isn't known yet. */
export function unitCostCents(item: { packCostCents: number | null; packSize: unknown }): number | null {
  const size = num(item.packSize)
  if (item.packCostCents === null || item.packCostCents === undefined || size <= 0) return null
  return item.packCostCents / size
}

export interface CostLine { stockItemId: string; qty: unknown }
export interface Costed { costCents: number | null; missing: string[] }

/** What one of something costs to make. `missing` names stock items with no price yet. */
export function costOf(lines: CostLine[], stock: Map<string, { name: string; packCostCents: number | null; packSize: unknown }>): Costed {
  if (!lines.length) return { costCents: null, missing: [] }
  let total = 0
  const missing: string[] = []
  for (const l of lines) {
    const s = stock.get(l.stockItemId)
    const u = s ? unitCostCents(s) : null
    if (u === null) { missing.push(s?.name || 'a deleted item'); continue }
    total += num(l.qty) * u
  }
  return { costCents: missing.length ? null : Math.round(total), missing }
}

/** Cost as a share of price, one decimal (31.4). null if either side is unknown. */
export function costPct(costCents: number | null, priceCents: number | null): number | null {
  if (costCents === null || !priceCents || priceCents <= 0) return null
  return Math.round((costCents / priceCents) * 1000) / 10
}

/** Recipe lines for one size: lines for that size, else lines for every size (sizeId null). */
export function linesForSize<T extends { sizeId: string | null }>(lines: T[], sizeId: string): T[] {
  const exact = lines.filter(l => l.sizeId === sizeId)
  return exact.length ? exact : lines.filter(l => l.sizeId === null)
}

// ─── Usage and variance ─────────────────────────────────────────────────────
export interface Sold { menuItemId: string | null; sizeId: string; qty: number; stockItemId?: string | null; stockQty?: unknown }

/** Units of each stock item the register says were used: recipes × items sold, plus tap pours as recorded. */
export function theoreticalUse(sold: Sold[], recipes: Map<string, Array<{ sizeId: string | null; stockItemId: string; qty: unknown }>>): Map<string, number> {
  const use = new Map<string, number>()
  const add = (id: string, n: number) => use.set(id, (use.get(id) || 0) + n)
  for (const s of sold) {
    if (s.stockItemId) { add(s.stockItemId, num(s.stockQty) * s.qty); continue }
    if (!s.menuItemId) continue
    for (const l of linesForSize(recipes.get(s.menuItemId) || [], s.sizeId)) add(l.stockItemId, num(l.qty) * s.qty)
  }
  return use
}

export interface VarianceRow { stockItemId: string; name: string; category: string; unit: string; start: number; received: number; end: number; actual: number; expected: number; varianceUnits: number; varianceCents: number | null; actualCents: number | null }

/** Between two counts. A positive variance means more went out than the register accounts for. */
export function variance(
  items: Array<{ id: string; name: string; category: string; unit: string; packCostCents: number | null; packSize: unknown }>,
  start: Map<string, number>, end: Map<string, number>, received: Map<string, number>, expected: Map<string, number>,
): VarianceRow[] {
  const rows: VarianceRow[] = []
  for (const it of items) {
    if (!start.has(it.id) || !end.has(it.id)) continue   // only what was counted both times
    const s = start.get(it.id)!, e = end.get(it.id)!, r = received.get(it.id) || 0, x = expected.get(it.id) || 0
    const actual = s + r - e
    const u = unitCostCents(it)
    rows.push({
      stockItemId: it.id, name: it.name, category: it.category, unit: it.unit, start: s, received: r, end: e,
      actual: round3(actual), expected: round3(x), varianceUnits: round3(actual - x),
      varianceCents: u === null ? null : Math.round((actual - x) * u), actualCents: u === null ? null : Math.round(actual * u),
    })
  }
  return rows.sort((a, b) => Math.abs(b.varianceCents || 0) - Math.abs(a.varianceCents || 0))
}
const round3 = (n: number) => Math.round(n * 1000) / 1000

// ─── Ordering ───────────────────────────────────────────────────────────────
/** Packs to order to get back to par, rounded up to whole packs. 0 when at or above par. */
export function packsToOrder(onHandUnits: number, packSize: unknown, parPacks: unknown): number {
  const size = num(packSize), par = num(parPacks)
  if (size <= 0 || par <= 0) return 0
  const short = par - onHandUnits / size
  return short > 0 ? Math.ceil(short - 1e-9) : 0
}

// ─── Menu engineering (Kasavana & Smith) ────────────────────────────────────
export interface MenuRow { key: string; name: string; sold: number; priceCents: number; costCents: number | null }
export interface EngineeredRow extends MenuRow { marginCents: number | null; mixPct: number; class: 'star' | 'plowhorse' | 'puzzle' | 'dog' | null }

/**
 * Popular = sold at least 70% of an even share of the mix. Profitable = margin
 * at or above the sales-weighted average margin. Items without a cost are
 * listed but not classed (and don't move the averages).
 */
export function engineerMenu(rows: MenuRow[]): { rows: EngineeredRow[]; avgMarginCents: number | null; popularAt: number } {
  const total = rows.reduce((n, r) => n + r.sold, 0)
  const popularAt = rows.length ? (1 / rows.length) * 0.7 * 100 : 0
  const costed = rows.filter(r => r.costCents !== null && r.sold > 0)
  const soldCosted = costed.reduce((n, r) => n + r.sold, 0)
  const avgMarginCents = soldCosted ? Math.round(costed.reduce((n, r) => n + r.sold * (r.priceCents - (r.costCents as number)), 0) / soldCosted) : null
  const out = rows.map((r) => {
    const marginCents = r.costCents === null ? null : r.priceCents - r.costCents
    const mixPct = total ? Math.round((r.sold / total) * 1000) / 10 : 0
    let cls: EngineeredRow['class'] = null
    if (marginCents !== null && avgMarginCents !== null) {
      const popular = mixPct >= popularAt, profitable = marginCents >= avgMarginCents
      cls = popular && profitable ? 'star' : popular ? 'plowhorse' : profitable ? 'puzzle' : 'dog'
    }
    return { ...r, marginCents, mixPct, class: cls }
  })
  return { rows: out.sort((a, b) => b.sold - a.sold), avgMarginCents, popularAt: Math.round(popularAt * 10) / 10 }
}
