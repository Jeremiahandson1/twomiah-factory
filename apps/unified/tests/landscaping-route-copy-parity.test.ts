// Landscaping parity row 28 — copy a route, and route templates (Yardbook's copy route; data/routeTemplates.ts,
// crm/landscaping/routeTemplates.ts; route_copy, not ready). Fails without the change: none of these paths existed.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq, asc } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { hasPrices } from '../server/data/routeTemplates.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let staff: string
let crewId: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes']
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const stopsOf = (routeId: string) => t.db.select().from(t.schema.recurringRouteStop).where(eq(t.schema.recurringRouteStop.recurringRouteId, routeId)).orderBy(asc(t.schema.recurringRouteStop.sortOrder))

let route: any
let sites: any[] = []
beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['route_copy'])
  owner = await login('owner@test.example', s.password)
  const password = 'Correct-horse-1'
  const crew = await ins(t.schema.user, { companyId, email: 'crew@test.example', firstName: 'Cam', lastName: 'Crew', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') })
  crewId = crew.id
  // A crew seat: reads routes, may not create them, does not see money.
  staff = await login('crew@test.example', password)
  const ct = await ins(t.schema.contact, { companyId, name: 'Elm Owner', type: 'client' })
  for (const name of ['Elm', 'Oak', 'Ash']) sites.push(await ins(t.schema.site, { companyId, name, contactId: ct.id, address: `1 ${name} St` }))
  route = await ins(t.schema.recurringRoute, { companyId, name: 'Monday A', dayOfWeek: 1, assignedToId: crewId, startTime: '07:30', estimatedHours: '6', billingMode: 'per_visit', seasonStart: '2026-04-01', seasonEnd: '2026-10-31', notes: 'Gate code 1234' })
  for (const [i, x] of sites.entries()) await ins(t.schema.recurringRouteStop, { companyId, recurringRouteId: route.id, siteId: x.id, contactId: ct.id, serviceType: i === 2 ? 'aeration' : 'mowing', sortOrder: [2, 0, 1][i], estimatedMinutes: 20 + i, pricePerVisit: String(40 + i), skipVisitMessage: i === 1 })
})

describe('row 28: copy a route', () => {
  test('a copy on another day has the stops in order, crew, start time, hours, billing, season and notes', async () => {
    const res = await post(owner, `/api/recurring-routes/templates/copy/${route.id}`, { name: 'Thursday A', dayOfWeek: 4 })
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.stops).toBe(3)
    const [r] = await t.db.select().from(t.schema.recurringRoute).where(eq(t.schema.recurringRoute.id, out.route.id))
    expect({ day: r.dayOfWeek, crew: r.assignedToId, start: r.startTime, hours: Number(r.estimatedHours), billing: r.billingMode, season: [r.seasonStart, r.seasonEnd], notes: r.notes })
      .toEqual({ day: 4, crew: crewId, start: '07:30', hours: 6, billing: 'per_visit', season: ['2026-04-01', '2026-10-31'], notes: 'Gate code 1234' })
    const old = await stopsOf(route.id), copy = await stopsOf(out.route.id)
    expect(copy.map((s: any) => s.siteId)).toEqual(old.map((s: any) => s.siteId))
    expect(copy.map((s: any) => [s.serviceType, s.estimatedMinutes, Number(s.pricePerVisit), s.skipVisitMessage])).toEqual(old.map((s: any) => [s.serviceType, s.estimatedMinutes, Number(s.pricePerVisit), s.skipVisitMessage]))
    expect(copy.map((s: any) => s.sortOrder)).toEqual([0, 1, 2])
    // The original is untouched.
    expect((await stopsOf(route.id)).length).toBe(3)
  })

  test('a name and a day are asked; another company’s route is not found; a priced route is copied only by a seat that sees money', async () => {
    expect((await post(owner, `/api/recurring-routes/templates/copy/${route.id}`, { dayOfWeek: 2 })).status).toBe(400)
    expect((await post(owner, `/api/recurring-routes/templates/copy/${route.id}`, { name: 'X', dayOfWeek: 9 })).status).toBe(400)
    expect((await post(owner, '/api/recurring-routes/templates/copy/nope', { name: 'X', dayOfWeek: 2 })).status).toBe(404)
    const r = await post(staff, `/api/recurring-routes/templates/copy/${route.id}`, { name: 'Staff copy', dayOfWeek: 2 })
    expect(r.status).toBe(403)
    // Copying prices is setting them: the route asks for a seat that sees money whenever a stop is priced.
    const shape = (p: string) => ({ assignedToId: null, estimatedHours: '0', startTime: '08:00', billingMode: null, seasonStart: null, seasonEnd: null, notes: null, stops: [{ siteId: 's', contactId: null, serviceType: 'mowing', estimatedMinutes: 30, pricePerVisit: p, skipVisitMessage: false }] })
    expect(hasPrices(shape('45.00'))).toBe(true)
    expect(hasPrices(shape('0'))).toBe(false)
  })
})

