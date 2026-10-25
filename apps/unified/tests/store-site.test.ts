// A store's website: the shop pages read the store itself (server/site/routes.ts with crm/store createStorefront;
// sections/shop/*), where templates/website-store fetched them from the store's API over HTTP.
//   · /shop lists what is on sale (not drafts), each with its lowest price and an add-to-cart carrying its SKU;
//   · /product/:slug: the product, its options, its structured data (a name with "</script>" can't end the block);
//     unknown or not on sale is a 404;
//   · /cart is the browser's cart; /scripts/cart.js and the shop's styles are a store's only; the header has the cart;
//     the menu offers Shop; the sitemap lists the products;
//   · /checkout/success shows the order the provider returned to (?ref=), the lines adding to the total;
//   · a store whose subscription has ended is closed: the shop pages answer the unavailable page, the order-received
//     page still opens.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { forgetAccountLock } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const get = async (p: string) => { const r = await t.call(p); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' } }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  companyId = (await seedOwner(t)).company.id
  const db: any = t.db, S: any = t.schema
  const [mug] = await db.insert(S.storeProduct).values({ companyId, slug: 'mug', name: 'Camp Mug </script><b>x</b>', tagline: 'Enamel, 12oz', status: 'active', featured: true, position: 1 }).returning()
  await db.insert(S.storeProductImage).values({ productId: mug.id, url: '/media/site/mug.jpg', alt: 'A mug', isPrimary: true })
  await db.insert(S.storeProductVariant).values([
    { productId: mug.id, sku: 'MUG-BLUE', name: 'Blue', priceCents: 1800, inventoryQty: 5, position: 1 },
    { productId: mug.id, sku: 'MUG-RED', name: 'Red', priceCents: 1600, compareAtPriceCents: 2000, inventoryQty: 0, position: 2 },
  ])
  const [draft] = await db.insert(S.storeProduct).values({ companyId, slug: 'secret', name: 'Unreleased Kettle', status: 'draft', position: 2 }).returning()
  await db.insert(S.storeProductVariant).values({ productId: draft.id, sku: 'KET-1', name: 'Default', priceCents: 5000 })
  const [order] = await db.insert(S.storeOrder).values({
    companyId, orderNumber: 'ORD-TEST1', provider: 'square', providerSessionId: 'sq_1', status: 'paid', customerEmail: 'ada@example.com',
    subtotalCents: 3600, discountCents: 400, loyaltyDiscountCents: 0, discountCode: 'SAVE', shippingCents: 500, taxCents: 288, totalCents: 3988,
  }).returning()
  await db.insert(S.storeOrderItem).values({ orderId: order.id, productName: 'Camp Mug', variantName: 'Blue', sku: 'MUG-BLUE', unitPriceCents: 1800, quantity: 2, lineTotalCents: 3600 })
  ;(globalThis as any).__orderId = order.id
}, 120_000)

