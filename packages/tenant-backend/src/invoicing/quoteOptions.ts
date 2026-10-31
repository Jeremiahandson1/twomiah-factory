// A quote's optional lines and its deposit — the rules the quote routes, the customer's quote page (portal.ts) and the
// unified app's billing (apps/unified/server/crm/billing) all read, so the office, the customer and the invoice agree.
//
// OPTIONAL LINES (Jobber's and Housecall Pro's "optional items"). A line marked optional is offered, not included, until
// it is ticked — by the office on the quote page or by the customer on the quote's own link before approving. The
// quote's totals count a line only when it is included, and only included lines carry into the job and the invoice.
// A template whose quote_line_item has no `optional` column has none: every line is included, exactly as before.
//
// OPTIONS (good / better / best). Lines that share an `optionGroup` name are one alternative; a quote with two or more such names
// is a choice. Exactly one option is picked — by the customer on the quote's link before signing, or by the office — and then only
// that option's lines count, with the quote's own non-option lines; the totals, the signed document, the job, the invoice and the
// deposit all follow what was picked. A quote whose lines have no option name is unchanged. An option line is optional by definition,
// so the one rule above (`isIncluded`) still decides what counts.
//
// DEPOSIT. A quote may ask a deposit on approval: a percent of its total, or a fixed amount (never more than the total).
import { and, asc, eq } from 'drizzle-orm'
import { calcTotals, round2 } from './money'

/** Is this line in the quote's price? A line not marked optional always is; an optional one once it is ticked. */
export const isIncluded = (line: { optional?: boolean | null; selected?: boolean | null }): boolean => !line?.optional || !!line?.selected

/** The lines a quote's price, its job and its invoice are made of. */
export const includedLines = <T extends { optional?: boolean | null; selected?: boolean | null }>(lines: T[]): T[] => (lines || []).filter(isIncluded)

export type DepositType = 'percent' | 'fixed'

/** The deposit a quote asks, in dollars: a percent of its total, or the fixed amount (never more than the total). */
export function depositAmount(q: { depositType?: string | null; depositValue?: unknown; total?: unknown }): number {
  const total = Number(q?.total) || 0
  const v = Number(q?.depositValue) || 0
  if (!q?.depositType || v <= 0 || total <= 0) return 0
  if (q.depositType === 'percent') return round2(Math.min(total, total * Math.min(v, 100) / 100))
  if (q.depositType === 'fixed') return round2(Math.min(v, total))
  return 0
}

/** Why this deposit cannot be asked — or null. `total` is the quote's total as it will stand. */
export function depositProblem(type: unknown, value: unknown, total: number): string | null {
  if (type === null || type === undefined || type === '') return null
  if (type !== 'percent' && type !== 'fixed') return 'A deposit is a percent of the total or a fixed amount.'
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return 'Enter the deposit: more than zero.'
  if (round2(v) === 0) return 'The deposit rounds to nothing — enter at least $0.01.'
  if (type === 'percent' && v > 100) return 'A deposit cannot be more than 100% of the total.'
  if (type === 'fixed' && round2(v) > round2(total) + 0.005) return 'The deposit cannot be more than the quote total.'
  return null
}

/**
 * Work a quote's totals out again from its included lines — after a line is ticked or unticked — and store them.
 * `db` may be a transaction. Tax and discount stay the quote's; the discount applied never exceeds what is included
 * (calcTotals' rule), so unticking lines can never take the total below zero.
 */
export async function retotalQuote(db: any, t: { quote: any; quoteLineItem: any }, companyId: string, quoteId: string) {
  const [q] = await db.select().from(t.quote).where(and(eq(t.quote.id, quoteId), eq(t.quote.companyId, companyId))).limit(1)
  if (!q) return null
  const lines = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quoteId)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
  const calc = calcTotals(includedLines(lines).map((l: any) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })), Number(q.taxRate), Number(q.discount))
  const [updated] = await db.update(t.quote).set({ subtotal: calc.subtotal.toString(), taxAmount: calc.taxAmount.toString(), total: calc.total.toString(), updatedAt: new Date() })
    .where(and(eq(t.quote.id, quoteId), eq(t.quote.companyId, companyId))).returning()
  return { quote: updated, lineItems: lines }
}

/**
 * Tick or untick one optional line and work the totals out again. Refuses a line that is not optional (a quote's own
 * lines are not the customer's to remove) or not on this quote. The caller has already decided the quote is open.
 */
