// Landscaping parity rows 20 and 21 — the Route Board finished (server/crm/landscaping/recurringRoutes.ts, data/routeVisits.ts),
// behind route_board_tools (not ready).
//   · row 20: a route's season — visits only inside it, the ones already made outside it cancelled, the top-up never makes them, and
//     the next season's renewal (Service Autopilot's master schedules);
//   · row 21: a stop added after the visits were made gets its own visits at once, as far as the route's reach (not visits deleted
//     by hand); a visit whose crew is already booked at that time is said; the shortest order is worked out from the yard.
// Fails without the change: there was no season, no /renew, no clashes, and a new stop waited for the six-hourly top-up.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { topUpRouteVisits, inSeason } from '../server/data/routeVisits.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let ownerId: string
let owner: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const json = async (r: Response) => (await r.json()) as any
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const ymd = (d: any) => new Date(d).toISOString().slice(0, 10)
const BASE = ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes']
const features = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const todayKey = async () => {
  const { companyTimeZone, storeDayRange } = await import('@twomiah/tenant-backend')
  return storeDayRange(await companyTimeZone(t.db, companyId)).date
}

/** A Monday route led by the owner, with `stops` properties of 60 minutes each. */
async function route(name: string, stops = 2, startTime = '08:00') {
  const ct = await json(await as(owner, '/api/contacts', { method: 'POST', json: { name: `Customer of ${name}`, type: 'client' } }))
  const r = await json(await as(owner, '/api/recurring-routes', { method: 'POST', json: { name, dayOfWeek: 1, startTime, assignedToId: ownerId } }))
  const made: any[] = []
  for (let i = 0; i < stops; i++) {
    const s = await json(await as(owner, '/api/sites', { method: 'POST', json: { name: `${name} ${i}`, contactId: ct.id, address: `${i} Elm St`, city: 'Eau Claire' } }))
    made.push(await json(await as(owner, `/api/recurring-routes/${r.id}/stops`, { method: 'POST', json: { siteId: s.id, estimatedMinutes: 60 } })))
  }
  return { ct, route: r, stops: made }
}
const visitsOf = async (stopIds: string[]) => (await t.db.select().from(t.schema.job).where(and(eq(t.schema.job.companyId, companyId), inArray(t.schema.job.recurringRouteStopId, stopIds)))) as any[]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  owner = await login('owner@test.example', s.password)
  await features(['route_board_tools'])
})

describe('row 20: a season for each route', () => {
  test('visits are made only inside the season; one set later cancels those outside it; the top-up keeps to it', async () => {
    const r = await route('Season', 1)
    const today = await todayKey()
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { from: today, weeks: 8 } })
    const before = (await visitsOf([r.stops[0].id])).filter((v) => v.status === 'scheduled')
    expect(before.length).toBe(8)
    // The season ends three weeks from today: the Mondays after it are cancelled, the ones before stay.
    const end = addDays(today, 21)
    const put = await json(await as(owner, `/api/recurring-routes/${r.route.id}`, { method: 'PUT', json: { seasonStart: today, seasonEnd: end } }))
    expect(put.cancelledOutOfSeason).toBe(before.filter((v) => ymd(v.scheduledDate) > end).length)
    const after = await visitsOf([r.stops[0].id])
    expect(after.filter((v) => v.status === 'scheduled').every((v) => ymd(v.scheduledDate) <= end)).toBe(true)
    // The six-hourly top-up makes nothing past the season's end.
    await topUpRouteVisits(t.db, { horizonDays: 120 })
    const topped = (await visitsOf([r.stops[0].id])).filter((v) => v.status === 'scheduled')
    expect(topped.every((v) => ymd(v.scheduledDate) <= end)).toBe(true)
    expect(inSeason({ seasonStart: '2027-04-01', seasonEnd: '2027-10-31' }, '2027-11-01')).toBe(false)
    expect(inSeason({}, '2027-11-01')).toBe(true)
  })

  test('the season ends after it starts; renewing gives next year’s same days; a route with no season has nothing to renew', async () => {
    const r = await route('Renew', 1)
    expect((await as(owner, `/api/recurring-routes/${r.route.id}`, { method: 'PUT', json: { seasonStart: '2027-10-31', seasonEnd: '2027-04-01' } })).status).toBe(400)
    expect((await as(owner, `/api/recurring-routes/${r.route.id}/renew`, { method: 'POST' })).status).toBe(409)
    expect((await as(owner, `/api/recurring-routes/${r.route.id}`, { method: 'PUT', json: { seasonStart: '2027-04-01', seasonEnd: '2027-11-15' } })).status).toBe(200)
    const renewed = await json(await as(owner, `/api/recurring-routes/${r.route.id}/renew`, { method: 'POST' }))
    expect([renewed.seasonStart, renewed.seasonEnd]).toEqual(['2028-04-01', '2028-11-15'])
  })
})

