// THE STORE'S HOME-SCREEN CONDITIONS — one definition for the dashboard's count and for the list the phone's tile opens.
//
// "To fulfill" counted every order in `paid`, but a gift-card-only order (fulfillment 'digital') stays `paid` for good —
// nothing can pack it — so the tile could read 4 and open a list the packer could never empty. "At supplier" and "Orders"
// had no list that could be asked for them at all (the orders list took one status). Each condition is written here once;
// the dashboard's stats and `GET /api/admin/orders?tile=` / `GET /api/admin/reviews?tile=` both call it.
// (apps/unified/tests/store-vet-tiles.test.ts holds count and list equal, with rows that must NOT count.)
import { and, eq, ne, notInArray } from 'drizzle-orm'

/** The filters `GET /api/admin/orders` accepts as `?tile=`. A value outside the list is refused, never answered as "empty". */
export const ORDER_TILES = ['to_pack', 'at_supplier', 'counted'] as const
/** The filters `GET /api/admin/reviews` accepts as `?tile=`. */
export const REVIEW_TILES = ['pending'] as const

/** "To pack" (the server's status `paid`): paid and something to put in a box. Gift-card-only (digital) orders have nothing to pack. */
export const toPackCondition = (order: any) => and(eq(order.status, 'paid'), ne(order.fulfillment, 'digital'))!

/** "At supplier": forwarded to the dropship supplier and not yet back. */
export const atSupplierCondition = (order: any) => eq(order.supplierStatus, 'placed')

/** "Orders": every order that was a sale — a refunded one still was; an unfinished checkout and a cancelled one never were. */
export const countedOrderCondition = (order: any) => notInArray(order.status, ['pending', 'cancelled'])

/** "Reviews to approve": a review nobody has decided. */
export const pendingReviewCondition = (review: any) => eq(review.status, 'pending')

export { productSearchCondition } from '../../data/tileSql.ts'
