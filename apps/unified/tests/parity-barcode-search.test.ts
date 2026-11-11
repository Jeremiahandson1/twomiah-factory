// Parity tier 2 #10 (11/10): a part is found by its barcode or the supplier's part number — what the phone's scan sends as the
// search (apps/mobile/src/trades/stock.ts). Through the real server as field service.
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
