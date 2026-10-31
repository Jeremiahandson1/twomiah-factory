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
// PROPOSAL OPTIONS (Good / Better / Best — Roofr's multi-option proposals, a price guide). A quote may carry options
// (quote_proposal_option), each with its own lines, a brand, a warranty, a few photos, in up to three SETS: a pick-one set
// (the customer picks exactly one — Good / Better / Best) or an additive set (any number — add-ons). The customer picks on
// the quote's link and signs; the quote's price is the lines every option shares plus the lines of every option picked. An
// option's lines ARE optional lines (above) ticked together, so the totals, the job, the invoice and the billing count
// only the options picked with no change of their own. Nothing here runs on a template whose tables have no such table.
// Every trade with quotes has them (one feature, `quote_proposals`): the deposit follows the options picked (each option shows
// its own), a deposit bigger than the cheapest pick is refused, and the office may choose for a customer who says so by phone.
import { and, asc, eq, inArray } from 'drizzle-orm'
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
// PROPOSAL OPTIONS, IN SETS
//
// A quote's options sit in up to three SETS (Jobber: up to three sets, 2–5 choices each). A set has a name the customer
// sees ("Furnace", "Thermostat") and a kind: 'one' — the customer picks exactly one of it (Good / Better / Best) — or
// 'any' — additive (Housecall Pro "approve more than one option", ServiceTitan additive options): the customer takes any
// number of them, none included. The quote's price is the lines every option shares plus the lines of every option picked,
// across every set; the deposit, the signed fingerprint, the PDF, the invoice and the job follow every pick, because an
// option's lines are optional lines ticked while it is picked. A quote with one set and no name is what it always was.

export const PROPOSAL_TIERS = ['good', 'better', 'best'] as const
/** The most options one set holds (Jobber allows five; six keeps every quote already written). */
export const MAX_PROPOSAL_OPTIONS = 6
export const MAX_PROPOSAL_SETS = 3
export const SET_KINDS = ['one', 'any'] as const
export type SetKind = (typeof SET_KINDS)[number]
export const MAX_OPTION_PHOTOS = 6

/** A set's kind as stored: anything but 'any' is a pick-one set (every option written before sets had a kind). */
export const setKindOf = (v: unknown): SetKind => (v === 'any' ? 'any' : 'one')
/** What the customer sees above a set: its name, or "Options" on a quote's only set, else "Options 1, 2, 3". */
export const setNameOf = (name: unknown, index: number, setCount: number): string =>
  (typeof name === 'string' && name.trim()) ? name.trim() : setCount > 1 ? `Options ${index + 1}` : 'Options'

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

type Priced = { quantity: unknown; unitPrice: unknown; taxable?: boolean | null }
type OptionLine = Priced & { proposalOptionId?: string | null }
/** What the pricing needs to know of an option row: which set it is in, the set's kind, and whether it is picked now. */
export type OptionRow = { id: string; setIndex?: number | null; setKind?: string | null; chosen?: boolean | null }
type Totals = ReturnType<typeof calcTotals>

const toPriced = (l: Priced) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), ...(l.taxable === false ? { taxable: false } : {}) })
/** The quote's whole price with the options in `taken` picked: the shared lines plus theirs, tax and discount as the quote has them. */
const priceWith = (shared: Priced[], optionLines: OptionLine[], taken: Set<string>, taxRate: unknown, discount: unknown): Totals =>
  calcTotals([...shared, ...optionLines.filter((l) => !!l.proposalOptionId && taken.has(l.proposalOptionId))].map(toPriced), Number(taxRate) || 0, Number(discount) || 0)

/**
 * Which options count in the price shown for `optionId`: in its own set, this option alone (pick one) or the set's picks
 * plus it (additive); in every other set, whatever is picked there. So each price is "what the quote comes to if you take
 * this, with what you have picked elsewhere" — on a quote with one pick-one set, the whole job with that option, as before.
 */
