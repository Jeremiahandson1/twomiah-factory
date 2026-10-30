// Storms and canvassing (docs/parity/roof-storms-canvass.md; roofing depth, gap 9), through the real server as the roofing
// vertical:
//   · a storm drawn on the map (a polygon or a circle) finds the PAST CUSTOMERS inside it by where their pin is — the job's
//     pin first, then the contact's — and a customer with no pin only by zip, marked as such; a customer in the storm's
//     zip but outside the drawn path is NOT hit; the storm board's generate-leads reads the same path;
//   · "check NOAA now" is the owner's, an admin's or a manager's action (storms:update, owner decision 10/30): a crew seat
//     and the read-only seat are refused on the server; it reads a hand-written sample (tests/fixtures/roof-noaa-sample.csv)
//     through a stubbed fetch — no test reaches NOAA — and no request is made until the action is asked for or the DAILY
//     check runs: that is one hourly timer (started only at boot) that does anything only for a company with the hidden
//     storm_customer_map switch on, at 5 am on its own clock, and never twice for the same report;
//   · drawn canvass territories assigned to reps: made, changed and deleted by canvassing:manage, seen by the team and by
//     the read-only seat, a rep sees only their own; the territory's doors and leads come from the stops logged inside it;
//     /locate says whether a rep is inside their territory; nothing fences them in;
//   · both new switches are not ready (hidden), and a seat without the permission is refused by the server.
// Nothing here reaches NOAA, Google or a real tenant.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getAdvertisableFeaturesForTemplate, getFeaturesForTemplate } from '@twomiah/tenant-backend'
import { matchArea, parsePath, pointInPath, zipSet } from '../server/crm/roof/field/geo.ts'
import { createStormData } from '../server/crm/roof/field/stormData.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
let otherId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'storm_lead_gen', 'canvassing_tool', 'storm_customer_map', 'canvass_territories']
const FIXTURE = readFileSync(join(import.meta.dir, 'fixtures/roof-noaa-sample.csv'), 'utf8')

/** Every outside request the server makes in this file. NOAA's is answered from the fixture; anything else is a failure. */
const outside: string[] = []
let noaaStatus = 200
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  outside.push(url)
  if (url.includes('ncdc.noaa.gov/stormevents/csv')) return new Response(noaaStatus === 200 ? FIXTURE : 'busy', { status: noaaStatus })
  throw new Error(`test reached outside: ${url}`)
}) as any
const noaaCalls = () => outside.filter((u) => u.includes('ncdc.noaa.gov')).length

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

// Eau Claire. The storm is the box 44.80–44.84 N, 91.54–91.48 W.
const BOX = { kind: 'polygon', points: [[44.80, -91.54], [44.80, -91.48], [44.84, -91.48], [44.84, -91.54]] }
const INSIDE = { lat: 44.82, lng: -91.51 }
const OUTSIDE = { lat: 44.90, lng: -91.30 }

/** A customer, and a job at the stage given with its own pin (or none). */
async function customer(name: string, o: { zip?: string; pin?: { lat: number; lng: number } | null; jobPin?: { lat: number; lng: number } | null; job?: string | null; company?: string }) {
  const co = o.company ?? companyId
  const c = await ins(t.schema.contact, {
    companyId: co, name, type: 'client', address: `${name} Rd`, city: 'Eau Claire', state: 'WI', zip: o.zip ?? '54701',
    ...(o.pin ? { lat: o.pin.lat, lng: o.pin.lng } : {}),
  })
  if (o.job) {
    await ins(t.schema.job, {
      companyId: co, contactId: c.id, number: `ROOF-${name}`, title: `${name} Rd`, address: `${name} Rd`, zip: o.zip ?? '54701', status: o.job,
      ...(o.jobPin ? { lat: o.jobPin.lat, lng: o.jobPin.lng } : {}), completedAt: new Date('2021-06-01T00:00:00Z'),
    })
  }
  ids[name] = c.id
  return c
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, zip: '54701' } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['admin', 'admin'], ['mgr', 'manager'], ['rep', 'field'], ['rep2', 'field'], ['view', 'viewer']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing', zip: '54701' } as any).returning()
  otherId = other.id

  // Past customers (work done) and others.
  await customer('Alder', { job: 'collected', jobPin: INSIDE })                       // job pin inside
  await customer('Birch', { job: 'collected', jobPin: OUTSIDE })                      // in the storm's zip, pin outside
  await customer('Cedar', { job: 'invoiced' })                                        // no pin at all, zip 54701
  await customer('Dogwood', { job: 'collected', zip: '54703' })                       // no pin, a zip the storm does not name
  await customer('Elm', { job: 'proposal_sent', jobPin: INSIDE })                     // not a past customer, pin inside
  await customer('Fir', { pin: INSIDE })                                              // a contact with no job, pin inside
  await customer('Gum', { job: 'final_inspection', pin: OUTSIDE, jobPin: INSIDE })    // the roof (job) is inside; the billing pin is not
  await customer('Hazel', { job: 'collected', jobPin: INSIDE, company: otherId })     // another company's customer, inside
}, 120_000)

