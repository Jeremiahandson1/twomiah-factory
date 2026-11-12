// /api/admin/stock-locations — stock by location for the store (parity tier 2 #11; ../../../data/storeStock.ts holds the rule;
// feature store_locations, not ready).
//
//   GET  /                                  products:read    the locations, and each counted option's count at each
//   POST /locations                         products:update  { name, address? } — a new location (sold from after the others)
//   PUT  /variants/:variantId/levels        products:update  { locationId, quantity } — the count at one location
//   POST /variants/:variantId/transfer      products:update  { fromId, toId, quantity } — move units; the total does not change
//   GET  /orders/:orderId                   orders:read      where an order is filled from, and the locations it could be
//   PUT  /orders/:orderId                   orders:update    { locationId } — fill it from another location (before it is sent,
//                                                            with nothing refunded): its units go back and come off there
// An option's total (what the storefront sells against) is always the sum of its locations once it has any.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { storeOrder, storeProduct, storeProductVariant } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import { invalid } from '../../../http/errors.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { addStoreLocation, levelsFor, moveOrderTakes, setLevel, storeLocations, transfer } from '../../../data/storeStock.ts'
import { createStockWho } from '../lib/stockWho.ts'

const count = z.number({ error: 'Enter a whole number' }).int('Enter a whole number').min(0, 'A count cannot be below 0').max(1_000_000, 'At most 1,000,000')
const locationBody = z.object({ name: z.string({ error: 'Name the location' }).trim().min(1, 'Name the location').max(80, 'At most 80 characters'), address: z.string().trim().max(300).optional().nullable() })
const levelBody = z.object({ locationId: z.string({ error: 'Choose a location' }).min(1, 'Choose a location'), quantity: count })
const transferBody = z.object({ fromId: z.string().min(1, 'Choose where from'), toId: z.string().min(1, 'Choose where to'), quantity: count.min(1, 'Move at least 1') })

