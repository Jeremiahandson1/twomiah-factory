// /api/public — the storefront's API: the shop's status and settings, the catalogue, the loyalty quote, checkout, the
// payment and supplier webhooks, product reviews, cart recovery and the order summary. No sign-in: a shopper's browser
// (the cart script, same origin) and the payment providers. Moved from templates/crm-store/backend/src/routes/public.ts,
// with the rate limits index.ts put in front of it.
//
// The business is the oldest company row (one business per tenant database, SPEC §2): core.shop().
//
// Other public routers share the /api/public prefix (/api/public/ads-experiments is mounted for every vertical), so
// nothing here is applied to '*': the store-closed door and the rate limits are on this router's own paths only.
//
// Changes from the template:
//   · every query is the company's (company_id); the shop's name and support email are the company row's;
//   · the success, cancel and recovery addresses are built from the REQUEST's origin (x-forwarded-host / host,
//     x-forwarded-proto), else SITE_URL — never from a body field. The template took `origin` from the body (its
//     storefront proxy added it); a shopper's redirect after paying must not be steerable by whoever sends the request,
//     and the storefront is now this app. A body `origin` is ignored;
//   · at checkout the shopper becomes a contact (decision 2: core.shopperFor), its id on orders.contact_id; loyalty is
//     core's (by contact);
//   · a loyalty reward's id is the shared programme's (a cuid2), so the body's loyaltyRewardId is any short id, not a
//     uuid;
//   · the order's id is the app's (cuid2) and its number ORD-<first 8 characters> (checkoutService.orderNumberFor);
//   · GET /loyalty fails soft exactly as the storefront's proxy did (storeApi.ts fetchLoyaltyQuote): no email, the
//     programme off, or any error → 200 with the empty quote; subtotalCents floored and clamped to 0…10,000,000;
//   · the refund notices and the supplier's "shipped" go to the orders group (OrderHooks: applyProviderRefund,
//     applyRefundUpdate, mayMove — the template imported them from routes/orders.ts). Until they are wired those two
//     notices answer 503 so the provider retries and nothing is lost;
//   · replies through reply.ts (RULEBOOK §3): one record is the record itself — GET /products/:slug, /settings and
//     /order-summary no longer wrap it ({ product }, { settings }, { order }); the product list is
//     { data, pagination }; an unknown order is 404 (was 200 { order: null }); a webhook acknowledgement is
//     { success: true } (was { received: true }); a submitted review is 201 { success, message } (was { ok, message });
//     a refused cart is 400 { error: 'Invalid cart', code: 'validation_failed', fields };
//   · the cart-recovery link's two refusals stay plain text (it is a page a shopper opens from an email, not an API).
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { createId } from '@paralleldrive/cuid2'
import { and, eq, inArray } from 'drizzle-orm'
import {
  discountCode, paymentConfig, productReview, storeOrder, storeOrderItem, storeProduct, storeProductImage, storeProductVariant,
  type ShippingZone, type TaxRate,
} from '../../../db/schema/store.ts'
import { ratingSummaries, verifyingOrderId } from '../../../data/storeCheckout.ts'
import { createRateLimiter } from '../../../http/guards.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import type { WebhookResult } from '../payments/types.ts'
import { activeProductRow, storefrontCatalogue, storefrontProduct } from './catalogue.ts'
import { NO_EMAIL_YET, orderNumberFor, requestOrigin, successUrlFor, type CheckoutService } from './checkoutService.ts'

/** What the orders group lends the webhooks (server/crm/store/orders): the lifecycle, and a provider's refund notice applied. */
export interface OrderHooks {
  /** May an order go from `from` to `to` (orders' NEXT_STATUS; a same-status save is not a move)? */
  mayMove(from: string, to: string): boolean
  /** A refund made in the provider's own dashboard, by the payment's running total. */
  applyProviderRefund(companyId: string, provider: string, providerPaymentId: string, refundedCents: number, chargeCents: number): Promise<string>
  /** The provider's word on one refund, by its id: the store's own refund echoing back is matched, never counted twice. */
  applyRefundUpdate(companyId: string, provider: string, refundId: string, outcome: 'completed' | 'failed', reason?: string): Promise<string>
}