afterAll(() => { globalThis.fetch = realFetch })

describe('the shapes', () => {
  test('a polygon is tested by ray casting (a concave one too), a circle by distance, and bad shapes say what is wrong', () => {
    const box = (parsePath(BOX) as any).path
    expect(pointInPath(INSIDE.lat, INSIDE.lng, box)).toBe(true)
    expect(pointInPath(OUTSIDE.lat, OUTSIDE.lng, box)).toBe(false)
    // An L: the notch (44.83, -91.49) is outside, the foot (44.81, -91.49) inside.
    const ell = (parsePath({ kind: 'polygon', points: [[44.80, -91.54], [44.80, -91.48], [44.82, -91.48], [44.82, -91.50], [44.84, -91.50], [44.84, -91.54]] }) as any).path
    expect(pointInPath(44.83, -91.49, ell)).toBe(false)
    expect(pointInPath(44.81, -91.49, ell)).toBe(true)
    expect(pointInPath(44.83, -91.52, ell)).toBe(true)
    const circle = (parsePath({ kind: 'circle', lat: 44.82, lng: -91.51, radiusMiles: 2 }) as any).path
    expect(pointInPath(44.83, -91.51, circle)).toBe(true)   // about 0.7 mile
    expect(pointInPath(44.90, -91.51, circle)).toBe(false)  // about 5.5 miles
    for (const bad of [null, {}, { kind: 'polygon', points: [[1, 1], [2, 2]] }, { kind: 'polygon', points: [[1, 1], [2, 2], [3, 3]] },
      { kind: 'polygon', points: [[100, 1], [2, 2], [3, 5]] }, { kind: 'circle', lat: 44, lng: -91, radiusMiles: 0 }, { kind: 'circle', lat: 44, lng: -91, radiusMiles: 900 }, { kind: 'star' }]) {
      expect('error' in (parsePath(bad) as any)).toBe(true)
    }
  })

  test('a point with a pin is placed by the shape alone; one without a pin only by zip; no shape, zips decide', () => {
    const box = (parsePath(BOX) as any).path
    const zips = zipSet(['54701-1234'])
    expect(matchArea({ ...INSIDE, zip: '99999' }, { path: box, zips })).toBe('path')
    expect(matchArea({ ...OUTSIDE, zip: '54701' }, { path: box, zips })).toBeNull()                       // right zip, outside the swath
    expect(matchArea({ ...OUTSIDE, zip: '54701' }, { path: box, zips }, { zipAlso: true })).toBe('zip')    // a territory is shape OR zips
    expect(matchArea({ lat: null, lng: null, zip: '54701' }, { path: box, zips })).toBe('zip')
    expect(matchArea({ lat: null, lng: null, zip: '54703' }, { path: box, zips })).toBeNull()
    expect(matchArea({ ...OUTSIDE, zip: '54701' }, { path: null, zips })).toBe('zip')
  })
})