describe('row 21: the Route Board finished', () => {
  test('a stop added after the visits were made gets its own at once — and a visit deleted by hand is not made again', async () => {
    const r = await route('NewStop', 1)
    const today = await todayKey()
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { from: today, weeks: 3 } })
    const first = await visitsOf([r.stops[0].id])
    await t.db.delete(t.schema.job).where(eq(t.schema.job.id, first[0].id))
    const s = await json(await as(owner, '/api/sites', { method: 'POST', json: { name: 'NewStop late', contactId: r.ct.id, address: '9 Oak St', city: 'Eau Claire' } }))
    const added = await json(await as(owner, `/api/recurring-routes/${r.route.id}/stops`, { method: 'POST', json: { siteId: s.id, estimatedMinutes: 30 } }))
    expect(added.visitsMade).toBe(3)
    const late = await visitsOf([added.id])
    expect(late.map((v) => ymd(v.scheduledDate)).sort()).toEqual(first.map((v) => ymd(v.scheduledDate)).sort())
    // Timed after the stop before it (08:00 + 60 minutes).
    expect(late.every((v) => v.scheduledTime === '09:00')).toBe(true)
    expect((await visitsOf([r.stops[0].id])).length).toBe(2)
  })

  test('a visit whose crew is already booked at that time is said on the route', async () => {
    const r = await route('Clash', 1, '10:00')
    const today = await todayKey()
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { from: today, weeks: 1 } })
    const [v] = await visitsOf([r.stops[0].id])
    await ins(t.schema.job, { companyId, number: 'OTHER-1', title: 'Estimate at the Smiths', status: 'scheduled', assignedToId: ownerId, scheduledDate: v.scheduledDate, scheduledTime: '10:30', estimatedHours: '1.00' })
    await ins(t.schema.job, { companyId, number: 'OTHER-2', title: 'Later job', status: 'scheduled', assignedToId: ownerId, scheduledDate: v.scheduledDate, scheduledTime: '13:00', estimatedHours: '1.00' })
    const detail = await json(await as(owner, `/api/recurring-routes/${r.route.id}`))
    expect(detail.clashes.map((x: any) => [x.number, x.other, x.otherTime])).toEqual([[v.number, 'OTHER-1', '10:30']])
  })

  test('the shortest order starts from the yard where the business address is set', async () => {
    await t.db.update(t.schema.company).set({ address: '100 Yard Rd', city: 'Eau Claire', state: 'WI', zip: '54701' } as any).where(eq(t.schema.company.id, companyId))
    const r = await route('Yard', 2)
    const today = await todayKey()
    await as(owner, `/api/recurring-routes/${r.route.id}/visits`, { method: 'POST', json: { from: today, weeks: 1 } })
    // Every stop on the map (the next visit's point), and the yard geocoded.
    const vs = await visitsOf(r.stops.map((s: any) => s.id))
    for (const [i, v] of vs.entries()) await t.db.update(t.schema.job).set({ lat: 44.8 + i * 0.01, lng: -91.5 }).where(eq(t.schema.job.id, v.id))
    const real = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const u = String(input?.url ?? input)
      if (u.includes('maps.googleapis.com/maps/api/geocode')) return Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 44.9, lng: -91.5 } }, formatted_address: '100 Yard Rd', types: ['street_address'] }] })
      return real(input, init)
    }) as any
    const key = process.env.GOOGLE_MAPS_API_KEY
    process.env.GOOGLE_MAPS_API_KEY = 'k'
    try {
      const opt = await json(await as(owner, `/api/recurring-routes/${r.route.id}/optimize`))
      expect(opt.startFrom).toBe('yard')
    } finally {
      globalThis.fetch = real
      if (key === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = key
    }
  })

  test('the switch: not ready; off, a new stop waits for the top-up as before and the season is refused', async () => {
    expect(FEATURE_REGISTRY.find((f) => f.id === 'route_board_tools')).toMatchObject({ templates: ['crm-landscaping'] })
    await features([])
    try {
      const r = await route('Off', 1)
      expect((await as(owner, `/api/recurring-routes/${r.route.id}`, { method: 'PUT', json: { seasonStart: '2027-04-01' } })).status).toBe(403)
      expect((await as(owner, `/api/recurring-routes/${r.route.id}/renew`, { method: 'POST' })).status).toBe(403)
      const detail = await json(await as(owner, `/api/recurring-routes/${r.route.id}`))
      expect('clashes' in detail).toBe(false)
    } finally { await features(['route_board_tools']) }
  })
})
