// Which orders were ever paid — the ones that belong in the books and on a shopper's order history. An unfinished
// checkout (pending) never was; a cancelled order was only if money had been taken for it (a payment on record, or a
// refund). Every other status is a sale (a refunded one was).
import { and, eq, gt, isNotNull, ne, or } from 'drizzle-orm'
import { storeOrder } from '../../../db/schema/store.ts'

export const wasPaid = () => or(
  and(ne(storeOrder.status, 'pending'), ne(storeOrder.status, 'cancelled')),
  and(eq(storeOrder.status, 'cancelled'), or(isNotNull(storeOrder.providerPaymentId), gt(storeOrder.refundedCents, 0))),
)!
