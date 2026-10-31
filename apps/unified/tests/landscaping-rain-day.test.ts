// Landscaping gap 3: a rain day — one request pushes a day's open jobs (or one route's) forward and texts the customers on the
// business's own number inside the text hours. Each test fails without it: there was no rain-day endpoint, and the only bulk move
// (bulkRescheduleJobs) set one date for everything, could land two visits of a stop on one day, and told nobody.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { textTime } from '../server/data/routeRainDay.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let ownerId: string
let owner: string
let field: string
let viewer: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

/** A seat of the given role, signed in. */
async function seat(role: string) {
  const password = 'Correct-horse-1'
  await ins(t.schema.user, { companyId, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash(password, 'bcrypt') })
  return login(`${role}@test.example`, password)
}

/** The next given weekday (0 = Sunday) after today, as YYYY-MM-DD — worked out here, not by the code under test. */
function nextWeekday(dow: number): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() !== dow)
  return d.toISOString().slice(0, 10)
}
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd) + n * 86_400_000).toISOString().slice(0, 10)
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'area_pricing', 'snow_billing'] }).where(eq(t.schema.company.id, companyId))
  owner = await login('owner@test.example', s.password)
  field = await seat('field')
  viewer = await seat('viewer')
})

/** A Monday route with two stops (45 and 30 minutes, $40 and $55), led by the owner. */
async function mondayRoute(name = 'Monday A') {
  const ct = await (await as(owner, '/api/contacts', { method: 'POST', json: { name: `Customer of ${name}`, type: 'client' } })).json()
  const a = await (await as(owner, '/api/sites', { method: 'POST', json: { name: `${name} Elm`, contactId: ct.id, address: '1 Elm St', city: 'Eau Claire' } })).json()
  const b = await (await as(owner, '/api/sites', { method: 'POST', json: { name: `${name} Oak`, contactId: ct.id, address: '2 Oak St', city: 'Eau Claire' } })).json()
  const route = await (await as(owner, '/api/recurring-routes', { method: 'POST', json: { name, dayOfWeek: 1, startTime: '07:30', assignedToId: ownerId } })).json()
  const stopA = await (await as(owner, `/api/recurring-routes/${route.id}/stops`, { method: 'POST', json: { siteId: a.id, estimatedMinutes: 45, pricePerVisit: 40 } })).json()
  const stopB = await (await as(owner, `/api/recurring-routes/${route.id}/stops`, { method: 'POST', json: { siteId: b.id, estimatedMinutes: 30, pricePerVisit: 55 } })).json()
  return { ct, a, b, route, stopA, stopB }
}

const visitsOf = (stopIds: string[]) =>
  t.db.select().from(t.schema.job).where(and(eq(t.schema.job.companyId, companyId), inArray(t.schema.job.recurringRouteStopId, stopIds)))





/** The next Monday after today, with a route's visits made for `weeks` Mondays from it. */
async function routeWithVisits(name: string, weeks = 1) {
  const r = await mondayRoute(name)
  const from = new Date().toISOString().slice(0, 10)
  await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { from, weeks } })
  const visits = await visitsOf([r.stopA.id, r.stopB.id])
  const days = [...new Set(visits.map((v: any) => ymd(v.scheduledDate)!))].sort()
  return { ...r, visits, days }
}
const rain = (json: any) => as(owner, '/api/recurring-routes/rain-day', { method: 'POST', json })
const phoneOf = async (contactId: string, mobile: string | null) => t.db.update(t.schema.contact).set({ mobile }).where(eq(t.schema.contact.id, contactId))

