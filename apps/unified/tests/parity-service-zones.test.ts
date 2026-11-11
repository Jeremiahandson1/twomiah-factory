// Parity tier 3 (11/10, field service): service zones — ServiceTitan's zones, by ZIP. Through the real server as field service:
//   · the owner saves zones (each a list of ZIPs); a ZIP in two zones is refused in words; anyone who reads jobs reads them;
//   · a job is in the zone of its ZIP (a ZIP+4 too) — what the Dispatch Board shows; the jobs list carries the ZIP it reads;
//   · each zone names its techs and a daily job limit (ServiceTitan's technician zones and zone capacity): a job past the limit asks
//     "check before you book" and books anyway on the office's say; Find a time for a job in the zone offers its techs, and no time
//     on a day it is full; the Dispatch Board reads the techs to show their lanes;
//   · switched off, closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { zoneOfZip, zipKey } from '../server/crm/field/serviceZones.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', tia = '', gus = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'team', 'dispatch_board', 'tech_availability', 'service_zones'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  const made = async (email: string, firstName: string) => {
    const r = await json(await call('/api/company/users', { method: 'POST', json: { email, firstName, lastName: 'Tech', role: 'field', password: 'Long-enough-pass-1' } }))
    return r.body.id ?? r.body.user?.id
  }
  tia = await made('tia@heating.example', 'Tia')
  gus = await made('gus@heating.example', 'Gus')
  // Business hours, so everyone has time to offer.
  const week = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => [d, { open: '08:00', close: '17:00' }]))
  await t.db.update(t.schema.company).set({ settings: { businessHours: week } } as any).where(eq(t.schema.company.id, companyId))
}, 120_000)

test('a ZIP+4 is in its five-digit zone', () => {
  expect(zipKey(' 53703-1234 ')).toBe('53703')
  const zones = [{ id: 'n', name: 'North', zips: ['53704'], color: '#000000', techIds: [], dailyLimit: null }]
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

test("a zone's techs and daily limit: saved, a job past the limit warns and books anyway; Find a time offers the zone's techs and skips its full day", async () => {
  const saved = await json(await call('/api/service-zones', { method: 'PUT', json: { zones: [{ name: 'North', zips: ['53704', '53705'] }, { name: 'East', zips: ['53714'], techIds: [tia], dailyLimit: 1 }] } }))
  expect(saved.status).toBe(200)
  expect(saved.body.zones.map((z: any) => [z.name, z.techIds, z.dailyLimit])).toEqual([['North', [], null], ['East', [tia], 1]])
  expect((await json(await call('/api/service-zones', { method: 'PUT', json: { zones: [{ name: 'East', zips: ['53714'], dailyLimit: 0 }] } }))).status).toBe(400)

  // East already has JOB-1 on Dec 1 (the test above): one more there is past its limit of 1.
  const [hank] = await (t.db as any).select().from(t.schema.contact).where(eq(t.schema.contact.name, 'Hank'))
  const body = { title: 'AC check', contactId: hank.id, zip: '53714', scheduledDate: '2026-12-01', scheduledTime: '10:00' }
  const full = await json(await call('/api/jobs', { method: 'POST', json: body }))
  expect([full.status, full.body.code, full.body.canBookAnyway]).toEqual([409, 'unavailable', true])
  expect(full.body.error ?? full.body.message).toContain('East is full on Dec 1: 1 of 1 jobs already booked there.')
  expect((await call('/api/jobs', { method: 'POST', json: { ...body, bookAnyway: true } })).status).toBe(201)
  expect((await call('/api/jobs', { method: 'POST', json: { ...body, zip: '53704' } })).status).toBe(201) // North has no limit
  expect((await call('/api/jobs', { method: 'POST', json: { ...body, scheduledDate: '2026-12-02' } })).status).toBe(201)

  const found = await json(await call('/api/availability/find?from=2026-12-01&days=2&duration=60&zip=53714'))
  expect(found.status).toBe(200)
  expect(found.body.zone).toEqual({ name: 'East', techsOnly: true, full: ['2026-12-01', '2026-12-02'] })
  expect(found.body.slots.length).toBe(0)
  const later = await json(await call('/api/availability/find?from=2026-12-03&days=1&duration=60&zip=53714'))
  expect(later.body.zone.full).toEqual([])
  expect([...new Set(later.body.slots.map((s: any) => s.personId))]).toEqual([tia])
  // The office picked someone: they are asked about, not the zone's techs.
  const picked = await json(await call(`/api/availability/find?from=2026-12-03&days=1&duration=60&zip=53714&personIds=${gus}`))
  expect(picked.body.zone.techsOnly).toBe(false)
  expect([...new Set(picked.body.slots.map((s: any) => s.personId))]).toEqual([gus])
  // No ZIP, or a ZIP in no zone: everyone, as before.
  expect((await json(await call('/api/availability/find?from=2026-12-03&days=1&duration=60'))).body.zone).toBeUndefined()
})

test('switched off: closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  expect([403, 404]).toContain((await call('/api/service-zones')).status)
})