export async function chooseOptionalLine(db: any, t: { quote: any; quoteLineItem: any }, companyId: string, quoteId: string, lineItemId: unknown, selected: unknown):
  Promise<{ error: string; status: 400 | 404 } | { quote: any; lineItems: any[] }> {
  if (typeof lineItemId !== 'string' || !lineItemId) return { error: 'Say which line.', status: 400 }
  if (typeof selected !== 'boolean') return { error: 'Say whether the line is included (selected: true or false).', status: 400 }
  if (!t.quoteLineItem?.optional) return { error: 'This quote has no optional lines.', status: 400 }
  const [line] = await db.select().from(t.quoteLineItem).where(and(eq(t.quoteLineItem.id, lineItemId), eq(t.quoteLineItem.quoteId, quoteId))).limit(1)
  if (!line) return { error: 'That line is not on this quote.', status: 404 }
  if (!line.optional) return { error: 'Only an optional line can be ticked or unticked.', status: 400 }
  await db.update(t.quoteLineItem).set({ selected }).where(eq(t.quoteLineItem.id, lineItemId))
  const r = await retotalQuote(db, t, companyId, quoteId)
  return r ?? { error: 'Quote not found', status: 404 }
}

// ── good / better / best ────────────────────────────────────────────────────────────────────────────────────────────

/** The option names on a quote's lines, in the order they first appear. */
export const optionNames = (lines: Array<{ optionGroup?: string | null }>): string[] => {
  const seen: string[] = []
  for (const l of lines || []) if (l?.optionGroup && !seen.includes(l.optionGroup)) seen.push(l.optionGroup)
  return seen
}
/** Is this quote a choice between options? Two or more names. */
export const hasOptions = (lines: Array<{ optionGroup?: string | null }>): boolean => optionNames(lines).length >= 2

/** The option that is picked now, or null. */
export const pickedOption = (lines: Array<{ optionGroup?: string | null; selected?: boolean | null }>): string | null =>
  optionNames(lines).find((n) => lines.some((l) => l.optionGroup === n && l.selected)) ?? null

/** Why this quote cannot be signed or approved yet for want of a choice — or null. */
export const optionChoiceProblem = (lines: Array<{ optionGroup?: string | null; selected?: boolean | null }>): string | null =>
  hasOptions(lines) && !pickedOption(lines) ? `Choose one of the options first: ${optionNames(lines).join(', ')}.` : null

/** Why these lines, as the office wrote them, are not a valid set of options — or null. */
export function optionLinesProblem(lines: Array<{ optionGroup?: string | null; selected?: boolean | null; optional?: boolean | null }>): string | null {
  const names = optionNames(lines)
  if (names.length === 0) return null
  if (names.length < 2) return 'A choice needs at least two options (for example Good and Better). Give the lines two option names, or clear the option name.'
  if (names.length > 5) return 'At most five options.'
  const picked = names.filter((n) => lines.some((l) => l.optionGroup === n && l.selected))
  if (picked.length > 1) return 'Only one option can be chosen at a time.'
  return null
}

/** What the quote would cost under each option: the non-option lines plus that option's lines, with the quote's tax and discount. */
export function optionTotals(lines: Array<{ optionGroup?: string | null; optional?: boolean | null; selected?: boolean | null; quantity: unknown; unitPrice: unknown }>, taxRate: unknown, discount: unknown) {
  return optionNames(lines).map((name) => {
    const counted = lines.filter((l) => (l.optionGroup ? l.optionGroup === name : isIncluded(l)))
      .map((l) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }))
    const calc = calcTotals(counted, Number(taxRate), Number(discount))
    return { name, subtotal: calc.subtotal, taxAmount: calc.taxAmount, total: calc.total }
  })
}

/**
 * Pick one option: its lines are ticked, the other options' lines are not, and the totals are worked out again. The caller has
 * decided the quote is open. Refuses a name the quote does not have.
 */
export async function chooseOptionGroup(db: any, t: { quote: any; quoteLineItem: any }, companyId: string, quoteId: string, group: unknown):
  Promise<{ error: string; status: 400 | 404 } | { quote: any; lineItems: any[] }> {
  if (!t.quoteLineItem?.optionGroup) return { error: 'This quote has no options.', status: 400 }
  if (typeof group !== 'string' || !group) return { error: 'Say which option.', status: 400 }
  const [q] = await db.select().from(t.quote).where(and(eq(t.quote.id, quoteId), eq(t.quote.companyId, companyId))).limit(1)
  if (!q) return { error: 'Quote not found', status: 404 }
  const lines = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quoteId))
  if (!optionNames(lines).includes(group)) return { error: `This quote has no option called “${group}”.`, status: 404 }
  for (const l of lines) if (l.optionGroup) await db.update(t.quoteLineItem).set({ selected: l.optionGroup === group }).where(eq(t.quoteLineItem.id, l.id))
  const r = await retotalQuote(db, t, companyId, quoteId)
  return r ?? { error: 'Quote not found', status: 404 }
}
