import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import {
  products, productImages, productVariants, orders, orderItems,
  storeSettings, paymentConfig, discountCodes,
  productReviews,
} from '../../db/schema.ts'
import type { ShippingZone, TaxRate } from '../../db/schema.ts'
import { eq, and, inArray, asc, sql } from 'drizzle-orm'
import { getActiveProvider } from '../payments/index.ts'
import type { WebhookResult } from '../payments/types.ts'
import { sendOrderConfirmation, sendMerchantNewOrder } from '../services/email.ts'
import logger from '../services/logger.ts'

const pub = new Hono()

// Flip a pending order to paid, populate customer/shipping from the provider
// result, and decrement tracked inventory. Idempotent + race-safe: only the
// UPDATE that actually transitions pending→paid decrements inventory, so the
// webhook and the success-page retrieval can both call this without double
// counting or double-flipping.
async function finalizeOrder(order: typeof orders.$inferSelect, result: WebhookResult): Promise<void> {
  if (order.status !== 'pending') return
  const orderNumber = `ORD-${order.id.split('-')[0].toUpperCase()}`
  const flipped = await db.update(orders).set({
    status: 'paid',
    orderNumber,
    providerPaymentId: result.providerPaymentId ?? null,
    customerEmail: result.customerEmail ?? order.customerEmail,
    customerName: result.customerName ?? null,
    customerPhone: result.customerPhone ?? null,
    shippingAddress: result.shippingAddress ?? null,
    billingAddress: result.billingAddress ?? null,
    updatedAt: new Date(),
  }).where(and(eq(orders.id, order.id), eq(orders.status, 'pending'))).returning({ id: orders.id })

  if (flipped.length === 0) return // another path finalized it first

  // Count discount-code usage exactly once (only the winning finalize reaches here).
  if (order.discountCode) {
    try {
      await db.update(discountCodes)
        .set({ usedCount: sql`${discountCodes.usedCount} + 1` })
        .where(eq(discountCodes.code, order.discountCode))
    } catch { /* non-blocking */ }
  }

  // Dropship: forward the paid order to the connected supplier. Fire-and-forget
  // — supplier problems must never block payment finalization; the sweep retries.
  import('../suppliers/index.ts')
    .then(m => m.forwardOrderToSupplier(order.id))
    .catch(() => { /* logged inside */ })

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
  for (const it of items) {
    if (!it.variantId) continue
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, it.variantId)).limit(1)
    if (v && v.inventoryQty !== null) {
      await db.update(productVariants)
        .set({ inventoryQty: Math.max(0, v.inventoryQty - it.quantity), updatedAt: new Date() })
        .where(eq(productVariants.id, v.id))
    }
  }

  // Notify the buyer (confirmation) + the merchant (new order). Non-blocking —
  // never fail the order because email is down or unconfigured.
  try {
    const [settings] = await db.select().from(storeSettings).limit(1)
    const storeName = settings?.companyName || 'Our Store'
    const emailOrder = {
      orderNumber,
      customerEmail: result.customerEmail ?? order.customerEmail,
      customerName: result.customerName ?? null,
      subtotalCents: order.subtotalCents, shippingCents: order.shippingCents,
      taxCents: order.taxCents, totalCents: order.totalCents, currency: order.currency,
      shippingAddress: result.shippingAddress ?? null,
    }
    const emailItems = items.map((it) => ({
      productName: it.productName, variantName: it.variantName,
      quantity: it.quantity, lineTotalCents: it.lineTotalCents,
    }))
    void sendOrderConfirmation({ order: emailOrder, items: emailItems, storeName, supportEmail: settings?.supportEmail })
    if (settings?.supportEmail) void sendMerchantNewOrder({ order: emailOrder, items: emailItems, storeName, toEmail: settings.supportEmail })
  } catch (e: any) {
    logger.warn('order emails failed', { error: e?.message })
  }

  logger.info('order finalized', { order: orderNumber })
}

// ── Catalog reads (public, active products only) ─────────────────────────────
async function hydrate(rows: (typeof products.$inferSelect)[]) {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [imgs, vars] = await Promise.all([
    db.select().from(productImages).where(inArray(productImages.productId, ids)).orderBy(asc(productImages.position)),
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)).orderBy(asc(productVariants.position)),
  ])
  return rows.map((p) => ({
    ...p,
    images: imgs.filter((i) => i.productId === p.id),
    variants: vars.filter((v) => v.productId === p.id),
  }))
}

pub.get('/products', async (c) => {
  const rows = await db.select().from(products)
    .where(eq(products.status, 'active')).orderBy(asc(products.position))
  return c.json({ products: await hydrate(rows) })
})

