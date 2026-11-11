// Parity tier 2 #1 (11/10): the business's days off — holidays — for every trade (Buildertrend's workday exceptions,
// ServiceTitan's holidays). Through the real server as field service:
//   · Settings › Days off adds, lists and removes them (jobs:dispatch to change, jobs:read to read); one a day;
//   · a job booked on one is a warning the office can book past ("The business is closed on Nov 26 (Thanksgiving)"), for every
//     business — not only one with Tech Availability on;
//   · a maintenance plan's visit that lands on one goes on the next open day;
//   · the same rows close online booking (they are booking_blackout's own) — and a person's own time off is never touched here.
import { test, expect, beforeAll, setSystemTime, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { usualHolidays } from '../web/src/crm/pages/usualHolidays.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', hank = '', tech = ''
const tok: Record<string, string> = {}
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'team', 'dashboard', 'service_agreements', 'online_booking', 'days_off'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  const made = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email: 'tech@heating.example', firstName: 'Tia', lastName: 'Tech', role: 'field', password: 'Long-enough-pass-1' } }))
  tech = made.body.id ?? made.body.user?.id
  tok.tech = (await login('tech@heating.example', 'Long-enough-pass-1')).accessToken
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', type: 'client' })).id
}, 120_000)
afterEach(() => setSystemTime())

test('the usual US holidays fall on the right days', () => {
  expect(usualHolidays(2026)).toEqual([
    { date: '2026-01-01', reason: "New Year's Day" }, { date: '2026-05-25', reason: 'Memorial Day' }, { date: '2026-07-04', reason: 'Independence Day' },
    { date: '2026-09-07', reason: 'Labor Day' }, { date: '2026-11-26', reason: 'Thanksgiving' }, { date: '2026-12-25', reason: 'Christmas Day' },
  ])
  expect(usualHolidays(2027).find((h) => h.reason === 'Thanksgiving')?.date).toBe('2027-11-25')
})

test('Settings › Days off: add (one a day), list, remove; a tech reads but does not change them', async () => {
  setSystemTime(new Date('2026-11-10T15:00:00Z'))
  const a = await json(await call('owner', '/api/days-off', { method: 'POST', json: { date: '2026-11-26', reason: 'Thanksgiving' } }))
  expect([a.status, a.body.date, a.body.reason]).toEqual([201, '2026-11-26', 'Thanksgiving'])
  const again = await json(await call('owner', '/api/days-off', { method: 'POST', json: { date: '2026-11-26', reason: 'Twice' } }))
  expect(again.body.id).toBe(a.body.id)
  expect((await call('owner', '/api/days-off', { method: 'POST', json: { date: '2026-02-30' } })).status).toBe(400)
  const xmas = await json(await call('owner', '/api/days-off', { method: 'POST', json: { date: '2026-12-25', reason: 'Christmas Day' } }))
  // A person's own whole-day blackout is theirs, not the business's.
  await ins(t.schema.bookingBlackout, { companyId, userId: tech, date: '2026-11-27', reason: 'Tia away' })
  const list = await json(await call('tech', '/api/days-off'))
  expect(list.body.data.map((d: any) => [d.date, d.reason])).toEqual([['2026-11-26', 'Thanksgiving'], ['2026-12-25', 'Christmas Day']])
  expect((await call('tech', '/api/days-off', { method: 'POST', json: { date: '2026-12-31' } })).status).toBe(403)
  expect((await call('owner', `/api/days-off/${xmas.body.id}`, { method: 'DELETE' })).status).toBe(200)
  expect((await json(await call('owner', '/api/days-off'))).body.data.map((d: any) => d.date)).toEqual(['2026-11-26'])
})

test('a job booked on a day off warns — for every business — and can be booked anyway', async () => {
  const body = { title: 'Furnace check', contactId: hank, scheduledDate: '2026-11-26', scheduledTime: '10:00' }
  const r = await json(await call('owner', '/api/jobs', { method: 'POST', json: body }))
  expect(r.status).toBe(409)
  expect(r.body.code).toBe('unavailable')
  expect(r.body.error).toContain('The business is closed on Nov 26 (Thanksgiving).')
  const anyway = await json(await call('owner', '/api/jobs', { method: 'POST', json: { ...body, bookAnyway: true } }))
  expect(anyway.status).toBe(201)
  // An open day books as before.
  expect((await call('owner', '/api/jobs', { method: 'POST', json: { ...body, scheduledDate: '2026-11-24' } })).status).toBe(201)
})

test("a maintenance plan's visit on a day off goes on the next open day", async () => {
  const plan = await ins(t.schema.agreementPlan, { companyId, name: 'Twice-yearly furnace care', price: '199', billingFrequency: 'annual', durationMonths: 12, visitsIncluded: 2 })
  const agr = await ins(t.schema.serviceAgreement, { companyId, contactId: hank, planId: plan.id, number: 'AGR-0981', name: 'Furnace care', amount: '199', startDate: new Date('2026-11-26T00:00:00Z'), endDate: new Date('2027-11-26T00:00:00Z'), status: 'active' })
  const out = await (t.services as any).crm.agreements.scheduleTermVisits(agr.id, companyId)
  expect(out.dates).toEqual(['2026-11-27', '2027-05-26'])
})

test('the same day closes online booking (one calendar)', async () => {
  const off = await (t.db as any).select().from(t.schema.bookingBlackout).where(eq(t.schema.bookingBlackout.date, '2026-11-26'))
  expect(off.map((r: any) => [r.userId, r.startMinute, r.endMinute, r.reason])).toEqual([[null, null, null, 'Thanksgiving']])
})

test('with Days Off switched off nothing changes: the same day books with no warning, the page is closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'team', 'dashboard', 'service_agreements', 'online_booking'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  const r = await call('owner', '/api/jobs', { method: 'POST', json: { title: 'Furnace check', contactId: hank, scheduledDate: '2026-11-26', scheduledTime: '13:00' } })
  expect(r.status).toBe(201)
  expect((await call('owner', '/api/days-off')).status).toBe(403)
})
