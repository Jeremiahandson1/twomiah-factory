// Parity tier 3 (11/10, store): sales reports saved and emailed on a schedule — on the shared saved-reports machinery. Through the
// real server as the store:
//   · a report is saved by table and period name, with a weekly schedule; a bad table or period is refused in words;
//   · the timed pass emails it on its day and hour as a CSV of the latest figures, once that day;
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

test('switched off: closed, and nothing is sent', async () => {
  await setFeatures(['store_sales_reports'])
  expect([403, 404]).toContain((await call('/api/admin/sales-reports/saved')).status)
  expect(await pass(new Date('2026-11-16T15:00:00Z'))).toBe(0)
})
