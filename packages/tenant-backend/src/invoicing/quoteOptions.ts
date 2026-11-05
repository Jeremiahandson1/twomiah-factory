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
// Every trade with quotes has them (one feature, `quote_proposals`): the deposit follows the option chosen (each option shows
// its own), a deposit bigger than the cheapest option is refused, and the office may choose for a customer who says so by phone.
//
// UPGRADES AND A DISCOUNT PER OPTION (Roofr). An option may carry UPGRADES: add-on lines (option_role = 'upgrade') that belong to
// that one option. Choosing the option does not tick them; once the option is chosen the customer ticks the ones they want,
// and the totals, the job, the invoice and the signature count only the ticked ones. Choosing another option clears them.
// An option may also carry ONE DISCOUNT (a fixed amount in cents, or a percent of the option's price before its upgrades),
// taken off while that option is the one chosen. The quote keeps it apart (quote.option_discount) from the discount the
// office typed, and quote.discount is the two together, so the invoice, the page and the PDF agree with the total.
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
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

export const UPGRADE = 'upgrade'
/** Do this template's quote tables carry the per-option discount and the upgrade role (the unified app's, migration 0061)? */
export const hasOptionDiscounts = (t: { quote?: any; quoteLineItem?: any }): boolean => !!t?.quote?.optionDiscount && !!t?.quoteLineItem?.optionRole

/** What an option's discount takes off, in dollars: its fixed amount or its percent of `basis`, never more than `basis`. */
export function optionDiscountDollars(opt: { discountCents?: unknown; discountPercent?: unknown } | null | undefined, basis: number): number {
  const cents = Math.max(0, Math.round(Number(opt?.discountCents) || 0))
  const pct = Math.min(100, Math.max(0, Number(opt?.discountPercent) || 0))
  const raw = cents > 0 ? cents / 100 : round2(basis * pct / 100)
  return round2(Math.max(0, Math.min(raw, basis)))
}
/** The price a discount works on: the lines counted for the option before its upgrades, as a dollar subtotal. */
export const optionBasis = (lines: Array<{ quantity: unknown; unitPrice: unknown }>): number =>
  round2(lines.reduce((s, l) => s + Math.max(0, Number(l.quantity) || 0) * Math.max(0, Number(l.unitPrice) || 0), 0))

/**
 * Work a quote's totals out again from its included lines — after a line is ticked or unticked — and store them.
 * `db` may be a transaction. Tax and discount stay the quote's; the discount applied never exceeds what is included
 * (calcTotals' rule), so unticking lines can never take the total below zero.
 */
export async function retotalQuote(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption?: any }, companyId: string, quoteId: string, opts: { baseDiscount?: number } = {}) {
  const [q] = await db.select().from(t.quote).where(and(eq(t.quote.id, quoteId), eq(t.quote.companyId, companyId))).limit(1)
  if (!q) return null
  const lines = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quoteId)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
  const counted = includedLines(lines).map((l: any) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }))
  // The discount the office typed, and the chosen option's own on top of it.
  const base = opts.baseDiscount ?? Math.max(0, round2(Number(q.discount) - Number(q.optionDiscount || 0)))
  let optionDisc = 0
  if (hasOptionDiscounts(t) && t.quoteProposalOption) {
    const [chosen] = await db.select().from(t.quoteProposalOption).where(and(eq(t.quoteProposalOption.quoteId, quoteId), eq(t.quoteProposalOption.chosen, true))).limit(1)
    if (chosen) optionDisc = optionDiscountDollars(chosen, optionBasis(lines.filter((l: any) => (!l.proposalOptionId ? isIncluded(l) : l.proposalOptionId === chosen.id && l.optionRole !== UPGRADE))))
  }
  const calc = calcTotals(counted, Number(q.taxRate), base + optionDisc)
  const set: any = { subtotal: calc.subtotal.toString(), taxAmount: calc.taxAmount.toString(), total: calc.total.toString(), updatedAt: new Date() }
  if (hasOptionDiscounts(t)) {
    set.discount = calc.effectiveDiscount.toString()
    set.optionDiscount = round2(Math.min(optionDisc, calc.effectiveDiscount)).toString()
  }
  const [updated] = await db.update(t.quote).set(set).where(and(eq(t.quote.id, quoteId), eq(t.quote.companyId, companyId))).returning()
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
  if (line.proposalOptionId) return { error: line.optionRole === UPGRADE ? 'That is an upgrade of one of the options. Tick it with the option\'s upgrades.' : 'That line belongs to one of the options. Choose the option instead.', status: 400 }
  await db.update(t.quoteLineItem).set({ selected }).where(eq(t.quoteLineItem.id, lineItemId))
  const r = await retotalQuote(db, t, companyId, quoteId)
  return r ?? { error: 'Quote not found', status: 404 }
}

