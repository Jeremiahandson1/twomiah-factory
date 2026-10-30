// The store checkout group's raw SQL (RULEBOOK §2), for server/crm/store/checkout/: a discount code's use counted by the
// database, a paid order's stock taken off in the UPDATE itself, the approved-review summary, and "did this email buy
// this product". Moved from templates/crm-store/backend/src/routes/public.ts (finalizeOrder) and services/reviews.ts.
// Every function returns camelCase.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { discountCode, productReview, storeOrder, storeOrderItem, storeProductVariant } from '../db/schema/store.ts'

/** One more use of a discount code, counted by the database (two orders paid at once both count). */
export async function countDiscountUse(db: any, companyId: string, code: string): Promise<void> {
  await db.update(discountCode).set({ usedCount: sql`${discountCode.usedCount} + 1` } as any)
    .where(and(eq(discountCode.companyId, companyId), eq(discountCode.code, code)))
}

/**
 * Take a paid line's units off its variant's stock, IN the update. Reading the count and writing count − qty let two
 * orders paid at the same moment both read 10 and both write their own remainder — one sale never left the stock.
 * Untracked stock (inventory_qty NULL) is left alone; never below zero.
 */
export async function decrementStock(db: any, variantId: string, quantity: number): Promise<void> {
  await db.update(storeProductVariant)
    .set({ inventoryQty: sql`GREATEST(0, ${storeProductVariant.inventoryQty} - ${quantity}::int)`, updatedAt: new Date() } as any)
    .where(and(eq(storeProductVariant.id, variantId), sql`${storeProductVariant.inventoryQty} IS NOT NULL`))
}

/** Approved rating summary for a set of the company's products, keyed by product id. */
export async function ratingSummaries(db: any, companyId: string, productIds: string[]): Promise<Record<string, { average: number; count: number }>> {
  if (!productIds.length) return {}
  const rows = await db.select({
    productId: productReview.productId,
    count: sql<number>`COUNT(*)::int`,
    average: sql<number>`ROUND(AVG(${productReview.rating})::numeric, 2)::float8`,
  })
    .from(productReview)
    .where(and(eq(productReview.companyId, companyId), eq(productReview.status, 'approved'), inArray(productReview.productId, productIds)))
    .groupBy(productReview.productId)
  const out: Record<string, { average: number; count: number }> = {}
  for (const r of rows) out[r.productId] = { average: Number(r.average) || 0, count: Number(r.count) || 0 }
  return out
}

/**
 * Did this email actually buy this product? An order of the company's, paid or further along, compared lower-cased.
 * Drives the verified badge. The order's id, or null.
 */
export async function verifyingOrderId(db: any, companyId: string, productId: string, email: string): Promise<string | null> {
  if (!email) return null
  const [row] = await db.select({ orderId: storeOrder.id })
    .from(storeOrder)
    .innerJoin(storeOrderItem, eq(storeOrderItem.orderId, storeOrder.id))
    .where(and(
      eq(storeOrder.companyId, companyId),
      eq(storeOrderItem.productId, productId),
      sql`LOWER(${storeOrder.customerEmail}) = LOWER(${email})`,
      inArray(storeOrder.status, ['paid', 'fulfilled', 'shipped', 'delivered', 'ready_for_pickup', 'picked_up']),
    ))
    .limit(1)
  return row?.orderId ?? null
}
