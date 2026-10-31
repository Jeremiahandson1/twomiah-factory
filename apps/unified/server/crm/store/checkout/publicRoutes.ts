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
import { and, eq } from 'drizzle-orm'
import { productReview, storeOrder } from '../../../db/schema/store.ts'
import { ratingSummaries, verifyingOrderId } from '../../../data/storeCheckout.ts'
import { createRateLimiter } from '../../../http/guards.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import type { WebhookResult } from '../payments/types.ts'
import { activeProductRow, cartUpsell, storefrontCatalogue, storefrontProduct } from './catalogue.ts'
import { requestOrigin, type CheckoutService } from './checkoutService.ts'
import { createOrderStarter, usesStripeTax } from './placeOrder.ts'
import { createFeedRoutes } from './feeds.ts'
import { createStoreGiftCards } from '../giftCards.ts'
import { createShopperAccounts } from '../accounts/shopperAccounts.ts'
import { shopperOf } from '../accounts/routes.ts'
import { pricingForContact } from '../catalog/groupPricing.ts'
import { createPaymentNotices, type PaymentNotices } from './paymentNotices.ts'

export { computeShipping, computeTaxBps, checkoutImageUrl } from './placeOrder.ts'

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

// ── Checkout: prices are ALWAYS computed server-side from the DB (./placeOrder.ts) ──────────────
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
  // A gift card the shopper pays part or all of the order with; its balance is held when the order is written.
  giftCardCode: z.string().trim().min(4).max(40).optional(),
  // Ship it, or collect it from the shop (offered when the store has pickup on). A cart of gift cards needs neither.
  delivery: z.enum(['ship', 'pickup']).optional(),
  // Accelerated checkout (store_fast_checkout) — honoured only for a signed-in shopper: "keep my card" and "pay with my kept card".
  saveCard: z.boolean().optional(),
  useSavedCard: z.boolean().optional(),
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

