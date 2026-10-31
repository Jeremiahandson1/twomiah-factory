// /api/public/express — the wallet buttons (Apple Pay, Google Pay, Link) on the product and cart pages (store_fast_checkout,
// 2026-10-31, parity row 6). Stripe's ExpressCheckoutElement asks three things of the server:
//   GET  /config  — the key Stripe.js starts with (and the connected account), or "not available";
//   POST /quote   — what the cart totals for the address the wallet sheet shows (priced by the same rule as checkout; nothing written);
//   POST /intent  — the order and the PaymentIntent for exactly that total; the browser confirms it with the wallet's card.
// No sign-in is needed (a guest pays with a wallet). The shopper comes back to the success page, which finishes the order.
// Not for a store that works its tax out on Stripe's page (Stripe Tax), nor for Square / PayPal: they answer "not available".
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { createRateLimiter } from '../../../http/guards.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { requestOrigin, type CheckoutService } from './checkoutService.ts'
import { createOrderStarter, usesStripeTax } from './placeOrder.ts'
import type { StoreGiftCards } from '../giftCards.ts'

const cart = z.object({
  items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive().max(999) })).min(1).max(100),
  discountCode: z.string().max(64).optional(),
  delivery: z.enum(['ship', 'pickup']).optional(),
  // What the wallet sheet shows: the shipping name and address (Stripe.js' `shippingAddress`), and the payer's email.
  shipping: z.object({
    name: z.string().trim().min(1).max(120),
    address: z.object({
      line1: z.string().trim().min(1).max(200), line2: z.string().trim().max(200).optional().nullable(), city: z.string().trim().max(100).default(''),
      state: z.string().trim().max(40).default(''), postalCode: z.string().trim().max(20).default(''), country: z.string().trim().length(2),
    }),
  }).optional(),
  email: z.string().trim().email().max(200).optional(),
})

export function createExpressRoutes(d: CrmDeps, core: StoreCore, checkout: CheckoutService, giftCards: StoreGiftCards) {
  const app = new Hono()
  const starter = createOrderStarter(d, core, checkout, giftCards)
  const isProd = process.env.NODE_ENV === 'production'
  const open: MiddlewareHandler = async (c, next) => {
    if (await core.isClosed()) return fail(c, 503, 'This store is unavailable right now.', 'STORE_UNAVAILABLE')
    await next()
  }
  app.use('*', open)
  app.use('/intent', createRateLimiter(15 * 60 * 1000, isProd ? 60 : 1000))
  app.use('/quote', createRateLimiter(15 * 60 * 1000, isProd ? 300 : 2000))

  const norm = (b: z.infer<typeof cart>) => b.shipping ? { name: b.shipping.name, address: { ...b.shipping.address, line2: b.shipping.address.line2 || undefined } } : undefined

  app.get('/config', async (c) => {
    const co = await core.shop()
    if (!co) return one(c, { available: false })
    const [settings, provider] = [await core.settings(co.id), await core.getActiveProvider(co.id).catch(() => null)]
    const keys = provider?.expressKeys?.() ?? null
    if (!provider || provider.name !== 'stripe' || !keys || usesStripeTax(settings, provider)) return one(c, { available: false })
    return one(c, { available: true, publishableKey: keys.publishableKey, ...(keys.stripeAccount ? { stripeAccount: keys.stripeAccount } : {}), currency: settings.currency ?? 'usd', pickup: !!settings.pickupEnabled })
  })

  app.post('/quote', async (c) => {
    const body = cart.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 400, 'Invalid cart', 'validation_failed')
    const co = await core.shop(); if (!co) return fail(c, 503, 'This store is not set up yet')
    const r = await starter.start({ companyId: co.id, items: body.data.items, discountCode: body.data.discountCode, delivery: body.data.delivery, origin: requestOrigin(c), express: { shipping: norm(body.data) }, preview: true })
    if (!r.ok) return fail(c, r.status, r.error, r.code)
    return one(c, r.preview ?? {})
  })

  app.post('/intent', async (c) => {
    const body = cart.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 400, 'Invalid cart', 'validation_failed')
    const co = await core.shop(); if (!co) return fail(c, 503, 'This store is not set up yet')
    const r = await starter.start({ companyId: co.id, items: body.data.items, discountCode: body.data.discountCode, delivery: body.data.delivery, customerEmail: body.data.email, origin: requestOrigin(c), express: { shipping: norm(body.data) } })
    if (!r.ok) return fail(c, r.status, r.error, r.code)
    return one(c, { clientSecret: r.clientSecret, returnUrl: r.url, orderId: r.orderId })
  })

  return app
}
