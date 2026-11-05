// Default markup by kind of line, and the live margin a quote shows while it is built (features markup_defaults, quote_line_images).
// Pure arithmetic on the form's lines, so what the screen shows is what these functions say. The server never prices a quote from a
// default: the form fills the markup (visibly, in the line's Markup column) and the price, and the quote saves the lines as sent.
import type { LineItemInput } from './types'

export type MarkupDefaults = Partial<Record<NonNullable<LineItemInput['type']>, number | null>>
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10

/**
 * The line after an edit, with the company's usual markup for its kind filled in where the person has not priced it themselves:
 *   · a cost and a kind, no markup and no price typed → the kind's markup, and the price it makes;
 *   · the kind changed on a line whose markup was the OLD kind's usual one → the new kind's usual markup.
 * A price typed by hand, or a markup the person changed, is never overwritten.
 */
export function applyDefaultMarkup(prev: LineItemInput, next: LineItemInput, defaults?: MarkupDefaults | null): LineItemInput {
  if (!defaults || !next.type || next.unitCost === undefined || next.unitCost === null) return next
  const want = defaults[next.type]
  if (want === null || want === undefined) return next
  const untouched = next.markupPct === undefined && !(Number(next.unitPrice) > 0)
  const oldWant = prev.type ? defaults[prev.type] : null
  const wasDefault = prev.type !== next.type && next.markupPct !== undefined && oldWant !== null && oldWant !== undefined && next.markupPct === oldWant
  if (!untouched && !wasDefault) return next
  return { ...next, markupPct: want, unitPrice: round2(next.unitCost * (1 + want / 100)) }
}

/** One line's margin: the share of the price that is ours to keep (markup 25% is a margin of 20%). Null while it has no cost or no price. */
export function lineMargin(li: Pick<LineItemInput, 'unitCost' | 'unitPrice'>): number | null {
  if (li.unitCost === undefined || li.unitCost === null) return null
  const price = Number(li.unitPrice) || 0
  if (!(price > 0)) return null
  return round1(((price - li.unitCost) / price) * 100)
}

/** The quote's margin over the lines that have a cost; says how many have none, so a thin figure is not read as the whole quote. */
export function quoteMargin(lines: Array<Pick<LineItemInput, 'quantity' | 'unitCost' | 'unitPrice'> & { description?: string }>) {
  let cost = 0, price = 0, uncosted = 0
  for (const li of lines) {
    if (li.description !== undefined && !String(li.description).trim()) continue
    const qty = Number(li.quantity) || 0
    if (li.unitCost === undefined || li.unitCost === null) { if (qty > 0 && Number(li.unitPrice) > 0) uncosted++; continue }
    cost += qty * li.unitCost
    price += qty * (Number(li.unitPrice) || 0)
  }
  cost = round2(cost); price = round2(price)
  const profit = round2(price - cost)
  return { cost, price, profit, margin: price > 0 ? round1((profit / price) * 100) : null, uncosted }
}
