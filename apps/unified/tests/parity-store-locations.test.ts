// Parity tier 2 #11 (11/10): stock by location for the store (Shopify's inventory locations). Through the real server as the store:
//   · locations are added (named once each); a product's first count at a location keeps what it had at the first location;
//   · the total the storefront sells against is always the sum of the locations;
//   · a sale takes from the first location first, then the next; a refund's restock, a delivery and the API's adjustment go to
//     the first; a count typed on the product moves the difference the same way;
//   · moving units between locations keeps the total, and moving more than is there is refused;
//   · a product not counted by location is counted exactly as before; switched off, the page is closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { decrementStock } from '../server/data/storeCheckout.ts'
import { restockVariant } from '../server/data/storeOrders.ts'
import { writeStock } from '../server/data/storeApi.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', mug = '', bowl = '', front = '', back = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const FEATURES = ['store_locations']
const total = async (id: string) => ((await (t.db as any).select({ q: t.schema.storeProductVariant.inventoryQty }).from(t.schema.storeProductVariant).where(eq(t.schema.storeProductVariant.id, id)))[0].q)
const at = async (id: string) => {
  const r = (await json(await call('/api/admin/stock-locations'))).body
  return r.options.find((o: any) => o.id === id)
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  const product = async (slug: string, sku: string, qty: number | null) => {
    const [p] = await (t.db as any).insert(t.schema.storeProduct).values({ companyId, slug, name: slug, status: 'active' }).returning()
    const [v] = await (t.db as any).insert(t.schema.storeProductVariant).values({ productId: p.id, sku, name: 'Default', priceCents: 1000, inventoryQty: qty }).returning()
    return v.id
  }
  mug = await product('mug', 'MUG-1', 10)
  bowl = await product('bowl', 'BOWL-1', 4)
}, 120_000)

test('locations: added in order, named once each', async () => {
  const a = await json(await call('/api/admin/stock-locations/locations', { method: 'POST', json: { name: 'Front shop' } }))
  expect(a.status).toBe(201)
  front = a.body.id
  back = (await json(await call('/api/admin/stock-locations/locations', { method: 'POST', json: { name: 'Back room' } }))).body.id
  expect((await call('/api/admin/stock-locations/locations', { method: 'POST', json: { name: 'front shop' } })).status).toBe(400)
  const r = (await json(await call('/api/admin/stock-locations'))).body
  expect(r.locations.map((l: any) => l.name)).toEqual(['Front shop', 'Back room'])
  expect(r.options.find((o: any) => o.id === mug)).toMatchObject({ total: 10, byLocation: null })
})

test("a product's first count at a location keeps what it had at the first; the total is the sum", async () => {
  const r = await json(await call(`/api/admin/stock-locations/variants/${mug}/levels`, { method: 'PUT', json: { locationId: back, quantity: 5 } }))
  expect(r.body.total).toBe(15)
  expect((await at(mug)).byLocation).toEqual({ [front]: 10, [back]: 5 })
  expect(await total(mug)).toBe(15)
})

test('a sale takes from the first location first, then the next', async () => {
  await decrementStock(t.db, mug, 12)
  expect(await total(mug)).toBe(3)
  expect((await at(mug)).byLocation).toEqual({ [front]: 0, [back]: 3 })
})

test("a refund's restock, the API and a count typed on the product go to the first location", async () => {
  await restockVariant(t.db, mug, 2)
  expect((await at(mug)).byLocation).toEqual({ [front]: 2, [back]: 3 })
  await writeStock(t.db, companyId, mug, { adjustBy: 4 })
  expect((await at(mug)).byLocation).toEqual({ [front]: 6, [back]: 3 })
  const edit = await call(`/api/admin/products/variants/${mug}`, { method: 'PATCH', json: { inventoryQty: 7 } })
  expect(edit.status).toBe(200)
  expect((await at(mug)).byLocation).toEqual({ [front]: 4, [back]: 3 })
  expect(await total(mug)).toBe(7)
})

test('moving units keeps the total; more than is there is refused', async () => {
  const m = await json(await call(`/api/admin/stock-locations/variants/${mug}/transfer`, { method: 'POST', json: { fromId: back, toId: front, quantity: 2 } }))
  expect(m.body.total).toBe(7)
  expect((await at(mug)).byLocation).toEqual({ [front]: 6, [back]: 1 })
  const no = await json(await call(`/api/admin/stock-locations/variants/${mug}/transfer`, { method: 'POST', json: { fromId: back, toId: front, quantity: 5 } }))
  expect([no.status, no.body.error]).toEqual([400, 'There are not 5 there to move.'])
})

test('a product not counted by location is counted as before', async () => {
  await decrementStock(t.db, bowl, 1)
  expect(await total(bowl)).toBe(3)
  expect((await at(bowl)).byLocation).toBeNull()
})

test('switched off: the page is closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  try { expect([403, 404]).toContain((await call('/api/admin/stock-locations')).status) } finally {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  }
})
