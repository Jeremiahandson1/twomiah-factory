// Gap 4 against Shopify (2026-10-30): low-stock alerts on the store's options.
//   · a level per option; a sale that takes the count down to it sends the owner ONE email, however many sales follow;
//   · it can tell the owner again only after the count has been back above the level (a restock, a refund's return);
//   · a Low stock filter and a tile count the same products;
//   · it is behind store_low_stock (registered not ready): off, no email, no filter, no level accepted;
//   · the level is the owner's — a shopper reading the catalogue is never sent it; the Dashboard tile is products:read's.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'

let k: Awaited<ReturnType<typeof bootStore>>
let n = 0

beforeAll(async () => {
  k = await bootStore()
  await k.connectStripe()
}, 120_000)

const features = async (list: string[]) => {
  await (k.t.db as any).update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const ON = ['dashboard', 'orders', 'products', 'contacts', 'store_low_stock']
const variantNow = async (id: string) => (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, id)))[0]
/** A shopper buys `quantity` of a sku and pays; the owner's emails to the shop are returned. */
async function buy(sku: string, quantity: number): Promise<string[]> {
  const before = k.mails.length
  const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku, quantity }], customerEmail: `buyer${++n}@example.com` })
  expect(r.status).toBe(200)
  const sid = new URL(r.json.url).pathname.split('/').pop()!
  const o = await k.orderBySession(sid)
  k.stripe.sessions.set(sid, paidSession(sid, { amountTotal: o.totalCents, email: `buyer${n}@example.com` }))
  expect((await k.pub('GET', `/checkout/success?session_id=${sid}`)).status).toBe(200)
  await k.settle()
  return k.mails.slice(before).filter((m) => m.template === 'storeLowStock').map((m) => m.to)
}
const lowMails = () => k.mails.filter((m) => m.template === 'storeLowStock')

