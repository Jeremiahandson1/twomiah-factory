// A quote's optional lines and its deposit — the rules the quote routes, the customer's quote page (portal.ts) and the
// unified app's billing (apps/unified/server/crm/billing) all read, so the office, the customer and the invoice agree.
//
// OPTIONAL LINES (Jobber's and Housecall Pro's "optional items"). A line marked optional is offered, not included, until
// it is ticked — by the office on the quote page or by the customer on the quote's own link before approving. The
// quote's totals count a line only when it is included, and only included lines carry into the job and the invoice.
// A template whose quote_line_item has no `optional` column has none: every line is included, exactly as before.
//
// DEPOSIT. A quote may ask a deposit on approval: a percent of its total, or a fixed amount (never more than the total).
//
// PROPOSAL OPTIONS (Good / Better / Best — Roofr's multi-option proposals, a price guide). A quote may carry two to six
// options (quote_proposal_option), each with its own lines, a brand, a warranty, a few photos. The customer picks ONE on
// the quote's link and signs; the quote's price is the lines every option shares plus the chosen option's lines. An
// option's lines ARE optional lines (above) ticked together, so the totals, the job, the invoice and the billing count
// only the chosen option with no change of their own. Nothing here runs on a template whose tables have no such table.
import { and, asc, eq, isNotNull } from 'drizzle-orm'
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
  // A line of a proposal option goes with its option: the customer chooses the option, not its lines one by one.
  if (line.proposalOptionId) return { error: 'That line belongs to one of the options. Choose the option instead.', status: 400 }
  await db.update(t.quoteLineItem).set({ selected }).where(eq(t.quoteLineItem.id, lineItemId))
  const r = await retotalQuote(db, t, companyId, quoteId)
  return r ?? { error: 'Quote not found', status: 404 }
}

// ---------------------------------------------------------------------------------------------------------------------
// PROPOSAL OPTIONS

export const PROPOSAL_TIERS = ['good', 'better', 'best'] as const
export const MAX_PROPOSAL_OPTIONS = 6
export const MAX_OPTION_PHOTOS = 6

/** An image address a customer's page may show: the business's own /media files, or an https address. */
export const isPhotoAddress = (v: unknown): v is string => typeof v === 'string' && v.length <= 2000 && (/^https:\/\/[^\s"'<>]+$/i.test(v) || /^\/media\/[^\s"'<>]+$/.test(v))

/** Does this template have the proposal tables? (Its quote tables carry them only in the unified app.) */
export const hasProposalTables = (t: { quoteProposalOption?: any; quoteLineItem?: any }): boolean => !!t?.quoteProposalOption && !!t?.quoteLineItem?.proposalOptionId

export type ProposalOptionView = {
  id: string; name: string; tier: string | null; brand: string | null; warranty: string | null; description: string | null
  photos: string[]; recommended: boolean; chosen: boolean; sortOrder: number
  /** What the whole quote comes to if this is the option chosen: the shared lines plus this option's, tax and discount as the quote has them. */
  price: string; subtotal: string; taxAmount: string
  lines: any[]
}

/** A quote's options with their lines and the price of each — null when it has none. `quote` supplies the tax rate and discount. */
export async function proposalView(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption: any }, quote: { id: string; taxRate?: unknown; discount?: unknown }): Promise<{ options: ProposalOptionView[]; chosenOptionId: string | null; needsChoice: boolean } | null> {
  if (!hasProposalTables(t)) return null
  const options = await db.select().from(t.quoteProposalOption).where(eq(t.quoteProposalOption.quoteId, quote.id)).orderBy(asc(t.quoteProposalOption.sortOrder), asc(t.quoteProposalOption.id))
  if (!options.length) return null
  const lines = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quote.id)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
  const shared = lines.filter((l: any) => !l.proposalOptionId && isIncluded(l))
  const pricing = (extra: any[]) => calcTotals([...shared, ...extra].map((l: any) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })), Number(quote.taxRate) || 0, Number(quote.discount) || 0)
  const views: ProposalOptionView[] = options.map((o: any) => {
    const own = lines.filter((l: any) => l.proposalOptionId === o.id)
    const p = pricing(own)
    return {
      id: o.id, name: o.name, tier: o.tier ?? null, brand: o.brand ?? null, warranty: o.warranty ?? null, description: o.description ?? null,
      photos: Array.isArray(o.photos) ? o.photos.filter(isPhotoAddress) : [], recommended: !!o.recommended, chosen: !!o.chosen, sortOrder: o.sortOrder,
      price: p.total.toFixed(2), subtotal: p.subtotal.toFixed(2), taxAmount: p.taxAmount.toFixed(2), lines: own,
    }
  })
  const chosen = views.find((v) => v.chosen)
  return { options: views, chosenOptionId: chosen?.id ?? null, needsChoice: !chosen }
}

/** Has this quote options the customer has not yet picked from? A quote without options never needs a choice. */
export async function proposalNeedsChoice(db: any, t: { quoteProposalOption?: any }, quoteId: string): Promise<boolean> {
  if (!t?.quoteProposalOption) return false
  const rows = await db.select({ chosen: t.quoteProposalOption.chosen }).from(t.quoteProposalOption).where(eq(t.quoteProposalOption.quoteId, quoteId))
  return rows.length > 0 && !rows.some((r: any) => r.chosen)
}

export const CHOOSE_FIRST = 'Choose one of the options before you approve this quote.'

/**
 * Make one option the choice: its lines are ticked, every other option's lines are not, and the quote's totals are worked
 * out again. The caller has already decided the quote is open. Choosing again changes the choice.
 */
export async function chooseProposalOption(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption: any }, companyId: string, quoteId: string, optionId: unknown):
  Promise<{ error: string; status: 400 | 404 } | { quote: any; lineItems: any[] }> {
  if (!hasProposalTables(t)) return { error: 'This quote has no options.', status: 400 }
  if (typeof optionId !== 'string' || !optionId) return { error: 'Say which option.', status: 400 }
  const [opt] = await db.select().from(t.quoteProposalOption).where(and(eq(t.quoteProposalOption.id, optionId), eq(t.quoteProposalOption.quoteId, quoteId))).limit(1)
  if (!opt) return { error: 'That option is not on this quote.', status: 404 }
  const run = async (tx: any) => {
    await tx.update(t.quoteProposalOption).set({ chosen: false, chosenAt: null }).where(eq(t.quoteProposalOption.quoteId, quoteId))
    await tx.update(t.quoteProposalOption).set({ chosen: true, chosenAt: new Date() }).where(eq(t.quoteProposalOption.id, optionId))
    await tx.update(t.quoteLineItem).set({ selected: false }).where(and(eq(t.quoteLineItem.quoteId, quoteId), isNotNull(t.quoteLineItem.proposalOptionId)))
    await tx.update(t.quoteLineItem).set({ selected: true }).where(and(eq(t.quoteLineItem.quoteId, quoteId), eq(t.quoteLineItem.proposalOptionId, optionId)))
    return retotalQuote(tx, t, companyId, quoteId)
  }
  const r = typeof db.transaction === 'function' ? await db.transaction(run) : await run(db)
  return r ?? { error: 'Quote not found', status: 404 }
}
