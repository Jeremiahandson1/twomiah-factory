// Landscaping gap 1: finishing a route visit records how long it took, and a route's stop order can be improved (shown first, applied
// only by the reorder). Each test fails on the Route Board as it was: no start time was kept, and there was no best-order endpoint.
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


delete process.env.GOOGLE_MAPS_API_KEY // the straight line decides in tests; nothing calls Google

describe('visit time', () => {
  test('start keeps the time once; done records the hours between; a visit never started has none', async () => {
    const r = await mondayRoute('Timing')
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { weeks: 1 } })
    const [a, b] = await visitsOf([r.stopA.id, r.stopB.id])
    const start = await as(owner, `/api/jobs/${a.id}/start`, { method: 'POST' })
    expect(start.status).toBe(200)
    const [started] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, a.id))
    expect(started.startedAt).toBeTruthy()
    // The crew pressed Start 90 minutes ago; a second Start does not move it.
    const ago = new Date(Date.now() - 90 * 60_000)
    await t.db.update(t.schema.job).set({ startedAt: ago }).where(eq(t.schema.job.id, a.id))
    await as(owner, `/api/jobs/${a.id}/start`, { method: 'POST' })
    const [again] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, a.id))
    expect(again.startedAt!.getTime()).toBe(ago.getTime())
    const done = await as(owner, `/api/jobs/${a.id}/complete`, { method: 'POST' })
    expect(done.status).toBe(200)
    const [fin] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, a.id))
    expect(Number(fin.actualHours)).toBeGreaterThanOrEqual(1.5)
    expect(Number(fin.actualHours)).toBeLessThan(1.6)
    // Finished with no Start: no length is made up.
    await as(owner, `/api/jobs/${b.id}/complete`, { method: 'POST' })
    const [skipped] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, b.id))
    expect(skipped.status).toBe('completed')
    expect(skipped.actualHours).toBeNull()
  })

  test('hours somebody typed in are not overwritten', async () => {
    const r = await mondayRoute('Timing typed')
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { weeks: 1 } })
    const [a] = await visitsOf([r.stopA.id])
    await as(owner, `/api/jobs/${a.id}/start`, { method: 'POST' })
    await t.db.update(t.schema.job).set({ startedAt: new Date(Date.now() - 3 * 3_600_000), actualHours: '0.75' }).where(eq(t.schema.job.id, a.id))
    await as(owner, `/api/jobs/${a.id}/complete`, { method: 'POST' })
    const [fin] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, a.id))
    expect(Number(fin.actualHours)).toBe(0.75)
  })
})

describe('best order for a route', () => {
  /** Four stops that zig-zag along one road: Elm at 0, Oak at 0.20, Pine at 0.02, Ash at 0.22 (degrees east). */
  async function zigzag(name: string) {
    const base = await mondayRoute(name)
    const mk = async (label: string) => {
      const s = await (await as(owner, '/api/sites', { method: 'POST', json: { name: `${name} ${label}`, contactId: base.ct.id, address: `3 ${label} St`, city: 'Eau Claire' } })).json()
      return (await (await as(owner, `/api/recurring-routes/${base.route.id}/stops`, { method: 'POST', json: { siteId: s.id, estimatedMinutes: 30, pricePerVisit: 30 } })).json())
    }
    const stopC = await mk('Pine'), stopD = await mk('Ash')
    await as(owner, `/api/recurring-routes/${base.route.id}/visits`, { method: 'POST', json: { weeks: 1 } })
    const ids = [base.stopA.id, base.stopB.id, stopC.id, stopD.id]
    return { ...base, ids, stopC, stopD }
  }
  const place = async (stopId: string, east: number) => {
    const vs = await visitsOf([stopId])
    await t.db.update(t.schema.job).set({ lat: 44.8, lng: -91.5 + east }).where(eq(t.schema.job.id, vs[0].id))
  }

  test('stops not on the map are not guessed at; once placed, a shorter order is proposed and nothing changes until it is applied', async () => {
    const z = await zigzag('Zig')
    const before = await (await as(owner, `/api/recurring-routes/${z.route.id}/optimize`)).json()
    expect(before.changes).toBe(false)
    expect(before.unplaced.length).toBe(4)
    expect(before.proposed).toEqual(z.ids)

    await place(z.ids[0], 0); await place(z.ids[1], 0.2); await place(z.ids[2], 0.02); await place(z.ids[3], 0.22)
    const res = await (await as(owner, `/api/recurring-routes/${z.route.id}/optimize`)).json()
    expect(res.changes).toBe(true)
    expect(res.proposed).toEqual([z.ids[0], z.ids[2], z.ids[1], z.ids[3]])
    expect(res.savings.miles).toBeGreaterThan(0)
    // Asking changed nothing: the board and the visit times are as they were.
    const board = await (await as(owner, `/api/recurring-routes/${z.route.id}`)).json()
    expect(board.stops.map((s: any) => s.id)).toEqual(z.ids)

    // Applying it is the reorder the board already has: the visits still to do follow the new order.
    const applied = await as(owner, `/api/recurring-routes/${z.route.id}/stops/reorder`, { method: 'PUT', json: { stopIds: res.proposed } })
    expect(applied.status).toBe(200)
    const times = new Map((await visitsOf(z.ids)).map((v: any) => [v.recurringRouteStopId, v.scheduledTime]))
    expect(times.get(z.ids[0])! < times.get(z.ids[2])!).toBe(true)
    expect(times.get(z.ids[2])! < times.get(z.ids[1])!).toBe(true)
    expect(times.get(z.ids[1])! < times.get(z.ids[3])!).toBe(true)
    const after = await (await as(owner, `/api/recurring-routes/${z.route.id}/optimize`)).json()
    expect(after.changes).toBe(false)
  })

  test('a route already in the best order says so; a seat without jobs:update cannot put stops on the map', async () => {
    const z = await zigzag('Straight')
    await place(z.ids[0], 0); await place(z.ids[1], 0.02); await place(z.ids[2], 0.2); await place(z.ids[3], 0.22)
    const res = await (await as(owner, `/api/recurring-routes/${z.route.id}/optimize`)).json()
    expect(res.changes).toBe(false)
    expect(res.savings).toBeNull()
    const refused = await as(viewer, `/api/recurring-routes/${z.route.id}/locate`, { method: 'POST' })
    expect(refused.status).toBe(403)
    const none = await (await as(owner, `/api/recurring-routes/${z.route.id}/locate`, { method: 'POST' })).json()
    expect(none.located).toEqual([])
    expect(none.remaining).toBe(0)
  })
})