describe('low-stock alerts', () => {
  test('are registered not ready: offered to the store, switched on by no plan', () => {
    const f = FEATURE_MAP.store_low_stock
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
  })

  test('ONE email when a sale takes an option down to its level, none for the sales after it', async () => {
    await features(ON)
    const { variant } = await k.product({ slug: 'feeder', name: 'Window feeder', sku: 'LOW-1', priceCents: 1500, qty: 6 })
    expect((await k.as('owner')('PATCH', `/api/admin/products/variants/${variant.id}`, { lowStockAt: 3, inventoryFrom: 6 })).status).toBe(200)
    // 6 → 5 → 4: still above the level, nothing sent.
    expect(await buy('LOW-1', 1)).toEqual([])
    expect(await buy('LOW-1', 1)).toEqual([])
    // 4 → 3: at the level — the owner is told, once.
    expect(await buy('LOW-1', 1)).toEqual(['owner@shop.test'])
    expect(lowMails()).toHaveLength(1)
    expect(lowMails()[0].data.items).toEqual([{ productName: 'Window feeder', variantName: 'Default', sku: 'LOW-1', quantity: 3, lowStockAt: 3 }])
    // 3 → 2 → 1: lower still, but the owner has been told.
    expect(await buy('LOW-1', 1)).toEqual([])
    expect(await buy('LOW-1', 1)).toEqual([])
    expect(lowMails()).toHaveLength(1)
  })

  test('can tell the owner again once the count has been back above the level', async () => {
    const before = lowMails().length
    const v = (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.sku, 'LOW-1')))[0]
    expect(v.inventoryQty).toBe(1)
    // A delivery: the owner counts 10 on the shelf.
    expect((await k.as('manager')('PATCH', `/api/admin/products/variants/${v.id}`, { inventoryQty: 10, inventoryFrom: 1 })).status).toBe(200)
    expect((await variantNow(v.id)).lowStockAlertedAt).toBeNull()
    expect(await buy('LOW-1', 6)).toEqual([]) // 10 → 4
    expect(await buy('LOW-1', 2)).toEqual(['owner@shop.test']) // 4 → 2, crossed again
    expect(lowMails()).toHaveLength(before + 1)
  })

  test('a sale of several options that cross at once is one email listing them', async () => {
    const a = await k.product({ slug: 'seed', name: 'Seed mix', sku: 'LOW-A', priceCents: 500, qty: 5 })
    await k.as('owner')('PATCH', `/api/admin/products/variants/${a.variant.id}`, { lowStockAt: 5, inventoryFrom: 5 })
    // already at its level when it was set: the owner is looking at it, so the next sale does not email
    expect(await buy('LOW-A', 1)).toEqual([])
    const b = await k.product({ slug: 'suet', name: 'Suet cake', sku: 'LOW-B', priceCents: 700, qty: 8 })
    await k.as('owner')('PATCH', `/api/admin/products/variants/${b.variant.id}`, { lowStockAt: 5, inventoryFrom: 8 })
    expect(await buy('LOW-B', 3)).toEqual(['owner@shop.test'])
  })

  test('an untracked option and one with no level never email', async () => {
    const before = lowMails().length
    await k.product({ slug: 'bath', name: 'Bird bath', sku: 'LOW-U', priceCents: 900, qty: null })
    const plain = await k.product({ slug: 'pole', name: 'Pole', sku: 'LOW-N', priceCents: 900, qty: 2 })
    expect(await buy('LOW-U', 2)).toEqual([])
    expect(await buy('LOW-N', 2)).toEqual([])
    expect((await variantNow(plain.variant.id)).inventoryQty).toBe(0)
    expect(lowMails()).toHaveLength(before)
  })

  test('the Low stock filter and the Dashboard tile count the same products', async () => {
    const list = await k.as('manager')('GET', '/api/admin/products?filter=low_stock')
    expect(list.status).toBe(200)
    const names = list.json.data.map((p: any) => p.name).sort()
    // Window feeder (2 ≤ 3), Seed mix (4 ≤ 5), Suet cake (5 ≤ 5); the bird bath and the pole have no level.
    expect(names).toEqual(['Seed mix', 'Suet cake', 'Window feeder'])
    const stats = (await k.as('manager')('GET', '/api/admin/orders/stats')).json
    expect(stats.lowStock).toBe(names.length)
    expect((await k.as('manager')('GET', '/api/admin/products?filter=nonsense')).status).toBe(400)
  })

  test("a shopper reading the catalogue is never sent the owner's level", async () => {
    const cat = await k.pub('GET', '/api/public/products')
    expect(cat.status).toBe(200)
    expect(cat.text).toContain('LOW-1')
    expect(cat.text).not.toContain('lowStockAt')
    expect(cat.text).not.toContain('lowStockAlertedAt')
  })

  test('a negative level is refused', async () => {
    const v = (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.sku, 'LOW-1')))[0]
    const r = await k.as('owner')('PATCH', `/api/admin/products/variants/${v.id}`, { lowStockAt: -1 })
    expect(r.status).toBe(400)
  })

  test('with the switch off: no level accepted, no filter, no tile, and a sale emails nobody', async () => {
    await features(['dashboard', 'orders', 'products', 'contacts'])
    try {
      const v = (await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.sku, 'LOW-B')))[0]
      const set = await k.as('owner')('PATCH', `/api/admin/products/variants/${v.id}`, { lowStockAt: 1 })
      expect(set.status).toBe(403)
      expect(set.json.code).toBe('FEATURE_NOT_ENABLED')
      const filtered = await k.as('owner')('GET', '/api/admin/products?filter=low_stock')
      expect(filtered.status).toBe(403)
      expect((await k.as('owner')('GET', '/api/admin/orders/stats')).json.lowStock).toBeUndefined()
      // LOW-B stands at 5 (level 5) with its alert already spent; make a fresh option that would cross with the switch on.
      const f = await k.product({ slug: 'fresh', name: 'Fresh', sku: 'LOW-OFF', priceCents: 400, qty: 3 })
      await (k.t.db as any).update(k.S.storeProductVariant).set({ lowStockAt: 3 }).where(eq(k.S.storeProductVariant.id, f.variant.id))
      expect(await buy('LOW-OFF', 1)).toEqual([])
      expect((await variantNow(f.variant.id)).lowStockAlertedAt).toBeNull()
    } finally { await features(ON) }
  })

  test('the menu\'s Products screen asks the switch for the box, the filter and the tile', async () => {
    const fs = await import('node:fs'), path = await import('node:path')
    const web = (p: string) => fs.readFileSync(path.join(import.meta.dir, '..', 'web', 'src', p), 'utf8')
    expect(web('crm/pages/store/catalog/ProductsPage.tsx')).toContain("hasFeature('store_low_stock')")
    expect(web('crm/pages/store/catalog/ProductEditPage.tsx')).toContain("hasFeature('store_low_stock')")
    expect(web('crm/pages/store/orders/DashboardPage.tsx')).toContain('lowStock')
  })
})
