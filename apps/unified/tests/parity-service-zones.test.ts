// Parity tier 3 (11/10, field service): service zones — ServiceTitan's zones, by ZIP. Through the real server as field service:
//   · the owner saves zones (each a list of ZIPs); a ZIP in two zones is refused in words; anyone who reads jobs reads them;
//   · a job is in the zone of its ZIP (a ZIP+4 too) — what the Dispatch Board shows; the jobs list carries the ZIP it reads;
//   · switched off, closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { zoneOfZip, zipKey } from '../server/crm/field/serviceZones.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'dispatch_board', 'service_zones'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
}, 120_000)

test('a ZIP+4 is in its five-digit zone', () => {
  expect(zipKey(' 53703-1234 ')).toBe('53703')
  const zones = [{ id: 'n', name: 'North', zips: ['53704'], color: '#000000' }]
  expect(zoneOfZip(zones, '53704-0001')?.name).toBe('North')
  expect(zoneOfZip(zones, '60601')).toBeNull()
})

test('zones saved; a ZIP in two zones refused', async () => {
  const twice = await json(await call('/api/service-zones', { method: 'PUT', json: { zones: [{ name: 'North', zips: ['53704'] }, { name: 'East', zips: ['53704', '53714'] }] } }))
  expect([twice.status, twice.body.error]).toEqual([400, 'ZIP 53704 is in both North and East. A ZIP belongs to one zone.'])
  const r = await json(await call('/api/service-zones', { method: 'PUT', json: { zones: [{ name: 'North', zips: ['53704', '53705'] }, { name: 'East', zips: ['53714'] }] } }))
  expect(r.status).toBe(200)
  expect(r.body.zones.map((z: any) => [z.name, z.zips])).toEqual([['North', ['53704', '53705']], ['East', ['53714']]])
  expect((await json(await call('/api/service-zones'))).body.zones.length).toBe(2)
})

test("the jobs list carries the ZIP the board puts in a zone", async () => {
  const [hank] = await (t.db as any).insert(t.schema.contact).values({ companyId, name: 'Hank', type: 'client' }).returning()
  await (t.db as any).insert(t.schema.job).values({ companyId, number: 'JOB-1', title: 'No heat', contactId: hank.id, zip: '53714', scheduledDate: new Date('2026-12-01T00:00:00Z') })
  const list = await json(await call('/api/jobs?date=2026-12-01&limit=200'))
  expect(list.body.data[0].zip).toBe('53714')
})

test('switched off: closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  expect([403, 404]).toContain((await call('/api/service-zones')).status)
})
