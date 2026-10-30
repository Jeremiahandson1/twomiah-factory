// The store's checkout work that is not a route: a paid order finalised (once, whoever gets there first), the
// shopper's order summary, a cart reopened from its reminder, and the three sweeps — stale pending orders, abandoned-cart
// reminders and review requests. Moved from templates/crm-store/backend/src: routes/public.ts (finalizeOrder, the
// order-summary handler), services/abandonedCart.ts (sweepAbandonedCarts, resumeCheckout, newRecoveryToken),
// services/reviews.ts (approvedReviews, sweepReviewRequests) and index.ts (sweepStalePending).
//
// Changes from the template:
//   · everything is the company's (company_id), the business is the company row (core.shop(): its name and its email,
//     which is the support address the template kept in store_settings);
//   · the shopper is a contact (decision 2): a paid order with no contact yet is given one (core.shopperFor) before its
//     loyalty settles, so the points land on that contact;
//   · the order number is made from the order's id as before — the first block of a uuid (the template's ids, moved
//     across as text, give the same number) or the first eight characters of a cuid2;
//   · the messages go through core.mail (the app's email service), each a store template (./emails.ts);
//   · the storefront is this app, so the links in the messages are built from SITE_URL (FRONTEND_URL, BACKEND_URL) —
//     the template's store_settings.storefrontOrigin is gone;
//   · FIXED: a reopened cart's payment page returned the shopper to /order/success?session=… — the storefront has no
//     such page (it is /checkout/success, read with ?session_id= for Stripe and ?ref= for Square and PayPal, whose
//     redirects fill no placeholder), so a recovered order's shopper landed on Not Found and never saw their receipt;
//     an already-paid cart's link did the same. Both now use checkout's own success address;
//   · FIXED: the review request linked to /products/<slug>#reviews; the storefront's product page is /product/<slug>;
//   · FIXED: the abandoned-cart sweep picked any pending order with an email, and every cart left before the shopper
//     typed one carries the placeholder 'pending@checkout' — the reminder was sent to that address. Such carts are
//     skipped (there is nobody to remind);
//   · a reminder and a review request are claimed with a conditional update (still unclaimed AT the update) before
//     sending, so two passes at once (two instances during a deploy) send one message, not two.
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { productReview, storeOrder, storeOrderItem, storeProduct } from '../../../db/schema/store.ts'
import { countDiscountUse, decrementStock, type LowStockCrossing } from '../../../data/storeCheckout.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { emailItems, emailOrder } from '../emails.ts'
import { createStoreGiftCards, GIFT_CARD_TAX_CODE, HOLD_EXPIRY_MS } from '../giftCards.ts'
import type { PaymentProvider, WebhookResult } from '../payments/types.ts'
import { checkoutImageUrl } from './placeOrder.ts'
import { formatCents } from '../lib/money.ts'

/** Cancel only well after the reminder has had a chance to work (the abandoned-cart reminder needs room). */
export const STALE_PENDING_MS = 7 * 24 * 60 * 60 * 1000
/** A guest checkout's email before the shopper has given one (checkout writes it; the provider fills the real one). */
export const NO_EMAIL_YET = 'pending@checkout'

type Order = typeof storeOrder.$inferSelect

export function newRecoveryToken(): string {
  return randomBytes(24).toString('hex')
}

/** ORD-XXXXXXXX from the order's id: a uuid's first block (orders moved from the template), else the first 8 characters. */
export function orderNumberFor(id: string): string {
  return `ORD-${(id.includes('-') ? id.split('-')[0] : id.slice(0, 8)).toUpperCase()}`
}

/** The shop's own address, for links in messages sent without a request (the sweeps). */
export const siteBase = (): string => String(process.env.SITE_URL || process.env.FRONTEND_URL || process.env.BACKEND_URL || '').replace(/\/+$/, '')

/**
 * The origin the shopper is actually on, from the request (the proxy's x-forwarded-host / host and x-forwarded-proto,
 * as the storefront's originFromHeaders read it), else SITE_URL. Never a field of the request's body: a body origin
 * would let anyone send a paying shopper's return to another site.
 */