describe('past customers in a storm\'s path', () => {
  test('both new switches are not ready: offered to the roofing template, never advertised', () => {
    for (const id of ['storm_customer_map', 'canvass_territories']) {
      expect(getFeaturesForTemplate('crm-roof').find((f) => f.id === id)?.hidden).toBe(true)
      expect(getAdvertisableFeaturesForTemplate('crm-roof').map((f) => f.id)).not.toContain(id)
    }
  })

  test('without a drawn path a storm matches by zip, as before — and says so', async () => {
    const ev = await call('mgr', 'POST', '/api/storms/events', { affectedZipCodes: ['54701'], eventType: 'hail', hailSizeInches: 1.5, eventDate: '2026-10-10T18:00:00Z' })
    ids.storm = ev.body.id
    const r = await call('mgr', 'GET', `/api/storm-map/events/${ids.storm}/customers`)
    expect(r.status).toBe(200)
    expect(r.body.summary).toMatchObject({ matching: 'zip', scope: 'past' })
    expect(r.body.summary.note).toContain('matched by zip')
    // Past customers in 54701: Alder, Birch, Cedar, Gum. Dogwood is 54703; Elm and Fir are not past customers; Hazel is another company's.
    expect(r.body.data.map((c: any) => c.name).sort()).toEqual(['Alder', 'Birch', 'Cedar', 'Gum'])
  })

  test('a drawn path finds who is inside by their pin — the job\'s first — and leaves out the right zip outside the swath', async () => {
    expect((await call('mgr', 'PUT', `/api/storm-map/events/${ids.storm}/path`, { path: BOX })).body.path).toEqual(BOX)
    const r = await call('mgr', 'GET', `/api/storm-map/events/${ids.storm}/customers`)
    const by = Object.fromEntries(r.body.data.map((c: any) => [c.name, c.by]))
    // Alder (job pin inside), Gum (job pin inside though the billing pin is outside) are in the path; Cedar has no pin, matched by zip only.
    expect(by).toEqual({ Alder: 'path', Gum: 'path', Cedar: 'zip' })
    expect(r.body.data[0].by).toBe('path')
    expect(r.body.summary).toMatchObject({ matching: 'path', matched: 3, inPath: 2, byZipOnly: 1, customersLooked: 5, onTheMap: 3, notOnTheMap: 2 })
    expect(r.body.summary.note).toContain('2 customers have no pin')
    expect(r.body.data.find((c: any) => c.name === 'Alder')).toMatchObject({ located: true, pastCustomer: true, job: { status: 'collected' } })
    expect(r.body.data.find((c: any) => c.name === 'Cedar')).toMatchObject({ located: false, lat: null })
    // Everyone, not only past customers: Elm and Fir are inside too.
    const all = await call('mgr', 'GET', `/api/storm-map/events/${ids.storm}/customers?scope=all`)
    expect(all.body.data.map((c: any) => c.name).sort()).toEqual(['Alder', 'Cedar', 'Elm', 'Fir', 'Gum'])
  })

  test('a circle works too, and the path can be cleared', async () => {
    const circle = { kind: 'circle', lat: 44.90, lng: -91.30, radiusMiles: 1 }
    await call('mgr', 'PUT', `/api/storm-map/events/${ids.storm}/path`, { path: circle })
    expect((await call('mgr', 'GET', `/api/storm-map/events/${ids.storm}/customers`)).body.data.map((c: any) => c.name).sort()).toEqual(['Birch', 'Cedar'])
    expect((await call('mgr', 'PUT', `/api/storm-map/events/${ids.storm}/path`, { path: null })).body.path).toBeNull()
    expect((await call('mgr', 'GET', `/api/storm-map/events/${ids.storm}/customers`)).body.summary.matching).toBe('zip')
    await call('mgr', 'PUT', `/api/storm-map/events/${ids.storm}/path`, { path: BOX })
  })

  test('a bad path is a 400 that says why; another company\'s storm is not found', async () => {
    const bad = await call('mgr', 'PUT', `/api/storm-map/events/${ids.storm}/path`, { path: { kind: 'polygon', points: [[44, -91], [44.1, -91.1]] } })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('three corners')
    expect((await call('mgr', 'PUT', `/api/storm-map/events/${ids.storm}/path`, {})).status).toBe(400)
    const theirs = await ins(t.schema.stormEvent, { companyId: otherId, eventDate: new Date(), eventType: 'hail', affectedZipCodes: ['54701'] })
    expect((await call('mgr', 'GET', `/api/storm-map/events/${theirs.id}/customers`)).status).toBe(404)
    expect((await call('mgr', 'PUT', `/api/storm-map/events/${theirs.id}/path`, { path: BOX })).status).toBe(404)
  })

  test('the storm board makes leads from the same path: who was hit, not everyone in the zip', async () => {
    const withPath = await call('mgr', 'POST', `/api/storms/events/${ids.storm}/generate-leads`)
    expect(withPath.status).toBe(200)
    const leads = await t.db.select().from(t.schema.stormLead).where(eq(t.schema.stormLead.stormEventId, ids.storm))
    const names = async (rows: any[]) => (await Promise.all(rows.map(async (l) => (await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, l.contactId)))[0].name))).sort()
    // Inside the box: Alder, Elm, Fir, Gum by pin; Cedar by zip (no pin). Birch (right zip, pin outside) and Dogwood are not hit.
    expect(await names(leads)).toEqual(['Alder', 'Cedar', 'Elm', 'Fir', 'Gum'])
    // The same storm with no path hits everyone in the zip, Birch included — the difference the path makes.
    const plain = await call('mgr', 'POST', '/api/storms/events', { affectedZipCodes: ['54701'], eventType: 'hail' })
    await call('mgr', 'POST', `/api/storms/events/${plain.body.id}/generate-leads`)
    const plainLeads = await t.db.select().from(t.schema.stormLead).where(eq(t.schema.stormLead.stormEventId, plain.body.id))
    expect(await names(plainLeads)).toContain('Birch')
  })

  test('a crew seat and the read-only seat cannot see the customers or draw the path; the office can', async () => {
    for (const who of ['rep', 'view']) {
      expect((await call(who, 'GET', `/api/storm-map/events/${ids.storm}/customers`)).status).toBe(403)
      expect((await call(who, 'PUT', `/api/storm-map/events/${ids.storm}/path`, { path: BOX })).status).toBe(403)
    }
    for (const who of ['mgr', 'admin', 'owner']) expect((await call(who, 'GET', `/api/storm-map/events/${ids.storm}/customers`)).status).toBe(200)
  })

  test('switched off, the routes are not there', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'storm_customer_map') } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    const r = await call('owner', 'GET', `/api/storm-map/events/${ids.storm}/customers`)
    expect([403, 404]).toContain(r.status)
    expect(r.body.data).toBeUndefined()
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  })
})