pub.get('/products/:slug', async (c) => {
  const [row] = await db.select().from(products)
    .where(and(eq(products.slug, c.req.param('slug')), eq(products.status, 'active'))).limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  const [full] = await hydrate([row])
  return c.json({ product: full })
})

// Safe public subset of store settings (branding + shipping display).
pub.get('/settings', async (c) => {
  const [s] = await db.select().from(storeSettings).limit(1)
  if (!s) return c.json({ settings: null })
  const [cfg] = await db.select({ connected: paymentConfig.connected }).from(paymentConfig)
    .where(eq(paymentConfig.connected, true)).limit(1)
  return c.json({
    settings: {
      companyName: s.companyName,
      supportEmail: s.supportEmail,
      currency: s.currency,
      flatShippingCents: s.flatShippingCents,
      freeShippingThresholdCents: s.freeShippingThresholdCents,
      taxRateBps: s.taxRateBps,
      checkoutEnabled: !!cfg,
    },
  })
})

// ── Checkout: prices are ALWAYS computed server-side from the DB ──────────────
// Shipping: first matching zone (by the buyer's ship-to region) wins, else the
// flat rate. Free-shipping thresholds apply per-zone or via the flat threshold.
function computeShipping(settings: any, subtotalCents: number, shipTo?: { country?: string; state?: string }): number {
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
function computeTaxBps(settings: any, shipTo?: { country?: string; state?: string }): number {
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

const checkoutSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive().max(999),
  })).min(1).max(100),
  customerEmail: z.string().email().optional(),
  // The storefront passes the origin the customer is actually on so the
  // success/cancel redirects land on the live site (not a not-yet-live domain).
  origin: z.string().url().optional(),
  // Optional ship-to region (from the cart) → region shipping/tax. Falls back to
  // flat rates when absent.
  shipTo: z.object({ country: z.string().max(2), state: z.string().max(16) }).partial().optional(),
  discountCode: z.string().max(64).optional(),
})

