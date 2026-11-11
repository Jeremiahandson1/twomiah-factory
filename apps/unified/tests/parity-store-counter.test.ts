// Parity tier 2 #12 (11/10): selling at the counter (Shopify POS) — a sale paid in person, recorded as the store's own order.
// Through the real server as the store:
//   · the preview prices it with the store's tax and makes nothing;
//   · a walk-in sale: paid, handed over (picked up), source 'counter', the stock off, no customer needed, no pickup setting needed;
//   · with an email, the receipt goes there; a customer can be named;
//   · refused in words: nothing in it, an unknown product; switched off, closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', mug = ''
const mails: any[] = []
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const sell = async (body: any) => json(await call('/api/admin/counter-sales', { method: 'POST', json: body }))
const stock = async () => ((await (t.db as any).select({ q: t.schema.storeProductVariant.inventoryQty }).from(t.schema.storeProductVariant).where(eq(t.schema.storeProductVariant.id, mug)))[0].q)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['store_counter'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  ;(t.services.crm.emailService as any).send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  await (t.db as any).insert(t.schema.storeSettings).values({ companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 500, pickupEnabled: false })
  const [p] = await (t.db as any).insert(t.schema.storeProduct).values({ companyId, slug: 'mug', name: 'Mug', status: 'active' }).returning()
  mug = ((await (t.db as any).insert(t.schema.storeProductVariant).values({ productId: p.id, sku: 'MUG-1', name: 'Default', priceCents: 2000, inventoryQty: 10 }).returning())[0]).id
}, 120_000)

test('the preview prices the sale with the store tax, no shipping, and makes nothing', async () => {
  const r = await sell({ items: [{ sku: 'MUG-1', quantity: 2 }], paidBy: 'cash', preview: true })
  expect(r.status).toBe(200)
  expect(r.body.preview).toMatchObject({ subtotalCents: 4000, shippingCents: 0, taxCents: 200, totalCents: 4200 })
  expect(await stock()).toBe(10)
})

test('a walk-in sale: paid, handed over, source counter, stock off — no customer and no pickup setting needed', async () => {
  const r = await sell({ items: [{ sku: 'MUG-1', quantity: 2 }], paidBy: 'cash' })
  expect(r.status).toBe(201)
  expect(r.body.order).toMatchObject({ status: 'picked_up', source: 'counter', provider: 'in_person', totalCents: 4200, contactId: null, customerName: 'Walk-in' })
  expect(r.body.order.pickedUpAt).toBeTruthy()
  expect(await stock()).toBe(8)
  expect(r.body.receiptTo).toBeNull()
})

test('with an email, the receipt goes there; a customer can be named', async () => {
  const [sam] = await (t.db as any).insert(t.schema.contact).values({ companyId, name: 'Sam Shopper', type: 'client', email: 'sam@shop.example' }).returning()
  mails.length = 0
  const r = await sell({ items: [{ sku: 'MUG-1', quantity: 1 }], paidBy: 'card', contactId: sam.id })
  expect(r.body.order).toMatchObject({ contactId: sam.id, customerName: 'Sam Shopper', status: 'picked_up' })
  expect(r.body.receiptTo).toBe('sam@shop.example')
  expect(mails.some((m) => m.template === 'storeOrderConfirmation' && m.to === 'sam@shop.example')).toBe(true)
  expect(await stock()).toBe(7)
})

test("an email typed for the receipt: an existing customer's makes the sale theirs; a new one is a new customer, by that email — never \"Walk-in\" (live test 11/11)", async () => {
  const typed = await sell({ items: [{ sku: 'MUG-1', quantity: 1 }], paidBy: 'cash', email: 'SAM@shop.example' })
  expect(typed.body.order).toMatchObject({ customerName: 'Sam Shopper' })
  expect(typed.body.order.contactId).toBeTruthy()
  const stranger = await sell({ items: [{ sku: 'MUG-1', quantity: 1 }], paidBy: 'cash', email: 'new@shop.example' })
  expect(stranger.body.order.customerName).toBe('new@shop.example')
  expect(stranger.body.order.contactId).toBeTruthy()
  expect(stranger.body.receiptTo).toBe('new@shop.example')
})

test("the reports name a customer from their record — an old \"Walk-in\" order of theirs never labels the row (live test 11/11)", async () => {
  const { salesByCustomer, repeatCustomers } = await import('../server/data/storeReports.ts')
  const typed = await sell({ items: [{ sku: 'MUG-1', quantity: 1 }], paidBy: 'cash', email: 'sam@shop.example' })
  // As an order sold before the counter knew the email belonged to Sam: named "Walk-in", on Sam's record.
  await t.db.update(t.schema.storeOrder).set({ customerName: 'Walk-in' } as any).where(eq(t.schema.storeOrder.id, typed.body.order.id))
  const w = { from: '2000-01-01', to: '2100-01-01', timeZone: 'UTC' }
  const row = (await salesByCustomer(t.db, companyId, w)).find((r) => r.customer === typed.body.order.contactId)
  expect(row?.name).toBe('Sam Shopper')
  const repeat = (await repeatCustomers(t.db, companyId, w)).top.find((r) => r.customerId === typed.body.order.contactId)
  expect(repeat?.name).toBe('Sam Shopper')
})

test('refused in words: nothing in it, an unknown product', async () => {
  expect((await sell({ items: [], paidBy: 'cash' })).status).toBe(400)
  const r = await sell({ items: [{ sku: 'NOPE', quantity: 1 }], paidBy: 'cash' })
  expect(r.status).toBeGreaterThanOrEqual(400)
  expect(typeof r.body.error).toBe('string')
})

test('switched off: closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  expect([403, 404]).toContain((await sell({ items: [{ sku: 'MUG-1', quantity: 1 }], paidBy: 'cash' })).status)
})
