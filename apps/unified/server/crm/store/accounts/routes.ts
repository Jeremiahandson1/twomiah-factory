// /api/public/account — the shopper's account (./shopperAccounts.ts): sign in by an emailed link or code, their orders,
// their addresses, ordering again, and the wholesale prices their group is owed. Behind the store_accounts feature
// (registered not ready: no plan or signup switches it on); off, every path here is 404.
//
// Their session is the shopper_session cookie and nothing else: the staff cookies and tokens do not reach it, and it
// reaches none of the staff routes. Every read is by the contact the session belongs to.
//
// A request that changes something must come from the shop's own pages: it is JSON (a form on another site cannot send
// that), and when the browser says where it came from (Origin), that is this shop's address.
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { storeProduct, storeProductVariant } from '../../../db/schema/store.ts'
import { createRateLimiter } from '../../../http/guards.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { requestOrigin } from '../checkout/checkoutService.ts'
import { groupPrice, pricingForContact } from '../catalog/groupPricing.ts'
import { createOrderRefunds } from '../orders/refunds.ts'
import { createStoreReturns, REASONS } from '../returns/returns.ts'
import { createStoreGiftCards } from '../giftCards.ts'
import { createShopperAccounts, SESSION_DAYS, SHOPPER_COOKIE, type ShopperAccounts, type ShopperSession } from './shopperAccounts.ts'

const isProd = process.env.NODE_ENV === 'production'
/** The same answer whoever asks, known email or not. */
export const SIGN_IN_SENT = 'We have sent a sign-in link and a code to that address. They work for 15 minutes. New here? Signing in the first time makes your account.'

/** The signed-in shopper of a request, or null: the cookie, looked up for this shop. */
export async function shopperOf(accounts: ShopperAccounts, c: Context, companyId: string): Promise<ShopperSession | null> {
  return accounts.sessionFor(companyId, getCookie(c, SHOPPER_COOKIE))
}

const addressBody = z.object({ label: z.unknown().optional(), name: z.unknown().optional(), phone: z.unknown().optional(), address: z.unknown().optional(), isDefault: z.unknown().optional() })

