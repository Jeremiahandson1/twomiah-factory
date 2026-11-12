// Parity tier 2 #5 (11/10): booking a visit from the customer portal (ServiceTitan's and Housecall Pro's self-scheduling), through
// the real server as field service: the portal's Book a Visit section gives the booking pages' address for this customer and their
// bookings still to come (each with its page to move or cancel it); the booking form is filled from the portal; the /book list
// carries the customer's link to the service they choose; behind portal_booking AND online booking.
import { test, expect, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', hank = '', serviceId = ''
const TOKEN = 'hank-portal-booking'
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const ON = ['jobs', 'contacts', 'quotes', 'invoices', 'client_portal', 'online_booking', 'portal_booking']
const DAY = 86_400_000

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await features(ON)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', email: 'hank@home.example', phone: '715-555-0100', address: '12 Pine St', city: 'Chippewa Falls', state: 'WI', zip: '54729', type: 'client', portalEnabled: true, portalToken: TOKEN })).id
  expect((await call('/api/booking/settings', { method: 'PATCH', json: { enabled: true, maxDaysOut: 30 } })).status).toBe(200)
  const svc = await json(await call('/api/booking/services', { method: 'POST', json: { name: 'Furnace tune-up', durationMinutes: 60 } }))
  serviceId = svc.body.id
}, 120_000)

test('portal_booking is registered, not ready, for field service, basic and landscaping', () => {
  const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'portal_booking')
  expect([!!f.hidden, f.templates]).toEqual([false, ['crm-fieldservice', 'crm-basic', 'crm-landscaping']])
})

test("Book a Visit: the booking pages' address for this customer, and their bookings still to come", async () => {
  const soon = new Date(Date.now() + 3 * DAY)
  await ins(t.schema.booking, { companyId, serviceId, contactId: hank, startAt: soon, endAt: new Date(soon.getTime() + 3_600_000), customerName: 'Hank Homeowner', customerEmail: 'hank@home.example', token: 'bk-soon', status: 'confirmed' })
  await ins(t.schema.booking, { companyId, serviceId, contactId: hank, startAt: new Date(Date.now() - 3 * DAY), endAt: new Date(Date.now() - 3 * DAY + 3_600_000), customerName: 'Hank Homeowner', customerEmail: 'hank@home.example', token: 'bk-past', status: 'completed' })
  await ins(t.schema.booking, { companyId, serviceId, contactId: hank, startAt: new Date(Date.now() + 5 * DAY), endAt: new Date(Date.now() + 5 * DAY + 3_600_000), customerName: 'Hank Homeowner', customerEmail: 'hank@home.example', token: 'bk-gone', status: 'cancelled' })
  const r = await json(await t.call(`/api/portal/p/${TOKEN}/book-online`))
  expect(r.status).toBe(200)
  expect(r.body.bookUrl).toEndWith(`/book?portal=${TOKEN}`)
  expect(r.body.bookings.map((b: any) => [b.service, b.status, b.manageUrl?.endsWith('/booking/bk-soon')])).toEqual([['Furnace tune-up', 'confirmed', true]])
})

test("the booking form is filled from the portal — the customer's own details only", async () => {
  const r = await json(await t.call(`/api/portal/p/${TOKEN}/book-online/prefill`))
  expect(r.body).toEqual({ name: 'Hank Homeowner', email: 'hank@home.example', phone: '715-555-0100', address: '12 Pine St', city: 'Chippewa Falls', state: 'WI', zip: '54729' })
  expect((await t.call('/api/portal/p/not-a-real-portal/book-online/prefill')).status).toBeGreaterThanOrEqual(400)
  const script = readFileSync(new URL('../site/public/scripts/book-flow.ts', import.meta.url), 'utf8')
  expect(script).toContain("'/book-online/prefill'")
})

test('the /book list carries the customer\'s link to the service chosen', async () => {
  const page = await (await t.call(`/book?portal=${TOKEN}`)).text()
  expect(page).toContain(`/book/furnace-tune-up?portal=${TOKEN}`)
  const plain = await (await t.call('/book')).text()
  expect(plain).not.toContain('portal=')
})

test('without portal_booking (or without online booking) the section is closed', async () => {
  await features(ON.filter((f) => f !== 'portal_booking'))
  expect((await t.call(`/api/portal/p/${TOKEN}/book-online`)).status).toBeGreaterThanOrEqual(400)
  await features(ON.filter((f) => f !== 'online_booking'))
  expect((await t.call(`/api/portal/p/${TOKEN}/book-online`)).status).toBeGreaterThanOrEqual(400)
  await features(ON)
})

test('nothing to book (booking off, or no service offered): no Book a Visit — not a page saying "opening soon" (live test 11/11)', async () => {
  const sections = async () => (await json(await t.call(`/api/portal/p/${TOKEN}`))).body.sections
  expect((await sections()).bookOnline).toBe(true)
  expect((await call(`/api/booking/services/${serviceId}`, { method: 'PATCH', json: { active: false } })).status).toBe(200)
  expect((await sections()).bookOnline).toBe(false)
  expect((await t.call(`/api/portal/p/${TOKEN}/book-online`)).status).toBe(404)
  expect((await call(`/api/booking/services/${serviceId}`, { method: 'PATCH', json: { active: true } })).status).toBe(200)
  expect((await call('/api/booking/settings', { method: 'PATCH', json: { enabled: false } })).status).toBe(200)
  expect((await sections()).bookOnline).toBe(false)
  expect((await call('/api/booking/settings', { method: 'PATCH', json: { enabled: true } })).status).toBe(200)
  expect((await sections()).bookOnline).toBe(true)
})
