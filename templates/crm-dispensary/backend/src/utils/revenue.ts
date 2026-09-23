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
 * Tax actually KEPT: charged, minus what went back with returns. Split the same way the charge is, so a
 * report's excise / sales / local lines still add up to its total after netting — netting only the total
 * would push the derived local line (total − excise − sales) negative.
 *
 * GREATEST(0, …) because a legacy row can carry a refund recorded before refunded_tax existed.
 */
export const taxNetExpr = sql`GREATEST(0, COALESCE(NULLIF(o.total_tax, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_tax, '')::numeric, 0))`
export const exciseNetExpr = sql`GREATEST(0, COALESCE(NULLIF(o.excise_tax, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_excise_tax, '')::numeric, 0))`
export const salesNetExpr = sql`GREATEST(0, COALESCE(NULLIF(o.sales_tax, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_sales_tax, '')::numeric, 0))`

/** The same, for a query with no `o.` alias. */
export const taxNetExprBare = sql`GREATEST(0, COALESCE(NULLIF(total_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_tax, '')::numeric, 0))`
export const exciseNetExprBare = sql`GREATEST(0, COALESCE(NULLIF(excise_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_excise_tax, '')::numeric, 0))`
export const salesNetExprBare = sql`GREATEST(0, COALESCE(NULLIF(sales_tax, '')::numeric, 0) - COALESCE(NULLIF(refunded_sales_tax, '')::numeric, 0))`

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

/** The same three, for a query with no `o.` alias on the orders table. */
export const refundedExprBare = sql`COALESCE(NULLIF(refunded_amount, '')::numeric, 0)`
export const grossExprBare = sql`COALESCE(total::numeric, 0)`
export const netExprBare = sql`GREATEST(0, COALESCE(total::numeric, 0) - COALESCE(NULLIF(refunded_amount, '')::numeric, 0))`