export function requestOrigin(c: Context): string {
  const host = (c.req.header('x-forwarded-host') || c.req.header('host') || '').split(',')[0].trim()
  if (!host) return siteBase()
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host)
  const proto = (c.req.header('x-forwarded-proto') || (local ? 'http' : 'https')).split(',')[0].trim()
  return `${proto}://${host}`
}

/**
 * Where the payment page sends the shopper back. Stripe fills its own {CHECKOUT_SESSION_ID} placeholder on redirect;
 * Square and PayPal don't, so for them the success page is correlated by our own order id (`ref`).
 */
export function successUrlFor(provider: string, storefront: string, orderId: string): string {
  return provider === 'stripe'
    ? `${storefront}/checkout/success?session_id={CHECKOUT_SESSION_ID}`
    : `${storefront}/checkout/success?ref=${orderId}`
}

export interface OrderSummary {
  orderNumber: string | null
  status: string
  email: string
  subtotalCents: number
  discountCents: number
  loyaltyDiscountCents: number
  discountCode: string | null
  shippingCents: number
  taxCents: number
  totalCents: number
  refundedCents: number
  currency: string
  /** What a gift card paid of the total (the rest was charged to the card on the payment page). */
  giftCardCents: number
  /** ship | pickup | digital, and for a pickup where and when. */
  fulfillment: string
  pickup: { address: string; hours: string } | null
  /** Stripe Tax worked the tax out from the shopper's address. */
  taxAutomatic: boolean
  items: Array<{ productName: string; variantName: string; quantity: number; lineTotalCents: number; imageUrl: string | null }>
}

