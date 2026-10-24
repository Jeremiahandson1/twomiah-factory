// Two fixes from the scheduling branch's notes (batch 4, 2026-10-24):
//   1. Route timings never call the public OSRM demo server (its usage policy forbids production use, as the OSM tiles'
//      did). With GOOGLE_MAPS_API_KEY the server asks Google's licensed Routes API — one computeRouteMatrix call for a
//      day's stops — and without it, or when Google does not answer, uses the straight-line distance.
//   2. /api/jobs?date= is the COMPANY'S day, not the server's: pinned here to a server clock in Honolulu (UTC-10) and a
//      company in Chicago, where the server's local midnight put the next day's work on the board and lost the day's own.
//
// The server clock is pinned before anything reads a date.
process.env.TZ = 'Pacific/Honolulu'
import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getRoute, optimizeRoute } from '../server/crm/field/routingService.ts'

const LOOP = { lat: 41.8781, lng: -87.6298 }, NORTH = { lat: 42.1, lng: -87.7 }, WEST = { lat: 41.88, lng: -88.1 }

describe('1. route timings: Google\'s Routes API or the straight line, never a public router', () => {
  const realFetch = globalThis.fetch
  let calls: Array<{ url: string; init?: any }> = []
  const stub = (answer: (url: string, init?: any) => Response | Promise<Response>) => {
    calls = []
    globalThis.fetch = (async (url: any, init?: any) => { calls.push({ url: String(url), init }); return answer(String(url), init) }) as any
  }
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.GOOGLE_MAPS_API_KEY; delete process.env.OSRM_URL })

  test('no key: no call leaves the server, and the straight line answers (OSRM_URL unset, as in production)', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY; delete process.env.OSRM_URL
    stub(() => new Response('{}', { status: 500 }))
    const r = await optimizeRoute([LOOP, NORTH, WEST])
    expect(calls).toEqual([])
    expect(r.source).toBe('straight_line')
    expect(r.legs.length).toBe(2)
    expect(r.totalDistanceMiles).toBeGreaterThan(10)
    const one = await getRoute(LOOP, NORTH)
    expect(calls).toEqual([])
    expect(one.source).toBe('straight_line')
    expect(one.durationMinutes).toBeGreaterThan(20)
  })

  test('with the key: one computeRouteMatrix call from the server with the server key, its figures used', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'server-key'
    process.env.OSRM_URL = 'https://router.project-osrm.org'
    stub((url, init) => {
      const body = JSON.parse(init.body)
      const out: any[] = []
      body.origins.forEach((_: any, i: number) => body.destinations.forEach((_d: any, j: number) => {
        if (i !== j) out.push({ originIndex: i, destinationIndex: j, distanceMeters: 1000 * (i + j + 1), duration: `${600 * (i + j + 1)}s`, condition: 'ROUTE_EXISTS' })
      }))
      return new Response(JSON.stringify(out), { status: 200 })
    })
    const r = await optimizeRoute([LOOP, NORTH, WEST])
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix')
    expect(calls[0].init.headers['X-Goog-Api-Key']).toBe('server-key')
    expect(calls.some((c) => /osrm/i.test(c.url))).toBe(false)
    expect(r.source).toBe('google')
    // Legs come off the same matrix: no second round of calls, and each is Google's figure (a multiple of 600 s).
    expect(r.legs.every((l: any) => l.duration % 600 === 0)).toBe(true)
  })

  test('with the key, one leg is computeRoutes; Google refusing falls back to the straight line, still no OSRM', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'server-key'
    stub(() => new Response(JSON.stringify({ routes: [{ distanceMeters: 30000, duration: '1800s' }] }), { status: 200 }))
    const leg = await getRoute(LOOP, NORTH)
    expect(calls.map((c) => c.url)).toEqual(['https://routes.googleapis.com/directions/v2:computeRoutes'])
    expect(leg).toMatchObject({ source: 'google', distance: 30000, durationMinutes: 30 })

    stub(() => new Response('{"error":{"code":403}}', { status: 403 }))
    const r = await optimizeRoute([LOOP, NORTH, WEST])
    expect(calls.every((c) => c.url.startsWith('https://routes.googleapis.com/'))).toBe(true)
    expect(r.source).toBe('straight_line')
    expect(r.legs.length).toBe(2)
  })
})

describe('2. /api/jobs?date= is the company\'s day, on a server clock that is not', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let token = '', co = '', ownerId = ''
  const ids: Record<string, string> = {}
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'fieldservice' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['contacts', 'jobs', 'dispatch_board', 'route_optimization'] } as any).where(eq(t.schema.company.id, co))
    token = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    ownerId = s.owner.id
    const add = async (key: string, number: string, scheduledDate: Date, source?: string) => {
      const [j] = await t.db.insert(t.schema.job).values({ companyId: co, number, title: key, status: 'scheduled', scheduledDate, assignedToId: ownerId, lat: 41.8 + Number(number.slice(4)) / 50, lng: -87.6, ...(source ? { source } : {}) } as any).returning()
      ids[key] = j.id
    }
    // Day markers (a job booked in the CRM) for 2 Nov, 3 Nov and 4 Nov.
    await add('marker-2nd', 'JOB-1', new Date('2026-11-02T00:00:00Z'))
    await add('marker-3rd', 'JOB-2', new Date('2026-11-03T00:00:00Z'))
    await add('marker-4th', 'JOB-3', new Date('2026-11-04T00:00:00Z'))
    // Online bookings carry the instant: 21:00 on the 3rd in Chicago (03:00Z on the 4th), and 22:00 on the 2nd.
    await add('booked-3rd-evening', 'JOB-4', new Date('2026-11-04T03:00:00Z'), 'online_booking')
    await add('booked-2nd-evening', 'JOB-5', new Date('2026-11-03T04:00:00Z'), 'online_booking')
  }, 120_000)

  test('the server clock is pinned off UTC (the precondition the old code failed on)', () => {
    expect(new Date('2026-11-03T00:00:00').getTimezoneOffset()).toBe(600)
  })

  test('?date=2026-11-03 lists the 3rd\'s marker and the 3rd-evening booking, not the 2nd\'s or the 4th\'s', async () => {
    const r = await t.call('/api/jobs?date=2026-11-03&limit=100', { headers: { Authorization: `Bearer ${token}` } })
    expect(r.status).toBe(200)
    const got = ((await r.json()) as any).data.map((j: any) => j.title).sort()
    expect(got).toEqual(['booked-3rd-evening', 'marker-3rd'])
  })

  test('?date=2026-11-04 lists only the 4th\'s marker; a malformed date is no filter at all', async () => {
    const r = await t.call('/api/jobs?date=2026-11-04&limit=100', { headers: { Authorization: `Bearer ${token}` } })
    expect(((await r.json()) as any).data.map((j: any) => j.title)).toEqual(['marker-4th'])
    const all = await t.call('/api/jobs?date=2026-13-45x&limit=100', { headers: { Authorization: `Bearer ${token}` } })
    expect(((await all.json()) as any).data.length).toBe(5)
  })

  test('a person\'s day route (/api/routing/optimize-day?date=2026-11-03) is the company\'s day too', async () => {
    const r = await t.call(`/api/routing/optimize-day?date=2026-11-03`, { headers: { Authorization: `Bearer ${token}` } })
    expect(r.status).toBe(200)
    const body = (await r.json()) as any
    expect(body.date).toBe('2026-11-03')
    expect(body.jobs.map((j: any) => j.title).sort()).toEqual(['booked-3rd-evening', 'marker-3rd'])
    expect(body.optimizedRoute.source).toBe('straight_line')
  })
})
