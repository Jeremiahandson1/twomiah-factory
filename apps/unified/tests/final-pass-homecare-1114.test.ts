// The home care final live pass (11/14), each finding as it should now be:
//   · step 22 "Offer a series says fewer than two weeks have a visit, though the calendar shows those Fridays" — the form's From is
//     today (a Saturday); the series now starts on the visit's own weekday on or after From, and a refusal names what it left out;
//   · step 32 "office visit notes are shown to the family" — the portal's visit lists never carry the office's notes;
//   · step 32 "Dana's Last login stays Never" — a relative who signs in through the client portal with the same email has signed in;
//   · "skills were stored as the caregiver's NPI" — an NPI is ten digits, refused otherwise.
// Through the real server as the homecare vertical; nothing reaches a real tenant.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { addDays } from '../server/crm/homecare/core/agencyTime.ts'
import { firstOnWeekday } from '../server/crm/homecare/scheduling/openShiftOffers.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', today = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const send = async (who: string, method: string, path: string, body?: any) => {
  const r = await as(who)(path, { method, ...(body !== undefined ? { json: body } : {}) })
  const text = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, body: parsed, text }
}
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const dowOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay()

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['contacts', 'scheduling', 'team', 'care_open_shift_offers'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  today = await createHomecareCore({ services: t.services.crm } as any).time.today(companyId)
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.casey = (await ins(t.schema.user, { email: 'casey@test.example', passwordHash: hash, firstName: 'Casey', lastName: 'Carer', role: 'caregiver', companyId })).id
  ids.martha = (await ins(t.schema.clients, { companyId, firstName: 'Martha', lastName: 'Client', isActive: true })).id
}, 90_000)

test('firstOnWeekday: the visit\'s weekday on or after From; From itself for a schedule with no weekday', () => {
  expect(firstOnWeekday('2026-11-14', 5)).toBe('2026-11-20') // Saturday → the next Friday
  expect(firstOnWeekday('2026-11-20', 5)).toBe('2026-11-20') // a Friday stays
  expect(firstOnWeekday('2026-11-14', 6)).toBe('2026-11-14')
  expect(firstOnWeekday('2026-11-14', 0)).toBe('2026-11-15')
  expect(firstOnWeekday('2026-11-14', null)).toBe('2026-11-14')
})

test('step 22: a series offered From a day that is not the visit\'s weekday posts the visit\'s own days', async () => {
  const from = addDays(today, 7)
  const visitDow = (dowOf(from) + 6) % 7 // the day before From's weekday: stepping from From never lands on it
  const sched = await send('owner', 'POST', '/api/schedules-enhanced', { caregiverId: ids.casey, clientId: ids.martha, scheduleType: 'recurring', dayOfWeek: visitDow, startTime: '09:00', endTime: '13:00', frequency: 'weekly' })
  expect(sched.status).toBe(201)
  const sid = sched.body.id ?? sched.body.schedule?.id ?? sched.body.data?.id
  const r = await send('owner', 'POST', `/api/open-shift-offers/series/${sid}`, { from, weeks: 3 })
  expect(r.status).toBe(201)
  expect(r.body.posted).toBe(3)
  const board = (await send('owner', 'GET', '/api/open-shift-offers/board?status=all')).body.data as any[]
  const dates = board.filter((s) => s.seriesId === r.body.seriesId).map((s) => String(s.date ?? s.shiftDate).slice(0, 10)).sort()
  expect(dates.length).toBe(3)
  for (const d of dates) expect(dowOf(d)).toBe(visitDow)
  expect(dates[0] >= from).toBe(true)
  // Offered again, every week is already posted: the refusal says which days it left out and why.
  const again = await send('owner', 'POST', `/api/open-shift-offers/series/${sid}`, { from, weeks: 3 })
  expect(again.status).toBe(409)
  expect(again.body.error).toContain('Left out:')
  expect(again.body.error).toContain('Already posted as an open shift')
}, 60_000)

test('step 32: the client portal\'s visits never carry the office\'s visit notes; the family\'s own note stays theirs', async () => {
  const sched = await send('owner', 'POST', '/api/schedules-enhanced', { caregiverId: ids.casey, clientId: ids.martha, scheduleType: 'recurring', dayOfWeek: dowOf(addDays(today, 2)), startTime: '15:00', endTime: '17:00', frequency: 'weekly', notes: 'Office edit during clock-in — gate code 4411' })
  expect(sched.status).toBe(201)
  const hash = await Bun.password.hash('Family-pass-1114', 'bcrypt')
  await ins(t.schema.clientPortalAccounts, { companyId, clientId: ids.martha, email: 'dana@family.example', displayName: 'Dana Daughter', passwordHash: hash, portalEnabled: true })
  const login = await send('owner', 'POST', '/api/portal/login', { email: 'dana@family.example', password: 'Family-pass-1114' })
  expect(login.status).toBe(200)
  tokens.dana = login.body.token ?? login.body.accessToken
  const visits = await send('dana', 'GET', '/api/portal/visits')
  expect(visits.status).toBe(200)
  const list = (visits.body.data ?? visits.body.visits ?? visits.body) as any[]
  expect(list.length).toBeGreaterThan(0)
  expect(visits.text).not.toContain('gate code 4411')
  for (const v of list) expect('notes' in v).toBe(false)
}, 60_000)

test('step 32: a relative who signed in through the client portal has a last login on the Family Portal list', async () => {
  const added = await send('owner', 'POST', '/api/family-portal/admin/members', { clientId: ids.martha, firstName: 'Dana', lastName: 'Daughter', email: 'dana@family.example', password: 'Family-pass-2-1114', relationship: 'daughter' })
  expect([200, 201]).toContain(added.status)
  const members = await send('owner', 'GET', '/api/family-portal/admin/members')
  expect(members.status).toBe(200)
  const dana = (members.body.data as any[]).find((m) => m.email === 'dana@family.example')
  expect(dana).toBeTruthy()
  expect(dana.lastLogin).toBeTruthy() // signed in through /api/portal/login in the test above
}, 60_000)

test('an NPI is ten digits: skills typed into the box are refused, naming it; a real one (spaces allowed) is kept', async () => {
  const bad = await send('owner', 'PATCH', `/api/caregiver-profile/${ids.casey}`, { npiNumber: 'Dementia care, safe transfers, meal prep', capabilities: '' })
  expect(bad.status).toBe(400)
  expect(bad.body.code).toBe('bad_npi')
  expect(bad.body.fields?.npiNumber).toBeTruthy()
  const good = await send('owner', 'PATCH', `/api/caregiver-profile/${ids.casey}`, { npiNumber: '123 456 7893', capabilities: 'Dementia care' })
  expect([200, 201]).toContain(good.status)
  expect(good.body.npiNumber).toBe('1234567893')
  expect((await send('owner', 'PATCH', `/api/caregiver-profile/${ids.casey}`, { npiNumber: '' })).status).toBe(200)
}, 60_000)