// ---------------------------------------------------------------------------------------------------------------------
// PROPOSAL OPTIONS

export const PROPOSAL_TIERS = ['good', 'better', 'best'] as const
export const MAX_PROPOSAL_OPTIONS = 6
export const MAX_OPTION_PHOTOS = 6
export const MAX_OPTION_UPGRADES = 12

/** An image address a customer's page may show: the business's own /media files, or an https address. */
export const isPhotoAddress = (v: unknown): v is string => typeof v === 'string' && v.length <= 2000 && (/^https:\/\/[^\s"'<>]+$/i.test(v) || /^\/media\/[^\s"'<>]+$/.test(v))

/** Does this template have the proposal tables? (Its quote tables carry them only in the unified app.) */
export const hasProposalTables = (t: { quoteProposalOption?: any; quoteLineItem?: any }): boolean => !!t?.quoteProposalOption && !!t?.quoteLineItem?.proposalOptionId

/**
 * THE rule for whether a business has proposal options at all: the tables are there AND its `quote_proposals` switch is on
 * (`enabled` is the app's feature question; none given = a template, which has no switch). The office's routes (quotes.ts),
 * the customer's pages and the customer's pick (portal.ts) all ask this and nothing else, so with the switch off a quote
 * behaves exactly as it did before options existed.
 */
export async function proposalsLive(t: { quoteProposalOption?: any; quoteLineItem?: any }, enabled: ((companyId: string) => Promise<boolean> | boolean) | undefined, companyId: string): Promise<boolean> {
  return hasProposalTables(t) && (enabled ? !!(await enabled(companyId)) : true)
}

export type ProposalOptionView = {
  id: string; name: string; tier: string | null; brand: string | null; warranty: string | null; description: string | null
  photos: string[]; recommended: boolean; chosen: boolean; sortOrder: number
  /** Files attached to this option (a manufacturer's brochure): [{ name, url }]. */
  attachments: Array<{ name: string; url: string }>
  /** What the whole quote comes to if this is the option chosen: the shared lines plus this option's, tax and discount as the quote has them. */
  price: string; subtotal: string; taxAmount: string
  /** The deposit the quote asks if this is the option chosen ('0.00' when it asks none). */
  deposit: string
  /** The option's own discount: what it takes off ('0.00' when none), and how it was set (cents, or a percent of the price before upgrades). */
  discount: string; discountCents: number; discountPercent: number
  /** The option's own lines, and its upgrades (add-ons the customer ticks once this option is chosen). */
  lines: any[]
  upgrades: any[]
}

/**
 * What the whole quote comes to under each option: `shared` (the lines every option shares, as counted) plus that option's lines,
 * less the discount typed on the quote (`discount`) and the option's own (`optionDiscounts`, by option id). Upgrades are not part of
 * an option's price until they are ticked, so they are left out here.
 */
export function optionPrices(shared: Array<{ quantity: unknown; unitPrice: unknown }>, optionLines: Array<{ proposalOptionId?: string | null; optionRole?: string | null; quantity: unknown; unitPrice: unknown }>, taxRate: unknown, discount: unknown, optionDiscounts?: Map<string, { discountCents?: unknown; discountPercent?: unknown }>): Map<string, ReturnType<typeof calcTotals>> {
  const out = new Map<string, ReturnType<typeof calcTotals>>()
  const ids = [...new Set(optionLines.map((l) => l.proposalOptionId).filter((x): x is string => !!x))]
  for (const id of ids) {
    const own = optionLines.filter((l) => l.proposalOptionId === id && l.optionRole !== UPGRADE)
    const all = [...shared, ...own].map((l) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }))
    const od = optionDiscountDollars(optionDiscounts?.get(id), optionBasis(all))
    out.set(id, calcTotals(all, Number(taxRate) || 0, (Number(discount) || 0) + od))
  }
  return out
}