describe('row 28: route templates', () => {
  test('save a route as a template, list it, make a route from it (a deleted property is left out), delete it', async () => {
    const saved = await post(owner, `/api/recurring-routes/templates/from/${route.id}`, { name: 'Spring mow' })
    expect(saved.status).toBe(201)
    const tpl = await saved.json()
    expect(tpl.stops).toBe(3)
    const list = await (await as(owner, '/api/recurring-routes/templates')).json()
    const row = list.data.find((x: any) => x.id === tpl.id)
    expect(row).toMatchObject({ name: 'Spring mow', stopCount: 3, startTime: '07:30', weeklyRevenue: 123 })
    // A template makes no route by itself: the board is unchanged.
    const before = (await t.db.select().from(t.schema.recurringRoute).where(eq(t.schema.recurringRoute.companyId, companyId))).length

    await t.db.delete(t.schema.site).where(eq(t.schema.site.id, sites[2].id))
    const used = await post(owner, `/api/recurring-routes/templates/${tpl.id}/use`, { name: 'Wednesday B', dayOfWeek: 3 })
    expect(used.status).toBe(201)
    const out = await used.json()
    expect(out.stops).toBe(2)
    expect(out.leftOut).toBe(1)
    expect((await t.db.select().from(t.schema.recurringRoute).where(eq(t.schema.recurringRoute.companyId, companyId))).length).toBe(before + 1)
    expect((await stopsOf(out.route.id)).map((s: any) => s.siteId)).toEqual([sites[1].id, sites[0].id]) // the template's order (Oak, Elm), Ash's property gone

    expect((await as(owner, `/api/recurring-routes/templates/${tpl.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await as(owner, `/api/recurring-routes/templates/${tpl.id}`, { method: 'DELETE' })).status).toBe(404)
    // The route made from it stays.
    expect((await stopsOf(out.route.id)).length).toBe(2)
  })

  test('a crew seat sees templates without their money', async () => {
    const saved = await (await post(owner, `/api/recurring-routes/templates/from/${route.id}`, { name: 'Staff view' })).json()
    const list = await (await as(staff, '/api/recurring-routes/templates')).json()
    const row = list.data.find((x: any) => x.id === saved.id)
    expect(row).toBeTruthy()
    expect('weeklyRevenue' in row).toBe(false)
  })

  test('off, every path is shut; the switch is hidden and landscaping only', async () => {
    await setFeatures([])
    try {
      expect((await as(owner, '/api/recurring-routes/templates')).status).toBe(404)
      expect((await post(owner, `/api/recurring-routes/templates/copy/${route.id}`, { name: 'X', dayOfWeek: 2 })).status).toBe(404)
      // The board's own route reads are unaffected.
      expect((await as(owner, `/api/recurring-routes/${route.id}`)).status).toBe(200)
    } finally { await setFeatures(['route_copy']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'route_copy') as any
    expect(f?.hidden).toBeFalsy()
    expect(f?.templates).toEqual(['crm-landscaping'])
  })
})