export function createShopperAccountRoutes(d: CrmDeps, core: StoreCore, accounts: ShopperAccounts = createShopperAccounts(d, core)) {
  const app = new Hono()

  // Nothing here is for a shared cache to keep: it is one person's.
  app.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'private, no-store') })

  /** A change must be JSON from this shop's own pages. */
  const ownPagesOnly: MiddlewareHandler = async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
    if (!(c.req.header('content-type') || '').toLowerCase().startsWith('application/json')) return fail(c, 415, 'Send JSON.', 'unsupported_media_type')
    const origin = c.req.header('origin')
    if (origin) {
      let host = ''
      try { host = new URL(origin).host } catch { /* refused below */ }
      const mine = (c.req.header('x-forwarded-host') || c.req.header('host') || '').split(',')[0].trim()
      if (!host || host !== mine) return fail(c, 403, 'That request did not come from this shop’s own pages.', 'forbidden')
    }
    return next()
  }
  app.use('*', ownPagesOnly)

  app.use('/sign-in', createRateLimiter(15 * 60 * 1000, isProd ? 10 : 1000))
  app.use('/verify', createRateLimiter(15 * 60 * 1000, isProd ? 30 : 1000))

  const shop = async (c: Context) => (await core.shop()) ?? null
  // Returns and store credit (store_returns, a feature of its own on top of accounts): the shopper starts a return from their order.
  const refunds = createOrderRefunds(d, core)
  const returns = createStoreReturns(d, core, refunds)
  const giftCards = createStoreGiftCards(d, core)
  const returnsOn = (companyId: string) => d.features.isFeatureEnabled(companyId, 'store_returns').catch(() => false)
  /** The signed-in shopper, or the 401 to give instead. */
  const signedIn = async (c: Context): Promise<{ s: ShopperSession } | { reply: Response }> => {
    const co = await shop(c)
    const s = co ? await shopperOf(accounts, c, co.id) : null
    return s ? { s } : { reply: fail(c, 401, 'Sign in to see your account.', 'signed_out') }
  }

  // ── Signing in ───────────────────────────────────────────────────────────────────────────────────────────────────
  app.post('/sign-in', async (c) => {
    const parsed = z.object({ email: z.string().trim().email().max(200) }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Enter your email address.', 'validation_failed', { email: 'Enter a valid email address' })
    const co = await shop(c)
    // The reply does not wait for the mail and says the same whether anything was sent.
    if (co) void accounts.requestSignIn(co.id, parsed.data.email, requestOrigin(c)).catch((e) => d.logger.warn('[store] sign-in email not sent', { error: e?.message }))
    return one(c, { ok: true, message: SIGN_IN_SENT })
  })

  app.post('/verify', async (c) => {
    const body = await c.req.json().catch(() => null)
    const co = await shop(c)
    const refuse = () => fail(c, 400, 'That link or code did not work. It may have expired or been used. Ask for a new one.', 'invalid_sign_in')
    if (!co || !body || typeof body !== 'object') return refuse()
    const token = typeof body.token === 'string' ? await accounts.signInWithToken(co.id, body.token)
      : typeof body.email === 'string' && typeof body.code === 'string' ? await accounts.signInWithCode(co.id, body.email, body.code.trim()) : null
    if (!token) return refuse()
    setCookie(c, SHOPPER_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: requestOrigin(c).startsWith('https:'), path: '/', maxAge: SESSION_DAYS * 86_400 })
    return one(c, { ok: true })
  })

  app.post('/sign-out', async (c) => {
    const co = await shop(c)
    if (co) await accounts.signOut(co.id, getCookie(c, SHOPPER_COOKIE))
    deleteCookie(c, SHOPPER_COOKIE, { path: '/' })
    return done(c)
  })

  // ── Their account ────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/me', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    // Store credit from returns: shown to its owner (the card number is what spends it).
    const credit = await returnsOn(r.s.companyId) ? await giftCards.creditOf(r.s.companyId, r.s.email) : []
    return one(c, { ...(await accounts.profile(r.s)), returns: await returnsOn(r.s.companyId), credit })
  })

  /** An order with, when returns are on, what of it can be sent back (the window, the units left). */
  const withReturnable = async (companyId: string, o: { id: string }) => {
    const row = await refunds.orderOf(o.id, companyId)
    if (!row) return o
    const can = await returns.returnable(row, await refunds.itemsOf(row.id), await returns.policy(companyId))
    return { ...o, returnable: { open: can.open && can.windowOpen, why: can.why ?? (can.windowOpen ? null : 'The return window for this order has closed.'), endsAt: can.windowEndsAt, lines: can.lines.map((l) => ({ orderItemId: l.orderItemId, left: l.left, note: l.note })) } }
  }
  app.get('/orders', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    const orders = await accounts.ordersOf(r.s)
    return one(c, { data: (await returnsOn(r.s.companyId)) ? await Promise.all(orders.map((o) => withReturnable(r.s.companyId, o))) : orders })
  })
  app.get('/orders/:id', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    const order = await accounts.orderOf(r.s, c.req.param('id'))
    if (!order) return fail(c, 404, 'That order was not found.')
    return one(c, (await returnsOn(r.s.companyId)) ? await withReturnable(r.s.companyId, order) : order)
  })
  app.post('/orders/:id/reorder', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    const again = await accounts.reorder(r.s, c.req.param('id'))
    return again ? one(c, again) : fail(c, 404, 'That order was not found.')
  })

  app.get('/addresses', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    return one(c, { data: await accounts.addresses(r.s) })
  })
  app.post('/addresses', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    const body = addressBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 400, 'Add a name and an address.', 'validation_failed')
    const made = await accounts.addAddress(r.s, body.data)
    return made.ok ? one(c, made.address, 201) : fail(c, 400, made.error, 'validation_failed')
  })
  app.put('/addresses/:id', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    const body = addressBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 400, 'Add a name and an address.', 'validation_failed')
    const made = await accounts.changeAddress(r.s, c.req.param('id'), body.data)
    return made.ok ? one(c, made.address) : fail(c, made.status, made.error, made.status === 400 ? 'validation_failed' : undefined)
  })
  app.delete('/addresses/:id', async (c) => {
    const r = await signedIn(c); if ('reply' in r) return r.reply
    return (await accounts.removeAddress(r.s, c.req.param('id'))) ? done(c) : fail(c, 404, 'That address was not found.')
  })

  // ── Returns (store_returns) ─────────────────────────────────────────────────────────────────────────────────────
  const returnBody = z.object({
    orderId: z.string().min(1), items: z.array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(1) })).min(1).max(200),
    reason: z.enum(REASONS).default('other'), note: z.string().max(1000).nullish(), wanted: z.string().max(500).nullish(),
    resolution: z.enum(['refund', 'exchange']).default('refund'), preferCredit: z.boolean().default(false),
  })
  /** Signed in, with returns switched on: else the 401, or a 404 as if there were no such page. */
  const forReturns = async (c: Context): Promise<{ s: ShopperSession } | { reply: Response }> => {
    const r = await signedIn(c); if ('reply' in r) return r
    return (await returnsOn(r.s.companyId)) ? r : { reply: fail(c, 404, 'Not found') }
  }
  app.get('/returns', async (c) => {
    const r = await forReturns(c); if ('reply' in r) return r.reply
    const rows = await returns.list(r.s.companyId, { contactId: r.s.contactId })
    return one(c, { data: await Promise.all(rows.map((x) => returns.forShopper(r.s.companyId, x))) })
  })
  app.post('/returns', async (c) => {
    const r = await forReturns(c); if ('reply' in r) return r.reply
    const body = returnBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 400, 'Choose the items, how many and why.', 'validation_failed')
    // Their own order only: the order is found by the session's contact, then read whole.
    const mine = await accounts.orderOf(r.s, body.data.orderId)
    const order = mine ? await refunds.orderOf(mine.id, r.s.companyId) : null
    if (!order) return fail(c, 404, 'That order was not found.')
    const made = await returns.start({
      companyId: r.s.companyId, order, lines: body.data.items, reason: body.data.reason, note: body.data.note, wanted: body.data.wanted, resolution: body.data.resolution,
      preferCredit: body.data.preferCredit, startedBy: 'shopper', byName: r.s.name,
    })
    return made.ok ? one(c, await returns.forShopper(r.s.companyId, made.ret), 201) : fail(c, made.status, made.error, made.code)
  })
  app.post('/returns/:id/cancel', async (c) => {
    const r = await forReturns(c); if ('reply' in r) return r.reply
    const done2 = await returns.cancel(r.s.companyId, c.req.param('id'), { shopperContactId: r.s.contactId, name: r.s.name })
    return done2.ok ? one(c, await returns.forShopper(r.s.companyId, done2.ret)) : fail(c, done2.status, done2.error, done2.code)
  })

  /**
   * What this shopper's group pays for the options asked about (?skus=a,b): only the ones that differ from the shop's
   * price. A shopper in no group, or nobody signed in, gets none — the page keeps the prices it was built with.
   */
  app.get('/prices', async (c) => {
    const co = await shop(c)
    const s = co ? await shopperOf(accounts, c, co.id) : null
    const none = { group: null as string | null, prices: {} as Record<string, number> }
    if (!co || !s) return one(c, none)
    const skus = String(c.req.query('skus') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 200)
    if (!skus.length) return one(c, none)
    const pricing = await pricingForContact(d.db, co.id, s.contactId)
    if (!pricing) return one(c, none)
    const rows: Array<{ v: typeof storeProductVariant.$inferSelect; p: typeof storeProduct.$inferSelect }> = await d.db.select({ v: storeProductVariant, p: storeProduct }).from(storeProductVariant)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId)).where(and(eq(storeProduct.companyId, co.id), inArray(storeProductVariant.sku, skus)))
    const prices: Record<string, number> = {}
    for (const { v, p } of rows) {
      const cents = groupPrice(v.priceCents, v.id, pricing, p.kind === 'gift_card')
      if (cents !== v.priceCents) prices[v.sku] = cents
    }
    return one(c, { group: pricing.name, prices })
  })

  return app
}