/** The cheapest option's whole price — the most a deposit may be while any option can still be the one chosen — or null without options. */
export const cheapestOption = (prices: Map<string, { total: number }>): number | null => (prices.size ? Math.min(...[...prices.values()].map((p) => p.total)) : null)

/** A quote's options with their lines and the price of each — null when it has none. `quote` supplies the tax rate, discount and deposit. */
export async function proposalView(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption?: any }, quote: { id: string; taxRate?: unknown; discount?: unknown; optionDiscount?: unknown; depositType?: string | null; depositValue?: unknown }): Promise<{ options: ProposalOptionView[]; chosenOptionId: string | null; needsChoice: boolean } | null> {
  if (!hasProposalTables(t)) return null
  const options = await db.select().from(t.quoteProposalOption).where(eq(t.quoteProposalOption.quoteId, quote.id)).orderBy(asc(t.quoteProposalOption.sortOrder), asc(t.quoteProposalOption.id))
  if (!options.length) return null
  const lines = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quote.id)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
  const shared = lines.filter((l: any) => !l.proposalOptionId && isIncluded(l))
  // The discount the office typed on the quote; the chosen option's own is part of the stored one (quote.option_discount).
  const baseDiscount = Math.max(0, round2((Number(quote.discount) || 0) - (Number(quote.optionDiscount) || 0)))
  const views: ProposalOptionView[] = options.map((o: any) => {
    const mine = lines.filter((l: any) => l.proposalOptionId === o.id)
    const own = mine.filter((l: any) => l.optionRole !== UPGRADE)
    const upgrades = mine.filter((l: any) => l.optionRole === UPGRADE)
    const toIn = (l: any) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })
    const before = [...shared, ...own].map(toIn)
    const disc = optionDiscountDollars(o, optionBasis(before))
    // A chosen option is priced with the upgrades the customer ticked; an option not chosen has none.
    const counted = [...before, ...(o.chosen ? upgrades.filter(isIncluded).map(toIn) : [])]
    const p = calcTotals(counted, Number(quote.taxRate) || 0, baseDiscount + disc)
    return {
      id: o.id, name: o.name, tier: o.tier ?? null, brand: o.brand ?? null, warranty: o.warranty ?? null, description: o.description ?? null,
      photos: Array.isArray(o.photos) ? o.photos.filter(isPhotoAddress) : [], recommended: !!o.recommended, chosen: !!o.chosen, sortOrder: o.sortOrder,
      attachments: Array.isArray(o.attachments) ? o.attachments.filter((a: any) => a && typeof a.name === 'string' && isPhotoAddress(a.url)).map((a: any) => ({ name: a.name, url: a.url })) : [],
      price: p.total.toFixed(2), subtotal: p.subtotal.toFixed(2), taxAmount: p.taxAmount.toFixed(2),
      deposit: depositAmount({ depositType: quote.depositType, depositValue: quote.depositValue, total: p.total }).toFixed(2),
      discount: disc.toFixed(2), discountCents: Number(o.discountCents) || 0, discountPercent: Number(o.discountPercent) || 0, lines: own, upgrades,
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
/** The code a refusal for want of a choice carries, so a screen can open the options instead of showing an error. */
export const CHOOSE_FIRST_CODE = 'option_required'

/**
 * Make one option the choice: its lines are ticked, every other option's lines are not, and the quote's totals are worked
 * out again. The caller has already decided the quote is open. Choosing again changes the choice.
 */
export async function chooseProposalOption(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption?: any }, companyId: string, quoteId: string, optionId: unknown):
  Promise<{ error: string; status: 400 | 404 } | { quote: any; lineItems: any[] }> {
  if (!hasProposalTables(t)) return { error: 'This quote has no options.', status: 400 }
  if (typeof optionId !== 'string' || !optionId) return { error: 'Say which option.', status: 400 }
  const [opt] = await db.select().from(t.quoteProposalOption).where(and(eq(t.quoteProposalOption.id, optionId), eq(t.quoteProposalOption.quoteId, quoteId))).limit(1)
  if (!opt) return { error: 'That option is not on this quote.', status: 404 }
  const run = async (tx: any) => {
    await tx.update(t.quoteProposalOption).set({ chosen: false, chosenAt: null }).where(eq(t.quoteProposalOption.quoteId, quoteId))
    await tx.update(t.quoteProposalOption).set({ chosen: true, chosenAt: new Date() }).where(eq(t.quoteProposalOption.id, optionId))
    await tx.update(t.quoteLineItem).set({ selected: false }).where(and(eq(t.quoteLineItem.quoteId, quoteId), isNotNull(t.quoteLineItem.proposalOptionId)))
    // The option's own lines are ticked; its upgrades wait for the customer to tick them, one by one.
    await tx.update(t.quoteLineItem).set({ selected: true }).where(and(eq(t.quoteLineItem.quoteId, quoteId), eq(t.quoteLineItem.proposalOptionId, optionId), t.quoteLineItem.optionRole ? isNull(t.quoteLineItem.optionRole) : undefined))
    return retotalQuote(tx, t, companyId, quoteId)
  }
  const r = typeof db.transaction === 'function' ? await db.transaction(run) : await run(db)
  return r ?? { error: 'Quote not found', status: 404 }
}