export function takenWith(options: OptionRow[], optionId: string): Set<string> {
  const me = options.find((o) => o.id === optionId)
  const out = new Set<string>()
  for (const o of options) {
    if (me && (o.setIndex ?? 0) === (me.setIndex ?? 0)) {
      if (setKindOf(me.setKind) === 'one' ? o.id === me.id : (o.chosen || o.id === me.id)) out.add(o.id)
    } else if (o.chosen) out.add(o.id)
  }
  return out
}

/**
 * What the quote comes to under each option (`takenWith`), and what that option ADDS: the difference between the price with
 * it and the price without it, discount and tax included — what an additive option costs the customer to tick.
 */
export function optionPrices(shared: Priced[], optionLines: OptionLine[], options: OptionRow[], taxRate: unknown, discount: unknown): Map<string, Totals & { add: number }> {
  const out = new Map<string, Totals & { add: number }>()
  for (const o of options) {
    const taken = takenWith(options, o.id)
    const withIt = priceWith(shared, optionLines, taken, taxRate, discount)
    taken.delete(o.id)
    const without = priceWith(shared, optionLines, taken, taxRate, discount)
    out.set(o.id, { ...withIt, add: round2(withIt.total - without.total) })
  }
  return out
}

/**
 * The least the quote can come to while any combination can still be the one chosen — the most a deposit may be: the
 * shared lines, the cheapest option of every pick-one set, and no additive option. Null without options.
 */
export function lowestPrice(shared: Priced[], optionLines: OptionLine[], options: OptionRow[], taxRate: unknown, discount: unknown): Totals | null {
  if (!options.length) return null
  const raw = (id: string) => optionLines.filter((l) => l.proposalOptionId === id).reduce((s, l) => s + Math.max(0, Number(l.quantity) || 0) * Math.max(0, Number(l.unitPrice) || 0), 0)
  const taken = new Set<string>()
  const sets = new Map<number, OptionRow[]>()
  for (const o of options) { const k = o.setIndex ?? 0; sets.set(k, [...(sets.get(k) || []), o]) }
  for (const members of sets.values()) {
    if (setKindOf(members[0].setKind) !== 'one') continue
    taken.add([...members].sort((a, b) => raw(a.id) - raw(b.id))[0].id)
  }
  return priceWith(shared, optionLines, taken, taxRate, discount)
}

export type ProposalOptionView = {
  id: string; name: string; tier: string | null; brand: string | null; warranty: string | null; description: string | null
  photos: string[]; recommended: boolean; chosen: boolean; sortOrder: number
  /** The set this option is one choice of: its place, what the customer sees above it, and whether they pick one or any. */
  setIndex: number; setName: string; setKind: SetKind
  /** What the whole quote comes to with this option taken (and what is picked in the other sets): tax and discount as the quote has them. */
  price: string; subtotal: string; taxAmount: string
  /** What taking this option adds to the quote's price, tax in — the figure an additive option shows. */
  addPrice: string
  /** The deposit the quote asks if this is the option taken ('0.00' when it asks none). */
  deposit: string
  lines: any[]
}
export type ProposalSetView = {
  index: number; name: string; kind: SetKind
  options: ProposalOptionView[]
  chosenOptionIds: string[]
  /** A pick-one set nobody has picked from yet; an additive set never needs a choice. */
  needsChoice: boolean
}
export type ProposalView = {
  /** Every option, in set order then its own (what every screen read before sets existed, each now naming its set). */
  options: ProposalOptionView[]
  sets: ProposalSetView[]
  /** The first option picked (the one pick of a one-set quote); every pick is `chosenOptionIds`. */
  chosenOptionId: string | null
  chosenOptionIds: string[]
  /** Some pick-one set is still unpicked: the customer cannot sign, and the PDF and the email offer the options. */
  needsChoice: boolean
  /** The least the quote can come to (the cheapest pick of every pick-one set, no add-ons): the "from" price, the deposit's limit. */
  lowest: { total: string; subtotal: string; taxAmount: string }
}

