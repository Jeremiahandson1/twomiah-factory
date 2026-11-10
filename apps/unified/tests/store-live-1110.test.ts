// The store live test (Chrome, 2026-11-10), through the real server, with NO payment provider connected (as on the test site):
//   · an order the owner makes for a customer who paid in person (cash, a check, the shop's own terminal) is made PAID — before,
//     every order needed a provider, so a cash sale could not be recorded (Shopify's draft order "Mark as paid");
//   · the cart's discount code shows what it takes off, with shipping, tax and the total, before checkout (preview), and a code that
//     does not apply says so;
//   · a screen's script from the release before is reloaded once, not "Something went wrong";
//   · a shop's Settings speak of shops: Migrate Data offers Shopify and the other stores, Import brings customers.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { isStaleBuild } from '../../../packages/tenant-ui/src/shell/staleBuild.ts'
import { PLATFORM_PRESETS } from '../server/crm/office/migrationService.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let shirt: any, mug: any, buyer = '', noEmail = ''
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

beforeAll(async () => {
  k = await bootStore()
  await (k.t.db as any).insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 550 })
  // No payment provider: the test site's state.
  shirt = await k.product({ slug: 'shirt', name: 'Classic T-Shirt', sku: 'TS-M-BLUE', priceCents: 1999, qty: 3 })
  mug = await k.product({ slug: 'mug', name: 'Ceramic Mug', sku: 'MUG-11', priceCents: 1200, qty: 25 })
  await (k.t.db as any).insert(k.S.discountCode).values({ companyId: k.companyId, code: 'SAVE10', type: 'percent', value: 10 })
  ;[{ id: buyer }] = await (k.t.db as any).insert(k.S.contact).values({ companyId: k.companyId, type: 'customer', name: 'Chrome Shopper', email: 'shopper@home.example' }).returning()
  ;[{ id: noEmail }] = await (k.t.db as any).insert(k.S.contact).values({ companyId: k.companyId, type: 'customer', name: 'Walk In' }).returning()
}, 120_000)
afterAll(() => k.restore())

describe('an order paid in person, with no payment provider', () => {
  test('is made paid: no link, stock comes off, marked how it was paid', async () => {
    const before = k.mails.length
    const r = await k.M('POST', '/api/admin/draft-orders', { contactId: buyer, items: [{ sku: 'TS-M-BLUE', quantity: 1 }, { sku: 'MUG-11', quantity: 1 }], paidInPerson: 'cash' })
    expect(r.status).toBe(201)
    expect([r.json.paidInPerson, r.json.payUrl, r.json.sent]).toEqual(['cash', null, false])
    const o = await k.order(r.json.order.id)
    expect([o.status, o.provider, o.recoveryToken]).toEqual(['paid', 'in_person', null])
    expect(o.internalNote).toContain('Paid in person: cash')
    expect(o.subtotalCents).toBe(3199)
    const [v] = await (k.t.db as any).select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, shirt.variant.id))
    expect(v.inventoryQty).toBe(2)
    await k.settle()
    expect(k.mails.slice(before).some((m) => m.template === 'storeInvoice')).toBe(false)
    expect(k.mails.slice(before).some((m) => m.template === 'storeOrderConfirmation' && m.to === 'shopper@home.example')).toBe(true)
  })

  test('a customer with no email: paid in person is made (no receipt email); a link to pay is refused', async () => {
    expect((await k.M('POST', '/api/admin/draft-orders', { contactId: noEmail, items: [{ sku: 'MUG-11', quantity: 1 }] })).status).toBe(400)
    const before = k.mails.length
    const r = await k.M('POST', '/api/admin/draft-orders', { contactId: noEmail, items: [{ sku: 'MUG-11', quantity: 1 }], paidInPerson: 'check' })
    expect(r.status).toBe(201)
    expect((await k.order(r.json.order.id)).status).toBe('paid')
    await k.settle()
    expect(k.mails.slice(before).some((m) => m.template === 'storeOrderConfirmation')).toBe(false)
  })

  test('a link to pay still needs a payment provider; staff may not make either', async () => {
    const link = await k.M('POST', '/api/admin/draft-orders', { contactId: buyer, items: [{ sku: 'MUG-11', quantity: 1 }] })
    expect([link.status, link.json.error]).toEqual([503, 'This store is not accepting orders yet'])
    expect((await k.ST('POST', '/api/admin/draft-orders', { contactId: buyer, items: [{ sku: 'MUG-11', quantity: 1 }], paidInPerson: 'cash' })).status).toBe(403)
  })
})

describe("the cart's totals before checkout", () => {
  test('a code that applies: the discount, shipping, tax and total — with no payment provider', async () => {
    const r = await k.pub('POST', '/api/public/checkout/preview', { items: [{ sku: 'MUG-11', quantity: 2 }], discountCode: 'save10', shipTo: { country: 'US', state: 'WI' } })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ subtotalCents: 2400, discountCents: 240, shippingCents: 500, taxCents: 119, totalCents: 2779, discountCode: 'SAVE10', taxAtCheckout: false })
  })
  test('a code that does not apply is named as not applied; nothing is written', async () => {
    const orders = (await (k.t.db as any).select().from(k.S.storeOrder)).length
    const r = await k.pub('POST', '/api/public/checkout/preview', { items: [{ sku: 'MUG-11', quantity: 1 }], discountCode: 'NOPE' })
    expect(r.status).toBe(200)
    expect([r.json.discountCode, r.json.discountCents]).toEqual([null, 0])
    expect((await (k.t.db as any).select().from(k.S.storeOrder)).length).toBe(orders)
  })
  test('the cart keeps the code and the region it was given, and has Apply for the code', () => {
    const cart = src('../site/public/scripts/cart.ts')
    expect(cart).toContain("data-discount-apply")
    expect(cart).toContain("value=\"' + esc(discountCode) + '\"")
    expect(cart).toContain("value=\"' + esc(shipCountry) + '\"")
    expect(cart).toContain("/api/public/checkout/preview")
  })
})

describe('the rest of the findings', () => {
  test("a screen's script from the release before is a stale build (reloaded once), nothing else is", () => {
    expect(isStaleBuild(new TypeError('Failed to fetch dynamically imported module: https://x/crm-assets/assets/screens-tWciOAw7.js'))).toBe(true)
    expect(isStaleBuild(new Error('Importing a module script failed.'))).toBe(true)
    expect(isStaleBuild(new Error('Cannot read properties of undefined'))).toBe(false)
  })
  test("a shop's Migrate Data offers the stores it moves from, each with a customer export", async () => {
    for (const id of ['shopify', 'woocommerce', 'bigcommerce', 'squarespace', 'wix']) expect(Object.keys(PLATFORM_PRESETS[id].csvMappings)).toEqual(['contacts'])
    const settings = src('../verticals/store/settings.ts')
    expect(settings).toContain("migration: { providers: ['shopify', 'woocommerce', 'bigcommerce', 'squarespace', 'wix'] }")
    expect(settings).toContain("emailExamples: 'order confirmations, receipts and shipping updates'")
  })
  test('the review buttons have words; a gift card given by hand is not "thanks for your order"; profit with no sales says so', () => {
    const reviews = src('../web/src/crm/pages/store/catalog/ReviewsPage.tsx')
    for (const w of ['/>Publish</button>', '/>Reject</button>', '/>Delete</button>']) expect(reviews).toContain(w)
    expect(src('../server/crm/store/emails.ts')).toContain("from ${esc(b.companyName)}`} — enter")
    expect(src('../web/src/crm/pages/store/orders/SalesPage.tsx')).toContain("'No product sales in these days'")
  })
})
