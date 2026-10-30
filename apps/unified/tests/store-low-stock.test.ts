// Gap 4 against Shopify (2026-10-30): low-stock alerts on the store's options — a level per option, ONE email a day while
// anything is at or under its level (and none on a day with nothing low), a Low stock filter and a Dashboard tile.
//   · the daily email lists everything at or under its level, fewest left first; it is sent from 8am the SHOP's time, once
//     a day (two sweeps at once send one), and a day with nothing low sends nothing;
//   · the Low stock filter and the tile count the same products;
//   · it is behind store_low_stock (registered not ready): off, no email, no filter, no level accepted;
//   · the level is the owner's — a shopper reading the catalogue is never sent it.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'
import { createStoreCore } from '../server/crm/store/core.ts'
import { createLowStockDigest, shopClock } from '../server/crm/store/lowStock.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let digest: ReturnType<typeof createLowStockDigest>
const ON = ['dashboard', 'orders', 'products', 'contacts', 'store_low_stock']
const features = async (list: string[]) => {
  await (k.t.db as any).update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
/** 9am in Chicago (CDT, UTC−5) on the given October day; 6am for `early`. */
const at = (day: number, early = false) => new Date(Date.UTC(2026, 9, day, early ? 11 : 14, 0, 0))
const digests = () => k.mails.filter((m) => m.template === 'storeLowStockDigest')
const stock = (sku: string, qty: number | null) => (k.t.db as any).update(k.S.storeProductVariant).set({ inventoryQty: qty }).where(eq(k.S.storeProductVariant.sku, sku))
const level = (sku: string, lowStockAt: number | null) => (k.t.db as any).update(k.S.storeProductVariant).set({ lowStockAt }).where(eq(k.S.storeProductVariant.sku, sku))

beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).update(k.S.company).set({ timezone: 'America/Chicago' }).where(eq(k.S.company.id, k.companyId))
  const deps = { db: k.t.db, logger: { info() {}, warn() {}, error() {} }, features: k.t.services.features }
  const core = createStoreCore({ ...deps, services: k.t.services.crm } as any)
  digest = createLowStockDigest(deps as any, core)
  await features(ON)
  await k.product({ slug: 'feeder', name: 'Window feeder', sku: 'LOW-1', priceCents: 1500, qty: 2 })
  await k.product({ slug: 'seed', name: 'Seed mix', sku: 'LOW-2', priceCents: 900, qty: 4 })
  await k.product({ slug: 'suet', name: 'Suet cake', sku: 'LOW-3', priceCents: 500, qty: 40 })
  await k.product({ slug: 'bath', name: 'Bird bath', sku: 'LOW-U', priceCents: 900, qty: null })
  await k.product({ slug: 'pole', name: 'Pole', sku: 'LOW-N', priceCents: 900, qty: 0 }) // empty, but no level set
}, 120_000)

