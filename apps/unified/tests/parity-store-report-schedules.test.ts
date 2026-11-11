// Parity tier 3 (11/10, store): sales reports saved and emailed on a schedule — on the shared saved-reports machinery. Through the
// real server as the store:
//   · a report is saved by table and period name, with a weekly schedule; a bad table or period is refused in words;
//   · the timed pass emails it on its day and hour as a CSV of the latest figures, once that day;
//   · the further reports (Shopify's report library) on Store › Sales and saved alike: by customer, by channel, by place, taxes
//     by month, refunds given (by when the money went back), inventory value (now; cost columns only for a seat that sees costs);
//     each also a spreadsheet;
//   · switched off: closed, and nothing is sent.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { storeSalesTable } from '../server/crm/store/orders/savedSalesReports.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = ''
const sent: any[] = []
const S = () => t.schema as any
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const setFeatures = async (list: string[]) => { await t.db.update(S().company).set({ enabledFeatures: list } as any).where(eq(S().company.id, companyId)); t.services.features.forgetFeatures() }
// Monday 9 Nov 2026, 9am in Chicago (15:00Z).
const MONDAY_9AM = new Date('2026-11-09T15:00:00Z')
const pass = (now: Date) => (t.services.crm as any).eventJobs.storeSavedReportsPass(now)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(S().company).set({ timezone: 'America/Chicago' } as any).where(eq(S().company.id, companyId))
  await setFeatures(['store_sales_reports', 'store_report_schedules'])
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { sent.push(m); return { success: true } }
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  const [p] = await (t.db as any).insert(S().storeProduct).values({ companyId, slug: 'mug', name: 'Mug', status: 'active' }).returning()
  const [v] = await (t.db as any).insert(S().storeProductVariant).values({ productId: p.id, sku: 'MUG-1', name: 'Default', priceCents: 2500, inventoryQty: 10 }).returning()
  const [o] = await (t.db as any).insert(S().storeOrder).values({ companyId, orderNumber: 'ORD-1', provider: 'in_person', providerSessionId: 'x1', status: 'paid', customerEmail: 'a@b.c', subtotalCents: 5000, totalCents: 5000, createdAt: new Date('2026-11-02T16:00:00Z') }).returning()
  await t.db.insert(S().storeOrderItem).values({ orderId: o.id, productId: p.id, variantId: v.id, productName: 'Mug', variantName: 'Default', sku: 'MUG-1', unitPriceCents: 2500, quantity: 2, lineTotalCents: 5000 })
}, 120_000)

test('a table by period name: by product, last 30 days', async () => {
  const table = await storeSalesTable(t.db, companyId, { tab: 'products', period: '30' }, MONDAY_9AM)
  expect(table.rows).toEqual([expect.objectContaining({ name: 'Mug', units: 2, sales: 50 })])
})

test('saved with a weekly schedule; refused in words for a bad table', async () => {
  const bad = await json(await call('/api/admin/sales-reports/saved', { method: 'POST', json: { name: 'X', params: { tab: 'nope', period: '30' } } }))
  expect(bad.status).toBe(400)
  const r = await json(await call('/api/admin/sales-reports/saved', { method: 'POST', json: { name: 'Weekly products', params: { tab: 'products', period: '30' }, schedule: { frequency: 'weekly', weekday: 1, dayOfMonth: 1, hour: 8, recipients: ['owner@shop.example'] } } }))
  expect(r.status).toBeLessThan(300)
  const list = await json(await call('/api/admin/sales-reports/saved'))
  expect(list.body.map((x: any) => x.name)).toEqual(['Weekly products'])
})

test('the pass emails it on its day and hour as a CSV, once', async () => {
  expect(await pass(new Date('2026-11-08T15:00:00Z'))).toBe(0) // Sunday
  expect(await pass(MONDAY_9AM)).toBe(1)
  expect(sent.at(-1).to).toBe('owner@shop.example')
  const csv = Buffer.from(sent.at(-1).attachments[0].content).toString('utf8')
  expect(csv).toContain('Mug')
  expect(await pass(new Date(MONDAY_9AM.getTime() + 3_600_000))).toBe(0)
})