/** What a shopper is told when the loyalty quote cannot be answered — never an error (the storefront's EMPTY_QUOTE). */
export const EMPTY_QUOTE = {
  pointsBalance: 0,
  punchCard: { enabled: false, visitsRequired: 0, progress: 0, remaining: 0, unclaimed: 0 },
  rewards: [] as unknown[],
}

// ── Checkout: prices are ALWAYS computed server-side from the DB ──────────────
// Shipping: first matching zone (by the buyer's ship-to region) wins, else the flat rate. Free-shipping thresholds
// apply per-zone or via the flat threshold.
export function computeShipping(settings: any, subtotalCents: number, shipTo?: { country?: string; state?: string }): number {
  const zones: ShippingZone[] = settings?.shippingZones || []
  if (shipTo && zones.length) {
    const c = (shipTo.country || '').toUpperCase()
    const s = (shipTo.state || '').toUpperCase()
    const zone = zones.find((z) =>
      (!z.countries?.length || z.countries.map((x) => x.toUpperCase()).includes(c)) &&
      (!z.states?.length || z.states.map((x) => x.toUpperCase()).includes(s)))
    if (zone) {
      if (zone.freeThresholdCents != null && subtotalCents >= zone.freeThresholdCents) return 0
      return Math.max(0, zone.rateCents || 0)
    }
  }
  const threshold = settings?.freeShippingThresholdCents ?? null
  return threshold !== null && subtotalCents >= threshold ? 0 : (settings?.flatShippingCents ?? 0)
}

// Tax: first matching region rate wins, else the flat taxRateBps.
export function computeTaxBps(settings: any, shipTo?: { country?: string; state?: string }): number {
  const rates: TaxRate[] = settings?.taxRates || []
  if (shipTo && rates.length) {
    const c = (shipTo.country || '').toUpperCase()
    const s = (shipTo.state || '').toUpperCase()
    const r = rates.find((r) =>
      (!r.country || r.country.toUpperCase() === c) &&
      (!r.state || r.state.toUpperCase() === s))
    if (r) return Math.max(0, r.rateBps || 0)
  }
  return settings?.taxRateBps ?? 0
}

/**
 * THE PICTURE A PAYMENT PAGE MAY SHOW. (Live, Stripe test mode, 10/12: the first checkout on the test store answered
 * 502 'Could not start checkout'; Stripe's reason, from the log, was 'Not a valid URL'.)
 *
 * Stripe takes a product image only as a public https address (pasted images are held to https already). The sample
 * products every new store is seeded with carry their placeholder picture as a data: URI, so the very first test order
 * a new owner placed — on the products the store came with — failed, and the order never existed. An image is
 * decoration on the payment page, never a reason to refuse the payment: a picture Stripe cannot fetch is left off, and
 * the shopper still pays.
 */
export const checkoutImageUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined
  try { const u = new URL(url); return u.protocol === 'https:' ? u.href : undefined } catch { return undefined }
}

const checkoutSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive().max(999),
  })).min(1).max(100),
  customerEmail: z.string().email().optional(),
  // Optional ship-to region (from the cart) → region shipping/tax. Falls back to flat rates when absent.
  shipTo: z.object({ country: z.string().max(2), state: z.string().max(16) }).partial().optional(),
  discountCode: z.string().max(64).optional(),
  // A loyalty reward the shopper chose. Only an id travels — what it is worth is decided by the server against this
  // cart, exactly like the discount code above, because the client is not a trustworthy source of how much money to
  // take off.
  loyaltyRewardId: z.string().min(1).max(64).optional(),
})

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  authorName: z.string().min(1).max(80),
  authorEmail: z.string().email().optional(),
  title: z.string().max(120).optional(),
  body: z.string().max(4000).optional(),
})

const fieldsOf = (error: z.ZodError): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (const i of error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
  return fields
}

const headersOf = (c: Context): Record<string, string> => {
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
  return headers
}