describe('low-stock alerts', () => {
  test('are registered not ready: offered to the store, switched on by no plan', () => {
    const f = FEATURE_MAP.store_low_stock
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
  })

  test('a level is set on an option by the owner (and the manager); a negative one is refused', async () => {
    const id = async (sku: string) => (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.sku, sku)))[0].id
    expect((await k.as('owner')('PATCH', `/api/admin/products/variants/${await id('LOW-1')}`, { lowStockAt: 3 })).status).toBe(200)
    expect((await k.as('manager')('PATCH', `/api/admin/products/variants/${await id('LOW-2')}`, { lowStockAt: 4 })).status).toBe(200)
    expect((await k.as('owner')('PATCH', `/api/admin/products/variants/${await id('LOW-3')}`, { lowStockAt: 5 })).status).toBe(200)
    expect((await k.as('owner')('PATCH', `/api/admin/products/variants/${await id('LOW-3')}`, { lowStockAt: -1 })).status).toBe(400)
    await level('LOW-U', 5) // a level on an untracked option means nothing
  })

  test('before 8am the shop\'s time nothing is sent; at 9am ONE email lists what is low, fewest left first', async () => {
    expect(shopClock('America/Chicago', at(30, true))).toEqual({ day: '2026-10-30', hour: 6 })
    expect(await digest.sweep(at(30, true))).toBe('too_early')
    expect(digests()).toHaveLength(0)
    expect(await digest.sweep(at(30))).toBe('sent')
    await k.settle()
    expect(digests()).toHaveLength(1)
    expect(digests()[0].to).toBe('owner@shop.test')
    // Window feeder 2 ≤ 3 and Seed mix 4 ≤ 4; Suet cake (40 vs 5), the untracked bath and the pole (no level) are not listed.
    expect(digests()[0].data.items.map((i: any) => [i.sku, i.quantity, i.lowStockAt])).toEqual([['LOW-1', 2, 3], ['LOW-2', 4, 4]])
  })

  test('once a day: the same day again, and two sweeps at once, send nothing more', async () => {
    expect(await digest.sweep(at(30))).toBe('already_sent')
    await stock('LOW-3', 1) // something else runs low later the same day: it waits for tomorrow's email
    expect(await digest.sweep(new Date(at(30).getTime() + 5 * 3600_000))).toBe('already_sent')
    await k.settle()
    expect(digests()).toHaveLength(1)
    const both = await Promise.all([digest.sweep(at(31)), digest.sweep(at(31))])
    await k.settle()
    expect(both.sort()).toEqual(['already_sent', 'sent'])
    expect(digests()).toHaveLength(2)
    expect(digests()[1].data.items.map((i: any) => i.sku)).toEqual(['LOW-3', 'LOW-1', 'LOW-2'])
  })

  test('a day with nothing low sends nothing, and the day is not used up: it sends the moment something is low', async () => {
    await stock('LOW-1', 20); await stock('LOW-2', 20); await stock('LOW-3', 20)
    const before = digests().length
    expect(await digest.sweep(new Date(Date.UTC(2026, 10, 1, 14)))).toBe('nothing_low')
    await k.settle()
    expect(digests()).toHaveLength(before)
    await stock('LOW-2', 0) // sold out during the day
    expect(await digest.sweep(new Date(Date.UTC(2026, 10, 1, 20)))).toBe('sent')
    await k.settle()
    expect(digests()).toHaveLength(before + 1)
    expect(digests().at(-1)!.data.items.map((i: any) => [i.sku, i.quantity])).toEqual([['LOW-2', 0]])
  })

  test('an archived product is not listed', async () => {
    await (k.t.db as any).update(k.S.storeProduct).set({ status: 'archived' }).where(eq(k.S.storeProduct.slug, 'seed'))
    expect(await digest.sweep(new Date(Date.UTC(2026, 10, 2, 14)))).toBe('nothing_low')
    await (k.t.db as any).update(k.S.storeProduct).set({ status: 'active' }).where(eq(k.S.storeProduct.slug, 'seed'))
  })

  test('the Low stock filter and the Dashboard tile count the same products', async () => {
    await stock('LOW-1', 1); await stock('LOW-3', 3)
    const list = await k.as('manager')('GET', '/api/admin/products?filter=low_stock')
    expect(list.status).toBe(200)
    const names = list.json.data.map((p: any) => p.name).sort()
    expect(names).toEqual(['Seed mix', 'Suet cake', 'Window feeder']) // 0 ≤ 4, 3 ≤ 5, 1 ≤ 3
    expect((await k.as('manager')('GET', '/api/admin/orders/stats')).json.lowStock).toBe(3)
    expect((await k.as('manager')('GET', '/api/admin/products?filter=nonsense')).status).toBe(400)
  })

  test("a shopper reading the catalogue is never sent the owner's level", async () => {
    const cat = await k.pub('GET', '/api/public/products')
    expect(cat.status).toBe(200)
    expect(cat.text).toContain('LOW-1')
    expect(cat.text).not.toContain('lowStockAt')
  })

  test('with the switch off: no level accepted, no filter, no tile, no email', async () => {
    await features(['dashboard', 'orders', 'products', 'contacts'])
    try {
      const v = (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.sku, 'LOW-3')))[0]
      const set = await k.as('owner')('PATCH', `/api/admin/products/variants/${v.id}`, { lowStockAt: 1 })
      expect(set.status).toBe(403)
      expect(set.json.code).toBe('FEATURE_NOT_ENABLED')
      expect((await k.as('owner')('GET', '/api/admin/products?filter=low_stock')).status).toBe(403)
      expect((await k.as('owner')('GET', '/api/admin/orders/stats')).json.lowStock).toBeUndefined()
      const before = digests().length
      expect(await digest.sweep(new Date(Date.UTC(2026, 10, 3, 14)))).toBe('off')
      expect(digests()).toHaveLength(before)
    } finally { await features(ON) }
  })

  test("the Products screen, its editor and the Dashboard ask the switch for the box, the filter and the tile", () => {
    const web = (p: string) => fs.readFileSync(path.join(import.meta.dir, '..', 'web', 'src', p), 'utf8')
    expect(web('crm/pages/store/catalog/ProductsPage.tsx')).toContain("hasFeature('store_low_stock')")
    expect(web('crm/pages/store/catalog/ProductEditPage.tsx')).toContain("hasFeature('store_low_stock')")
    expect(web('crm/pages/store/orders/DashboardPage.tsx')).toContain('lowStock')
  })
})
