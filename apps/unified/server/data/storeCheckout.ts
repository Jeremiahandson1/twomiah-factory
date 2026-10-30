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

/** A variant a sale took down to its low-stock level: what the owner is told. */
export interface LowStockCrossing { variantId: string; sku: string; variantName: string; quantity: number; lowStockAt: number }

/**
 * Take a paid line's units off its variant's stock, IN the update. Reading the count and writing count − qty let two
 * orders paid at the same moment both read 10 and both write their own remainder — one sale never left the stock.
 * Untracked stock (inventory_qty NULL) is left alone; never below zero.
 *
 * With `alert` (the shop has low-stock alerts on), the variant is also CLAIMED when this sale left it at or under its
 * level: a conditional update on the once-stamp (low_stock_alerted_at still empty), so of any number of sales — at once
 * or one after another — exactly one gets the row back and sends the email; the rest find the stamp set. The stamp
 * comes off again when the count rises above the level (settleLowStockStamp). The crossing, or null.
 */
export async function decrementStock(db: any, variantId: string, quantity: number, alert = false): Promise<LowStockCrossing | null> {
  await db.update(storeProductVariant)
    .set({ inventoryQty: sql`GREATEST(0, ${storeProductVariant.inventoryQty} - ${quantity}::int)`, updatedAt: new Date() } as any)
    .where(and(eq(storeProductVariant.id, variantId), sql`${storeProductVariant.inventoryQty} IS NOT NULL`))
  if (!alert) return null
  const [row] = await db.update(storeProductVariant).set({ lowStockAlertedAt: new Date() } as any)
    .where(and(
      eq(storeProductVariant.id, variantId), sql`${storeProductVariant.lowStockAt} IS NOT NULL`, sql`${storeProductVariant.inventoryQty} IS NOT NULL`,
      sql`${storeProductVariant.inventoryQty} <= ${storeProductVariant.lowStockAt}`, sql`${storeProductVariant.lowStockAlertedAt} IS NULL`,
    )).returning({ variantId: storeProductVariant.id, sku: storeProductVariant.sku, variantName: storeProductVariant.name, quantity: storeProductVariant.inventoryQty, lowStockAt: storeProductVariant.lowStockAt })
  return row ? { ...row, quantity: Number(row.quantity), lowStockAt: Number(row.lowStockAt) } : null
}

/**
 * Keep the once-stamp true to the count: at or under its level the stamp is set (the owner is already looking at it — a
 * level set on something already low, a count typed in by hand, never an email), above it (or with no level, or untracked)
 * the stamp is cleared, so the next sale that takes it down to the level tells the owner again.
 */
export async function settleLowStockStamp(db: any, variantId: string): Promise<void> {
  await db.update(storeProductVariant).set({
    lowStockAlertedAt: sql`CASE WHEN ${storeProductVariant.lowStockAt} IS NOT NULL AND ${storeProductVariant.inventoryQty} IS NOT NULL AND ${storeProductVariant.inventoryQty} <= ${storeProductVariant.lowStockAt} THEN COALESCE(${storeProductVariant.lowStockAlertedAt}, now()) ELSE NULL END`,
  } as any).where(eq(storeProductVariant.id, variantId))
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