export function createStorePublicRoutes(d: CrmDeps, core: StoreCore, checkout: CheckoutService, orders?: OrderHooks) {
  const { db, logger } = d
  const pub = new Hono()
  const isProd = process.env.NODE_ENV === 'production'

  // ── A store whose subscription ended is UNAVAILABLE to shoppers too (10/14) ─────────────────────────────────────
  // Owner: "what do the pros do? shopify?" — a frozen Shopify store shows "This store is unavailable": no browsing, no
  // checkout, admin closed, until the bill is paid. Same rule, same summary (the company's subscription), on the
  // shopper's side:
  //   - GET /status always answers — the storefront asks it to decide whether to show its "unavailable" page;
  //   - the payment and supplier WEBHOOKS stay open, so money already in flight (paid a moment before the lock) still
  //     lands and its order is finalised; and the order summary stays open, so that shopper still sees their receipt;
  //   - everything else — the catalogue, the cart's loyalty quote, checkout, reviews, cart recovery — answers 503.
  // Applied to each of those routes by name (below), never to '*': this router shares /api/public with others.
  const shopperDoor: MiddlewareHandler = async (c, next) => {
    if (await core.isClosed()) return fail(c, 503, 'This store is unavailable right now.', 'STORE_UNAVAILABLE')
    await next()
  }

  /** The shop, or the reply to give instead (not provisioned yet). */
  const theShop = async (c: Context) => {
    const co = await core.shop()
    if (!co) return { reply: fail(c, 503, 'This store is not set up yet') }
    return { co }
  }

  // Webhooks are excluded from rate limiting (signature-verified, provider-driven).
  // ('/products/*' also matches /products itself.)
  pub.use('/products/*', createRateLimiter(15 * 60 * 1000, isProd ? 600 : 5000))
  pub.use('/checkout', createRateLimiter(15 * 60 * 1000, isProd ? 60 : 1000))

  pub.get('/status', async (c) => {
    const co = await core.shop()
    // Only THAT it is unavailable and the shop's name — never why, and nothing about the bill.
    return one(c, { open: !(await core.isClosed()), storeName: co?.name ?? null })
  })

  // ── Catalog reads (public, active products only) ─────────────────────────────
  pub.get('/products', shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const rows = await storefrontCatalogue(d, s.co.id)
    return listAll(c, rows)
  })

  pub.get('/products/:slug', shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const product = await storefrontProduct(d, s.co.id, c.req.param('slug'))
    if (!product) return fail(c, 404, 'Not found')
    return one(c, product)
  })

  // Safe public subset of store settings (branding + shipping display).
  pub.get('/settings', shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const settings = await core.settings(s.co.id)
    const [cfg] = await db.select({ connected: paymentConfig.connected }).from(paymentConfig)
      .where(and(eq(paymentConfig.companyId, s.co.id), eq(paymentConfig.connected, true))).limit(1)
    return one(c, {
      companyName: s.co.name,
      supportEmail: s.co.email,
      currency: settings.currency,
      flatShippingCents: settings.flatShippingCents,
      freeShippingThresholdCents: settings.freeShippingThresholdCents,
      taxRateBps: settings.taxRateBps,
      checkoutEnabled: !!cfg,
    })
  })

  /**
   * What this shopper can claim against the cart they are holding.
   *
   * Deliberately narrow. There is no shopper login on this storefront, so anyone who knows an address could ask — which
   * means this answers only what that person is about to be offered at checkout: a balance, a card position, and the
   * rewards that apply to THIS cart. It returns no order history, no name, no address, and nothing that would turn a
   * guessed email into a profile. An unknown address gets the same shape with a zero balance rather than a 404, so the
   * endpoint cannot be used to test whether someone shops here.
   */
  pub.get('/loyalty', shopperDoor, async (c) => {
    const email = String(c.req.query('email') || '').trim()
    // Floored and coerced rather than trusted: this value comes off a query string.
    const subtotalCents = Math.max(0, Math.min(10_000_000, Math.floor(Number(c.req.query('subtotalCents')) || 0)))
    try {
      const co = await core.shop()
      if (!co || !email) return one(c, EMPTY_QUOTE)
      if (!(await core.loyaltySettings(co.id)).enabled) return one(c, EMPTY_QUOTE)
      const quote = await core.availableRewards(co.id, email, subtotalCents)
      return one(c, {
        pointsBalance: quote.pointsBalance,
        punchCard: quote.punchCard,
        rewards: quote.rewards.map((r) => ({
          id: r.id, name: r.name, description: r.description,
          pointsCost: r.pointsCost, discountCents: r.discountCents,
          available: r.available, reason: r.reason, onTheHouse: r.onTheHouse,
        })),
      })
    } catch {
      // A loyalty problem must never stop someone shopping.
      return one(c, EMPTY_QUOTE)
    }
  })

  pub.post('/checkout', shopperDoor, async (c) => {
    const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Invalid cart', 'validation_failed', fieldsOf(parsed.error))
    const s = await theShop(c); if (s.reply) return s.reply
    const companyId = s.co.id

    const provider = await core.getActiveProvider(companyId)
    if (!provider) return fail(c, 503, 'This store is not accepting orders yet')

    const settings = await core.settings(companyId)
    const currency = settings.currency ?? 'usd'

    // Collapse duplicate SKUs, then load the real variants (trusted prices) — of this company's products.
    const wanted = new Map<string, number>()
    for (const it of parsed.data.items) wanted.set(it.sku, (wanted.get(it.sku) ?? 0) + it.quantity)
    const skus = [...wanted.keys()]

    const found: Array<{ v: typeof storeProductVariant.$inferSelect; p: typeof storeProduct.$inferSelect }> = await db
      .select({ v: storeProductVariant, p: storeProduct })
      .from(storeProductVariant)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(and(inArray(storeProductVariant.sku, skus), eq(storeProduct.companyId, companyId)))
    if (found.length === 0) return fail(c, 400, 'None of these items are available')
    const prodIds = [...new Set(found.map((r) => r.p.id))]

    const lineItems: {
      sku: string; name: string; description?: string; imageUrl?: string
      unitPriceCents: number; quantity: number
      productId: string; variantId: string; variantName: string; productName: string
    }[] = []

    // Only sell variants whose product is active.
    for (const { v, p } of found) {
      if (p.status !== 'active') continue
      const qty = wanted.get(v.sku)!
      if (v.inventoryQty !== null && v.inventoryQty < qty) {
        return fail(c, 409, `Only ${v.inventoryQty} of ${p.name} left`)
      }
      lineItems.push({
        sku: v.sku,
        name: v.name && v.name !== p.name ? `${p.name} — ${v.name}` : p.name,
        description: p.tagline ?? undefined,
        unitPriceCents: v.priceCents,
        quantity: qty,
        productId: p.id,
        variantId: v.id,
        variantName: v.name,
        productName: p.name,
      })
    }
    if (lineItems.length === 0) return fail(c, 400, 'None of these items are available')

    // Attach a primary image per product for the checkout display.
    const imgs: Array<typeof storeProductImage.$inferSelect> = await db.select().from(storeProductImage).where(inArray(storeProductImage.productId, prodIds))
    for (const li of lineItems) {
      const img = imgs.find((i) => i.productId === li.productId && i.isPrimary)
        ?? imgs.find((i) => i.productId === li.productId)
      const shown = checkoutImageUrl(img?.url)
      if (shown) li.imageUrl = shown
    }

    // ── Server-computed totals (never trust the client) ──
    const subtotalCents = lineItems.reduce((a, li) => a + li.unitPriceCents * li.quantity, 0)

    // Validate + apply a discount code server-side (never trust the client).
    let discountCents = 0
    let appliedCode: string | null = null
    if (parsed.data.discountCode) {
      const code = parsed.data.discountCode.trim().toUpperCase()
      const [dc] = await db.select().from(discountCode).where(and(eq(discountCode.companyId, companyId), eq(discountCode.code, code))).limit(1)
      if (dc && dc.active
          && (!dc.expiresAt || dc.expiresAt > new Date())
          && (dc.maxUses == null || dc.usedCount < dc.maxUses)
          && subtotalCents >= dc.minSubtotalCents) {
        discountCents = dc.type === 'percent'
          ? Math.min(subtotalCents, Math.round(subtotalCents * dc.value / 100))
          : Math.min(subtotalCents, dc.value)
        appliedCode = dc.code
      }
    }

    // A loyalty reward, priced by the server against this cart. The points are NOT spent here — that happens at
    // finalizeOrder, so an abandoned checkout costs the shopper nothing. Kept apart from the code discount so the books
    // can still say which was which, and the two together are capped at the subtotal rather than being allowed to make
    // an order pay the customer.
    let loyaltyDiscountCents = 0
    let loyaltyRewardId: string | null = null
    if (parsed.data.loyaltyRewardId && parsed.data.customerEmail) {
      try {
        const quoted = await core.quoteRewardForCheckout(companyId, parsed.data.customerEmail, parsed.data.loyaltyRewardId, subtotalCents)
        loyaltyDiscountCents = Math.max(0, Math.min(quoted, subtotalCents - discountCents))
        if (loyaltyDiscountCents > 0) loyaltyRewardId = parsed.data.loyaltyRewardId
      } catch { /* a loyalty problem must not stop a customer paying */ }
    }
    const totalDiscountCents = Math.min(subtotalCents, discountCents + loyaltyDiscountCents)

    const shippingCents = computeShipping(settings, subtotalCents, parsed.data.shipTo)
    const taxCents = Math.round(Math.max(0, subtotalCents - totalDiscountCents) * (computeTaxBps(settings, parsed.data.shipTo) / 10000))
    const totalCents = Math.max(0, subtotalCents - totalDiscountCents) + shippingCents + taxCents

    // The origin the shopper is actually on — from the request, never the body (see the header).
    const storefront = requestOrigin(c).replace(/\/+$/, '')

    // The shopper is a customer (decision 2), found by email or made now.
    let contactId: string | null = null
    if (parsed.data.customerEmail) {
      try { contactId = await core.shopperFor(companyId, { email: parsed.data.customerEmail }) } catch (e: any) {
        logger.warn('[store] shopper contact not made at checkout', { error: e?.message })
      }
    }

    // Create a pending order FIRST so a webhook (or the success page) can reconcile by provider session id. Idempotency
    // is guaranteed by the unique (provider, provider_session_id) index; abandoned checkouts stay 'pending'. Assign the
    // order number at CREATION, not at payment — an abandoned/pending order should still be traceable by number. It's
    // deterministic from the id, so finalizeOrder keeps the identical value (no conflict).
    const orderId = createId()
    const [order] = await db.insert(storeOrder).values({
      id: orderId,
      companyId,
      contactId,
      orderNumber: orderNumberFor(orderId),
      provider: provider.name,
      providerSessionId: `pending_${createId()}`, // replaced with real id below
      status: 'pending',
      customerEmail: parsed.data.customerEmail ?? NO_EMAIL_YET,
      subtotalCents, shippingCents, taxCents,
      // discountCents stays the TOTAL taken off, so every existing reader (totals, exports, refunds) keeps working;
      // the loyalty share is recorded alongside it rather than hidden inside it.
      discountCents: totalDiscountCents, discountCode: appliedCode,
      loyaltyRewardId, loyaltyDiscountCents,
      totalCents, currency,
    }).returning()

    try {
      const session = await provider.createCheckout({
        lineItems: lineItems.map((li) => ({
          name: li.name, description: li.description, imageUrl: li.imageUrl,
          unitPriceCents: li.unitPriceCents, quantity: li.quantity, sku: li.sku,
        })),
        currency,
        shippingCents,
        taxCents,
        // EVERYTHING taken off — the code AND the loyalty reward. This passed `discountCents` (the code alone), so a
        // shopper who redeemed a reward was charged full price while the order said otherwise, and their points were
        // spent at payment anyway. The amount the provider charges must be the order's totalCents.
        discountCents: totalDiscountCents,
        customerEmail: parsed.data.customerEmail,
        collectShippingAddress: true,
        successUrl: successUrlFor(provider.name, storefront, order.id),
        cancelUrl: `${storefront}/cart`,
        clientReferenceId: order.id,
        metadata: { orderId: order.id },
      })

      await db.update(storeOrder)
        .set({ providerSessionId: session.providerSessionId, updatedAt: new Date() })
        .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))

      await db.insert(storeOrderItem).values(lineItems.map((li) => ({
        orderId: order.id,
        productId: li.productId,
        variantId: li.variantId,
        productName: li.productName,
        variantName: li.variantName,
        sku: li.sku,
        imageUrl: li.imageUrl ?? null,
        unitPriceCents: li.unitPriceCents,
        quantity: li.quantity,
        lineTotalCents: li.unitPriceCents * li.quantity,
      })))

      return one(c, { url: session.redirectUrl })
    } catch (err: any) {
      // Roll back the pending order so a failed provider call leaves no orphan.
      await db.delete(storeOrder).where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))
      logger.error('[store] checkout failed', { error: err?.message })
      return fail(c, 502, 'Could not start checkout')
    }
  })

  // ── Webhooks: signature-verified, idempotent ─────────────────────────────────
  // Supplier shipment webhook (Printful). Verified by the URL token we embedded when auto-configuring the webhook at
  // connect time. Writes tracking through the same fields as manual fulfillment so the shipped email reuses.
  pub.post('/webhooks/supplier', async (c) => {
    const rawBody = await c.req.text()
    const s = await theShop(c); if (s.reply) return s.reply
    const companyId = s.co.id
    const active = await core.getActiveSupplier(companyId)
    if (!active) return fail(c, 400, 'No supplier configured')
    let result
    try {
      result = await active.provider.verifyAndParseWebhook({ rawBody, headers: headersOf(c), urlToken: c.req.query('t') || undefined })
    } catch (err: any) {
      logger.warn('[store] supplier webhook rejected', { error: err?.message })
      return fail(c, 400, 'Invalid webhook')
    }
    if (result.type !== 'shipped') return done(c)

    const mine = eq(storeOrder.companyId, companyId)
    let order: typeof storeOrder.$inferSelect | undefined
    if (result.externalId) {
      ;[order] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, result.externalId), mine)).limit(1)
    }
    if (!order && result.supplierOrderId) {
      ;[order] = await db.select().from(storeOrder).where(and(eq(storeOrder.supplierOrderId, result.supplierOrderId), mine)).limit(1)
    }
    if (!order) {
      logger.warn('[store] supplier webhook for unknown order', { supplierOrderId: result.supplierOrderId })
      return done(c)
    }
    // The lifecycle is the orders group's; until it is wired the notice is refused so the supplier sends it again.
    if (!orders) return fail(c, 503, 'Orders are not ready to take this notice yet')
    // The supplier's word is recorded whatever the order's state — tracking and supplier status are facts. The ORDER
    // moves to shipped only where the lifecycle allows it (orders' NEXT_STATUS, the rule every admin move is held to):
    // a cancelled or refunded order stays so, rather than reading "shipped" over a refund, and a delivered one does not
    // step back. The status condition is in the UPDATE, so a refund landing at the same moment wins cleanly.
    const moves = order.status !== 'shipped' && orders.mayMove(order.status, 'shipped')
    const [updated] = await db.update(storeOrder).set({
      ...(moves ? { status: 'shipped' as const, fulfilledAt: new Date() } : {}),
      supplierStatus: 'shipped',
      trackingCarrier: result.trackingCarrier,
      trackingNumber: result.trackingNumber,
      updatedAt: new Date(),
    }).where(moves ? and(eq(storeOrder.id, order.id), mine, eq(storeOrder.status, order.status)) : and(eq(storeOrder.id, order.id), mine)).returning()
    if (moves && updated) void core.notifyShipped(updated)
    if (!moves && order.status !== 'shipped') logger.warn('[store] supplier shipped an order that is not open to ship', { order: order.id, status: order.status })
    return done(c)
  })

  pub.post('/webhooks/payment', async (c) => {
    const rawBody = await c.req.text()
    const headers = headersOf(c)
    const signature = headers['stripe-signature']
      || headers['x-square-hmacsha256-signature']
      || headers['paypal-transmission-sig']

    const s = await theShop(c); if (s.reply) return s.reply
    const companyId = s.co.id
    const provider = await core.getActiveProvider(companyId)
    if (!provider) return fail(c, 400, 'No provider configured')

    let result: WebhookResult
    try {
      result = await provider.verifyAndParseWebhook({ rawBody, signature, headers })
    } catch (err: any) {
      logger.warn('[store] webhook signature rejected', { error: err?.message })
      return fail(c, 400, 'Invalid signature')
    }

    // A notice naming one refund is first matched to the store's own (its echo is never counted twice; a refund the
    // provider was holding is settled, or given back on a failure). Anything else is a dashboard refund, by running
    // total. Both are the orders group's; until it is wired the notice is refused so the provider sends it again.
    if (result.type === 'refund_failed' || (result.type === 'refunded' && result.providerPaymentId)) {
      if (!orders) return fail(c, 503, 'Orders are not ready to take this notice yet')
      if (result.type === 'refund_failed') {
        const outcome = result.providerRefundId ? await orders.applyRefundUpdate(companyId, provider.name, result.providerRefundId, 'failed', result.refundFailureReason) : 'unknown'
        logger.info('[store] refund failure notification', { outcome })
        return done(c)
      }
      const ours = result.providerRefundId ? await orders.applyRefundUpdate(companyId, provider.name, result.providerRefundId, 'completed') : 'unknown'
      const outcome = ours !== 'unknown' ? ours : await orders.applyProviderRefund(companyId, provider.name, result.providerPaymentId!, result.amountRefundedCents ?? 0, result.amountTotalCents ?? 0)
      logger.info('[store] refund notification', { outcome })
      return done(c)
    }
    if (result.type !== 'paid' || !result.providerSessionId) return done(c)

    const [order] = await db.select().from(storeOrder)
      .where(and(eq(storeOrder.companyId, companyId), eq(storeOrder.provider, provider.name), eq(storeOrder.providerSessionId, result.providerSessionId)))
      .limit(1)
    if (!order) {
      logger.warn('[store] webhook for unknown session', { session: result.providerSessionId })
      return done(c)
    }
    await checkout.finalizeOrder(order, result)
    return done(c)
  })

  // ── Reviews ─────────────────────────────────────────────────────────────────
  pub.get('/products/:slug/reviews', shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const row = await activeProductRow(db, s.co.id, c.req.param('slug'))
    if (!row) return fail(c, 404, 'Not found')
    const [reviews, summary] = await Promise.all([checkout.approvedReviews(s.co.id, row.id), ratingSummaries(db, s.co.id, [row.id])])
    return one(c, { reviews, summary: summary[row.id] ?? { average: 0, count: 0 } })
  })

  pub.post('/products/:slug/reviews', shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const settings = await core.settings(s.co.id)
    if (settings.reviewsEnabled === false) return fail(c, 403, 'Reviews are turned off')

    const parsed = reviewSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Please give a rating from 1 to 5 and your name', 'validation_failed', fieldsOf(parsed.error))

    const row = await activeProductRow(db, s.co.id, c.req.param('slug'))
    if (!row) return fail(c, 404, 'Not found')

    const orderId = parsed.data.authorEmail ? await verifyingOrderId(db, s.co.id, row.id, parsed.data.authorEmail) : null

    await db.insert(productReview).values({
      companyId: s.co.id,
      productId: row.id,
      orderId,
      authorName: parsed.data.authorName.trim(),
      authorEmail: parsed.data.authorEmail ?? null,
      rating: parsed.data.rating,
      title: parsed.data.title?.trim() || null,
      body: parsed.data.body?.trim() || null,
      verifiedPurchase: !!orderId,
      status: 'pending',
    })

    // Deliberately not published on submit: the owner approves first.
    return one(c, { success: true, message: 'Thanks! Your review will appear once it is approved.' }, 201)
  })

  // ── Abandoned cart recovery ─────────────────────────────────────────────────
  // The link in the reminder email. Rebuilds a checkout for the same items and bounces the customer straight to the
  // payment page.
  pub.get('/recover/:token', shopperDoor, async (c) => {
    try {
      const co = await core.shop()
      const url = co ? await checkout.resumeCheckout(co.id, c.req.param('token'), requestOrigin(c)) : null
      if (!url) return c.text('This cart is no longer available.', 404)
      return c.redirect(url)
    } catch (err: any) {
      logger.error('[store] cart recovery failed', { error: err?.message })
      return c.text('We could not reopen that cart. Please contact us.', 500)
    }
  })

  // Order confirmation for the storefront success page (limited, non-sensitive).
  pub.get('/order-summary', async (c) => {
    // Stripe returns with ?session_id=<providerSessionId>; Square/PayPal return with ?ref=<our order id>. Either
    // resolves to the same order.
    const sessionId = c.req.query('session_id')
    const ref = c.req.query('ref')
    if (!sessionId && !ref) return fail(c, 400, 'Missing session_id')
    const s = await theShop(c); if (s.reply) return s.reply
    const summary = await checkout.orderSummary(s.co.id, { ref, sessionId })
    if (!summary) return fail(c, 404, 'Order not found')
    return one(c, summary)
  })

  return pub
}
