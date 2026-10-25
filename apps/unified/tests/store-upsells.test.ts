// Built-in upsells (2026-10-24, the store upgrade): "Frequently bought together" and "You may also like" on a product
// page — the owner's picks, else the same category — and one upsell line in the cart.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { pickUpsells } from '../server/crm/store/checkout/catalogue.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const p: Record<string, any> = {}
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd' })
  for (const [slug, name, sku, category, qty] of [
    ['mug', 'Mug', 'MUG-1', 'kitchen', 10], ['coaster', 'Coaster', 'COA-1', 'kitchen', 0], ['spoon', 'Spoon', 'SPO-1', 'kitchen', 10],
    ['jar', 'Jar', 'JAR-1', 'kitchen', 10], ['tee', 'Tee', 'TEE-1', 'apparel', 10],
  ] as const) p[slug] = await k.product({ slug, name, sku, priceCents: 1000, category, qty, extra: { position: Object.keys(p).length } })
  p.gift = await k.product({ slug: 'gift', name: 'Gift card', sku: 'GIFT-25', priceCents: 2500, kind: 'gift_card', category: 'kitchen', qty: null })
}, 120_000)
afterAll(() => k.restore())

describe('the picking rule', () => {
  const rows = [
    { id: 'a', category: 'k', kind: 'physical' }, { id: 'b', category: 'k', kind: 'physical' }, { id: 'c', category: 'k', kind: 'physical' },
    { id: 'd', category: 'x', kind: 'physical' }, { id: 'g', category: 'k', kind: 'gift_card' },
  ]
  test('the owner\'s picks win (only those on sale, never itself); else the category, never a gift card; the lists never repeat', () => {
    expect(pickUpsells({ id: 'a', category: 'k', boughtTogetherIds: ['d', 'zz', 'a'], alsoLikeIds: null }, rows)).toEqual({ together: ['d'], alsoLike: ['b', 'c'] })
    expect(pickUpsells({ id: 'a', category: 'k', boughtTogetherIds: null, alsoLikeIds: null }, rows)).toEqual({ together: ['b', 'c'], alsoLike: [] })
    expect(pickUpsells({ id: 'a', category: 'k', boughtTogetherIds: ['b'], alsoLikeIds: ['b', 'd'] }, rows)).toEqual({ together: ['b'], alsoLike: ['d'] })
    expect(pickUpsells({ id: 'd', category: null, boughtTogetherIds: null, alsoLikeIds: null }, rows)).toEqual({ together: [], alsoLike: [] })
  })
})

describe('on the storefront', () => {
  test("the product page shows the owner's picks to buy together and the same category to also like", async () => {
    await (k.t.db as any).update(k.S.storeProduct).set({ boughtTogetherIds: [p.spoon.product.id, p.tee.product.id] }).where(eq(k.S.storeProduct.id, p.mug.product.id))
    const page = await k.pub('GET', '/product/mug')
    expect(page.status).toBe(200)
    const fbt = page.text.slice(page.text.indexOf('Frequently bought together'), page.text.indexOf('You may also like'))
    expect(fbt).toContain('Spoon')
    expect(fbt).toContain('Tee')
    expect(fbt).toContain('data-sku="SPO-1"')
    const ymal = page.text.slice(page.text.indexOf('You may also like'))
    expect(ymal).toContain('Coaster')
    expect(ymal).toContain('Jar')
    expect(ymal).not.toContain('Gift card')
  })

  test("the cart's upsell line: bought with what is in the cart, not in it already, and in stock", async () => {
    expect((await k.pub('GET', '/api/public/upsells?skus=MUG-1')).json.product).toMatchObject({ sku: 'SPO-1', name: 'Spoon', priceCents: 1000, slug: 'spoon' })
    expect((await k.pub('GET', '/api/public/upsells?skus=MUG-1,SPO-1')).json.product.sku).toBe('TEE-1')
    // The jar's first pick, the coaster, is sold out: never offered — the spoon is.
    await (k.t.db as any).update(k.S.storeProduct).set({ boughtTogetherIds: [p.coaster.product.id, p.spoon.product.id] }).where(eq(k.S.storeProduct.id, p.jar.product.id))
    expect((await k.pub('GET', '/api/public/upsells?skus=JAR-1')).json.product.sku).toBe('SPO-1')
    expect((await k.pub('GET', '/api/public/upsells?skus=TEE-1')).json.product).toBeNull()
  })
})
