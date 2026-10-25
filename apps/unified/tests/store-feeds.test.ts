// Product feeds (2026-10-24, the store upgrade): Google Merchant Center (XML, TSV) and Meta (CSV) at private tokenised
// addresses, one row per variant on sale with Shopify's standard fields; the token is the owner's, and a new one retires
// the old addresses.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let token = ''
beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd' })
  const mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000, extra: { description: '<p>A big <b>mug</b>.</p>', brand: 'Clayworks', condition: 'new' } })
  await (k.t.db as any).update(k.S.storeProductVariant).set({ gtin: '012345678905', mpn: 'CW-MUG', compareAtPriceCents: 2500 }).where(eq(k.S.storeProductVariant.id, mug.variant.id))
  await (k.t.db as any).insert(k.S.storeProductImage).values({ productId: mug.product.id, url: '/media/site/products/mug.jpg', isPrimary: true })
  const tee = await k.product({ slug: 'tee', name: 'Tee', sku: 'TEE-S', priceCents: 1800, qty: 0, extra: { condition: 'used' } })
  await (k.t.db as any).insert(k.S.storeProductVariant).values({ productId: tee.product.id, sku: 'TEE-L', name: 'Large', priceCents: 1800, inventoryQty: null })
  await k.product({ slug: 'gift', name: 'Gift card', sku: 'GIFT-25', priceCents: 2500, kind: 'gift_card' })
  const [hidden] = await (k.t.db as any).insert(k.S.storeProduct).values({ companyId: k.companyId, slug: 'draft', name: 'Draft', status: 'draft' }).returning()
  await (k.t.db as any).insert(k.S.storeProductVariant).values({ productId: hidden.id, sku: 'DRAFT-1', name: 'Default', priceCents: 100 })
}, 120_000)
afterAll(() => k.restore())

describe('the feed token', () => {
  test("is the owner's: made on first read, never sent to staff", async () => {
    const owner = await k.O('GET', '/api/admin/settings')
    token = owner.json.feedToken
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect((await k.O('GET', '/api/admin/settings')).json.feedToken).toBe(token)
    expect('feedToken' in (await k.ST('GET', '/api/admin/settings')).json).toBe(false)
    expect('feedToken' in (await k.M('GET', '/api/admin/settings')).json).toBe(false)
  })
})

describe('the feeds', () => {
  test('Google XML: one item per variant on sale, the standard fields; no gift cards, no drafts', async () => {
    const r = await k.pub('GET', `/api/public/feeds/${token}/google.xml`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('application/xml')
    const x = r.text
    expect(x).toContain('xmlns:g="http://base.google.com/ns/1.0"')
    expect((x.match(/<item>/g) || []).length).toBe(3)
    expect(x).toContain('<g:id>MUG-1</g:id>')
    expect(x).toContain('<g:title>Mug</g:title>')
    expect(x).toContain('<g:description>A big mug .</g:description>')
    expect(x).toContain('<g:link>https://shop.test/product/mug</g:link>')
    expect(x).toContain('<g:image_link>https://shop.test/media/site/products/mug.jpg</g:image_link>')
    expect(x).toContain('<g:price>25.00 USD</g:price>')
    expect(x).toContain('<g:sale_price>20.00 USD</g:sale_price>')
    expect(x).toContain('<g:availability>in_stock</g:availability>')
    expect(x).toContain('<g:brand>Clayworks</g:brand>')
    expect(x).toContain('<g:gtin>012345678905</g:gtin>')
    expect(x).toContain('<g:mpn>CW-MUG</g:mpn>')
    expect(x).toContain('<g:condition>new</g:condition>')
    // The tee: two variants grouped, its own condition, the store's name for no brand, sold out, no identifiers.
    expect(x).toContain('<g:id>TEE-S</g:id><g:item_group_id>')
    expect(x).toContain('<g:title>Tee - Large</g:title>')
    expect(x).toContain('<g:availability>out_of_stock</g:availability>')
    expect(x).toContain('<g:brand>Test Builders</g:brand>')
    expect(x).toContain('<g:identifier_exists>no</g:identifier_exists>')
    expect(x).toContain('<g:condition>used</g:condition>')
    expect(x).not.toContain('GIFT-25')
    expect(x).not.toContain('DRAFT-1')
  })

  test('Google TSV and Meta CSV carry the same rows in their own formats', async () => {
    const tsv = await k.pub('GET', `/api/public/feeds/${token}/google.tsv`)
    const lines = tsv.text.trim().split('\n')
    expect(lines[0].split('\t')).toEqual(['id', 'item_group_id', 'title', 'description', 'link', 'image_link', 'price', 'sale_price', 'availability', 'brand', 'gtin', 'mpn', 'identifier_exists', 'condition'])
    expect(lines.length).toBe(4)
    expect(lines[1].split('\t')[0]).toBe('MUG-1')
    const csv = await k.pub('GET', `/api/public/feeds/${token}/meta.csv`)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const rows = csv.text.trim().split('\n')
    expect(rows[0]).toBe('id,title,description,availability,condition,price,sale_price,link,image_link,brand,gtin,mpn,item_group_id')
    expect(rows[1]).toBe('"MUG-1","Mug","A big mug .","in stock","new","25.00 USD","20.00 USD","https://shop.test/product/mug","https://shop.test/media/site/products/mug.jpg","Clayworks","012345678905","CW-MUG",""')
    expect(rows.some((r) => r.includes('"out of stock"'))).toBe(true)
  })

  test('a wrong token is a 404; a new token retires the old addresses; only the owner makes one', async () => {
    expect((await k.pub('GET', '/api/public/feeds/not-the-token/google.xml')).status).toBe(404)
    expect((await k.M('POST', '/api/admin/settings/feed-token')).status).toBe(403)
    const fresh = await k.O('POST', '/api/admin/settings/feed-token')
    expect(fresh.status).toBe(200)
    expect(fresh.json.feedToken).not.toBe(token)
    expect((await k.pub('GET', `/api/public/feeds/${token}/meta.csv`)).status).toBe(404)
    expect((await k.pub('GET', `/api/public/feeds/${fresh.json.feedToken}/meta.csv`)).status).toBe(200)
  })
})
