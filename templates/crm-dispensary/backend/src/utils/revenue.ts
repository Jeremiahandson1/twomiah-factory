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
// set) overstates what is owed. When a sale is refunded in PART the tax stays counted in full, because the
// schema records refunded_amount as one figure with no tax split, so the exact share returned is not
// recoverable — and dropping the whole sale (what the filing did) understates the liability far more than
// keeping it overstates it. Pro-rating tax by refunded_amount/total would be closer still and is a decision
// worth taking deliberately, not a thing to slip into a report people file from.
export const TAX_COLLECTED_STATUSES = ['completed', 'partially_refunded'] as const

/** The row set tax was actually collected on: a sale returned in full returned its tax too. */
export const taxCollected = sql`('completed', 'partially_refunded')`

/** Money returned, as a numeric expression over an `orders` row aliased `o`. */
export const refundedExpr = sql`COALESCE(NULLIF(o.refunded_amount, '')::numeric, 0)`

/** What was sold, before refunds. */
export const grossExpr = sql`COALESCE(o.total::numeric, 0)`

/** What was kept: gross minus what went back. */
export const netExpr = sql`(COALESCE(o.total::numeric, 0) - COALESCE(NULLIF(o.refunded_amount, '')::numeric, 0))`

/** The same three, for a query with no `o.` alias on the orders table. */
export const refundedExprBare = sql`COALESCE(NULLIF(refunded_amount, '')::numeric, 0)`
export const grossExprBare = sql`COALESCE(total::numeric, 0)`
export const netExprBare = sql`(COALESCE(total::numeric, 0) - COALESCE(NULLIF(refunded_amount, '')::numeric, 0))`