describe('check NOAA now: on demand for the owner, an admin and a manager; the daily check is behind the hidden switch', () => {
  test('nothing has asked NOAA yet: starting the server and every call above made no request', () => {
    expect(noaaCalls()).toBe(0)
    expect(outside).toEqual([])
  })

  test('a crew seat and the read-only seat are refused on the server — and the feed is not touched', async () => {
    for (const who of ['rep', 'view']) expect((await call(who, 'POST', '/api/storm-map/noaa-check', {})).status).toBe(403)
    expect(noaaCalls()).toBe(0)
  })

  test('a bad number of days is a 400 and a business with no service area is told to set one — neither touches the feed', async () => {
    expect((await call('admin', 'POST', '/api/storm-map/noaa-check', { days: 90 })).status).toBe(400)
    expect((await call('admin', 'POST', '/api/storm-map/noaa-check', { days: 'x' })).status).toBe(400)
    await call('mgr', 'PUT', '/api/storms/service-area', { zipCodes: [] })
    const none = await call('admin', 'POST', '/api/storm-map/noaa-check', {})
    expect(none).toMatchObject({ status: 400, body: { code: 'no_service_area' } })
    expect(noaaCalls()).toBe(0)
    await call('mgr', 'PUT', '/api/storms/service-area', { zipCodes: ['54701'] })
  })

  test('the admin asks once: one request, the sample\'s storms land on the board, no leads are made', async () => {
    const before = (await t.db.select().from(t.schema.stormEvent).where(eq(t.schema.stormEvent.companyId, companyId))).length
    const r = await call('admin', 'POST', '/api/storm-map/noaa-check', { days: 3 })
    expect(r.status).toBe(200)
    expect(noaaCalls()).toBe(1)
    expect(outside[0]).toContain('ncdc.noaa.gov/stormevents/csv')
    expect(r.body).toMatchObject({ fetched: 3, days: 3 })
    expect(r.body.message).toContain('Draw each storm')
    const rows = await t.db.select().from(t.schema.stormEvent).where(eq(t.schema.stormEvent.companyId, companyId))
    expect(rows.length).toBe(before + 3)
    const hail = rows.find((e: any) => e.source === 'noaa' && e.eventType === 'hail')
    expect(hail).toMatchObject({ hailSizeInches: '1.75', affectedZipCodes: ['54701'], status: 'detected', leadCount: 0 })
    expect(rows.filter((e: any) => e.source === 'noaa').map((e: any) => e.eventType).sort()).toEqual(['hail', 'tornado', 'wind'])
    // The owner may too.
    expect((await call('owner', 'POST', '/api/storm-map/noaa-check', {})).status).toBe(200)
    expect(noaaCalls()).toBe(2)
  })

  test('a manager may ask too: one request, and a report the board already has is not added a second time', async () => {
    const rowsNow = async () => (await t.db.select().from(t.schema.stormEvent).where(eq(t.schema.stormEvent.companyId, companyId))).length
    const before = await rowsNow(), asked = noaaCalls()
    const r = await call('mgr', 'POST', '/api/storm-map/noaa-check', {})
    expect(r.status).toBe(200)
    expect(noaaCalls()).toBe(asked + 1)
    // The admin's and the owner's checks above already put these three reports on the board.
    expect([r.body.fetched, await rowsNow()]).toEqual([0, before])
  })

  test('when the feed does not answer, nothing is added and the owner is told', async () => {
    noaaStatus = 503
    const count = async () => (await t.db.select().from(t.schema.stormEvent).where(eq(t.schema.stormEvent.companyId, companyId))).length
    const before = await count()
    const r = await call('admin', 'POST', '/api/storm-map/noaa-check', {})
    noaaStatus = 200
    expect(r).toMatchObject({ status: 502, body: { code: 'feed_unreachable' } })
    expect(await count()).toBe(before)
  })

  test('time passing and other calls make no request: the count is only the asks above', async () => {
    const asked = noaaCalls()
    await new Promise((res) => setTimeout(res, 150))
    await call('owner', 'GET', '/api/storms/events')
    expect(noaaCalls()).toBe(asked)
    expect(outside.every((u) => u.includes('ncdc.noaa.gov'))).toBe(true) // and nothing else went out (Google included)
  })

  test('the only timer is the scheduled check: one hourly job, registered through the CRM\'s job list in the roofing field group, and the template\'s own sweep stays unstarted', () => {
    const SERVER = join(import.meta.dir, '../server')
    const files: string[] = []
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && files.push(p) } }
    walk(SERVER)
    const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    const naming = files.filter((p) => /runDailyStormCheck|runStormCheck|fetchStormEvents|runScheduledNoaaCheck|startNoaaSchedule/.test(code(p))).map((p) => p.slice(SERVER.length + 1)).sort()
    expect(naming).toEqual(['crm/roof/field/index.ts', 'crm/roof/field/stormData.ts', 'crm/roof/field/stormMap.ts'])
    const data = code(join(SERVER, 'crm/roof/field/stormData.ts'))
    expect(data.match(/setInterval/g)?.length).toBe(1)
    expect(data).toMatch(/setInterval\(\(\) => \{ void runScheduledNoaaCheck\(\) \}, 60 \* 60_000\)/)
    expect(data).not.toMatch(/setTimeout|cron/i)
    // The template's sweep (with auto-leads) is defined and never called by anything.
    expect(files.filter((p) => /runDailyStormCheck\(/.test(code(p)) && !p.endsWith('stormData.ts'))).toEqual([])
    // The route calls the one-company run, never the sweep or the timer; the job is registered once, in the field group.
    expect(code(join(SERVER, 'crm/roof/field/stormMap.ts'))).not.toMatch(/setInterval|setTimeout|addJob|cron|runDailyStormCheck|runScheduledNoaaCheck/i)
    expect(code(join(SERVER, 'crm/roof/field/index.ts'))).toMatch(/addJob\(\(\) => createStormData\(d\)\.startNoaaSchedule\(\)\)/)
    expect(files.filter((p) => p.includes('crm/roof/') && /addJob/.test(code(p))).map((p) => p.slice(SERVER.length + 1))).toEqual(['crm/roof/field/index.ts'])
    // The boot-time job list (startJobs) never mentions a storm itself.
    const services = code(join(SERVER, 'crm/services.ts'))
    expect(services.slice(services.indexOf('startJobs()'))).not.toMatch(/storm/i)
  })
})