test('the further reports: by customer, channel, place, taxes, refunds and inventory value', async () => {
  const ins = async (values: any) => ((await (t.db as any).insert(S().storeOrder).values({ companyId, provider: 'stripe', status: 'paid', ...values }).returning()) as any[])[0]
  // A shipped order to Wisconsin with tax; a counter sale; an order refunded in part on Nov 5 (placed Oct 28, before the window).
  await ins({ orderNumber: 'ORD-2', providerSessionId: 'x2', customerEmail: 'A@B.C', customerName: 'Ann Buyer', subtotalCents: 3000, taxCents: 165, totalCents: 3165, fulfillment: 'ship', shippingAddress: { country: 'US', state: 'wi' }, createdAt: new Date('2026-11-03T16:00:00Z') })
  await ins({ orderNumber: 'ORD-3', providerSessionId: 'x3', customerEmail: 'walkin@shop.example', subtotalCents: 1000, totalCents: 1000, fulfillment: 'pickup', source: 'counter', createdAt: new Date('2026-11-04T16:00:00Z') })
  await ins({ orderNumber: 'ORD-4', providerSessionId: 'x4', customerEmail: 'cy@d.e', customerName: 'Cy', subtotalCents: 4000, totalCents: 4000, refundedCents: 1500, refundedAt: new Date('2026-11-05T16:00:00Z'), status: 'partially_refunded', createdAt: new Date('2026-10-28T16:00:00Z') })
  await t.db.update(S().storeProductVariant).set({ costCents: 900 } as any).where(eq(S().storeProductVariant.sku, 'MUG-1'))
  const table = async (tab: string) => (await json(await call(`/api/admin/sales-reports/table?tab=${tab}&from=2026-11-01&to=2026-11-09`))).body

  const customers = await table('customers')
  expect(customers.rows.find((r: any) => r.email === 'a@b.c')).toMatchObject({ name: 'Ann Buyer', orders: 2, net: 81.65 })
  const channels = await table('channels')
  expect(channels.rows.map((r: any) => [r.name, r.orders])).toEqual([['Online store', 2], ['At the counter', 1]])
  const places = await table('places')
  expect(places.rows.map((r: any) => r.name)).toContain('WI, US')
  expect(places.rows.map((r: any) => r.name)).toContain('Picked up or digital (in store)')
  const taxes = await table('taxes')
  expect(taxes.rows).toEqual([expect.objectContaining({ month: '2026-11-01', orders: 3, taxed: 1, sales: 90, tax: 1.65 })])
  const refunds = await table('refunds')
  expect(refunds.rows).toEqual([expect.objectContaining({ order: '#ORD-4', on: '2026-11-05', placed: '2026-10-28', refunded: 15, kind: 'Part' })])
  const inventory = await table('inventory')
  expect(inventory.rows).toEqual([expect.objectContaining({ product: 'Mug', onHand: 10, cost: 9, atCost: 90, atPrice: 250 })])
  expect(inventory.totals).toMatchObject({ atCost: 90, atPrice: 250 })

  const csv = await call('/api/admin/sales-reports/export?report=taxes&from=2026-11-01&to=2026-11-09')
  expect(csv.status).toBe(200)
  expect(await csv.text()).toContain('Tax collected')
  expect((await call('/api/admin/sales-reports/table?tab=nope&from=2026-11-01&to=2026-11-09')).status).toBe(404)
  // Saved like the rest.
  const saved = await storeSalesTable(t.db, companyId, { tab: 'inventory', period: '30' }, MONDAY_9AM)
  expect(saved.rows[0]).toMatchObject({ product: 'Mug', atCost: 90 })
})

test("a seat that does not see costs gets no cost columns", async () => {
  const r = await json(await call('/api/company/users', { method: 'POST', json: { email: 'mgr@shop.example', firstName: 'Max', lastName: 'Manager', role: 'manager', password: 'Long-enough-pass-1' } }))
  expect(r.status).toBeLessThan(300)
  const tok = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'mgr@shop.example', password: 'Long-enough-pass-1' } })).json()) as any).accessToken
  const seat = (p: string) => t.call(p, { headers: { Authorization: `Bearer ${tok}` } })
  const res = await seat('/api/admin/sales-reports/table?tab=inventory&from=2026-11-01&to=2026-11-09')
  if (res.status === 403) return // this seat reads no takings at all — nothing to hide from it
  const body = await res.json() as any
  const canSeeCosts = body.columns.some((c: any) => c.key === 'atCost')
  const perms = ((await (await seat('/api/auth/me')).json()) as any)
  const hasMargin = JSON.stringify(perms).includes('margin:read')
  expect(canSeeCosts).toBe(hasMargin)
  if (!hasMargin) expect(body.rows[0].cost).toBeUndefined()
})

test('switched off: closed, and nothing is sent', async () => {
  await setFeatures(['store_sales_reports'])
  expect([403, 404]).toContain((await call('/api/admin/sales-reports/saved')).status)
  expect((await call('/api/admin/sales-reports/table?tab=customers&from=2026-11-01&to=2026-11-09')).status).toBe(404)
  expect(await pass(new Date('2026-11-16T15:00:00Z'))).toBe(0)
})