pub.post('/checkout', async (c) => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid cart' }, 400)

  const provider = await getActiveProvider()
  if (!provider) return c.json({ error: 'This store is not accepting orders yet' }, 503)

  const [settings] = await db.select().from(storeSettings).limit(1)
  const currency = settings?.currency ?? 'usd'

  // Collapse duplicate SKUs, then load the real variants (trusted prices).
  const wanted = new Map<string, number>()
  for (const it of parsed.data.items) wanted.set(it.sku, (wanted.get(it.sku) ?? 0) + it.quantity)
  const skus = [...wanted.keys()]

  const variants = await db.select().from(productVariants).where(inArray(productVariants.sku, skus))
  if (variants.length === 0) return c.json({ error: 'None of these items are available' }, 400)

  // Only sell variants whose product is active.
  const prodIds = [...new Set(variants.map((v) => v.productId))]
  const prods = await db.select().from(products).where(inArray(products.id, prodIds))
  const prodById = new Map(prods.map((p) => [p.id, p]))

  const lineItems: {
    sku: string; name: string; description?: string; imageUrl?: string
    unitPriceCents: number; quantity: number
    productId: string; variantId: string; variantName: string; productName: string
  }[] = []

  for (const v of variants) {
    const p = prodById.get(v.productId)
    if (!p || p.status !== 'active') continue
    const qty = wanted.get(v.sku)!
    if (v.inventoryQty !== null && v.inventoryQty < qty) {
      return c.json({ error: `Only ${v.inventoryQty} of ${p.name} left` }, 409)
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
  if (lineItems.length === 0) return c.json({ error: 'None of these items are available' }, 400)

  // Attach a primary image per product for the checkout display.
  const imgs = await db.select().from(productImages).where(inArray(productImages.productId, prodIds))
  for (const li of lineItems) {
    const img = imgs.find((i) => i.productId === li.productId && i.isPrimary)
      ?? imgs.find((i) => i.productId === li.productId)
    if (img) li.imageUrl = img.url
  }

  // ── Server-computed totals (never trust the client) ──
  const subtotalCents = lineItems.reduce((a, li) => a + li.unitPriceCents * li.quantity, 0)

  // Validate + apply a discount code server-side (never trust the client).
  let discountCents = 0
  let appliedCode: string | null = null
  if (parsed.data.discountCode) {
    const code = parsed.data.discountCode.trim().toUpperCase()
    const [dc] = await db.select().from(discountCodes).where(eq(discountCodes.code, code)).limit(1)
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

  const shippingCents = computeShipping(settings, subtotalCents, parsed.data.shipTo)
  const taxCents = Math.round(Math.max(0, subtotalCents - discountCents) * (computeTaxBps(settings, parsed.data.shipTo) / 10000))
  const totalCents = Math.max(0, subtotalCents - discountCents) + shippingCents + taxCents

  // Prefer the origin the request carries (the domain the customer is actually
  // browsing) over env — env may hold a derived custom domain that isn't live.
  const storefront = (parsed.data.origin || process.env.STOREFRONT_URL || process.env.STOREFRONT_ORIGIN || '').replace(/\/+$/, '')

  // Create a pending order FIRST so a webhook (or the success page) can reconcile
  // by provider session id. Idempotency is guaranteed by the unique
  // (provider, provider_session_id) index; abandoned checkouts stay 'pending'.
  const [order] = await db.insert(orders).values({
    provider: provider.name,
    providerSessionId: `pending_${crypto.randomUUID()}`, // replaced with real id below
    status: 'pending',
    customerEmail: parsed.data.customerEmail ?? 'pending@checkout',
    subtotalCents, shippingCents, taxCents, discountCents, discountCode: appliedCode, totalCents, currency,
  }).returning()

  // Stripe fills its own {CHECKOUT_SESSION_ID} placeholder on redirect; Square and
  // PayPal don't, so for them we correlate the success page by our own order id
  // (`ref`). Keeps the proven Stripe path byte-for-byte unchanged.
  const successUrl = provider.name === 'stripe'
    ? `${storefront}/checkout/success?session_id={CHECKOUT_SESSION_ID}`
    : `${storefront}/checkout/success?ref=${order.id}`

  try {
    const checkout = await provider.createCheckout({
      lineItems: lineItems.map((li) => ({
        name: li.name, description: li.description, imageUrl: li.imageUrl,
        unitPriceCents: li.unitPriceCents, quantity: li.quantity, sku: li.sku,
      })),
      currency,
      shippingCents,
      taxCents,
      discountCents,
      customerEmail: parsed.data.customerEmail,
      collectShippingAddress: true,
      successUrl,
      cancelUrl: `${storefront}/cart`,
      clientReferenceId: order.id,
      metadata: { orderId: order.id },
    })

    await db.update(orders)
      .set({ providerSessionId: checkout.providerSessionId, updatedAt: new Date() })
      .where(eq(orders.id, order.id))

    await db.insert(orderItems).values(lineItems.map((li) => ({
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

    return c.json({ url: checkout.redirectUrl })
  } catch (err: any) {
    // Roll back the pending order so a failed provider call leaves no orphan.
    await db.delete(orders).where(eq(orders.id, order.id))
    logger.error('checkout failed', { error: err?.message })
    return c.json({ error: 'Could not start checkout' }, 502)
  }
})

// ── Webhook: signature-verified, idempotent order confirmation ───────────────
// Supplier shipment webhook (Printful). Verified by the URL token we embedded
// when auto-configuring the webhook at connect time. Writes tracking through
// the same fields as manual fulfillment so the shipped email reuses.
pub.post('/webhooks/supplier', async (c) => {
  const rawBody = await c.req.text()
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
  const { getActiveSupplier } = await import('../suppliers/index.ts')
  const active = await getActiveSupplier()
  if (!active) return c.json({ error: 'No supplier configured' }, 400)
  let result
  try {
    result = await active.provider.verifyAndParseWebhook({ rawBody, headers, urlToken: c.req.query('t') || undefined })
  } catch (err: any) {
    logger.warn('supplier webhook rejected', { error: err?.message })
    return c.json({ error: 'Invalid webhook' }, 400)
  }
  if (result.type !== 'shipped') return c.json({ received: true })

  let order
  if (result.externalId) {
    ;[order] = await db.select().from(orders).where(eq(orders.id, result.externalId)).limit(1)
  }
  if (!order && result.supplierOrderId) {
    ;[order] = await db.select().from(orders).where(eq(orders.supplierOrderId, result.supplierOrderId)).limit(1)
  }
  if (!order) {
    logger.warn('supplier webhook for unknown order', { supplierOrderId: result.supplierOrderId })
    return c.json({ received: true })
  }
  const [updated] = await db.update(orders).set({
    status: 'shipped',
    supplierStatus: 'shipped',
    trackingCarrier: result.trackingCarrier,
    trackingNumber: result.trackingNumber,
    fulfilledAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(orders.id, order.id)).returning()
  if (order.status !== 'shipped') {
    const { notifyShipped } = await import('./orders.ts')
    void notifyShipped(updated)
  }
  return c.json({ received: true })
})

pub.post('/webhooks/payment', async (c) => {
  const rawBody = await c.req.text()
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
  const signature = headers['stripe-signature']
    || headers['x-square-hmacsha256-signature']
    || headers['paypal-transmission-sig']

  const provider = await getActiveProvider()
  if (!provider) return c.json({ error: 'No provider configured' }, 400)

  let result
  try {
    result = await provider.verifyAndParseWebhook({ rawBody, signature, headers })
  } catch (err: any) {
    logger.warn('webhook signature rejected', { error: err?.message })
    return c.json({ error: 'Invalid signature' }, 400)
  }

  if (result.type !== 'paid' || !result.providerSessionId) return c.json({ received: true })

  const [order] = await db.select().from(orders)
    .where(and(eq(orders.provider, provider.name), eq(orders.providerSessionId, result.providerSessionId)))
    .limit(1)
  if (!order) {
    logger.warn('webhook for unknown session', { session: result.providerSessionId })
    return c.json({ received: true })
  }
  await finalizeOrder(order, result)
  return c.json({ received: true })
})

// Order confirmation for the storefront success page (limited, non-sensitive).
// ── Reviews ─────────────────────────────────────────────────────────────────
pub.get('/products/:slug/reviews', async (c) => {
  const [row] = await db.select().from(products)
    .where(and(eq(products.slug, c.req.param('slug')), eq(products.status, 'active'))).limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  const { approvedReviews, ratingSummaries } = await import('../services/reviews.ts')
  const [reviews, summary] = await Promise.all([approvedReviews(row.id), ratingSummaries([row.id])])
  return c.json({ reviews, summary: summary[row.id] ?? { average: 0, count: 0 } })
})

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  authorName: z.string().min(1).max(80),
  authorEmail: z.string().email().optional(),
  title: z.string().max(120).optional(),
  body: z.string().max(4000).optional(),
})

pub.post('/products/:slug/reviews', async (c) => {
  const [settings] = await db.select().from(storeSettings).limit(1)
  if (settings && settings.reviewsEnabled === false) return c.json({ error: 'Reviews are turned off' }, 403)

  const parsed = reviewSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Please give a rating from 1 to 5 and your name' }, 400)

  const [row] = await db.select().from(products)
    .where(and(eq(products.slug, c.req.param('slug')), eq(products.status, 'active'))).limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)

  const { findVerifyingOrder } = await import('../services/reviews.ts')
  const orderId = parsed.data.authorEmail ? await findVerifyingOrder(row.id, parsed.data.authorEmail) : null

  await db.insert(productReviews).values({
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
  return c.json({ ok: true, message: 'Thanks! Your review will appear once it is approved.' }, 201)
})

// ── Abandoned cart recovery ─────────────────────────────────────────────────
// The link in the reminder email. Rebuilds a checkout for the same items and
// bounces the customer straight to the payment page.
pub.get('/recover/:token', async (c) => {
  const origin = new URL(c.req.url).origin
  try {
    const { resumeCheckout } = await import('../services/abandonedCart.ts')
    const url = await resumeCheckout(c.req.param('token'), origin)
    if (!url) return c.text('This cart is no longer available.', 404)
    return c.redirect(url)
  } catch (err: any) {
    logger.error('cart recovery failed', { error: err?.message })
    return c.text('We could not reopen that cart. Please contact us.', 500)
  }
})

pub.get('/order-summary', async (c) => {
  // Stripe returns with ?session_id=<providerSessionId>; Square/PayPal return with
  // ?ref=<our order id>. Either resolves to the same order.
  const sessionId = c.req.query('session_id')
  const ref = c.req.query('ref')
  if (!sessionId && !ref) return c.json({ error: 'Missing session_id' }, 400)
  let [order] = ref
    ? await db.select().from(orders).where(eq(orders.id, ref)).limit(1)
    : await db.select().from(orders).where(eq(orders.providerSessionId, sessionId!)).limit(1)
  if (!order) return c.json({ order: null })

  // If the webhook hasn't finalized this yet, confirm payment directly with the
  // provider and finalize now — so the confirmation page and the admin order are
  // correct even when the webhook is delayed, misconfigured, or intercepted.
  if (order.status === 'pending') {
    try {
      const provider = await getActiveProvider()
      if (provider) {
        const result = await provider.retrieveSession(order.providerSessionId)
        if (result.type === 'paid') {
          await finalizeOrder(order, result)
          ;[order] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1)
        }
      }
    } catch (err: any) {
      logger.warn('order-summary finalize failed', { error: err?.message })
    }
  }

  const items = await db.select({
    productName: orderItems.productName, variantName: orderItems.variantName,
    quantity: orderItems.quantity, lineTotalCents: orderItems.lineTotalCents, imageUrl: orderItems.imageUrl,
  }).from(orderItems).where(eq(orderItems.orderId, order.id))
  return c.json({
    order: {
      orderNumber: order.orderNumber,
      status: order.status,
      email: order.customerEmail,
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      currency: order.currency,
      items,
    },
  })
})

export default pub
