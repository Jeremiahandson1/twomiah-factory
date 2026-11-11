// Parity tier 2 #10 (11/10): a part is found by its barcode or the supplier's part number — what the phone's scan sends as the
// search (apps/mobile/src/trades/stock.ts) — and the technician puts a part on the job they are at (inventory:use). Through the
// real server as field service.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let owner = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'inventory', 'barcode_scanning'] } as any).where(eq(t.schema.company.id, s.company.id))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  await t.db.insert(t.schema.inventoryItem).values([
    { companyId: s.company.id, sku: 'CAP-455', name: 'Capacitor 45/5', barcode: '012345678905', vendorPartNumber: 'GE-97F9895' },
    { companyId: s.company.id, sku: 'FLT-1620', name: 'Filter 16x20', barcode: '098765432109' },
  ] as any)
}, 120_000)

test('the scanned barcode finds the part, and so does the supplier part number', async () => {
  const names = async (q: string) => (((await (await call(`/api/inventory/items?search=${encodeURIComponent(q)}`)).json()) as any).data || []).map((i: any) => i.name)
  expect(await names('012345678905')).toEqual(['Capacitor 45/5'])
  expect(await names('GE-97F9895')).toEqual(['Capacitor 45/5'])
  expect(await names('Filter')).toEqual(['Filter 16x20'])
  expect(await names('555')).toEqual([])
})

test("the technician puts a part from the van on the job they are at; adjusting stock stays the office's; another company's job is not found", async () => {
  const companyId = ((await (t.db as any).select().from(t.schema.company))[0]).id
  const r = await (await call('/api/company/users', { method: 'POST', json: { email: 'tia@heating.example', firstName: 'Tia', lastName: 'Tech', role: 'field', password: 'Long-enough-pass-1' } })).json() as any
  const tech = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'tia@heating.example', password: 'Long-enough-pass-1' } })).json()) as any).accessToken
  const asTech = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tech}` } })
  const [cap] = await (t.db as any).select().from(t.schema.inventoryItem).where(eq(t.schema.inventoryItem.sku, 'CAP-455'))
  const [van] = await (t.db as any).insert(t.schema.inventoryLocation).values({ companyId, name: 'Van 1', type: 'truck' }).returning()
  await (t.db as any).insert(t.schema.stockLevel).values({ itemId: cap.id, locationId: van.id, quantity: 4 })
  const [hank] = await (t.db as any).insert(t.schema.contact).values({ companyId, name: 'Hank', type: 'client' }).returning()
  const [j] = await (t.db as any).insert(t.schema.job).values({ companyId, number: 'JOB-1', title: 'No cooling', contactId: hank.id, status: 'in_progress', assignedToId: r.id ?? r.user?.id }).returning()
  const used = await asTech('/api/inventory/use', { method: 'POST', json: { jobId: j.id, itemId: cap.id, locationId: van.id, quantity: 1 } })
  expect(used.status).toBeLessThan(300)
  const [lvl] = await (t.db as any).select().from(t.schema.stockLevel).where(eq(t.schema.stockLevel.locationId, van.id))
  expect(lvl.quantity).toBe(3)
  expect((await asTech('/api/inventory/adjust', { method: 'POST', json: { itemId: cap.id, locationId: van.id, quantity: 5, reason: 'x' } })).status).toBe(403)
  expect((await asTech('/api/inventory/use', { method: 'POST', json: { jobId: 'not-ours', itemId: cap.id, locationId: van.id, quantity: 1 } })).status).toBe(404)
})