export function createStockLocationRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit } = d
  const stockWho = createStockWho(db)
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  /** One of this company's counted options (inventory_qty not null), with its product's name. */
  const optionOf = async (companyId: string, variantId: string) => {
    const [r] = await db.select({ id: storeProductVariant.id, sku: storeProductVariant.sku, qty: storeProductVariant.inventoryQty, productId: storeProduct.id })
      .from(storeProductVariant).innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(and(eq(storeProductVariant.id, variantId), eq(storeProduct.companyId, companyId))).limit(1)
    return r ?? null
  }
  const locationOk = async (companyId: string, id: string) => (await storeLocations(db, companyId)).some((l) => l.id === id)

  app.get('/', requirePermission('products:read'), async (c) => {
    const companyId = c.get('user').companyId
    const locations = await storeLocations(db, companyId)
    const options = await db.select({ id: storeProductVariant.id, sku: storeProductVariant.sku, name: storeProductVariant.name, qty: storeProductVariant.inventoryQty, productName: storeProduct.name })
      .from(storeProductVariant).innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(and(eq(storeProduct.companyId, companyId), isNotNull(storeProductVariant.inventoryQty))).orderBy(asc(storeProduct.name), asc(storeProductVariant.sku)).limit(500)
    const levels = await levelsFor(db, companyId, (options as any[]).map((o) => o.id))
    return one(c, {
      locations,
      options: (options as any[]).map((o) => {
        const m = levels.get(o.id)
        return { id: o.id, sku: o.sku, name: o.name && o.name !== 'Default' ? o.name : null, productName: o.productName, total: o.qty, byLocation: m ? Object.fromEntries(m) : null }
      }),
    })
  })

  // An order's location (Shopify's fulfilment location).
  const orderOf = async (companyId: string, id: string) => (await db.select().from(storeOrder).where(and(eq(storeOrder.id, id), eq(storeOrder.companyId, companyId))).limit(1))[0] ?? null
  /** Why an order's location can no longer change, or null. */
  const fixed = (o: any) => (o.fulfilledAt || o.pickedUpAt ? 'It has been sent or collected already.' : Number(o.refundedCents || 0) > 0 ? 'Some of it was refunded already.' : ['pending', 'cancelled'].includes(o.status) ? 'It is not a paid order.' : null)
  app.get('/orders/:orderId', requirePermission('orders:read'), async (c) => {
    const companyId = c.get('user').companyId
    const o = await orderOf(companyId, c.req.param('orderId'))
    if (!o) return fail(c, 404, 'Order not found')
    const locations = await storeLocations(db, companyId)
    return one(c, { locationId: o.locationId ?? null, locationName: locations.find((l) => l.id === o.locationId)?.name ?? null, locations, canChange: !fixed(o) && !!o.locationId, why: o.locationId ? fixed(o) : 'Its stock is not counted by location.' })
  })
  app.put('/orders/:orderId', requirePermission('orders:update'), async (c) => {
    const body: any = await c.req.json().catch(() => null)
    const to = typeof body?.locationId === 'string' ? body.locationId : ''
    const companyId = c.get('user').companyId
    if (!(await locationOk(companyId, to))) return fail(c, 400, 'Choose one of your locations.')
    const r = await db.transaction(async (tx: any) => {
      const [o] = await tx.select().from(storeOrder).where(and(eq(storeOrder.id, c.req.param('orderId')), eq(storeOrder.companyId, companyId))).for('update').limit(1)
      if (!o) return { status: 404 as const, error: 'Order not found' }
      if (!o.locationId) return { status: 400 as const, error: 'This order’s stock is not counted by location.' }
      const why = fixed(o)
      if (why) return { status: 400 as const, error: `The location cannot change now. ${why}` }
      if (o.locationId === to) return { status: 200 as const, order: o }
      const takes = await moveOrderTakes(tx, companyId, (o.stockTakes || {}) as Record<string, Record<string, number>>, to)
      const [u] = await tx.update(storeOrder).set({ locationId: to, stockTakes: takes, updatedAt: new Date() } as any).where(eq(storeOrder.id, o.id)).returning()
      return { status: 200 as const, order: u, moved: Object.keys(takes) }
    })
    if (r.status !== 200) return fail(c, r.status, r.error)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'store_order', entityId: r.order.id, entityName: r.order.orderNumber, metadata: { locationId: to }, req: c })
    if (r.moved?.length) await core.events.stock(companyId, r.moved)
    return one(c, { locationId: to })
  })

  app.post('/locations', requirePermission('products:update'), async (c) => {
    const parsed = locationBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    if ((await storeLocations(db, companyId)).some((l) => l.name.toLowerCase() === parsed.data.name.toLowerCase())) return fail(c, 400, `There is already a location called "${parsed.data.name}".`)
    const loc = await addStoreLocation(db, companyId, parsed.data.name, parsed.data.address ?? null)
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'inventory_location', entityId: loc.id, entityName: loc.name, req: c })
    return one(c, loc, 201)
  })

  app.put('/variants/:variantId/levels', requirePermission('products:update'), async (c) => {
    const parsed = levelBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const opt = await optionOf(companyId, c.req.param('variantId'))
    if (!opt) return fail(c, 404, 'Not found')
    if (opt.qty == null) return fail(c, 400, "This option's stock is not counted. Switch counting on for it on the product first.")
    if (!(await locationOk(companyId, parsed.data.locationId))) return fail(c, 400, 'Choose one of your locations.')
    const who = await stockWho(c)
    const r = await db.transaction((tx: any) => setLevel(tx, companyId, opt.id, parsed.data.locationId, parsed.data.quantity, who))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'product_variant', entityId: opt.id, entityName: opt.sku, metadata: { stockAt: parsed.data, total: r.total }, req: c })
    await core.events.stock(companyId, [opt.id])
    return one(c, { id: opt.id, total: r.total })
  })

  app.post('/variants/:variantId/transfer', requirePermission('products:update'), async (c) => {
    const parsed = transferBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const { fromId, toId, quantity } = parsed.data
    if (fromId === toId) return fail(c, 400, 'Choose two different locations.')
    const opt = await optionOf(companyId, c.req.param('variantId'))
    if (!opt) return fail(c, 404, 'Not found')
    if (!(await locationOk(companyId, fromId)) || !(await locationOk(companyId, toId))) return fail(c, 400, 'Choose two of your locations.')
    const who = await stockWho(c)
    const names = new Map((await storeLocations(db, companyId)).map((l) => [l.id, l.name]))
    const r = await db.transaction((tx: any) => transfer(tx, companyId, opt.id, fromId, toId, quantity, { ...who, note: `${quantity} moved from ${names.get(fromId) ?? 'one location'} to ${names.get(toId) ?? 'another'}` }))
    if (!r) return fail(c, 400, `There are not ${quantity} there to move.`)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'product_variant', entityId: opt.id, entityName: opt.sku, metadata: { moved: parsed.data }, req: c })
    return one(c, { id: opt.id, total: r.total })
  })

  return app
}
