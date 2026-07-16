import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import {
  products, productImages, productVariants, orders, orderItems,
  storeSettings, paymentConfig,
} from '../../db/schema.ts'
import { eq, and, inArray, asc } from 'drizzle-orm'
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
const checkoutSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive().max(999),
  })).min(1).max(100),
  customerEmail: z.string().email().optional(),
  // The storefront passes the origin the customer is actually on so the
  // success/cancel redirects land on the live site (not a not-yet-live domain).
  origin: z.string().url().optional(),
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
  const threshold = settings?.freeShippingThresholdCents ?? null
  const shippingCents = threshold !== null && subtotalCents >= threshold ? 0 : (settings?.flatShippingCents ?? 0)
  const taxCents = Math.round(subtotalCents * ((settings?.taxRateBps ?? 0) / 10000))
  const totalCents = subtotalCents + shippingCents + taxCents

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
    subtotalCents, shippingCents, taxCents, discountCents: 0, totalCents, currency,
  }).returning()

  try {
    const checkout = await provider.createCheckout({
      lineItems: lineItems.map((li) => ({
        name: li.name, description: li.description, imageUrl: li.imageUrl,
        unitPriceCents: li.unitPriceCents, quantity: li.quantity, sku: li.sku,
      })),
      currency,
      shippingCents,
      taxCents,
      customerEmail: parsed.data.customerEmail,
      collectShippingAddress: true,
      successUrl: `${storefront}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
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
pub.post('/webhooks/payment', async (c) => {
  const rawBody = await c.req.text()
  const signature = c.req.header('stripe-signature')
    || c.req.header('x-signature')
    || c.req.header('paypal-transmission-sig')

  const provider = await getActiveProvider()
  if (!provider) return c.json({ error: 'No provider configured' }, 400)

  let result
  try {
    result = await provider.verifyAndParseWebhook({ rawBody, signature })
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
pub.get('/order-summary', async (c) => {
  const sessionId = c.req.query('session_id')
  if (!sessionId) return c.json({ error: 'Missing session_id' }, 400)
  let [order] = await db.select().from(orders)
    .where(eq(orders.providerSessionId, sessionId)).limit(1)
  if (!order) return c.json({ order: null })

  // If the webhook hasn't finalized this yet, confirm payment directly with the
  // provider and finalize now — so the confirmation page and the admin order are
  // correct even when the webhook is delayed, misconfigured, or intercepted.
  if (order.status === 'pending') {
    try {
      const provider = await getActiveProvider()
      if (provider) {
        const result = await provider.retrieveSession(sessionId)
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