/** The options of a quote grouped into their sets, in set order. */
export function groupSets<T extends OptionRow & { setName?: string | null; sortOrder?: number | null }>(options: T[]): Array<{ index: number; name: string; kind: SetKind; options: T[] }> {
  const by = new Map<number, T[]>()
  for (const o of options) { const k = o.setIndex ?? 0; by.set(k, [...(by.get(k) || []), o]) }
  const indexes = [...by.keys()].sort((a, b) => a - b)
  return indexes.map((index) => {
    const members = (by.get(index) || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    return { index, name: setNameOf(members[0]?.setName, index, indexes.length), kind: setKindOf(members[0]?.setKind), options: members }
  })
}

/** A quote's options with their lines and the price of each, in their sets — null when it has none. `quote` supplies the tax rate, discount and deposit. */
export async function proposalView(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption?: any }, quote: { id: string; taxRate?: unknown; discount?: unknown; depositType?: string | null; depositValue?: unknown }): Promise<ProposalView | null> {
  if (!hasProposalTables(t)) return null
  const rows = await db.select().from(t.quoteProposalOption).where(eq(t.quoteProposalOption.quoteId, quote.id)).orderBy(asc(t.quoteProposalOption.sortOrder), asc(t.quoteProposalOption.id))
  if (!rows.length) return null
  const lines = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quote.id)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
  const shared = lines.filter((l: any) => !l.proposalOptionId && isIncluded(l))
  const optionLines = lines.filter((l: any) => l.proposalOptionId)
  const prices = optionPrices(shared, optionLines, rows, quote.taxRate, quote.discount)
  const deposit = (total: number) => depositAmount({ depositType: quote.depositType, depositValue: quote.depositValue, total }).toFixed(2)
  const sets: ProposalSetView[] = groupSets<any>(rows).map((s) => {
    const options: ProposalOptionView[] = s.options.map((o: any) => {
      const p = prices.get(o.id)!
      return {
        id: o.id, name: o.name, tier: o.tier ?? null, brand: o.brand ?? null, warranty: o.warranty ?? null, description: o.description ?? null,
        photos: Array.isArray(o.photos) ? o.photos.filter(isPhotoAddress) : [], recommended: !!o.recommended, chosen: !!o.chosen, sortOrder: o.sortOrder,
        setIndex: s.index, setName: s.name, setKind: s.kind,
        price: p.total.toFixed(2), subtotal: p.subtotal.toFixed(2), taxAmount: p.taxAmount.toFixed(2), addPrice: p.add.toFixed(2),
        deposit: deposit(p.total), lines: lines.filter((l: any) => l.proposalOptionId === o.id),
      }
    })
    const chosenOptionIds = options.filter((o) => o.chosen).map((o) => o.id)
    return { index: s.index, name: s.name, kind: s.kind, options, chosenOptionIds, needsChoice: s.kind === 'one' && !chosenOptionIds.length }
  })
  const options = sets.flatMap((s) => s.options)
  const chosenOptionIds = sets.flatMap((s) => s.chosenOptionIds)
  const low = lowestPrice(shared, optionLines, rows, quote.taxRate, quote.discount)!
  return {
    options, sets, chosenOptionId: chosenOptionIds[0] ?? null, chosenOptionIds, needsChoice: sets.some((s) => s.needsChoice),
    lowest: { total: low.total.toFixed(2), subtotal: low.subtotal.toFixed(2), taxAmount: low.taxAmount.toFixed(2) },
  }
}

/**
 * Does the quote's PDF still print the options as a sheet to choose from? While a pick-one set is unpicked, or an additive
 * set is there to add from — never once approved: a signed quote prints the lines it was signed for.
 */
export const offersOptions = (view: ProposalView | null | undefined, status: unknown): boolean =>
  !!view && status !== 'approved' && (view.needsChoice || view.sets.some((s) => s.kind === 'any'))

/** The options picked, named for a signature, a notice or an audit row: "Better", or "Better + Smart thermostat + Humidifier". */
export const chosenLabel = (view: { options: Array<{ chosen: boolean; name: string }> } | null | undefined): string | null => {
  const names = (view?.options || []).filter((o) => o.chosen).map((o) => o.name)
  return names.length ? names.join(' + ') : null
}