/** Exactly what it uses: a caller with less is a type error, never a crash halfway through a payment. */
export function createCheckoutService(d: Pick<CrmDeps, 'db' | 'logger' | 'audit' | 'features'>, core: StoreCore) {
  const { db, logger } = d
  const giftCards = createStoreGiftCards(d, core)

  /**
   * Flip a pending order to paid, populate customer/shipping from the provider result, and decrement tracked
   * inventory. Idempotent + race-safe: only the UPDATE that actually transitions pending→paid does the rest, so the
   * webhook and the success-page retrieval can both call this without double counting or double-flipping.
   */
  async function finalizeOrder(order: Order, result: WebhookResult): Promise<void> {
    if (order.status !== 'pending') return
    const companyId = order.companyId
    const orderNumber = order.orderNumber || orderNumberFor(order.id)
    const [flipped]: Order[] = await db.update(storeOrder).set({
      status: 'paid',
      orderNumber,
      providerPaymentId: result.providerPaymentId ?? null,
      customerEmail: result.customerEmail ?? order.customerEmail,
      customerName: result.customerName ?? null,
      customerPhone: result.customerPhone ?? null,
      shippingAddress: result.shippingAddress ?? null,
      billingAddress: result.billingAddress ?? null,
      // Stripe Tax worked the tax out at the payment page: the order takes what was charged - the tax, and the total
      // (what the provider took, plus what the gift card paid).
      ...(order.taxAutomatic && result.amountTotalCents != null
        ? { taxCents: Math.max(0, result.taxCents ?? 0), totalCents: result.amountTotalCents + (order.giftCardCents || 0) }
        : {}),
      updatedAt: new Date(),
    }).where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId), eq(storeOrder.status, 'pending'))).returning()

    if (!flipped) return // another path finalized it first
    // The audit log: the order paid, once — only the update that made it paid writes it (store live test, 2026-10-26).
    // Never stops what follows: once the order is paid nothing retries the rest, so a failed audit write must not cost
    // the shopper their confirmation, the owner their new-order email, or the stock its count (store final check).
    try {
      await d.audit.log({ action: d.audit.ACTIONS.PAYMENT, entity: 'store_order', entityId: flipped.id, entityName: orderNumber, companyId,
        metadata: { description: `Order ${orderNumber} paid — ${formatCents(flipped.totalCents, flipped.currency)} by ${order.provider}` } })
    } catch (e: any) { logger.error('[store] paid order not audited', { order: order.id, error: e?.message }) }

    // The shopper is a customer (decision 2): an order begun before they gave an address is given its contact now,
    // from what the provider told us, before loyalty settles on that contact.
    let paid = flipped
    if (!paid.contactId) {
      try {
        const contactId = await core.shopperFor(companyId, { email: paid.customerEmail, name: paid.customerName, phone: paid.customerPhone })
        if (contactId) {
          ;[paid] = await db.update(storeOrder).set({ contactId }).where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId))).returning()
        }
      } catch (e: any) {
        logger.warn('[store] shopper contact not made', { order: order.id, error: e?.message })
      }
    }

    // Count discount-code usage exactly once (only the winning finalize reaches here).
    if (order.discountCode) {
      try { await countDiscountUse(db, companyId, order.discountCode) } catch { /* non-blocking */ }
    }

    // Loyalty settles HERE and nowhere else: points are earned on what was paid, and any reward the shopper picked at
    // checkout is charged for now rather than then — an abandoned cart must never burn someone's balance. Both halves
    // are keyed to the order id, so the webhook and the success page racing each other cannot pay or charge twice.
    // Never blocks a payment that already went through (core's settle never throws).
    void core.settleLoyaltyForPaidOrder(companyId, order.id)

    // Gift cards bought on this order are issued and emailed now (each keyed to its line, so never twice).
    try { await giftCards.issueForOrder(paid) } catch (e: any) { logger.error('[store] gift cards not issued', { order: order.id, error: e?.message }) }

    // Dropship: forward the paid order to the connected supplier. Fire-and-forget — supplier problems must never
    // block payment finalization; the sweep retries.
    void core.forwardOrderToSupplier(companyId, order.id).catch(() => { /* logged inside */ })

    // The decrement happens IN the update (server/data/storeCheckout.ts). Untracked stock is left alone.
    const items: Array<typeof storeOrderItem.$inferSelect> = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, order.id))
    // Low-stock alerts (store_low_stock): each variant this order took down to its level is claimed once in decrementStock,
    // and the owner gets ONE email for the order listing them — never one per sale.
    let alerts = false
    try { alerts = !!(await d.features.isFeatureEnabled(companyId, 'store_low_stock')) } catch { /* no alert rather than no stock count */ }
    const crossed: Array<LowStockCrossing & { productName: string }> = []
    for (const it of items) {
      if (!it.variantId) continue
      const crossing = await decrementStock(db, it.variantId, it.quantity, alerts)
      if (crossing) crossed.push({ ...crossing, productName: it.productName })
    }

    // Notify the buyer (confirmation) + the merchant (new order). Non-blocking — never fail the order because email
    // is down or unconfigured (core.mail never throws).
    try {
      const co = await core.shop()
      const mailOrder = emailOrder(paid)
      const mailItems = emailItems(items)
      void core.mail(paid.customerEmail, 'storeOrderConfirmation', { order: mailOrder, items: mailItems, supportEmail: co?.email }, co?.email)
      if (co?.email) void core.mail(co.email, 'storeMerchantNewOrder', { order: mailOrder, items: mailItems })
    } catch (e: any) {
      logger.warn('[store] order emails failed', { error: e?.message })
    }

    if (crossed.length) {
      try {
        const co = await core.shop()
        if (co?.email) void core.mail(co.email, 'storeLowStock', { items: crossed.map((x) => ({ productName: x.productName, variantName: x.variantName, sku: x.sku, quantity: x.quantity, lowStockAt: x.lowStockAt })), productsUrl: `${siteBase()}/crm/products?filter=low_stock` })
      } catch (e: any) {
        logger.warn('[store] low-stock email failed', { error: e?.message })
      }
    }

    logger.info('[store] order finalized', { order: orderNumber })
  }

  /**
   * The order the storefront's thank-you page shows (limited, non-sensitive). Stripe returns with ?session_id=<provider
   * session>; Square and PayPal with ?ref=<our order id>. If the webhook hasn't finalized it yet, payment is confirmed
   * with the provider directly and the order finalized now — so the confirmation page and the admin order are correct
   * even when the webhook is delayed, misconfigured, or intercepted. Null when there is no such order.
   */
  async function orderSummary(companyId: string, q: { ref?: string | null; sessionId?: string | null }): Promise<OrderSummary | null> {
    const mine = eq(storeOrder.companyId, companyId)
    const find = async (): Promise<Order | undefined> => (q.ref
      ? await db.select().from(storeOrder).where(and(eq(storeOrder.id, q.ref), mine)).limit(1)
      : await db.select().from(storeOrder).where(and(eq(storeOrder.providerSessionId, String(q.sessionId)), mine)).limit(1))[0]
    let order = await find()
    if (!order) return null

    if (order.status === 'pending') {
      try {
        const provider = await core.getActiveProvider(companyId)
        if (provider) {
          const result = await provider.retrieveSession(order.providerSessionId)
          if (result.type === 'paid') {
            await finalizeOrder(order, result)
            ;[order] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, order.id), mine)).limit(1)
          }
        }
      } catch (err: any) {
        logger.warn('[store] order-summary finalize failed', { error: err?.message })
      }
    }

    const items = await db.select({
      productName: storeOrderItem.productName, variantName: storeOrderItem.variantName,
      quantity: storeOrderItem.quantity, lineTotalCents: storeOrderItem.lineTotalCents, imageUrl: storeOrderItem.imageUrl,
    }).from(storeOrderItem).where(eq(storeOrderItem.orderId, order!.id))
    const o = order!
    const settings = o.fulfillment === 'pickup' ? await core.settings(companyId) : null
    return {
      orderNumber: o.orderNumber,
      status: o.status,
      email: o.customerEmail,
      subtotalCents: o.subtotalCents,
      // The thank-you page listed subtotal, shipping and tax and a total $3.70 short of them (E2E Run 2).
      discountCents: o.discountCents,
      loyaltyDiscountCents: o.loyaltyDiscountCents,
      discountCode: o.discountCode,
      shippingCents: o.shippingCents,
      taxCents: o.taxCents,
      totalCents: o.totalCents,
      // Sent back so far — a part refund shows as its own line under the total.
      refundedCents: o.refundedCents,
      currency: o.currency,
      giftCardCents: o.giftCardCents,
      fulfillment: o.fulfillment,
      pickup: settings ? { address: settings.pickupAddress || '', hours: settings.pickupHours || '' } : null,
      taxAutomatic: o.taxAutomatic,
      items,
    }
  }

  /**
   * Turn a recovery token back into a live checkout for the same items. Returns the address to send the shopper to:
   * the provider's payment page, or — already paid — their confirmation rather than a second charge. Null when the
   * cart is gone or the store cannot take payment.
   */
  async function resumeCheckout(companyId: string, token: string, requestOriginValue: string): Promise<string | null> {
    const [order]: Order[] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.recoveryToken, token))).limit(1)
    if (!order) return null
    const storefront = (requestOriginValue || siteBase()).replace(/\/$/, '')

    if (order.status !== 'pending') return `${storefront}/checkout/success?ref=${encodeURIComponent(order.id)}`

    const provider: PaymentProvider | null = await core.getActiveProvider(companyId)
    if (!provider) return null

    const items: Array<typeof storeOrderItem.$inferSelect> = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, order.id))
    if (!items.length) return null
    const pids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))]
    const cardsSold = new Set(pids.length ? (await db.select({ id: storeProduct.id, kind: storeProduct.kind }).from(storeProduct)
      .where(and(inArray(storeProduct.id, pids), eq(storeProduct.companyId, companyId)))).filter((p: any) => p.kind === 'gift_card').map((p: any) => p.id) : [])
    // Taxed as it was started: the store's rates kept on the order, or Stripe Tax again at the payment page (only while
    // the store still takes Stripe).
    const automaticTax = order.taxAutomatic && provider.name === 'stripe'

    const checkout = await provider.createCheckout({
      lineItems: items.map((i) => ({
        sku: i.sku,
        name: i.productName + (i.variantName ? ' - ' + i.variantName : ''),
        // The payment page takes only a picture it can fetch (placeOrder.ts checkoutImageUrl); the order keeps its own.
        imageUrl: checkoutImageUrl(i.imageUrl),
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        ...(i.productId && cardsSold.has(i.productId) ? { taxCode: GIFT_CARD_TAX_CODE } : {}),
      })),
      currency: order.currency,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      // What the gift card holds for this order is taken off too: the provider charges the rest.
      discountCents: order.discountCents + (order.giftCardCents || 0),
      customerEmail: order.customerEmail === NO_EMAIL_YET ? undefined : order.customerEmail,
      collectShippingAddress: order.fulfillment === 'ship',
      automaticTax,
      collectBillingAddress: automaticTax && order.fulfillment !== 'ship',
      successUrl: successUrlFor(provider.name, storefront, order.id),
      cancelUrl: `${storefront}/cart`,
      clientReferenceId: order.id,
      metadata: { orderId: order.id, recovered: 'true' },
    })

    // Point the order at the new session and record that recovery was attempted.
    await db.update(storeOrder)
      .set({ providerSessionId: checkout.providerSessionId, recoveredAt: new Date(), updatedAt: new Date() })
      .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))

    return checkout.redirectUrl
  }

  /**
   * Stale-cart sweep: checkouts that were started but never paid linger as 'pending'. Cancel any older than 7 days
   * (the abandoned-cart reminder needs room to work before a pending order is written off — it used to be cancelled
   * after 24h, unrecovered) so the orders list and revenue stats stay clean. Hourly and once at boot; never throws.
   */
  async function sweepStalePending(): Promise<number> {
    try {
      const co = await core.shop()
      if (!co) return 0
      const cutoff = new Date(Date.now() - STALE_PENDING_MS)
      const rows = await db.update(storeOrder)
        .set({ status: 'cancelled', updatedAt: new Date() })
        // A draft order is the owner's to cancel: its customer may pay from the emailed link at any time.
        .where(and(eq(storeOrder.companyId, co.id), eq(storeOrder.status, 'pending'), ne(storeOrder.source, 'draft'), lt(storeOrder.createdAt, cutoff)))
        .returning()
      for (const o of rows) await giftCards.release(o, 'Checkout never paid')
      return rows.length + await releaseExpiredHolds(co.id)
    } catch (e: any) {
      logger.warn('[store] stale-cart sweep failed', { error: e?.message })
      return 0
    }
  }

  /**
   * A checkout holding a gift card's money is written off once its payment page can no longer be paid (Stripe's session
   * lasts 24 hours; HOLD_EXPIRY_MS is a little more), and the hold goes back on the card - the shopper would otherwise
   * find the balance gone for a week. Cancelled conditionally (still pending AT the update), released once per order.
   */
  async function releaseExpiredHolds(companyId: string): Promise<number> {
    const rows = await db.update(storeOrder)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.status, 'pending'), ne(storeOrder.source, 'draft'),
        gt(storeOrder.giftCardCents, 0), lt(storeOrder.createdAt, new Date(Date.now() - HOLD_EXPIRY_MS))))
      .returning()
    for (const o of rows) await giftCards.release(o, 'Checkout never paid')
    return rows.length
  }

  /**
   * Abandoned carts: a pending order is an abandoned cart (checkout writes the order and its items before the shopper
   * reaches the payment page). Email one reminder per cart with a link straight back to checkout, then let it age out.
   * Before this, every abandoned cart was cancelled silently and never followed up.
   */
  async function sweepAbandonedCarts(): Promise<{ emailed: number; cancelled: number }> {
    const co = await core.shop()
    if (!co) return { emailed: 0, cancelled: 0 }
    const settings = await core.settings(co.id)

    let emailed = 0
    if (settings.abandonedCartEnabled) {
      const delayMs = Math.max(5, settings.abandonedCartDelayMinutes ?? 60) * 60 * 1000
      const cutoff = new Date(Date.now() - delayMs)
      const stale: Order[] = await db.select().from(storeOrder).where(and(
        eq(storeOrder.companyId, co.id),
        eq(storeOrder.status, 'pending'),
        lt(storeOrder.createdAt, cutoff),
        isNull(storeOrder.abandonedEmailSentAt),
        isNotNull(storeOrder.customerEmail),
        ne(storeOrder.customerEmail, NO_EMAIL_YET),
        // A draft order was emailed its own link (the invoice); it is not a cart someone left.
        ne(storeOrder.source, 'draft'),
      ))

      for (const order of stale) {
        try {
          const items: Array<typeof storeOrderItem.$inferSelect> = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, order.id))
          if (!items.length) continue

          const token = order.recoveryToken || newRecoveryToken()
          const recoverUrl = `${siteBase()}/api/public/recover/${token}`

          // Claim it first — still unclaimed AT the update: a send that throws must not be retried forever, and two
          // passes at once send one reminder.
          const claimed = await db.update(storeOrder)
            .set({ recoveryToken: token, abandonedEmailSentAt: new Date(), updatedAt: new Date() })
            .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, co.id), isNull(storeOrder.abandonedEmailSentAt)))
            .returning({ id: storeOrder.id })
          if (!claimed.length) continue

          const sent = await core.mail(order.customerEmail, 'storeAbandonedCart', {
            order: emailOrder(order), items: emailItems(items), recoverUrl, supportEmail: co.email,
          }, co.email)
          if (sent) emailed++
        } catch (err: any) {
          logger.warn('[store] abandoned cart email failed', { orderId: order.id, error: err?.message })
        }
      }
    }

    // Age out what never came back.
    const cancelCutoff = new Date(Date.now() - STALE_PENDING_MS)
    const cancelled = await db.update(storeOrder)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(storeOrder.companyId, co.id), eq(storeOrder.status, 'pending'), ne(storeOrder.source, 'draft'), lt(storeOrder.createdAt, cancelCutoff)))
      .returning()
    for (const o of cancelled) await giftCards.release(o, 'Checkout never paid')

    return { emailed, cancelled: cancelled.length + await releaseExpiredHolds(co.id) }
  }

  /** Approved reviews for one of the company's products, newest first. */
  async function approvedReviews(companyId: string, productId: string, limit = 50) {
    return db.select({
      id: productReview.id,
      authorName: productReview.authorName,
      rating: productReview.rating,
      title: productReview.title,
      body: productReview.body,
      verifiedPurchase: productReview.verifiedPurchase,
      createdAt: productReview.createdAt,
    })
      .from(productReview)
      .where(and(eq(productReview.companyId, companyId), eq(productReview.productId, productId), eq(productReview.status, 'approved')))
      .orderBy(desc(productReview.createdAt))
      .limit(limit)
  }

  /**
   * One review request per order, a configurable number of days after it ships. Never asks twice —
   * review_request_sent_at is claimed before sending.
   */
  async function sweepReviewRequests(): Promise<{ sent: number }> {
    const co = await core.shop()
    if (!co) return { sent: 0 }
    const settings = await core.settings(co.id)
    if (!settings.reviewsEnabled) return { sent: 0 }

    const days = Math.max(1, settings.reviewRequestDays ?? 7)
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const storefront = siteBase()

    const due: Order[] = await db.select().from(storeOrder).where(and(
      eq(storeOrder.companyId, co.id),
      inArray(storeOrder.status, ['shipped', 'delivered', 'fulfilled']),
      isNull(storeOrder.reviewRequestSentAt),
      isNotNull(storeOrder.customerEmail),
      lt(storeOrder.updatedAt, cutoff),
    ))

    let sent = 0
    for (const order of due) {
      try {
        const items: Array<typeof storeOrderItem.$inferSelect> = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, order.id))
        if (!items.length) continue

        // Claim before sending so a failure cannot loop (and two passes at once ask once). updatedAt is kept: the
        // request is not a change to the order.
        const claimed = await db.update(storeOrder)
          .set({ reviewRequestSentAt: new Date(), updatedAt: order.updatedAt })
          .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, co.id), isNull(storeOrder.reviewRequestSentAt)))
          .returning({ id: storeOrder.id })
        if (!claimed.length) continue

        const [firstItem] = items
        const [prod] = firstItem?.productId
          ? await db.select({ slug: storeProduct.slug }).from(storeProduct)
            .where(and(eq(storeProduct.id, firstItem.productId), eq(storeProduct.companyId, co.id))).limit(1)
          : []

        const ok = await core.mail(order.customerEmail, 'storeReviewRequest', {
          order: emailOrder(order), items: emailItems(items),
          reviewUrl: prod?.slug ? `${storefront}/product/${prod.slug}#reviews` : storefront,
          supportEmail: co.email,
        }, co.email)
        if (ok) sent++
      } catch (err: any) {
        logger.warn('[store] review request failed', { orderId: order.id, error: err?.message })
      }
    }
    return { sent }
  }

  return { finalizeOrder, orderSummary, resumeCheckout, sweepStalePending, sweepAbandonedCarts, approvedReviews, sweepReviewRequests }
}
export type CheckoutService = ReturnType<typeof createCheckoutService>
