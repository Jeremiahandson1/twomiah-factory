/**
 * Product reviews: aggregates for the storefront, and the one-time
 * "how did we do?" email that actually produces them.
 */
import { db } from '../../db/index.ts'
import { productReviews, orders, orderItems, products, storeSettings } from '../../db/schema.ts'
import { eq, and, lt, isNull, isNotNull, inArray, sql } from 'drizzle-orm'
import { sendReviewRequest } from './email.ts'
import logger from './logger.ts'

/** Approved rating summary for a set of products, keyed by product id. */
export async function ratingSummaries(productIds: string[]): Promise<Record<string, { average: number; count: number }>> {
  if (!productIds.length) return {}
  const rows = await db.select({
    productId: productReviews.productId,
    count: sql<number>`COUNT(*)::int`,
    average: sql<number>`ROUND(AVG(${productReviews.rating})::numeric, 2)::float8`,
  })
    .from(productReviews)
    .where(and(eq(productReviews.status, 'approved'), inArray(productReviews.productId, productIds)))
    .groupBy(productReviews.productId)

  const out: Record<string, { average: number; count: number }> = {}
  for (const r of rows) out[r.productId] = { average: Number(r.average) || 0, count: Number(r.count) || 0 }
  return out
}

/** Approved reviews for one product, newest first. */
export async function approvedReviews(productId: string, limit = 50) {
  return db.select({
    id: productReviews.id,
    authorName: productReviews.authorName,
    rating: productReviews.rating,
    title: productReviews.title,
    body: productReviews.body,
    verifiedPurchase: productReviews.verifiedPurchase,
    createdAt: productReviews.createdAt,
  })
    .from(productReviews)
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, 'approved')))
    .orderBy(sql`${productReviews.createdAt} DESC`)
    .limit(limit)
}

/**
 * Did this email actually buy this product? Drives the verified badge, and
 * lets a genuine buyer skip moderation limbo.
 */
export async function findVerifyingOrder(productId: string, email: string): Promise<string | null> {
  if (!email) return null
  const [row] = await db.select({ orderId: orders.id })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(
      eq(orderItems.productId, productId),
      sql`LOWER(${orders.customerEmail}) = LOWER(${email})`,
      inArray(orders.status, ['paid', 'fulfilled', 'shipped', 'delivered']),
    ))
    .limit(1)
  return row?.orderId ?? null
}

/**
 * One review request per order, a configurable number of days after it ships.
 * Never asks twice — review_request_sent_at is claimed before sending.
 */
export async function sweepReviewRequests(): Promise<{ sent: number }> {
  const [settings] = await db.select().from(storeSettings).limit(1)
  if (!settings || !settings.reviewsEnabled) return { sent: 0 }

  const days = Math.max(1, settings.reviewRequestDays ?? 7)
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const storefront = (settings.storefrontOrigin || '').replace(/\/$/, '')

  const due = await db.select().from(orders).where(and(
    inArray(orders.status, ['shipped', 'delivered', 'fulfilled']),
    isNull(orders.reviewRequestSentAt),
    isNotNull(orders.customerEmail),
    lt(orders.updatedAt, cutoff),
  ))

  let sent = 0
  for (const order of due) {
    try {
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
      if (!items.length) continue

      // Claim before sending so a failure cannot loop.
      await db.update(orders)
        .set({ reviewRequestSentAt: new Date(), updatedAt: order.updatedAt })
        .where(eq(orders.id, order.id))

      const [firstItem] = items
      const [prod] = firstItem?.productId
        ? await db.select({ slug: products.slug }).from(products).where(eq(products.id, firstItem.productId)).limit(1)
        : []

      await sendReviewRequest({
        order: order as any,
        items: items as any,
        storeName: settings.companyName,
        reviewUrl: prod?.slug ? `${storefront}/products/${prod.slug}#reviews` : storefront,
        supportEmail: settings.supportEmail,
      })
      sent++
    } catch (err: any) {
      logger.warn('review request failed', { orderId: order.id, error: err?.message })
    }
  }
  return { sent }
}
