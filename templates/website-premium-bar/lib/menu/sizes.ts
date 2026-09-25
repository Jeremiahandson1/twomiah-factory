/**
 * lib/menu/sizes.ts — an item's sizes and prices. OUR database owns the menu
 * (SYSTEM_DESIGN §0); Square only moves money.
 *
 * menu_items.variations holds [{ id, name, priceCents }]. `id` is ours and
 * stable (the size name slugged: 'sandwich', 'platter', '15-pieces'), so the
 * register, the grill pad and /order all say the same thing. Items seeded
 * before sizes existed get them parsed from the printed price label.
 */

export interface Size { id: string; name: string; priceCents: number | null }

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'item'
}

const AMOUNT = /\$\s*(\d+(?:\.\d{1,2})?)/g
const cents = (s: string) => Math.round(Number(s) * 100)
const size = (name: string, priceCents: number | null): Size => ({ id: slugify(name), name, priceCents })

function pairNames(sectionDescription: string | null | undefined): [string, string] {
  const m = /\b(sandwich|burger)\s*\/\s*platter\b/i.exec(sectionDescription || '')
  return m ? [m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), 'Platter'] : ['Regular', 'Large']
}

/**
 * The printed label → sizes.
 *   "$5.79 / $7.29"              (section says "Sandwich / platter") → Sandwich 579, Platter 729
 *   "Tuesdays · $7.49 / $9.09"   → the same; "Tuesdays" carries no price
 *   "15 / $7.99 · 20 / $10.39"   → "15 pieces" 799, "20 pieces" 1039
 *   no label, priceCents 949     → Regular 949
 *   nothing                      → Regular with no price (the register asks)
 */
export function sizesFromLabel(priceCents: number | null | undefined, priceLabel: string | null | undefined, sectionDescription?: string | null): Size[] {
  const label = (priceLabel || '').trim()
  const out: Size[] = []
  for (const part of label.split('·').map(p => p.trim()).filter(Boolean)) {
    const amounts = [...part.matchAll(AMOUNT)].map(m => cents(m[1]))
    if (!amounts.length) continue
    if (amounts.length >= 2) {
      const [a, b] = pairNames(sectionDescription)
      out.push(size(a, amounts[0]), size(b, amounts[1]))
      continue
    }
    const name = part.replace(AMOUNT, '').replace(/[\/:]/g, ' ').replace(/\s+/g, ' ').trim()
    out.push(size(!name ? 'Regular' : /^\d+$/.test(name) ? `${name} pieces` : name, amounts[0]))
  }
  if (!out.length) out.push(size('Regular', typeof priceCents === 'number' ? priceCents : null))
  return out
}

/** An item's sizes: what's stored, else parsed from its label. Always at least one. */
export function sizesOf(item: { variations?: unknown; priceCents: number | null; priceLabel: string | null }, sectionDescription?: string | null): Size[] {
  const stored = Array.isArray(item.variations) ? (item.variations as any[]).filter(v => v && typeof v.name === 'string') : []
  if (stored.length) return stored.map(v => ({ id: String(v.id || slugify(v.name)), name: v.name, priceCents: typeof v.priceCents === 'number' ? v.priceCents : null }))
  return sizesFromLabel(item.priceCents, item.priceLabel, sectionDescription)
}

// Size names the section description already explains ("Sandwich / platter"), so the price column can stay short.
const PLAIN = /^(regular|sandwich|burger|platter|basket|dinner|small|large|single|double)$/i

/** The printed price for a set of sizes. One price → null (the price column shows it). */
export function labelFromSizes(sizes: Size[]): string | null {
  const priced = sizes.filter(v => typeof v.priceCents === 'number')
  if (priced.length <= 1) return null
  const money = (c: number) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`)
  if (priced.every(v => PLAIN.test(v.name.trim()))) return priced.map(v => money(v.priceCents as number)).join(' / ')
  return priced.map(v => `${v.name} ${money(v.priceCents as number)}`).join(' · ')
}

// ─── Tax ──────────────────────────────────────────────────────────────────
/** Sales tax on a subtotal, rate in basis points (550 = 5.5%), rounded half-up to the cent. */
export function taxOn(subtotalCents: number, rateBps: number): number {
  return Math.floor((subtotalCents * rateBps + 5000) / 10000)   // integer math: no float drift at the half cent
}
