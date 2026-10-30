// Landscaping gap 1, "routes that do the work": a Route Board route makes real, dated jobs — one per stop per day it runs,
// in stop order, timed from the route's start time — so the crew's day is on the Schedule, Crew View and phone, not on a
// board nothing reads. Each test below fails on the Route Board as it was (the routes had no visits at all).
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

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

describe('route visits', () => {
  test('making visits puts one job per stop per day on the schedule, in stop order, timed from the route start', async () => {
    const { route, stopA, stopB, a, ct } = await mondayRoute()
    const first = nextWeekday(1)
    const res = await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: first, weeks: 2 } })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.made).toBe(4)
    expect(body.firstDay).toBe(first)
    expect(body.lastDay).toBe(addDays(first, 7))

    const rows = (await visitsOf([stopA.id, stopB.id])).sort((x: any, y: any) => `${ymd(x.scheduledDate)}${x.scheduledTime}`.localeCompare(`${ymd(y.scheduledDate)}${y.scheduledTime}`))
    expect(rows.map((r: any) => [ymd(r.scheduledDate), r.scheduledTime, r.recurringRouteStopId])).toEqual([
      [first, '07:30', stopA.id], [first, '08:15', stopB.id],
      [addDays(first, 7), '07:30', stopA.id], [addDays(first, 7), '08:15', stopB.id],
    ])
    const one: any = rows[0]
    expect(one.status).toBe('scheduled')
    expect(one.siteId).toBe(a.id)
    expect(one.contactId).toBe(ct.id)
    expect(one.assignedToId).toBe(ownerId)
    expect(one.address).toBe('1 Elm St')
    expect(Number(one.estimatedHours)).toBeCloseTo(0.75)
    expect(Number(one.estimatedValue)).toBe(40)
    expect(one.title).toBe('Mowing — Monday A Elm')
    // They are the schedule's own jobs: the jobs list the Schedule and Crew View read carries them.
    const list = await (await as(owner, '/api/jobs?limit=100')).json()
    expect(list.data.filter((j: any) => j.recurringRouteStopId === stopA.id || String(j.title).startsWith('Mowing — Monday A')).length).toBeGreaterThanOrEqual(4)
  })

  test('making them again adds nothing; a start day that is not the route\'s day begins on the next one that is', async () => {
    const { route, stopA, stopB } = await mondayRoute('Monday B')
    const first = nextWeekday(1)
    await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: first, weeks: 1 } })
    const again = await (await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: first, weeks: 1 } })).json()
    expect(again.made).toBe(0)
    expect(again.alreadyThere).toBe(2)
    expect((await visitsOf([stopA.id, stopB.id])).length).toBe(2)
    // From the Wednesday after: the next Monday is the one after `first`.
    const wed = addDays(first, 2)
    const later = await (await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: wed, weeks: 1 } })).json()
    expect(later.firstDay).toBe(addDays(first, 7))
    expect(later.made).toBe(2)
  })

  test('dragging the stops re-times the visits still to do, and leaves a finished one alone', async () => {
    const { route, stopA, stopB } = await mondayRoute('Monday C')
    const first = nextWeekday(1)
    await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: first, weeks: 2 } })
    // The first week's Elm visit is already done.
    const [done] = (await visitsOf([stopA.id])).filter((r: any) => ymd(r.scheduledDate) === first)
    await t.db.update(t.schema.job).set({ status: 'completed' }).where(eq(t.schema.job.id, done.id))

    const res = await as(owner, `/api/recurring-routes/${route.id}/stops/reorder`, { method: 'PUT', json: { stopIds: [stopB.id, stopA.id] } })
    expect(res.status).toBe(200)
    expect((await res.json()).retimed).toBe(3)
    const rows = await visitsOf([stopA.id, stopB.id])
    const timeOf = (stop: string, day: string) => (rows as any[]).find((r) => r.recurringRouteStopId === stop && ymd(r.scheduledDate) === day)?.scheduledTime
    // Oak (30 min) now leads: 07:30, then Elm at 08:00 — on the second Monday. The finished first-week visit keeps its time.
    expect(timeOf(stopB.id, addDays(first, 7))).toBe('07:30')
    expect(timeOf(stopA.id, addDays(first, 7))).toBe('08:00')
    expect(timeOf(stopA.id, first)).toBe('07:30')
  })

  test('a new route start time moves the visits still to do', async () => {
    const { route, stopA, stopB } = await mondayRoute('Monday D')
    await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: nextWeekday(1), weeks: 1 } })
    expect((await as(owner, `/api/recurring-routes/${route.id}`, { method: 'PUT', json: { startTime: '06:00' } })).status).toBe(200)
    expect((await visitsOf([stopA.id, stopB.id])).map((r: any) => r.scheduledTime).sort()).toEqual(['06:00', '06:45'])
    const bad = await as(owner, `/api/recurring-routes/${route.id}`, { method: 'PUT', json: { startTime: '6am' } })
    expect(bad.status).toBe(400)
    expect((await bad.json()).fields.startTime).toContain('07:30')
  })

  test('taking a stop off the route cancels its visits still to do — and only those', async () => {
    const { route, stopA, stopB } = await mondayRoute('Monday E')
    const first = nextWeekday(1)
    await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: first, weeks: 2 } })
    const [started] = (await visitsOf([stopA.id])).filter((r: any) => ymd(r.scheduledDate) === first)
    await t.db.update(t.schema.job).set({ status: 'in_progress' }).where(eq(t.schema.job.id, started.id))
    expect((await as(owner, `/api/recurring-routes/${route.id}/stops/${stopA.id}`, { method: 'DELETE' })).status).toBe(204)
    const rows = (await visitsOf([stopA.id, stopB.id])) as any[]
    expect(rows.filter((r) => r.recurringRouteStopId === stopA.id).map((r) => r.status).sort()).toEqual(['cancelled', 'in_progress'])
    expect(rows.filter((r) => r.recurringRouteStopId === stopB.id).every((r) => r.status === 'scheduled')).toBe(true)
    // And the stop left behind closes up the gap.
    expect(rows.filter((r) => r.recurringRouteStopId === stopB.id).every((r) => r.scheduledTime === '07:30')).toBe(true)
  })

  test('deleting the route cancels its visits still to do', async () => {
    const { route, stopA, stopB } = await mondayRoute('Monday F')
    await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: nextWeekday(1), weeks: 1 } })
    expect((await as(owner, `/api/recurring-routes/${route.id}`, { method: 'DELETE' })).status).toBe(204)
    const rows = (await visitsOf([stopA.id, stopB.id])) as any[]
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.status === 'cancelled')).toBe(true)
  })

  test('refusals say what to do: a paused route, an empty one, a bad number of weeks, a bad day, a route that is not ours', async () => {
    const { route } = await mondayRoute('Monday G')
    const bad = await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { weeks: 99 } })
    expect(bad.status).toBe(400)
    expect((await bad.json()).fields.weeks).toContain('1 to 26')
    const badDay = await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: 'next monday' } })
    expect(badDay.status).toBe(400)
    expect((await badDay.json()).fields.from).toContain('YYYY-MM-DD')

    await as(owner, `/api/recurring-routes/${route.id}`, { method: 'PUT', json: { status: 'paused' } })
    const paused = await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: {} })
    expect(paused.status).toBe(409)
    expect((await paused.json()).error).toContain('paused')

    const empty = await (await as(owner, '/api/recurring-routes', { method: 'POST', json: { name: 'Empty', dayOfWeek: 3 } })).json()
    const none = await as(owner, `/api/recurring-routes/${empty.id}/visits`, { method: 'POST', json: {} })
    expect(none.status).toBe(400)
    expect((await none.json()).error).toContain('Add at least one property')

    expect((await as(owner, '/api/recurring-routes/not-a-route/visits', { method: 'POST', json: {} })).status).toBe(404)
  })

  test('the server asks the seat: a crew seat and a viewer cannot make visits; a crew seat can read them, without the money', async () => {
    const { route } = await mondayRoute('Monday H')
    expect((await as(field, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: {} })).status).toBe(403)
    expect((await as(viewer, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: {} })).status).toBe(403)
    await as(owner, `/api/recurring-routes/${route.id}/visits`, { method: 'POST', json: { from: nextWeekday(1), weeks: 1 } })

    const mine = await as(owner, `/api/recurring-routes/${route.id}/visits`)
    expect(mine.status).toBe(200)
    const ownerRows = (await mine.json()).data
    expect(ownerRows.length).toBe(2)
    expect(ownerRows[0].estimatedValue).toBeDefined()

    const crew = await as(field, `/api/recurring-routes/${route.id}/visits`)
    expect(crew.status).toBe(200)
    const crewRows = (await crew.json()).data
    expect(crewRows.length).toBe(2)
    expect(crewRows[0].estimatedValue).toBeUndefined()
  })
})
