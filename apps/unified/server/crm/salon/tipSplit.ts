// A sale's tip, split across the stylists on it (salon parity row 10; Fresha, Square). Pure arithmetic in whole cents — no database here.
//
// The default split is by the VALUE of each stylist's services on the visit (a colourist with $120 of the $160 gets three quarters of the
// tip). The salon can set its own percentages on one sale, at checkout or afterwards; they replace the default for that sale. A refund that
// gives tip back is a negative tip: it is split by the same shares, so it comes off each person's tips the way it was added.

/** Who a share belongs to: a login (`u:<id>`) or a chair-only roster member (`m:<id>`), or nobody recorded (`none`). */
export type PersonKey = string
export const NOBODY: PersonKey = 'none'
export const keyOf = (p: { stylistId?: string | null; stylistMemberId?: string | null }): PersonKey => p.stylistId ? `u:${p.stylistId}` : p.stylistMemberId ? `m:${p.stylistMemberId}` : NOBODY

export interface Weighted { key: PersonKey; weight: number }

/** The default weights: each person's services' value (cents) on the visit. People with nothing priced get nothing; no priced service at all → the visit's own stylist. */
export function defaultWeights(items: Array<{ key: PersonKey; priceCents: number }>, visitStylist: PersonKey): Weighted[] {
  const by = new Map<PersonKey, number>()
  for (const i of items) if (i.priceCents > 0) by.set(i.key, (by.get(i.key) ?? 0) + i.priceCents)
  if (!by.size) return [{ key: visitStylist, weight: 1 }]
  return [...by.entries()].map(([key, weight]) => ({ key, weight }))
}

/**
 * Split `totalCents` (negative for a refund of tip) across the weights: whole cents, the shares add up to the total exactly (largest remainder,
 * ties to the earlier person), a refund splits as the mirror image of the same positive tip.
 */
export function splitCents(totalCents: number, weights: Weighted[]): Array<{ key: PersonKey; cents: number }> {
  const w = weights.filter((x) => x.weight > 0)
  if (!w.length || totalCents === 0) return w.map((x) => ({ key: x.key, cents: 0 }))
  const sign = totalCents < 0 ? -1 : 1
  const abs = Math.abs(Math.round(totalCents))
  const sum = w.reduce((t, x) => t + x.weight, 0)
  const exact = w.map((x) => (abs * x.weight) / sum)
  const floor = exact.map((v) => Math.floor(v))
  let left = abs - floor.reduce((t, v) => t + v, 0)
  const order = exact.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (const o of order) { if (left <= 0) break; floor[o.i] += 1; left -= 1 }
  return w.map((x, i) => ({ key: x.key, cents: sign * floor[i] }))
}

/** Percentages a person typed (two decimals allowed) as weights; null + the sentence when they are not a usable split of 100%. */
export function weightsFromPercents(rows: Array<{ key: PersonKey; percent: unknown }>): { weights: Weighted[] } | { problem: string } {
  if (!rows.length) return { problem: 'Add at least one person to split the tip between.' }
  const seen = new Set<string>()
  let sumBp = 0
  const out: Weighted[] = []
  for (const r of rows) {
    if (seen.has(r.key)) return { problem: 'Each person can appear once.' }
    seen.add(r.key)
    const n = typeof r.percent === 'string' && r.percent.trim() !== '' ? Number(r.percent) : r.percent
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) return { problem: 'Each share is a percent from 0 to 100.' }
    const bp = Math.round(n * 100)
    sumBp += bp
    out.push({ key: r.key, weight: bp })
  }
  if (sumBp !== 10000) return { problem: `The shares add up to ${(sumBp / 100).toFixed(2).replace(/\.00$/, '')}%, not 100%.` }
  return { weights: out.filter((x) => x.weight > 0) }
}