/**
 * Tick or untick one UPGRADE of the option the customer chose, and work the totals out again. The customer chooses the option
 * first: an upgrade of an option that is not the chosen one, or before any is chosen, is refused. The caller has already decided
 * the quote is open.
 */
export async function chooseOptionUpgrade(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption?: any }, companyId: string, quoteId: string, lineItemId: unknown, selected: unknown):
  Promise<{ error: string; status: 400 | 404 } | { quote: any; lineItems: any[] }> {
  if (!hasProposalTables(t) || !t.quoteLineItem?.optionRole) return { error: 'This quote has no options.', status: 400 }
  if (typeof lineItemId !== 'string' || !lineItemId) return { error: 'Say which upgrade.', status: 400 }
  if (typeof selected !== 'boolean') return { error: 'Say whether the upgrade is included (selected: true or false).', status: 400 }
  const [line] = await db.select().from(t.quoteLineItem).where(and(eq(t.quoteLineItem.id, lineItemId), eq(t.quoteLineItem.quoteId, quoteId))).limit(1)
  if (!line || line.optionRole !== UPGRADE || !line.proposalOptionId) return { error: 'That upgrade is not on this quote.', status: 404 }
  const [opt] = await db.select().from(t.quoteProposalOption).where(eq(t.quoteProposalOption.id, line.proposalOptionId)).limit(1)
  const [anyChosen] = await db.select({ id: t.quoteProposalOption.id }).from(t.quoteProposalOption).where(and(eq(t.quoteProposalOption.quoteId, quoteId), eq(t.quoteProposalOption.chosen, true))).limit(1)
  if (!anyChosen) return { error: 'Choose an option first; its upgrades are offered after that.', status: 400 }
  if (!opt?.chosen) return { error: 'That upgrade belongs to an option you did not choose.', status: 400 }
  await db.update(t.quoteLineItem).set({ selected }).where(eq(t.quoteLineItem.id, lineItemId))
  const r = await retotalQuote(db, t, companyId, quoteId)
  return r ?? { error: 'Quote not found', status: 404 }
}