describe('the daily NOAA check: only behind the hidden switch, at 5 am on the company\'s clock, never twice for a report', () => {
  // 5 am in Chicago on 2026-11-04 (CST, UTC-6) is 11:00 UTC; 2 pm is 20:00 UTC.
  const FIVE_AM = new Date('2026-11-04T11:00:00Z')
  const TWO_PM = new Date('2026-11-04T20:00:00Z')
  let storms: ReturnType<typeof createStormData>
  const board = async (co: string) => (await t.db.select().from(t.schema.stormEvent).where(and(eq(t.schema.stormEvent.companyId, co), eq(t.schema.stormEvent.source, 'noaa')))).length
  const leads = async (co: string) => (await t.db.select().from(t.schema.stormLead).where(eq(t.schema.stormLead.companyId, co))).length
  const setUp = async (companyFeatures: string[], zone = 'America/Chicago') => {
    await t.db.update(t.schema.company).set({ enabledFeatures: companyFeatures, timezone: zone } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  }
  const clearBoard = async () => { await t.db.delete(t.schema.stormEvent).where(and(eq(t.schema.stormEvent.companyId, companyId), eq(t.schema.stormEvent.source, 'noaa'))) }

  beforeAll(() => {
    // The same code the boot job runs, over the test database, with the same stubbed feed (globalThis.fetch above).
    storms = createStormData({ db: t.db, logger: { info() {}, warn() {}, error() {} }, features: t.services.features } as any)
  })
  afterAll(async () => { await setUp(FEATURES) })

  test('the switch is hidden (not ready), so no plan, owner or Factory save can give it to a business', () => {
    expect(getFeaturesForTemplate('crm-roof').find((f: any) => f.id === 'storm_customer_map')?.hidden).toBe(true)
    expect(getAdvertisableFeaturesForTemplate('crm-roof').map((f: any) => f.id)).not.toContain('storm_customer_map')
  })

  test('without the switch the 5 am pass asks NOAA for nothing and adds nothing', async () => {
    await setUp(FEATURES.filter((f) => f !== 'storm_customer_map'))
    await clearBoard()
    const asked = noaaCalls()
    expect(await storms.runScheduledNoaaCheck(FIVE_AM)).toEqual([])
    expect([noaaCalls(), await board(companyId)]).toEqual([asked, 0])
  })

  test('with the switch, outside 5 am on the company\'s own clock the pass does nothing — in Chicago and in Denver', async () => {
    await setUp(FEATURES, 'America/Chicago')
    const asked = noaaCalls()
    expect(await storms.runScheduledNoaaCheck(TWO_PM)).toEqual([])
    // 11:00 UTC is 4 am in Denver (MST, UTC-7): not yet.
    await setUp(FEATURES, 'America/Denver')
    expect(await storms.runScheduledNoaaCheck(FIVE_AM)).toEqual([])
    expect([noaaCalls(), await board(companyId)]).toEqual([asked, 0])
  })

  test('with the switch, at 5 am on the company\'s clock it checks that company once: the sample\'s storms land on the board, no leads are made', async () => {
    await setUp(FEATURES, 'America/Chicago')
    const asked = noaaCalls(), leadsBefore = await leads(companyId)
    const ran = await storms.runScheduledNoaaCheck(FIVE_AM)
    expect(ran).toEqual([{ companyId, fetched: 3, reached: true }])
    expect(noaaCalls()).toBe(asked + 1)
    expect(await board(companyId)).toBe(3)
    expect(await leads(companyId)).toBe(leadsBefore)
    // The other company (no switch) was not asked about; the pass made exactly one request for the one company.
    expect(await board(otherId)).toBe(0)
  })

  test('the next day\'s pass sees the same reports in its window and adds none of them again', async () => {
    const asked = noaaCalls()
    const ran = await storms.runScheduledNoaaCheck(new Date(FIVE_AM.getTime() + 86_400_000))
    expect(ran).toEqual([{ companyId, fetched: 0, reached: true }])
    expect([noaaCalls(), await board(companyId)]).toEqual([asked + 1, 3])
  })

  test('a feed that does not answer adds nothing and is not an error', async () => {
    await clearBoard()
    noaaStatus = 503
    const ran = await storms.runScheduledNoaaCheck(FIVE_AM)
    noaaStatus = 200
    expect(ran).toEqual([{ companyId, fetched: 0, reached: false }])
    expect(await board(companyId)).toBe(0)
  })
})

describe('canvass territories', () => {
  const MINE = { kind: 'polygon', points: [[44.80, -91.54], [44.80, -91.48], [44.84, -91.48], [44.84, -91.54]] }

  test('the office makes one with a drawn area and reps; a crew seat and the read-only seat cannot', async () => {
    for (const who of ['rep', 'view']) expect((await call(who, 'POST', '/api/territories', { name: 'Nope', boundary: MINE })).status).toBe(403)
    const made = await call('mgr', 'POST', '/api/territories', { name: 'Westside hail', color: '#dc2626', boundary: MINE, repIds: [ids.rep], stormEventId: ids.storm, notes: 'Hail 10/10' })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ name: 'Westside hail', color: '#dc2626', boundary: MINE, zips: [], stormEventId: ids.storm })
    expect(made.body.reps).toEqual([{ id: ids.rep, name: 'rep Seat' }])
    ids.west = made.body.id
    const zipOnly = await call('admin', 'POST', '/api/territories', { name: 'Downtown zips', zips: ['54701', '54703-1111', '54701'] })
    expect(zipOnly.status).toBe(201)
    expect(zipOnly.body).toMatchObject({ boundary: null, zips: ['54701', '54703'], reps: [], color: '#2563eb' })
    ids.zipTerr = zipOnly.body.id
  })

  test('what is wrong with a territory is said, field by field', async () => {
    const bad = async (b: any) => call('mgr', 'POST', '/api/territories', b)
    expect((await bad({ boundary: MINE })).body.fields).toHaveProperty('name')
    expect((await bad({ name: 'x' })).body.fields).toHaveProperty('boundary')
    expect((await bad({ name: 'x', zips: ['5470'] })).body.error).toContain('five-digit')
    expect((await bad({ name: 'x', boundary: { kind: 'polygon', points: [[1, 1]] } })).status).toBe(400)
    expect((await bad({ name: 'x', boundary: MINE, color: 'red' })).body.fields).toHaveProperty('color')
    expect((await bad({ name: 'x', boundary: MINE, repIds: ['someone-else'] })).body.error).toContain('not on your team')
    expect((await bad({ name: 'x', boundary: MINE, stormEventId: 'nope' })).body.error).toContain('storm board')
    const stranger = await ins(t.schema.user, { email: 'x@other.example', passwordHash: 'x', firstName: 'X', lastName: 'Y', role: 'field', companyId: otherId })
    expect((await bad({ name: 'x', boundary: MINE, repIds: [stranger.id] })).status).toBe(400)
  })

  test('a rep sees only the territories they are on; the team and the read-only seat see all', async () => {
    const names = async (who: string) => (await call(who, 'GET', '/api/territories')).body.data.map((x: any) => x.name).sort()
    expect(await names('rep')).toEqual(['Westside hail'])
    expect(await names('rep2')).toEqual([])
    for (const who of ['mgr', 'admin', 'owner', 'view']) expect(await names(who)).toEqual(['Downtown zips', 'Westside hail'])
    // Who can be assigned: the office sees the team; a crew seat does not.
    const team = await call('mgr', 'GET', '/api/territories/reps')
    expect(team.body.data.map((x: any) => x.id)).toContain(ids.rep)
    expect(team.body.data.find((x: any) => x.id === ids.rep)).toEqual({ id: ids.rep, name: 'rep Seat', role: 'field' })
    expect((await call('rep', 'GET', '/api/territories/reps')).status).toBe(403)
    expect((await call('rep', 'GET', `/api/territories/${ids.west}`)).status).toBe(200)
    expect((await call('rep', 'GET', `/api/territories/${ids.zipTerr}`)).status).toBe(404)
    expect((await call('rep2', 'GET', `/api/territories/${ids.west}`)).status).toBe(404)
  })

  test('its doors and leads are the stops logged inside it, a rep is told when they are outside, and nothing stops a door outside', async () => {
    const session = await call('rep', 'POST', '/api/canvassing/sessions', { name: 'Westside', centerLat: 44.82, centerLng: -91.51 })
    expect(session.status).toBe(201)
    const stop = (b: any) => call('rep', 'POST', `/api/canvassing/sessions/${session.body.id}/stops`, b)
    expect((await stop({ outcome: 'no_answer', address: '1 In St', ...INSIDE })).status).toBe(201)
    expect((await stop({ outcome: 'interested', address: '2 In St', phone: '7155550111', homeownerName: 'Pat In', lat: 44.83, lng: -91.52 })).status).toBe(201)
    expect((await stop({ outcome: 'not_interested', address: '3 Out St', ...OUTSIDE })).status).toBe(201) // outside: still logged
    const r = await call('rep', 'GET', `/api/territories/${ids.west}`)
    expect(r.body.stats).toMatchObject({ doorsKnocked: 2, leads: 1, byOutcome: { no_answer: 1, interested: 1 }, pastCustomers: null })
    // The office also sees the past customers inside: Alder and Gum by their job pins (Birch's is outside, Cedar has none and this territory names no zip).
    const office = await call('mgr', 'GET', `/api/territories/${ids.west}`)
    expect(office.body.stats.pastCustomers).toBe(2)
    // The zips-only territory (54701 and 54703) holds every past customer by zip — Alder, Birch, Cedar, Dogwood and Gum — and none of the doors, which carry no zip.
    expect((await call('mgr', 'GET', `/api/territories/${ids.zipTerr}`)).body.stats).toMatchObject({ doorsKnocked: 0, pastCustomers: 5 })
    // /locate: inside and outside the rep's own territory.
    const here = await call('rep', 'GET', `/api/territories/locate?lat=${INSIDE.lat}&lng=${INSIDE.lng}`)
    expect(here.body).toEqual({ inside: [{ id: ids.west, name: 'Westside hail' }], inMine: true, hasTerritory: true })
    const away = await call('rep', 'GET', `/api/territories/locate?lat=${OUTSIDE.lat}&lng=${OUTSIDE.lng}`)
    expect(away.body).toEqual({ inside: [], inMine: false, hasTerritory: true })
    expect((await call('rep2', 'GET', `/api/territories/locate?lat=${INSIDE.lat}&lng=${INSIDE.lng}`)).body).toEqual({ inside: [], inMine: false, hasTerritory: false })
    expect((await call('rep', 'GET', '/api/territories/locate?lat=abc&lng=1')).status).toBe(400)
  })

  test('the office changes it and moves its reps; a crew seat cannot; deleting it leaves the doors and the people alone', async () => {
    for (const who of ['rep', 'view']) {
      expect((await call(who, 'PUT', `/api/territories/${ids.west}`, { name: 'Mine now' })).status).toBe(403)
      expect((await call(who, 'PUT', `/api/territories/${ids.west}/reps`, { repIds: [] })).status).toBe(403)
      expect((await call(who, 'DELETE', `/api/territories/${ids.west}`)).status).toBe(403)
    }
    const edited = await call('mgr', 'PUT', `/api/territories/${ids.west}`, { name: 'Westside hail (wave 2)', color: '#16a34a' })
    expect(edited.body).toMatchObject({ name: 'Westside hail (wave 2)', color: '#16a34a', boundary: MINE })
    expect(edited.body.reps.map((r: any) => r.id)).toEqual([ids.rep]) // an edit that names no reps leaves them
    expect((await call('mgr', 'PUT', `/api/territories/${ids.zipTerr}`, { zips: [] })).status).toBe(400) // would leave it with nothing
    const moved = await call('mgr', 'PUT', `/api/territories/${ids.west}/reps`, { repIds: [ids.rep2] })
    expect(moved.body.reps.map((r: any) => r.id)).toEqual([ids.rep2])
    expect((await call('rep', 'GET', `/api/territories/${ids.west}`)).status).toBe(404)
    expect((await call('rep2', 'GET', `/api/territories/${ids.west}`)).status).toBe(200)
    const stopsBefore = (await t.db.select().from(t.schema.canvassingStop).where(eq(t.schema.canvassingStop.companyId, companyId))).length
    expect((await call('mgr', 'DELETE', `/api/territories/${ids.west}`)).body).toEqual({ success: true })
    expect((await call('mgr', 'GET', `/api/territories/${ids.west}`)).status).toBe(404)
    expect((await t.db.select().from(t.schema.canvassingStop).where(eq(t.schema.canvassingStop.companyId, companyId))).length).toBe(stopsBefore)
    expect((await t.db.select().from(t.schema.user).where(and(eq(t.schema.user.id, ids.rep2), eq(t.schema.user.companyId, companyId)))).length).toBe(1)
    expect((await t.db.select().from(t.schema.canvassTerritoryRep).where(eq(t.schema.canvassTerritoryRep.territoryId, ids.west))).length).toBe(0)
  })

  test('another company\'s territory is out of reach; switched off, the routes are not there', async () => {
    const theirs = await ins(t.schema.canvassTerritory, { companyId: otherId, name: 'Theirs', boundary: MINE })
    expect((await call('owner', 'GET', `/api/territories/${theirs.id}`)).status).toBe(404)
    expect((await call('owner', 'PUT', `/api/territories/${theirs.id}`, { name: 'Mine' })).status).toBe(404)
    expect((await call('owner', 'DELETE', `/api/territories/${theirs.id}`)).status).toBe(404)
    expect((await call('owner', 'GET', '/api/territories')).body.data.map((x: any) => x.name)).toEqual(['Downtown zips'])
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'canvass_territories') } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    const off = await call('owner', 'GET', '/api/territories')
    expect([403, 404]).toContain(off.status)
    expect(off.body.data).toBeUndefined()
  })
})