// Follow-up 10/30: "Skip Sundays when moving visits" (default on). A push of 6 days from a Monday lands on a Sunday — the one
// case that tells the two settings apart on every day of the week.
describe('rain day: skip Sundays', () => {
  const setSkip = (token: string, skipSundays: unknown) => as(token, '/api/recurring-routes/rain-day/settings', { method: 'PUT', json: { skipSundays } })
  const getSkip = async (token = owner) => (await (await as(token, '/api/recurring-routes/rain-day/settings')).json()).skipSundays

  test('the setting is ON until someone changes it; it is saved, and only a seat that may run a rain day can change it', async () => {
    await t.db.delete(t.schema.landscapingSetting).where(eq(t.schema.landscapingSetting.companyId, companyId))
    expect(await getSkip()).toBe(true)
    expect(await getSkip(field)).toBe(true) // anyone who sees jobs can read it
    expect((await setSkip(viewer, false)).status).toBe(403)
    expect((await setSkip(field, false)).status).toBe(403)
    expect(await getSkip()).toBe(true) // refused: nothing changed
    expect((await setSkip(owner, 'no')).status).toBe(400)
    expect((await setSkip(owner, false)).status).toBe(200)
    expect(await getSkip()).toBe(false)
    expect((await setSkip(owner, true)).status).toBe(200)
    expect(await getSkip()).toBe(true)
  })

  test('ON: a push that would land on a Sunday lands on Monday instead — times, order and the preview agree', async () => {
    expect((await setSkip(owner, true)).status).toBe(200)
    const r = await routeWithVisits('Sun on')
    const day = r.days[0] // a Monday
    const before = new Map(r.visits.map((v: any) => [v.id, v.scheduledTime]))
    const preview = await (await rain({ date: day, shift: 6, routeId: r.route.id })).json()
    expect(new Date(`${preview.toDate}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(preview.toDate).toBe(addDays(day, 7))
    expect(preview.skippedSunday).toBe(true)
    const res = await (await rain({ date: day, shift: 6, routeId: r.route.id, dryRun: false })).json()
    expect(res.moved).toBeGreaterThanOrEqual(2)
    const after = await visitsOf([r.stopA.id, r.stopB.id])
    expect(after.every((v: any) => ymd(v.scheduledDate) === addDays(day, 7))).toBe(true)
    expect(after.some((v: any) => v.scheduledDate.getUTCDay() === 0)).toBe(false)
    expect(after.every((v: any) => v.scheduledTime === before.get(v.id))).toBe(true)
  })

  test('OFF: the same push lands on the Sunday', async () => {
    expect((await setSkip(owner, false)).status).toBe(200)
    try {
      const r = await routeWithVisits('Sun off')
      const day = r.days[0]
      const res = await (await rain({ date: day, shift: 6, routeId: r.route.id, dryRun: false })).json()
      expect(res.toDate).toBe(addDays(day, 6))
      expect(res.skippedSunday).toBe(false)
      const after = await visitsOf([r.stopA.id, r.stopB.id])
      expect(after.every((v: any) => ymd(v.scheduledDate) === addDays(day, 6) && v.scheduledDate.getUTCDay() === 0)).toBe(true)
    } finally { await setSkip(owner, true) }
  })

  test('a push that does not land on a Sunday is not touched by the setting', async () => {
    expect((await setSkip(owner, true)).status).toBe(200)
    const r = await routeWithVisits('Sun na')
    const res = await (await rain({ date: r.days[0], shift: 'day', routeId: r.route.id, dryRun: false })).json()
    expect(res.toDate).toBe(addDays(r.days[0], 1))
    expect(res.skippedSunday).toBe(false)
  })
})

describe('rain day', () => {
  test('a preview changes nothing; pushing a day moves its open jobs one day, same times, same order', async () => {
    const r = await routeWithVisits('Rain A')
    const day = r.days[0]
    const before = new Map(r.visits.map((v: any) => [v.id, v.scheduledTime]))
    const preview = await (await rain({ date: day })).json()
    expect(preview.dryRun).toBe(true)
    expect(preview.wouldMove).toBeGreaterThanOrEqual(2)
    expect(preview.moved).toBe(0)
    expect((await visitsOf([r.stopA.id, r.stopB.id])).every((v: any) => ymd(v.scheduledDate) === day)).toBe(true)

    const res = await (await rain({ date: day, dryRun: false })).json()
    expect(res.moved).toBeGreaterThanOrEqual(2)
    expect(res.toDate).toBe(addDays(day, 1))
    const after = await visitsOf([r.stopA.id, r.stopB.id])
    expect(after.every((v: any) => ymd(v.scheduledDate) === addDays(day, 1))).toBe(true)
    // The crew's order is the same on the new day: each visit kept its time.
    expect(after.every((v: any) => v.scheduledTime === before.get(v.id))).toBe(true)
    const a = after.find((v: any) => v.recurringRouteStopId === r.stopA.id)!, b = after.find((v: any) => v.recurringRouteStopId === r.stopB.id)!
    expect(a.scheduledTime! < b.scheduledTime!).toBe(true)
  })

  test('a week\'s push never doubles a visit: the stop that already has one next week stays, and is listed', async () => {
    const r = await routeWithVisits('Rain B', 2)
    const res = await (await rain({ date: r.days[0], shift: 'week', routeId: r.route.id, dryRun: false })).json()
    expect(res.moved).toBe(0)
    expect(res.blocked.length).toBe(2)
    expect(res.blocked[0].reason).toContain('Already has a visit')
    expect((await visitsOf([r.stopA.id, r.stopB.id])).filter((v: any) => ymd(v.scheduledDate) === r.days[0]).length).toBe(2)
  })

  test('only open jobs move, and a route can be chosen', async () => {
    const one = await routeWithVisits('Rain C1')
    const two = await routeWithVisits('Rain C2')
    const day = one.days[0]
    const started = one.visits.find((v: any) => v.recurringRouteStopId === one.stopA.id)!
    await t.db.update(t.schema.job).set({ status: 'in_progress' }).where(eq(t.schema.job.id, started.id))
    const res = await (await rain({ date: day, routeId: one.route.id, dryRun: false })).json()
    expect(res.moved).toBe(1)
    const a = await visitsOf([one.stopA.id, one.stopB.id])
    expect(ymd(a.find((v: any) => v.id === started.id)!.scheduledDate)).toBe(day)
    expect(a.filter((v: any) => v.id !== started.id).every((v: any) => ymd(v.scheduledDate) === addDays(day, 1))).toBe(true)
    // The other route, same day, was not asked.
    expect((await visitsOf([two.stopA.id, two.stopB.id])).every((v: any) => ymd(v.scheduledDate) === day)).toBe(true)
  })

  test('texts: one per customer, in the text hours; no phone and opted-out customers are listed, not texted; off means none', async () => {
    const r = await routeWithVisits('Rain D')
    const day = r.days[0]
    await phoneOf(r.ct.id, '+17155550123')
    const silent = await routeWithVisits('Rain D opted out')
    await phoneOf(silent.ct.id, '+17155550124')
    await t.db.update(t.schema.contact).set({ optedOutSms: true }).where(eq(t.schema.contact.id, silent.ct.id))
    const noPhone = await routeWithVisits('Rain D no phone')
    const mine = [r, silent, noPhone].flatMap((x) => [x.stopA.id, x.stopB.id])
    // The earlier tests' routes are out of the way (cancelled), so this day holds only these three customers.
    const others = (await t.db.select().from(t.schema.job).where(eq(t.schema.job.companyId, companyId))).filter((j: any) => !mine.includes(j.recurringRouteStopId))
    for (const j of others) await t.db.update(t.schema.job).set({ status: 'cancelled' }).where(eq(t.schema.job.id, j.id))

    const none = await (await rain({ date: day, dryRun: false })).json()
    expect(none.texts).toBeNull()
    expect((await t.db.select().from(t.schema.scheduledText)).length).toBe(0)
    // Put them all back, then push with texts on.
    for (const id of mine) await t.db.update(t.schema.job).set({ scheduledDate: new Date(`${day}T00:00:00.000Z`) }).where(eq(t.schema.job.recurringRouteStopId, id))

    const res = await (await rain({ date: day, dryRun: false, notify: true })).json()
    expect(res.texts.queued).toBe(1)
    expect(res.texts.skipped.map((s: any) => s.reason).sort()).toEqual(['no_phone', 'opted_out'])
    const rows = await t.db.select().from(t.schema.scheduledText)
    expect(rows.length).toBe(1)
    expect(rows[0].contactId).toBe(r.ct.id)
    expect(rows[0].toPhone).toBe('+17155550123')
    expect(rows[0].status).toBe('scheduled')
    expect(rows[0].body).toContain('Customer')
    expect(rows[0].body).toContain('Rain D Elm')
    expect(rows[0].sendAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('refused: a seat that may not dispatch, a past day, a silly shift; nothing moves', async () => {
    const r = await routeWithVisits('Rain E')
    const day = r.days[0]
    expect((await as(viewer, '/api/recurring-routes/rain-day', { method: 'POST', json: { date: day, dryRun: false } })).status).toBe(403)
    expect((await as(field, '/api/recurring-routes/rain-day', { method: 'POST', json: { date: day, dryRun: false } })).status).toBe(403)
    expect((await rain({ date: '2020-01-01', dryRun: false })).status).toBe(400)
    expect((await rain({ date: day, shift: 40, dryRun: false })).status).toBe(400)
    expect((await rain({ date: day, routeId: 'nope', dryRun: false })).status).toBe(404)
    expect((await visitsOf([r.stopA.id, r.stopB.id])).every((v: any) => ymd(v.scheduledDate) === day)).toBe(true)
  })
})

describe('when a text goes', () => {
  const tz = 'America/Chicago' // UTC-5 in summer, UTC-6 in winter: pick dates that are unambiguous
  test('inside the hours: after the grace; early: at 8:00; late: next morning at 8:00', () => {
    const noon = new Date('2026-12-01T18:00:00Z') // 12:00 in Chicago (CST)
    expect(textTime(noon, tz).getTime()).toBe(noon.getTime() + 2 * 60_000)
    const night = new Date('2026-12-02T04:00:00Z') // 22:00 the day before
    expect(textTime(night, tz).toISOString()).toBe('2026-12-02T14:00:00.000Z') // 8:00 on Dec 2
    const early = new Date('2026-12-02T11:00:00Z') // 05:00
    expect(textTime(early, tz).toISOString()).toBe('2026-12-02T14:00:00.000Z')
  })
})