describe("a store's shop pages", () => {
  test('/shop lists what is on sale, from its lowest price, with an add-to-cart carrying the SKU', async () => {
    const r = await get('/shop')
    expect(r.status).toBe(200)
    expect(r.text).toContain('href="/product/mug"')
    expect(r.text).not.toContain('Unreleased Kettle')
    expect(r.text).toContain('$16.00') // the lowest-priced option
    expect(r.text).toMatch(/data-add-to-cart[\s\S]*data-sku="MUG-RED"/)
    // The name is text, never markup.
    expect(r.text).not.toContain('<b>x</b>')
    // The header carries the cart, the menu offers Shop, the page loads the cart script.
    expect(r.text).toContain('class="header-cart"')
    expect(r.text).toMatch(/<a href="\/shop"[^>]*>Shop<\/a>/)
    expect(r.text).toContain('/scripts/cart.js')
  })

  test('/product/:slug: options, sold-out marked, structured data that cannot be broken out of; unknown or draft is a 404', async () => {
    const r = await get('/product/mug')
    expect(r.status).toBe(200)
    expect(r.text).toContain('data-sku="MUG-BLUE"')
    expect(r.text).toMatch(/data-sku="MUG-RED"[^>]*data-soldout="1"/)
    const ld = r.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []
    const product = ld.map((s) => s.replace(/^<script[^>]*>|<\/script>$/g, '')).map((s) => JSON.parse(s)).find((j: any) => j['@type'] === 'Product')
    expect(product).toMatchObject({ name: 'Camp Mug </script><b>x</b>', offers: { '@type': 'AggregateOffer', lowPrice: '16.00', highPrice: '18.00', offerCount: 2 } })
    expect((await get('/product/secret')).status).toBe(404)
    expect((await get('/product/nope')).status).toBe(404)
  })

  test('/cart, the cart script and the shop styles', async () => {
    expect((await get('/cart')).text).toContain('id="cart-root"')
    const js = await get('/scripts/cart.js')
    expect(js.status).toBe(200)
    expect(js.type).toContain('javascript')
    expect(js.text).toContain('/api/public/checkout')
    expect(js.text).not.toContain('{{')
    expect((await get('/styles/main.css')).text).toContain('.product-grid')
  })

  test('the sitemap lists the shop and its products, not drafts', async () => {
    const r = await get('/sitemap.xml')
    expect(r.text).toContain('/shop</loc>')
    expect(r.text).toContain('/product/mug</loc>')
    expect(r.text).not.toContain('/product/secret')
  })

  test('/checkout/success shows the order the provider returned to, its lines adding to the total', async () => {
    const r = await get('/checkout/success?ref=' + (globalThis as any).__orderId)
    expect(r.status).toBe(200)
    expect(r.text).toContain('#ORD-TEST1')
    expect(r.text).toContain('Discount (SAVE)')
    expect(r.text).toContain('$39.88')
    expect(r.text).toContain('data-cart-clear')
    // No order to show: still a thank-you, still empties the cart.
    expect((await get('/checkout/success')).text).toContain('data-cart-clear')
    // Not paid yet: never "confirmed", and the cart is kept for another try (found in the Square sandbox check).
    const [pending] = await (t.db as any).insert(t.schema.storeOrder).values({ companyId, orderNumber: 'ORD-WAIT1', provider: 'square', providerSessionId: 'sq_wait', status: 'pending', customerEmail: 'w@example.com', subtotalCents: 1000, totalCents: 1000 }).returning()
    const w = await get('/checkout/success?ref=' + pending.id)
    expect(w.text).toContain('We haven&#39;t received your payment yet')
    expect(w.text).not.toContain('is confirmed')
    expect(w.text).not.toContain('data-cart-clear')
  })

  test("a store whose subscription has ended is closed: shop pages answer the unavailable page, the order page still opens", async () => {
    await t.db.update(t.schema.company).set({ settings: { subscriptionStatus: 'canceled', billingStatus: 'canceled' } } as any).where(eq(t.schema.company.id, companyId))
    forgetAccountLock()
    try {
      for (const p of ['/shop', '/product/mug', '/cart', '/']) {
        const r = await get(p)
        expect([p, r.status]).toEqual([p, 503])
        expect(r.text).toContain('is unavailable')
      }
      expect((await get('/checkout/success?ref=' + (globalThis as any).__orderId)).status).toBe(200)
      expect((await get('/styles/main.css')).status).toBe(200)
    } finally {
      await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, companyId))
      forgetAccountLock()
    }
  })
})

describe('another vertical has no shop', () => {
  test('no shop pages, no cart script, no shop styles, no cart in the header', async () => {
    const other = await bootTenant({ vertical: 'contractor' })
    await seedOwner(other)
    for (const p of ['/shop', '/cart', '/scripts/cart.js']) expect([p, (await other.call(p)).status]).toEqual([p, 404])
    expect(await (await other.call('/styles/main.css')).text()).not.toContain('.product-grid')
    expect(await (await other.call('/')).text()).not.toContain('header-cart')
  }, 60_000) // it boots a second tenant (every migration), which alone takes about the default 5 seconds
})
