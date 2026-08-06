/**
 * Abandoned cart recovery.
 *
 * A pending order is an abandoned cart: /api/public/checkout writes the order
 * and its items before the customer reaches the payment page. Previously those
 * rows were simply cancelled after 24h, so every abandoned cart was thrown away
 * without a word. Now they get one reminder with a link straight back to
 * checkout, and are only cancelled well after that.
 */
import { db } from '../../db/index.ts'
import { orders, orderItems, storeSettings } from '../../db/schema.ts'
import { eq, and, lt, isNull, isNotNull, sql } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { getActiveProvider } from '../payments/index.ts'
import { sendAbandonedCart } from './email.ts'
import logger from './logger.ts'

/** Cancel only well after the reminder has had a chance to work. */
const CANCEL_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export function newRecoveryToken(): string {
  return randomBytes(24).toString('hex')
}

/**
 * Email one reminder per abandoned cart, then let it age out.
 * Idempotent: abandoned_email_sent_at is set as part of the same pass.
 */
export async function sweepAbandonedCarts(): Promise<{ emailed: number; cancelled: number }> {
  const [settings] = await db.select().from(storeSettings).limit(1)
  if (!settings) return { emailed: 0, cancelled: 0 }

  let emailed = 0
  if (settings.abandonedCartEnabled) {
    const delayMs = Math.max(5, settings.abandonedCartDelayMinutes ?? 60) * 60 * 1000
    const cutoff = new Date(Date.now() - delayMs)

    const stale = await db.select().from(orders).where(and(
      eq(orders.status, 'pending'),
      lt(orders.createdAt, cutoff),
      isNull(orders.abandonedEmailSentAt),
      isNotNull(orders.customerEmail),
    ))

    for (const order of stale) {
      try {
        const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
        if (!items.length) continue

        const token = order.recoveryToken || newRecoveryToken()
        const origin = (settings.storefrontOrigin || '').replace(/\/$/, '')
        const recoverUrl = `${origin}/api/public/recover/${token}`

        // Claim it first: a send that throws must not be retried forever.
        await db.update(orders)
          .set({ recoveryToken: token, abandonedEmailSentAt: new Date(), updatedAt: new Date() })
          .where(eq(orders.id, order.id))

        await sendAbandonedCart({
          order: order as any,
          items: items as any,
          storeName: settings.companyName,
          recoverUrl,
          supportEmail: settings.supportEmail,
        })
        emailed++
      } catch (err: any) {
        logger.warn('abandoned cart email failed', { orderId: order.id, error: err?.message })
      }
    }
  }

  // Age out what never came back.
  const cancelCutoff = new Date(Date.now() - CANCEL_AFTER_MS)
  const cancelled = await db.update(orders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(orders.status, 'pending'), lt(orders.createdAt, cancelCutoff)))
    .returning({ id: orders.id })

  return { emailed, cancelled: cancelled.length }
}

/**
 * Turn a recovery token back into a live checkout for the same items.
 * Returns the provider URL to redirect the customer to.
 */
export async function resumeCheckout(token: string, requestOrigin: string): Promise<string | null> {
  const [order] = await db.select().from(orders).where(eq(orders.recoveryToken, token)).limit(1)
  if (!order) return null

  // Already paid? Send them to the confirmation rather than a second charge.
  if (order.status !== 'pending') {
    const [s] = await db.select().from(storeSettings).limit(1)
    const storefront = (s?.storefrontOrigin || requestOrigin || '').replace(/\/$/, '')
    return `${storefront}/order/success?order=${encodeURIComponent(order.id)}`
  }

  const provider = await getActiveProvider()
  if (!provider) return null

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
  if (!items.length) return null

  const [settings] = await db.select().from(storeSettings).limit(1)
  const storefront = (settings?.storefrontOrigin || requestOrigin || '').replace(/\/$/, '')

  const checkout = await provider.createCheckout({
    lineItems: items.map((i) => ({
      sku: i.sku,
      name: i.productName + (i.variantName ? ' - ' + i.variantName : ''),
      imageUrl: i.imageUrl ?? undefined,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
    })),
    currency: order.currency,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    discountCents: order.discountCents,
    customerEmail: order.customerEmail,
    collectShippingAddress: true,
    successUrl: `${storefront}/order/success?session={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${storefront}/cart`,
    clientReferenceId: order.id,
    metadata: { orderId: order.id, recovered: 'true' },
  })

  // Point the order at the new session and record that recovery was attempted.
  await db.update(orders)
    .set({ providerSessionId: checkout.providerSessionId, recoveredAt: new Date(), updatedAt: new Date() })
    .where(eq(orders.id, order.id))

  return checkout.redirectUrl
}

/** Abandoned-cart numbers for the dashboard. */
export async function abandonedCartStats(): Promise<{
  abandoned: number; emailed: number; recovered: number; recoveredValueCents: number
}> {
  const [row] = await db.select({
    abandoned: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'pending')::int`,
    emailed: sql<number>`COUNT(*) FILTER (WHERE ${orders.abandonedEmailSentAt} IS NOT NULL)::int`,
    recovered: sql<number>`COUNT(*) FILTER (WHERE ${orders.recoveredAt} IS NOT NULL AND ${orders.status} <> 'pending')::int`,
    recoveredValueCents: sql<number>`COALESCE(SUM(${orders.totalCents}) FILTER (WHERE ${orders.recoveredAt} IS NOT NULL AND ${orders.status} <> 'pending'), 0)::int`,
  }).from(orders)
  return row ?? { abandoned: 0, emailed: 0, recovered: 0, recoveredValueCents: 0 }
}
