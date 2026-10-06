// What "revenue" means, in one place.
//
// Three surfaces answered the same question three ways on the same day — compliance $3,395, analytics $2,825,
// dashboard $2,395 — and all three were labelled revenue (Dispensary T21 H8):
//
//   compliance  settled sales, GROSS              (what you sold)
//   analytics   completed + partially refunded, NET
//   dashboard   completed only, GROSS
//
// The disagreement was never about arithmetic. It was three different row sets and two different measures,
// none of them written down. So they are written down here, and every surface uses them.
//
//   SETTLED  — money changed hands: completed, partially_refunded, refunded. A sale that was later refunded
//              still happened; excluding it is how the compliance report lost real sales (T20 B3).
//   gross    — SUM(total) over settled. The sales figure a regulator asks for.
//   refunded — SUM(refunded_amount) over settled. Reported, never applied by omission.
//   net      — gross − refunded. What the business actually kept.
//
// A fully refunded sale contributes its total to gross and the same amount to refunded, so it adds exactly
// ZERO to net. That is what lets all three surfaces share one row set: the ones that report net are unchanged
// in value by including it, and the ones that report gross stop under-counting.
import { sql } from 'drizzle-orm'

/** The statuses that mean a sale actually happened. */
export const SETTLED_SALE_STATUSES = ['completed', 'partially_refunded', 'refunded'] as const

/** For a raw-SQL `WHERE ... AND o.status IN ${settledSale}`. */
export const settledSale = sql`('completed', 'partially_refunded', 'refunded')`

// TAX is the one measure that does NOT share the settled row set, and it split six surfaces three ways:
// the dashboard, the analytics summary and the tax FILING counted 'completed' only; the EOD report and the
// compliance tax report counted completed + partially refunded; the analytics timeseries and the compliance
// sales report counted all three settled statuses. Same day, same tenant, $488.75 against $710.75.
// (Dispensary T23 H1)
//
// Unlike revenue, this is not a choice of measure — it is what actually happened. When a sale is handed back
// IN FULL the tax goes back with it, so there is nothing collected to remit; counting it (the settled row
// set) overstates what is owed.
//
// A PARTIAL refund used to stay counted in full, because refunded_amount was one figure with no tax split
// and the share returned was not recoverable. The note here said pro-rating would be closer and was "a
// decision worth taking deliberately, not a thing to slip into a report people file from". It is taken now,
// and better than pro-rating: the refund records the tax it actually handed back (refunded_tax, split into
// refunded_excise_tax and refunded_sales_tax), computed by the same assessTax that charged it. So the tax
// surfaces subtract a real number rather than an estimate.
//
// This was the one remaining way the filing overstated the liability: a day with $43.75 refunded, carrying
// $8.75 of tax, still filed $30.00. (Dispensary T29 M4)
export const TAX_COLLECTED_STATUSES = ['completed', 'partially_refunded'] as const

/**
 * Tax actually KEPT: charged, minus what went back with returns, per component.
 *
 * GREATEST(0, …) because a legacy row can carry a refund recorded before refunded_tax existed, and no
 * component can collect a negative amount.
 *
 * These three are the RAW netted components. They are correct individually and they do NOT add up —
 * see taxKeptSplit below before summing them on a report.
 */
export const taxNetExpr = sql`GREATEST(0, COALESCE(NULLIF(o.total_tax, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_tax, '')::numeric, 0))`
export const exciseNetExpr = sql`GREATEST(0, COALESCE(NULLIF(o.excise_tax, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_excise_tax, '')::numeric, 0))`
export const salesNetExpr = sql`GREATEST(0, COALESCE(NULLIF(o.sales_tax, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_sales_tax, '')::numeric, 0))`

/** The same, for a query with no `o.` alias. */
export const taxNetExprBare = sql`GREATEST(0, COALESCE(NULLIF(total_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_tax, '')::numeric, 0))`
export const exciseNetExprBare = sql`GREATEST(0, COALESCE(NULLIF(excise_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_excise_tax, '')::numeric, 0))`
export const salesNetExprBare = sql`GREATEST(0, COALESCE(NULLIF(sales_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_sales_tax, '')::numeric, 0))`

