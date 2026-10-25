// A quote's optional lines and its deposit — the rules the quote routes, the customer's quote page (portal.ts) and the
// unified app's billing (apps/unified/server/crm/billing) all read, so the office, the customer and the invoice agree.
//
// OPTIONAL LINES (Jobber's and Housecall Pro's "optional items"). A line marked optional is offered, not included, until
// it is ticked — by the office on the quote page or by the customer on the quote's own link before approving. The
// quote's totals count a line only when it is included, and only included lines carry into the job and the invoice.
// A template whose quote_line_item has no `optional` column has none: every line is included, exactly as before.
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
