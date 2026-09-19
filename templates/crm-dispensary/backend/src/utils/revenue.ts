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