/**
 * THE SPLIT THAT ADDS UP. Excise + sales + local = total tax kept, on every row and therefore on every
 * sum of rows. (Dispensary T42/T51–T58: "$5.68 tax gap on 09-23")
 *
 * The docstring above used to claim the per-component netting was enough for a report's lines to add up
 * to its total. It is not, and that claim is the whole bug. Each component carries its own
 * GREATEST(0, charged − refunded) floor — right per column, since no tax line collects a negative
 * amount — and a floor is not additive: on an order whose refund handed back more of one tax than that
 * tax was charged (a rate corrected after the sale, a refund split by a different rate than the charge),
 * that component floors at zero while total_tax keeps the whole deduction. The parts then come out
 * LARGER than the whole, and the derived local line — total − excise − sales — goes negative and gets
 * clamped, which is where the missing $5.68 went.
 *
 * Clamping the components at the SUM level, as the compliance tax report did, hides it one level up
 * instead of fixing it: the day's three lines simply stop adding to the day's total.
 *
 * So the components are reconciled per ORDER, against what that order actually kept:
 *
 *   tot = GREATEST(0, total_tax − refunded_tax)        the money; unchanged, so every other tax
 *                                                      surface still agrees with these reports
 *   exc = LEAST(net excise, tot)                       a component cannot exceed what was kept
 *   sal = LEAST(net sales, tot − exc)
 *   loc = tot − exc − sal                              the residual, ≥ 0 by construction
 *
 * Per order the three sum to exactly `tot`, so their sums do too, and no component can be negative or
 * exceed the total — the two things that made the old figures unfilable. Excise is settled before sales
 * because excise is the narrower, cannabis-only tax and the one a state asks about first; both tax
 * surfaces must use the same order or they disagree on a mixed basket, which is why this is one
 * definition and not a shape each report rebuilds. check-one-tax-split.ts fails the build for a report
 * that sums the raw components instead.
 *
 * Written as self-contained per-row expressions rather than a subquery recipe, so a report can drop
 * them into the SELECT it already has — restructuring four working queries around a derived table is
 * how a money fix becomes a regression.
 */
const split = (tot: ReturnType<typeof sql>, exc: ReturnType<typeof sql>, sal: ReturnType<typeof sql>) => {
  const excKept = sql`LEAST(${exc}, ${tot})`
  const salKept = sql`LEAST(${sal}, GREATEST(0, ${tot} - ${excKept}))`
  // Provably non-negative; the floor is belt and braces, not arithmetic this relies on.
  const locKept = sql`GREATEST(0, ${tot} - ${excKept} - ${salKept})`
  return { excKept, salKept, locKept }
}

const aliased = split(taxNetExpr, exciseNetExpr, salesNetExpr)
const bare = split(taxNetExprBare, exciseNetExprBare, salesNetExprBare)

/** For a query over `orders` aliased `o`. SUM these, not the raw components. */
export const exciseKeptExpr = aliased.excKept
export const salesKeptExpr = aliased.salKept
export const localKeptExpr = aliased.locKept

/** The same, for a query with no `o.` alias. */
export const exciseKeptExprBare = bare.excKept
export const salesKeptExprBare = bare.salKept
export const localKeptExprBare = bare.locKept

/** The row set tax was actually collected on: a sale returned in full returned its tax too. */
export const taxCollected = sql`('completed', 'partially_refunded')`

/** Money returned, as a numeric expression over an `orders` row aliased `o`. */
export const refundedExpr = sql`COALESCE(NULLIF(o.refunded_amount, '')::numeric, 0)`

/** What was sold, before refunds. */
export const grossExpr = sql`COALESCE(o.total::numeric, 0)`

/**
 * What was kept: gross minus what went back, floored at zero PER SALE.
 *
 * A sale cannot have earned negative money. Without the floor, one row whose refunded_amount exceeds
 * its total — legacy data, or a sale settled twice before the completion was made atomic (T29 B1) —
 * drags the whole day under: the analytics series showed 13 September at −$50 with an average order
 * value of −$16.67. Refunds are still reported in full beside this, so nothing is hidden by the
 * clamp; it only stops one bad row from making a day's takings look like a payout. (T29 L3)
 */
export const netExpr = sql`GREATEST(0, COALESCE(o.total::numeric, 0) - COALESCE(NULLIF(o.refunded_amount, '')::numeric, 0))`

/**
 * THE GOODS VALUE, DERIVED FROM WHAT WAS COLLECTED RATHER THAN RE-SUMMED. (T42 tax report)
 *
 * `SUM(o.subtotal)` cannot be made to reconcile with the other columns on a tax row, for two
 * independent reasons: it is gross where the tax is net, and `total` is subtotal − discount + tax,
 * so a discounted day never added up either even before refunds existed.
 *
 * Taking the tax out of the net collected total gives the goods value that was ACTUALLY collected,
 * and makes "subtotal + tax = collected" hold by construction on every day instead of by hoping three
 * separate sums agree. Clamped at zero like its neighbours so a pathological row cannot go negative.
 */
export const subtotalNetExpr = sql`GREATEST(0,
  GREATEST(0, COALESCE(o.total::numeric, 0) - COALESCE(NULLIF(o.refunded_amount, '')::numeric, 0))
  - GREATEST(0, COALESCE(NULLIF(o.total_tax, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_tax, '')::numeric, 0))
)`

/** The same three, for a query with no `o.` alias on the orders table. */
export const refundedExprBare = sql`COALESCE(NULLIF(refunded_amount, '')::numeric, 0)`
export const grossExprBare = sql`COALESCE(total::numeric, 0)`
export const netExprBare = sql`GREATEST(0, COALESCE(total::numeric, 0) - COALESCE(NULLIF(refunded_amount, '')::numeric, 0))`
