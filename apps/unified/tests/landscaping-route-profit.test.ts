// Landscaping gap 1: what a route earns against what it costs, per route and per property, over the last 30 days. Fails on the
// Route Board as it was: there was no profit endpoint at all.
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




describe('route profit', () => {
  test('earned against labour and expenses, per route and per property; billed only for a seat that reads invoices', async () => {
    const r = await mondayRoute('Profit')
    await as(owner, `/api/recurring-routes/${r.route.id}`, { method: 'PUT', json: { billingMode: 'monthly' } })
    const from = addDays(new Date().toISOString().slice(0, 10), -21)
    const made = await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { from, weeks: 1 } })
    expect(made.status).toBe(201)
    const [a, b] = (await visitsOf([r.stopA.id, r.stopB.id])).sort((x: any, y: any) => (x.recurringRouteStopId === r.stopA.id ? -1 : 1))
    // Elm ($40): 2 hours of crew at $20 and a $5 dump fee. Oak ($55): no cost. Both finished.
    await ins(t.schema.timeEntry, { companyId, userId: ownerId, jobId: a.id, hours: '2', hourlyRate: '20' })
    await ins(t.schema.expense, { companyId, jobId: a.id, category: 'dump', amount: '5', description: 'Dump fee', date: new Date() })
    for (const v of [a, b]) expect((await as(owner, `/api/jobs/${v.id}/complete`, { method: 'POST' })).status).toBe(200)
    // Elm is billed ($40); Oak is done and not billed yet.
    expect((await as(owner, `/api/recurring-routes/billing/visits/${a.id}`, { method: 'POST', json: {} })).status).toBeLessThan(300)

    const res = await (await as(owner, `/api/recurring-routes/${r.route.id}/profit`)).json()
    expect(res.totals.completed).toBe(2)
    expect(res.totals.earned).toBe(95)
    expect(res.totals.labourHours).toBe(2)
    expect(res.totals.labourCost).toBe(40)
    expect(res.totals.expenseCost).toBe(5)
    expect(res.totals.cost).toBe(45)
    expect(res.totals.profit).toBe(50)
    expect(res.totals.marginPercent).toBe(52.6)
    expect(res.totals.billed).toBe(40)
    expect(res.totals.unbilled).toBe(55)
    expect(res.properties.length).toBe(2)
    // Worst first: Elm earned 40 and cost 45.
    expect(res.properties[0].name).toBe(`${'Profit'} Elm`)
    expect(res.properties[0].profit).toBe(-5)
    expect(res.properties[1].profit).toBe(55)

    // A window that holds none of it is empty, not an error.
    const none = await (await as(owner, `/api/recurring-routes/${r.route.id}/profit?from=${addDays(from, -60)}&to=${addDays(from, -50)}`)).json()
    expect(none.totals.visits).toBe(0)
    expect(none.totals.marginPercent).toBeNull()
  })

  test('refused to a seat without reports:read; bad days are said plainly; another company\'s route is not found', async () => {
    const r = await mondayRoute('Profit gate')
    expect((await as(viewer, `/api/recurring-routes/${r.route.id}/profit`)).status).toBe(403)
    expect((await as(field, `/api/recurring-routes/${r.route.id}/profit`)).status).toBe(403)
    const bad = await as(owner, `/api/recurring-routes/${r.route.id}/profit?from=2026-13-40`)
    expect(bad.status).toBe(400)
    const swapped = await as(owner, `/api/recurring-routes/${r.route.id}/profit?from=2026-10-10&to=2026-10-01`)
    expect(swapped.status).toBe(400)
    expect((await as(owner, '/api/recurring-routes/not-a-route/profit')).status).toBe(404)
  })
})
