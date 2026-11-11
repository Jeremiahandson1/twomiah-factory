// Parity tier 2 #8 (11/10): the lead map — enquiries pinned where they are (Buildertrend's and ServiceTitan's lead map). Through the
// real server as field service, with Google's geocoder stood in for (no test reaches Google):
//   · opening the map looks up enquiries not yet placed, ONCE each — found or not — and never with no Maps key;
//   · open enquiries by default; "include won and lost" adds those, never dismissed spam;
//   · enquiries with no place are counted with why (not found, no location, still to be placed);
//   · switched off, the page is closed.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { LOOKUPS_PER_OPEN } from '../server/crm/leads/leadMap.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tok: Record<string, string> = {}
const asked: string[] = []
const realFetch = globalThis.fetch
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)
const FEATURES = ['jobs', 'contacts', 'team', 'dashboard', 'lead_inbox', 'lead_map']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const lead = async (homeownerName: string, location: string | null, status = 'new', receivedAt = new Date('2026-11-01T15:00:00Z')) =>
  ((await t.db.insert(t.schema.lead).values({ companyId, homeownerName, location, status, sourcePlatform: 'website', receivedAt } as any).returning()) as any[])[0]
/** Madison and Middleton are found; anything else is not. */
const PLACES: Record<string, [number, number]> = { 'Madison, WI': [43.07, -89.4], 'Middleton, WI': [43.1, -89.5] }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(FEATURES)
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
      asked.push(url)
      const where = decodeURIComponent(/address=([^&]+)/.exec(url)?.[1] || '')
      const hit = PLACES[where]
      return new Response(JSON.stringify(hit ? { status: 'OK', results: [{ geometry: { location: { lat: hit[0], lng: hit[1] } }, formatted_address: where, types: ['locality'] }] } : { status: 'ZERO_RESULTS', results: [] }), { headers: { 'content-type': 'application/json' } })
    }
    return realFetch(input, init)
  }) as typeof fetch
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch; delete process.env.GOOGLE_MAPS_API_KEY })

test('no Maps key: nothing is looked up or marked, and the enquiries wait', async () => {
  delete process.env.GOOGLE_MAPS_API_KEY
  await lead('Ann Able', 'Madison, WI')
  const r = await json(await call('owner', '/api/lead-map'))
  expect(r.status).toBe(200)
  expect(r.body).toMatchObject({ pins: [], waiting: 1, notFound: 0, noPlace: 0, lookups: false })
  expect(asked).toEqual([])
})

test('opening the map places each enquiry once — found or not — and counts the rest with why', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key'
  await lead('Ben Baker', 'Middleton, WI', 'contacted')
  await lead('Cal Cole', 'Nowhere at all')
  await lead('Dee Dunn', null)
  await lead('Spam Spammer', 'Madison, WI', 'dismissed')
  await lead('Won Wendy', 'Madison, WI', 'converted')
  const r = await json(await call('owner', '/api/lead-map'))
  expect(r.body.pins.map((p: any) => [p.name, p.status, p.lat, p.lng]).sort()).toEqual([['Ann Able', 'new', 43.07, -89.4], ['Ben Baker', 'contacted', 43.1, -89.5]])
  expect(r.body).toMatchObject({ notFound: 1, noPlace: 1, waiting: 0, lookups: true })
  // Ann, Ben, Cal and Won Wendy were looked up; never the spam, never the one with no location.
  expect(asked.length).toBe(4)
  // Opened again: nothing is looked up twice.
  await call('owner', '/api/lead-map')
  expect(asked.length).toBe(4)
  // Won and lost on request; spam never.
  const all = await json(await call('owner', '/api/lead-map?show=all'))
  expect(all.body.pins.map((p: any) => p.name).sort()).toEqual(['Ann Able', 'Ben Baker', 'Won Wendy'])
})

test(`at most ${LOOKUPS_PER_OPEN} lookups each time the map opens, the newest first`, async () => {
  asked.length = 0
  for (let i = 0; i < LOOKUPS_PER_OPEN + 3; i++) await lead(`Bulk ${i}`, 'Madison, WI', 'new', new Date(Date.UTC(2026, 10, 2, 0, i)))
  const first = await json(await call('owner', '/api/lead-map'))
  expect(asked.length).toBe(LOOKUPS_PER_OPEN)
  expect(first.body.waiting).toBe(3)
  expect(first.body.pins.some((p: any) => p.name === `Bulk ${LOOKUPS_PER_OPEN + 2}`)).toBe(true)
  const second = await json(await call('owner', '/api/lead-map'))
  expect(second.body.waiting).toBe(0)
})

test('switched off: the page is closed', async () => {
  await setFeatures(FEATURES.filter((f) => f !== 'lead_map'))
  try { expect([403, 404]).toContain((await call('owner', '/api/lead-map')).status) } finally { await setFeatures(FEATURES) }
})
