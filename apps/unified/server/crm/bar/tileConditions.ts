// THE BAR'S HOME-SCREEN CONDITIONS (beyond the party book, which is restaurant/tileConditions.ts) — one definition for
// the dashboard's count (`/api/dashboard/stats` -> `tiles`) and for the list the tile opens (`?tile=` on the list).
// The phone used to count these client-side from a fetched list; the count now comes from the server's own condition.
import { and, eq, inArray } from 'drizzle-orm'

/** GET /api/bar/menu?tile= — "Out tonight": the items on the 86 board. */
export const MENU_TILES = ['out'] as const
/** On the board and still on the menu: a retired item is not "out tonight". */
export const outTonightCondition = (item: any) => and(eq(item.is86ed, true), eq(item.isActive, true))!

/** GET /api/bar/taps?tile= — "Taps low or blown". */
export const TAP_TILES = ['trouble'] as const
export const TAP_TROUBLE_STATUSES = ['last_keg', 'blown'] as const
export const tapTroubleCondition = (tap: any) => and(eq(tap.isActive, true), inArray(tap.status, [...TAP_TROUBLE_STATUSES]))!

/** GET /api/stock/orders?tile= — "Orders on the way": sent to the vendor, not yet received or cancelled. */
export const ORDER_TILES = ['on_the_way'] as const
export const onTheWayCondition = (order: any) => eq(order.status, 'sent')

/** GET /api/schedule/time-off?tile= — "Time off to decide". */
export const TIME_OFF_TILES = ['pending'] as const
export const pendingTimeOffCondition = (row: any) => eq(row.status, 'pending')
