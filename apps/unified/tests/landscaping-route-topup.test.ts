// Landscaping gap 1: route visits keep themselves four weeks ahead (data/routeVisits.ts topUpRouteVisits). Fails without it:
// the function does not exist, and a route's visits ran out after the weeks the owner last made.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { topUpRouteVisits } from '../server/data/routeVisits.ts'

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

describe('rolling top-up of route visits', () => {
  test('a route with visits is extended to four weeks ahead, once; a route never made is left alone; nothing doubles', async () => {
    const r = await mondayRoute('Top-up A')
    const fresh = await mondayRoute('Top-up untouched')
    const stopIds = [r.stopA.id, r.stopB.id]
    // The owner made one week of visits; nothing else.
    const first = await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { weeks: 1 } })
    expect(first.status).toBe(201)
    expect((await visitsOf(stopIds)).length).toBe(2)

    const out = await topUpRouteVisits(t.db)
    const mine = out.filter((x) => x.routeId === r.route.id)
    expect(mine.length).toBe(1)
    const after = await visitsOf(stopIds)
    // Four weeks ahead of today holds 4 or 5 Mondays; the first week was already there.
    const today = new Date().toISOString().slice(0, 10)
    const end = addDays(today, 28)
    const days = [...new Set(after.map((v: any) => ymd(v.scheduledDate)!))].sort()
    expect(days.length).toBeGreaterThanOrEqual(4)
    expect(days.every((d) => d <= end)).toBe(true)
    expect(days[days.length - 1] >= addDays(today, 21)).toBe(true)
    expect(after.length).toBe(days.length * 2)
    // The route nobody made visits for got none.
    expect((await visitsOf([fresh.stopA.id, fresh.stopB.id])).length).toBe(0)
    // Running it again adds nothing.
    const again = await topUpRouteVisits(t.db)
    expect(again.filter((x) => x.routeId === r.route.id).length).toBe(0)
    expect((await visitsOf(stopIds)).length).toBe(after.length)
  })

  test('a visit the owner deleted is not made again, and a paused route is not topped up', async () => {
    const r = await mondayRoute('Top-up B')
    const stopIds = [r.stopA.id, r.stopB.id]
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { weeks: 3 } })
    const made = await visitsOf(stopIds)
    expect(made.length).toBe(6)
    // Delete the middle week's first visit by hand.
    const days = [...new Set(made.map((v: any) => ymd(v.scheduledDate)!))].sort()
    const gone = made.find((v: any) => ymd(v.scheduledDate) === days[1] && v.recurringRouteStopId === r.stopA.id)!
    await t.db.delete(t.schema.job).where(eq(t.schema.job.id, gone.id))
    await topUpRouteVisits(t.db)
    const after = await visitsOf(stopIds)
    expect(after.some((v: any) => v.id === gone.id)).toBe(false)
    expect(after.some((v: any) => ymd(v.scheduledDate) === days[1] && v.recurringRouteStopId === r.stopA.id)).toBe(false)

    const p = await mondayRoute('Top-up paused')
    await as(owner, `/api/recurring-routes/${p.route.id}/visits`, { method: 'POST', json: { weeks: 1 } })
    await t.db.update(t.schema.recurringRoute).set({ status: 'paused' }).where(eq(t.schema.recurringRoute.id, p.route.id))
    await topUpRouteVisits(t.db)
    expect((await visitsOf([p.stopA.id, p.stopB.id])).length).toBe(2)
  })

  test('a company with the Route Board off is skipped', async () => {
    const r = await mondayRoute('Top-up C')
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { weeks: 1 } })
    const out = await topUpRouteVisits(t.db, { enabled: async () => false })
    expect(out.length).toBe(0)
    expect((await visitsOf([r.stopA.id, r.stopB.id])).length).toBe(2)
  })
})