/** Has this quote a pick-one set the customer has not yet picked from? A quote without options never needs a choice. */
export async function proposalNeedsChoice(db: any, t: { quoteProposalOption?: any }, quoteId: string): Promise<boolean> {
  if (!t?.quoteProposalOption) return false
  const rows: OptionRow[] = await db.select({ id: t.quoteProposalOption.id, chosen: t.quoteProposalOption.chosen, setIndex: t.quoteProposalOption.setIndex, setKind: t.quoteProposalOption.setKind }).from(t.quoteProposalOption).where(eq(t.quoteProposalOption.quoteId, quoteId))
  return groupSets(rows).some((s) => s.kind === 'one' && !s.options.some((o) => o.chosen))
}

export const CHOOSE_FIRST = 'Choose one of the options before you approve this quote.'
/** The code a refusal for want of a choice carries, so a screen can open the options instead of showing an error. */
export const CHOOSE_FIRST_CODE = 'option_required'

/**
 * Pick an option. In a pick-one set its lines are ticked and every other option's of that set are not (choosing again
 * changes the choice; a pick cannot be taken back, only moved). In an additive set `chosen` ticks or unticks it on its own.
 * The other sets' picks stand; the quote's totals are worked out again. The caller has already decided the quote is open.
 */
export async function chooseProposalOption(db: any, t: { quote: any; quoteLineItem: any; quoteProposalOption?: any }, companyId: string, quoteId: string, optionId: unknown, chosen: unknown = true):
  Promise<{ error: string; status: 400 | 404 } | { quote: any; lineItems: any[] }> {
  if (!hasProposalTables(t)) return { error: 'This quote has no options.', status: 400 }
  if (typeof optionId !== 'string' || !optionId) return { error: 'Say which option.', status: 400 }
  if (chosen !== undefined && typeof chosen !== 'boolean') return { error: 'Say whether the option is taken (chosen: true or false).', status: 400 }
  const want = chosen !== false
  const [opt] = await db.select().from(t.quoteProposalOption).where(and(eq(t.quoteProposalOption.id, optionId), eq(t.quoteProposalOption.quoteId, quoteId))).limit(1)
  if (!opt) return { error: 'That option is not on this quote.', status: 404 }
  const kind = setKindOf(opt.setKind)
  if (kind === 'one' && !want) return { error: 'One option of this set is always chosen: choose another instead.', status: 400 }
  const run = async (tx: any) => {
    if (kind === 'one') {
      const siblings = await tx.select({ id: t.quoteProposalOption.id }).from(t.quoteProposalOption).where(and(eq(t.quoteProposalOption.quoteId, quoteId), eq(t.quoteProposalOption.setIndex, opt.setIndex ?? 0)))
      const ids: string[] = siblings.map((s: any) => s.id)
      await tx.update(t.quoteProposalOption).set({ chosen: false, chosenAt: null }).where(inArray(t.quoteProposalOption.id, ids))
      await tx.update(t.quoteProposalOption).set({ chosen: true, chosenAt: new Date() }).where(eq(t.quoteProposalOption.id, optionId))
      await tx.update(t.quoteLineItem).set({ selected: false }).where(and(eq(t.quoteLineItem.quoteId, quoteId), inArray(t.quoteLineItem.proposalOptionId, ids)))
      await tx.update(t.quoteLineItem).set({ selected: true }).where(and(eq(t.quoteLineItem.quoteId, quoteId), eq(t.quoteLineItem.proposalOptionId, optionId)))
    } else {
      await tx.update(t.quoteProposalOption).set({ chosen: want, chosenAt: want ? new Date() : null }).where(eq(t.quoteProposalOption.id, optionId))
      await tx.update(t.quoteLineItem).set({ selected: want }).where(and(eq(t.quoteLineItem.quoteId, quoteId), eq(t.quoteLineItem.proposalOptionId, optionId)))
    }
    return retotalQuote(tx, t, companyId, quoteId)
  }
  const r = typeof db.transaction === 'function' ? await db.transaction(run) : await run(db)
  return r ?? { error: 'Quote not found', status: 404 }
}
