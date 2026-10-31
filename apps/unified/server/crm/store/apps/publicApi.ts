// The public store API (store_api, 2026-10-31, parity row 8; Shopify's Admin API, within one shop). A script or an outside app signs
// in with a key the owner made (Apps › Store API) and sees only what the key's scopes allow. Public mount (no staff sign-in), 404
// when the feature is off.
//
//   Authorization: Bearer tsk_…                      (a missing, unknown or revoked key: 401)
//   GET  /api/store/v1/products?status=&limit=&cursor=&updated_since=       products:read    options and pictures included
//   GET  /api/store/v1/products/:id                                         products:read
//   GET  /api/store/v1/orders?status=&limit=&cursor=&created_since=         orders:read      paid-or-later orders unless status= says otherwise
//   GET  /api/store/v1/orders/:id                                           orders:read
//   GET  /api/store/v1/customers?limit=&cursor=                             customers:read   with orders and spend
//   GET  /api/store/v1/inventory?sku=&limit=&cursor=                        inventory:read   one line per option
//   PUT  /api/store/v1/inventory/:variantId   { quantity | adjustBy, from? } inventory:write  audited, tells the webhooks
// A page is `{ data, nextCursor }` — pass nextCursor back as ?cursor= for the next page (null = the last). limit is 1–100 (default 50).
// 120 requests a minute per key (429 with Retry-After). Never in an answer: what things cost the shop, internal notes, suppliers.
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { z } from 'zod'
import { apiCustomers, apiInventory, apiOrder, apiOrders, apiProducts, writeStock } from '../../../data/storeApi.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { ApiKeyRow, ApiKeys, ApiScope } from './apiKeys.ts'
import { loadProductViews, orderView } from './payloads.ts'
import { SHOPPER_TYPE, type StoreCore } from '../core.ts'
import { eq } from 'drizzle-orm'
import { storeProduct } from '../../../db/schema/store.ts'

export const API_RATE_PER_MINUTE = 120

