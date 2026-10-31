// Retail sold, worked into money the owner can act on (salon row 13; Boulevard's retail sales and staff retail sales reports):
// what each line really brought in after the sale's discount and any refund, what the units cost, and the margin. Pure arithmetic, tested by hand.
//
//   net     = the line's price, less its share of the sale's discount, less the share of the sale that was refunded.
//   cost    = what one unit cost WHEN IT WAS SOLD × the units that stayed sold. Units the person put back on the shelf after a refund cost
//             nothing (they can be sold again); a refunded unit that was not put back stays a cost.
//   margin  = net − cost, counted only on lines whose cost is known; margin % is of that same net.
export interface SoldLine {
  /** null = a retail line typed by hand, not linked to a product: it has revenue but no brand, supplier or cost. */
  productId: string | null
  name: string
  brand: string | null
  category: string | null
  supplier: string | null
  sku: string | null
  qty: number
  /** The line's price × quantity, before the sale's discount. Dollars. */
  lineTotal: number
  /** The sale's subtotal, discount, total and refunded amounts. Dollars. */
  subtotal: number
  discount: number
  total: number
  amountRefunded: number
  /** Cents per unit when sold; null = no cost was entered. */
  unitCostCents: number | null
  /** Units of this product on this sale already put back on the shelf (shared by the sale's lines of the product, first line first). */
  returnedUnits: number
  who: { key: string; name: string }
}
export interface Priced { grossCents: number; discountCents: number; refundedCents: number; netCents: number; costCents: number | null; units: number }

export function priceLine(l: SoldLine): Priced {
  const grossCents = Math.round(l.lineTotal * 100)
  const factor = l.subtotal > 0 ? Math.max(0, (l.subtotal - l.discount) / l.subtotal) : 1
  const afterDiscount = Math.round(l.lineTotal * factor * 100)
  const ratio = l.total > 0 ? Math.min(1, Math.max(0, l.amountRefunded / l.total)) : 0
  const refundedCents = Math.round(afterDiscount * ratio)
  const kept = Math.max(0, l.qty - l.returnedUnits)
  return { grossCents, discountCents: grossCents - afterDiscount, refundedCents, netCents: afterDiscount - refundedCents, costCents: l.unitCostCents == null ? null : l.unitCostCents * kept, units: l.qty }
}

export interface Group { key: string; name: string; units: number; grossCents: number; discountCents: number; refundedCents: number; netCents: number; costCents: number; uncostedNetCents: number; marginCents: number | null; marginPercent: number | null }

/** Add priced lines into groups by whatever `by` names. Margin is on the costed part only; a group with nothing costed has no margin. */
export function group(lines: Array<SoldLine & { priced: Priced }>, by: (l: SoldLine) => { key: string; name: string }): Group[] {
  const out = new Map<string, Group>()
  for (const l of lines) {
    const k = by(l)
    const g = out.get(k.key) || { key: k.key, name: k.name, units: 0, grossCents: 0, discountCents: 0, refundedCents: 0, netCents: 0, costCents: 0, uncostedNetCents: 0, marginCents: null, marginPercent: null }
    const p = l.priced
    g.units += p.units; g.grossCents += p.grossCents; g.discountCents += p.discountCents; g.refundedCents += p.refundedCents; g.netCents += p.netCents
    if (p.costCents == null) g.uncostedNetCents += p.netCents; else g.costCents += p.costCents
    out.set(k.key, g)
  }
  return [...out.values()].map((g) => {
    const costedNet = g.netCents - g.uncostedNetCents
    const hasCost = costedNet !== 0 || g.costCents !== 0
    const margin = hasCost ? costedNet - g.costCents : null
    return { ...g, marginCents: margin, marginPercent: margin != null && costedNet > 0 ? Math.round((margin / costedNet) * 1000) / 10 : null }
  }).sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name))
}

export function totals(lines: Array<{ priced: Priced }>): Omit<Group, 'key' | 'name'> {
  const g = group(lines.map((l) => ({ ...(l as any), productId: null, name: 'all' })), () => ({ key: 'all', name: 'all' }))[0]
  if (!g) return { units: 0, grossCents: 0, discountCents: 0, refundedCents: 0, netCents: 0, costCents: 0, uncostedNetCents: 0, marginCents: null, marginPercent: null }
  const { key: _k, name: _n, ...rest } = g
  return rest
}