export function createStorePublicRoutes(d: CrmDeps, core: StoreCore, checkout: CheckoutService, orders?: OrderHooks, paymentNotices?: PaymentNotices) {
  const { db, logger } = d
  const giftCards = createStoreGiftCards(d, core)
  const starter = createOrderStarter(d, core, checkout, giftCards)
  // The provider's word on an order, applied by the one rule the Connect forwarder's events use too (./paymentNotices.ts).
  const notices = paymentNotices ?? createPaymentNotices(d, core, checkout, orders)
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
  // A gift card's balance by its number: few tries an address, so numbers cannot be guessed by trying them.
  pub.use('/gift-cards/*', createRateLimiter(15 * 60 * 1000, isProd ? 20 : 1000))
  pub.use('/upsells', createRateLimiter(15 * 60 * 1000, isProd ? 600 : 5000))

  pub.get('/status', async (c) => {
    const co = await core.shop()
    // Only THAT it is unavailable and the shop's name — never why, and nothing about the bill.
    // `accounts`: whether shoppers can sign in (the header's Account link is drawn only then).
    const open = !(await core.isClosed())
    // A closed shop says no more than it did: no `accounts` key.
    if (!open) return one(c, { open, storeName: co?.name ?? null })
    return one(c, { open, storeName: co?.name ?? null, accounts: co ? await d.features.isFeatureEnabled(co.id, 'store_accounts').catch(() => false) : false })
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
    // Checkout is open when the store has a way to take the money — keys connected on the Payments page, or the
    // business's connected Stripe account (core.getActiveProvider's rule), not a payment_config row alone.
    const provider = await core.getActiveProvider(s.co.id).catch(() => null)
    return one(c, {
      companyName: s.co.name,
      supportEmail: s.co.email,
      currency: settings.currency,
      flatShippingCents: settings.flatShippingCents,
      freeShippingThresholdCents: settings.freeShippingThresholdCents,
      taxRateBps: settings.taxRateBps,
      checkoutEnabled: !!provider,
      // Tax by the shopper's address at the payment page (Stripe Tax), so the cart says so instead of a rate.
      automaticTax: usesStripeTax(settings, provider),
      // Local pickup: offered at checkout, with where and when.
      pickup: settings.pickupEnabled ? { address: settings.pickupAddress || '', hours: settings.pickupHours || '' } : null,
    })
  })

  // What a gift card number has left (the cart's "Apply"). Only the balance — never who bought it or for whom.
  pub.get('/gift-cards/balance', shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const code = String(c.req.query('code') || '').trim().slice(0, 40)
    if (!code) return fail(c, 400, 'Enter the gift card number.', 'validation_failed', { code: 'Enter the gift card number' })
    const r = await giftCards.balanceOf(s.co.id, code)
    if (!r.ok) return fail(c, 404, r.error, 'gift_card')
    return one(c, { code: r.code, balanceCents: r.balanceCents })
  })

  // The cart's one upsell line: a product bought with what is in the cart, not already in it.
  pub.get('/upsells', shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const skus = String(c.req.query('skus') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50)
    return one(c, { product: skus.length ? await cartUpsell(d, s.co.id, skus) : null })
  })

  // The product feeds (Google Merchant Center, Meta) at their private addresses.
  pub.route('/', createFeedRoutes(d, core, shopperDoor))

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

  const accounts = createShopperAccounts(d, core)
  /** The signed-in shopper checkout is for, when shopper accounts are on and the browser holds a live session; else null. */
  async function signedInShopper(c: Context, companyId: string) {
    if (!(await d.features.isFeatureEnabled(companyId, 'store_accounts').catch(() => false))) return null
    const s = await shopperOf(accounts, c, companyId)
    if (!s) return null
    const where = await accounts.defaultAddress(companyId, s.contactId)
    return { contactId: s.contactId, email: s.email, name: s.name, pricing: await pricingForContact(d.db, companyId, s.contactId), ...(where ? { shipping: { name: where.name, address: where.address } } : {}) }
  }

  pub.post('/checkout', shopperDoor, async (c) => {
    const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Invalid cart', 'validation_failed', fieldsOf(parsed.error))
    const s = await theShop(c); if (s.reply) return s.reply
    // A signed-in shopper (their account's own cookie, never the typed email): their group's prices, their address ready.
    const shopper = await signedInShopper(c, s.co.id)
    // The origin the shopper is actually on — from the request, never the body (see the header).
    const { saveCard, useSavedCard, ...cart } = parsed.data
    const r = await starter.start({ ...cart, companyId: s.co.id, origin: requestOrigin(c), ...(shopper ? { shopper, fast: { saveCard, useSavedCard } } : {}) })
    if (!r.ok) return fail(c, r.status, r.error, r.code)
    return one(c, { url: r.url, ...(r.paidByGiftCard ? { paidByGiftCard: true } : {}) })
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

    // A store on its connected Stripe account has no webhook of its own here (no signing secret): its events come
    // through the Factory's Connect forwarder (./paymentNotices.ts claim), so a notice posted here is refused below.
    let result: WebhookResult
    try {
      result = await provider.verifyAndParseWebhook({ rawBody, signature, headers })
    } catch (err: any) {
      logger.warn('[store] webhook signature rejected', { error: err?.message })
      return fail(c, 400, 'Invalid signature')
    }

    if ((await notices.apply(companyId, provider.name, result, requestOrigin(c))) === 'retry') return fail(c, 503, 'Orders are not ready to take this notice yet')
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

  // The product page's review form posts here (site/views/sections/shop/product.ejs; store live test, 2026-10-26). Held as
  // the site's contact form is (site/enquiryHandler.ts): a few a quarter-hour from one address, and a filled hidden box
  // or a form sent within 1.5s of the page drawing is a bot — it gets the same thanks, and nothing is saved.
  pub.post('/products/:slug/reviews', createRateLimiter(15 * 60 * 1000, isProd ? 5 : 1000), shopperDoor, async (c) => {
    const s = await theShop(c); if (s.reply) return s.reply
    const settings = await core.settings(s.co.id)
    if (settings.reviewsEnabled === false) return fail(c, 403, 'Reviews are turned off')

    const raw = await c.req.json().catch(() => null)
    const thanks = { success: true, message: 'Thanks! Your review will appear once it is approved.' }
    const stamp = parseInt(String(raw?.t || '0'), 10)
    if (String(raw?.website || '').trim() || (stamp > 0 && Date.now() - stamp < 1500)) return one(c, thanks, 201)
    const parsed = reviewSchema.safeParse(raw && typeof raw === 'object' ? { ...raw, website: undefined, t: undefined } : raw)
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
