// The online store's live test (twomiah-live-test-shop, 2026-10-26), through the real unified server as the store:
//   · a store with no home page of its own opens on its shop at `/`, never "Coming soon" with only "Open Admin"
//   · `/contact` is a working contact page until the owner publishes their own (it was a 404)
//   · a composed home's shop/grid shows the catalogue live, under the page's hero
//   · a product page shows its approved reviews and a review form; a review sent lands pending (not shown), a bot's
//     (the hidden box filled) is thanked and not saved
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let mugId = ''
const S = () => t.schema as any
const get = async (p: string) => { const r = await t.call(p); return { status: r.status, text: await r.text() } }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  companyId = (await seedOwner(t)).company.id
  const db: any = t.db
  await db.update(S().company).set({ name: 'Live Test Shop', phone: '715-555-0142', email: 'hello@shop.example' }).where(eq(S().company.id, companyId))
  const [mug] = await db.insert(S().storeProduct).values({ companyId, slug: 'mug', name: 'Camp Mug', status: 'active', position: 1 }).returning()
  mugId = mug.id
  await db.insert(S().storeProductVariant).values({ productId: mug.id, sku: 'MUG-1', name: 'Default', priceCents: 1800, inventoryQty: 5, position: 1 })
  await db.insert(S().productReview).values([
    { companyId, productId: mug.id, authorName: 'Ada', rating: 5, title: 'Keeps coffee hot', body: 'Love it.', status: 'approved', verifiedPurchase: true },
    { companyId, productId: mug.id, authorName: 'Waiting Wendy', rating: 1, body: 'Not yet approved.', status: 'pending' },
  ])
}, 120_000)

describe("a store's front door", () => {
  test('no home page of its own: `/` is its shop, with its products and the way to the cart — not "Coming soon"', async () => {
    const r = await get('/')
    expect(r.status).toBe(200)
    expect(r.text).not.toMatch(/coming soon|composition team/i)
    expect(r.text).toContain('href="/product/mug"')
    expect(r.text).toContain('Camp Mug')
    expect(r.text).toMatch(/<a href="\/shop"[^>]*>Shop<\/a>/)
  })

  test('`/contact` is a contact form with the business\'s own details until the owner publishes a page of their own', async () => {
    const r = await get('/contact')
    expect(r.status).toBe(200)
    expect(r.text).toContain('action="/api/leads"')
    expect(r.text).toContain('715-555-0142')
    expect(r.text).not.toMatch(/project inquiries/i)
    await t.db.insert(S().page).values({ companyId, slug: 'contact', title: 'Contact', isPublished: true, sections: [{ type: 'cta', variant: 'banner', data: { heading: 'Our own contact page' } }] })
    expect((await get('/contact')).text).toContain('Our own contact page')
  })

  test("a composed home's shop/grid is the catalogue as it is now, under the hero", async () => {
    await t.db.insert(S().page).values({ companyId, slug: 'home', title: 'Home', isPublished: true, sections: [
      { type: 'hero', variant: 'centered-stats', data: { title: 'Live Test Shop' } },
      { type: 'shop', variant: 'grid', data: { heading: 'New this week' } },
    ] })
    const r = await get('/')
    expect(r.text).toContain('Live Test Shop')
    expect(r.text).toMatch(/<h2>New this week<\/h2>/)
    expect(r.text).toContain('href="/product/mug"')
  })
})

describe("a product's reviews", () => {
  test('the page shows the approved review, not the pending one, and a form to write one', async () => {
    const r = await get('/product/mug')
    expect(r.status).toBe(200)
    expect(r.text).toContain('Keeps coffee hot')
    expect(r.text).toContain('Verified purchase')
    expect(r.text).not.toContain('Waiting Wendy')
    expect(r.text).toContain('action="/api/public/products/mug/reviews"')
    expect(r.text).toContain('name="website"')
  })

  test("a shopper's review lands pending; a bot's is thanked and not saved", async () => {
    const send = (json: any) => t.call('/api/public/products/mug/reviews', { method: 'POST', json })
    const ok = await send({ rating: 4, authorName: 'Grace', body: 'Solid mug.', t: String(Date.now() - 60_000) })
    expect(ok.status).toBe(201)
    const bot = await send({ rating: 5, authorName: 'Bot', body: 'spam', website: 'http://spam.example' })
    expect(bot.status).toBe(201)
    const rows = await t.db.select().from(S().productReview).where(and(eq(S().productReview.companyId, companyId), eq(S().productReview.productId, mugId)))
    expect(rows.find((x: any) => x.authorName === 'Grace')?.status).toBe('pending')
    expect(rows.some((x: any) => x.authorName === 'Bot')).toBe(false)
    expect((await get('/product/mug')).text).not.toContain('Solid mug.')
  })
})