export function createStoreApi(d: CrmDeps, core: StoreCore, keys: ApiKeys, over: { now?: () => Date } = {}) {
  const { db } = d
  const app = new Hono<{ Variables: { key: ApiKeyRow; companyId: string } }>()
  const now = over.now ?? (() => new Date())
  const hits = new Map<string, { count: number; resetAt: number }>()

  app.use('*', async (c: Context, next: Next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') || '')
    const key = m ? await keys.find(m[1], now()) : null
    if (!key) return fail(c, 401, 'Send a store API key as "Authorization: Bearer tsk_…". It is missing, wrong or revoked.', 'invalid_api_key')
    // 120 a minute per key. The counter is per process: the store is one server per shop, so that is the limit a caller meets.
    const t = now().getTime()
    let h = hits.get(key.id)
    if (!h || t >= h.resetAt) { h = { count: 0, resetAt: t + 60_000 }; hits.set(key.id, h) }
    h.count++
    c.header('RateLimit-Limit', String(API_RATE_PER_MINUTE))
    c.header('RateLimit-Remaining', String(Math.max(0, API_RATE_PER_MINUTE - h.count)))
    if (h.count > API_RATE_PER_MINUTE) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((h.resetAt - t) / 1000))))
      return fail(c, 429, 'Too many requests: this key may make 120 a minute. Try again shortly.', 'rate_limited')
    }
    c.set('key', key); c.set('companyId', key.companyId)
    await next()
  })

  const needs = (scope: ApiScope) => async (c: Context, next: Next) => {
    if (!((c.get('key') as ApiKeyRow).scopes as string[]).includes(scope)) return fail(c, 403, `This key may not do that: it needs the "${scope}" scope.`, 'insufficient_scope')
    await next()
  }
  const companyOf = (c: Context) => c.get('companyId') as string
  const limitOf = (c: Context) => { const n = Number(c.req.query('limit')); return Number.isInteger(n) && n >= 1 ? Math.min(100, n) : 50 }
  const cursorOf = (c: Context) => { const raw = c.req.query('cursor'); return raw ? raw.slice(0, 64) : null }
  const sinceOf = (c: Context, name: string): Date | null | 'bad' => {
    const raw = c.req.query(name); if (!raw) return null
    const t = new Date(raw); return Number.isNaN(t.getTime()) ? 'bad' : t
  }
  const badSince = (c: Context, name: string) => fail(c, 400, `${name} must be a date and time such as 2026-10-01T00:00:00Z.`, 'validation_failed', { [name]: 'Not a date' })

  app.get('/products', needs('products:read'), async (c) => {
    const since = sinceOf(c, 'updated_since'); if (since === 'bad') return badSince(c, 'updated_since')
    const status = c.req.query('status') || null
    if (status && !['draft', 'active', 'archived'].includes(status)) return fail(c, 400, 'status must be draft, active or archived.', 'validation_failed', { status: 'Not a status' })
    const got = await apiProducts(db, companyOf(c), { status, after: cursorOf(c), limit: limitOf(c), updatedSince: since })
    return one(c, { data: await loadProductViews(db, got.rows), nextCursor: got.next })
  })
  app.get('/products/:id', needs('products:read'), async (c) => {
    const [p] = await db.select().from(storeProduct).where(eq(storeProduct.id, String(c.req.param('id')))).limit(1)
    if (!p || p.companyId !== companyOf(c)) return fail(c, 404, 'Not found', 'not_found')
    return one(c, { data: (await loadProductViews(db, [p]))[0] })
  })

  app.get('/orders', needs('orders:read'), async (c) => {
    const since = sinceOf(c, 'created_since'); if (since === 'bad') return badSince(c, 'created_since')
    const status = c.req.query('status') || null
    if (status && !['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded', 'ready_for_pickup', 'picked_up'].includes(status)) return fail(c, 400, 'That is not an order status.', 'validation_failed', { status: 'Not a status' })
    const got = await apiOrders(db, companyOf(c), { status, after: cursorOf(c), limit: limitOf(c), createdSince: since })
    return one(c, { data: got.rows.map((r) => orderView(r.order, r.items)), nextCursor: got.next })
  })
  app.get('/orders/:id', needs('orders:read'), async (c) => {
    const o = await apiOrder(db, companyOf(c), String(c.req.param('id')))
    return o ? one(c, { data: orderView(o.order, o.items) }) : fail(c, 404, 'Not found', 'not_found')
  })

  app.get('/customers', needs('customers:read'), async (c) => {
    const got = await apiCustomers(db, companyOf(c), d.settings?.contacts?.customerType || SHOPPER_TYPE, { after: cursorOf(c), limit: limitOf(c) })
    return one(c, {
      data: got.rows.map((r: any) => ({
        id: r.id, name: r.name, email: r.email, phone: r.phone, createdAt: new Date(r.createdAt).toISOString(), acceptsMarketing: !r.emailOptOut,
        orderCount: Number(r.orderCount ?? 0), totalSpentCents: Number(r.totalSpentCents ?? 0), lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : null,
      })),
      nextCursor: got.next,
    })
  })

  app.get('/inventory', needs('inventory:read'), async (c) => {
    const got = await apiInventory(db, companyOf(c), { after: cursorOf(c), limit: limitOf(c), sku: c.req.query('sku') || null })
    return one(c, { data: got.rows.map((r: any) => ({ variantId: r.id, productId: r.productId, productName: r.productName, sku: r.sku, name: r.name, inventoryQty: r.inventoryQty, tracked: r.inventoryQty !== null })), nextCursor: got.next })
  })
  const stockBody = z.union([
    z.object({ quantity: z.number().int().min(0).max(2147483647), from: z.number().int().min(0).max(2147483647).optional() }).strict(),
    z.object({ adjustBy: z.number().int().min(-2147483647).max(2147483647), from: z.number().int().min(0).max(2147483647).optional() }).strict(),
  ])
  app.put('/inventory/:variantId', needs('inventory:write'), async (c) => {
    const parsed = stockBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Send { "quantity": 12 } to set the count, or { "adjustBy": -2 } to move it. "from" is the count you last saw.', 'validation_failed')
    const companyId = companyOf(c)
    const w = 'quantity' in parsed.data ? { set: parsed.data.quantity } : { adjustBy: parsed.data.adjustBy }
    const r = await writeStock(db, companyId, String(c.req.param('variantId')), w, parsed.data.from)
    if (!r.ok) {
      if (r.reason === 'not_found') return fail(c, 404, 'Not found', 'not_found')
      if (r.reason === 'untracked') return fail(c, 409, 'This option does not count its stock, so a count cannot be set. Switch on stock counting for it in the shop first.', 'stock_not_tracked')
      return fail(c, 409, `The count is ${r.now} now, not ${parsed.data.from}: nothing was changed. Read it again and retry.`, 'inventory_changed')
    }
    const key = c.get('key') as ApiKeyRow
    await d.audit.log({ action: 'update', entity: 'product_variant', entityId: r.id, entityName: r.sku, companyId, metadata: { description: `Stock of ${r.productName} (${r.sku}) set to ${r.after} (was ${r.before}) through the store API key "${key.name}"` } }).catch(() => {})
    await core.events.stock(companyId, [r.id])
    return one(c, { data: { variantId: r.id, sku: r.sku, inventoryQty: r.after, previous: r.before } })
  })

  app.all('*', (c) => fail(c, 404, 'Not found', 'not_found'))
  return app
}
