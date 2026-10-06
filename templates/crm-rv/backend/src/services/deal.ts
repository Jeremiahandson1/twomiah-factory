/**
 * THE DESKED DEAL — the server's half of the rules. (T42 → T58d)
 *
 * The same rules live on the screen in frontend/src/lib/deal.ts, and for a long time its comment
 * called itself "the rules the server enforces on save" while the two disagreed about two things the
 * owner then reported:
 *
 *   "a down payment of 999,999 is accepted"            — neither side bounded it against the deal
 *   "the API names only the first bad field"           — the screen built a per-field map; this
 *                                                        returned on the first failure, as a string
 *
 * They cannot be ONE module — the screen imports from tenant-ui and the route from tenant-backend,
 * and there is no isomorphic package between them. So they are two, and
 * scripts/check-rv-deal-rules-agree.ts runs both over the same deals and fails if their verdicts
 * differ. This file exists separately from the route so that guard can simply import it, rather than
 * extracting a function out of a file that pulls in the database.
 */

export const DEAL_LABELS: Record<string, string> = {
  price: 'Selling price', discount: 'Discount', accessories: 'Accessories / add-ons', tradeAllow: 'Trade allowance',
  tradePayoff: 'Trade payoff', doc: 'Doc fee', freight: 'Freight / setup', titleReg: 'Title & reg', prep: 'Dealer prep',
  down: 'Down payment', taxRate: 'Tax rate',
}
export const DEAL_MONEY = ['price', 'discount', 'accessories', 'tradeAllow', 'tradePayoff', 'doc', 'freight', 'titleReg', 'prep', 'down']
export const DEAL_MAX = 10_000_000

/** The field order the form shows, so the leading sentence matches the first highlighted input. */
const DEAL_ORDER = [...DEAL_MONEY, 'taxRate']

export type DealRefusal = { error: string; field: string; fields: Record<string, string> }

/**
 * The out-the-door figure, identical to the screen's dealTotals(). Tax is charged on the selling
 * price plus add-ons, net of the trade ALLOWANCE; the trade PAYOFF is money still owed, so it does
 * not reduce what is taxed.
 */
export function dealOutTheDoor(d: Record<string, number>): number {
  const sellingPrice = Math.max(0, d.price - d.discount)
  const taxable = Math.max(0, sellingPrice + d.accessories - d.tradeAllow)
  const tax = (d.taxRate / 100) * taxable
  const fees = d.doc + d.freight + d.titleReg + d.prep
  return sellingPrice + d.accessories + tax + fees
}

/**
 * EVERY BAD FIELD, NOT THE FIRST ONE.
 *
 * Correcting a four-field form used to take four round trips, each revealing the next problem.
 * Reported in the shape this codebase already uses for a multi-field refusal — the same one
 * zodRefusal produces: `{ error, field, fields }`. The sentence is for anything that shows one line;
 * the map is for a form that highlights inputs.
 *
 * …AND A DOWN PAYMENT CANNOT EXCEED THE DEAL. The only ceiling was DEAL_MAX, ten million, which
 * guards a typo in any money field rather than saying anything about this one. $999,999 down on a
 * $30,000 trailer is not a deal — `financed` clamps at zero and the overpayment silently vanishes.
 * The real bound is the out-the-door total; a cent of slack absorbs rounding between the two sides.
 * Paying the full amount in cash is a DEAL, not an error, so the comparison is strictly greater.
 */
export function dealInput(body: any): { deal: Record<string, number> } | DealRefusal {
  if (!body || typeof body !== 'object') {
    return { error: 'Deal is required', field: 'deal', fields: { deal: 'Deal is required' } }
  }
  const deal: Record<string, number> = {}
  const fields: Record<string, string> = {}

  for (const k of DEAL_ORDER) {
    const v = body[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      fields[k] = `${DEAL_LABELS[k]} must be a number`
      deal[k] = 0   // so the rules below still run and can report on the fields that ARE numbers
      continue
    }
    deal[k] = k === 'taxRate' ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100
  }
  for (const k of DEAL_MONEY) {
    if (fields[k]) continue
    if (deal[k] < 0) fields[k] = `${DEAL_LABELS[k]} can't be negative`
    else if (deal[k] > DEAL_MAX) fields[k] = `${DEAL_LABELS[k]} is too large`
  }
  if (!fields.taxRate && (deal.taxRate < 0 || deal.taxRate > 25)) fields.taxRate = 'Tax rate must be between 0% and 25%'
  if (!fields.discount && !fields.price && deal.discount > deal.price) fields.discount = "Discount can't be more than the selling price"

  // Only worth asking once the figures it is derived from are themselves valid — otherwise a bad
  // price produces a second, confusing complaint about the down payment.
  const moneyOk = DEAL_MONEY.every((k) => !fields[k])
  if (!fields.down && moneyOk && !fields.taxRate) {
    const otd = dealOutTheDoor(deal)
    if (deal.down > otd + 0.01) {
      fields.down = `Down payment can't be more than the out-the-door total of ${otd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
    }
  }

  const bad = Object.keys(fields)
  if (!bad.length) return { deal }
  const first = DEAL_ORDER.find((k) => fields[k]) || bad[0]
  const more = bad.length - 1
  return {
    error: more > 0 ? `${fields[first]} (and ${more} other field${more === 1 ? '' : 's'})` : fields[first],
    field: first,
    fields,
  }
}
