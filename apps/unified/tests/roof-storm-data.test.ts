// Roofing parity row 25 — storm data (data/spcReports.ts, data/hailSwaths.ts, crm/roof/field/stormMap.ts + storms.ts + territories.ts;
// storm_data_tools and territory_tools, not ready). Fails without the change.
//   · NOAA's daily storm reports parsed on REAL files recorded 11/06 (tests/fixtures/spc-250520-{hail,wind,torn}.csv): sizes in
//     hundredths, UNK speeds, ratings, every report's place;
//   · hail swaths: no provider → said plainly (NO_PROVIDER); a provider's swaths become storm events with their shape, severity and
//     rainfall;
//   · storm leads scored (storm size, inside the shape or zip only, roof age, past customer), highest first;
//   · SalesRabbit: the most territories one rep may hold, and who worked a territory and when.
import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { parseSpc, milesBetween, spcDay, spcUrl } from '../server/data/spcReports.ts'
import { leadScore, useSwathProviderForTests } from '../server/data/hailSwaths.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

const real = (kind: string) => fs.readFileSync(path.resolve(import.meta.dir, 'fixtures', `spc-250520-${kind}.csv`), 'utf8')

describe('NOAA’s daily storm reports, on real files', () => {
  test('hail: sizes in hundredths of an inch, every report placed', () => {
    const hail = parseSpc('hail', real('hail'))
    expect(hail.length).toBe(135) // 136 lines less the header
    expect(hail[0]).toMatchObject({ kind: 'hail', time: '1824', hailInches: 2, location: 'Jacksonville', county: 'Morgan', state: 'IL', lat: 39.73, lng: -90.23, comments: '(ILX)' })
    expect(hail.every((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.hailInches! > 0)).toBe(true)
  })
  test('wind: mph or unknown; tornado: a rating or unknown', () => {
    const wind = parseSpc('wind', real('wind'))
    expect(wind.length).toBe(344)
    expect(wind[0]).toMatchObject({ kind: 'wind', windMph: null, location: '3 SSW Byhalia', state: 'MS' })
    expect(wind.some((r) => r.windMph && r.windMph > 50)).toBe(true)
    const torn = parseSpc('torn', real('torn'))
    expect(torn.length).toBe(46)
    expect(torn[0]).toMatchObject({ kind: 'tornado', rating: null, state: 'AL' })
  })
  test('the file names, and distance', () => {
    expect(spcDay(new Date(Date.UTC(2025, 4, 20)))).toBe('250520')
    expect(spcUrl('250520', 'hail')).toBe('https://www.spc.noaa.gov/climo/reports/250520_rpts_hail.csv')
    expect(Math.round(milesBetween({ lat: 44.81, lng: -91.5 }, { lat: 44.94, lng: -91.39 }))).toBe(10) // Eau Claire → Chippewa Falls
  })
  test('the lead score and its reasons', () => {
    const hot = leadScore({ hailInches: 2, windMph: null, matchedBy: 'path', roofAge: 18, pastCustomer: true })
    expect(hot).toEqual({ score: 100, reasons: ['2.00 in hail', 'inside the storm area', 'roof 18 years old', 'past customer'] })
    const cool = leadScore({ hailInches: 0.75, windMph: null, matchedBy: 'zip', roofAge: null, pastCustomer: false })
    expect(cool.score).toBe(20)
    expect(leadScore({ hailInches: null, windMph: 80, matchedBy: null, roofAge: 5, pastCustomer: false }).score).toBe(37)
  })
})

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'storm_lead_gen', 'storm_customer_map', 'canvassing_tool', 'canvass_territories', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ins = async (table: any, v: any) => ((await t.db.insert(table).values(v).returning()) as any[])[0]

describe('the routes', () => {
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'roofing' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await setFeatures(['storm_data_tools', 'territory_tools'])
    owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
    // A pinned job is where the business is (data/weatherForecast.ts businessPoint).
    const ct = await ins(t.schema.contact, { companyId, name: 'Base', type: 'client' })
    await ins(t.schema.job, { companyId, number: 'J-BASE', title: 'Base', contactId: ct.id, lat: '44.81', lng: '-91.50' })
  }, 120_000)
  afterEach(() => useSwathProviderForTests(null))

  test('hail swaths: no provider → said plainly; a provider’s swaths become storm events with shape, severity and rainfall', async () => {
    const none = await json(await auth('/api/storm-map/swaths', { method: 'POST', json: {} }))
    expect([none.status, none.body.code]).toEqual([501, 'NO_PROVIDER'])
    let asked: any = null
    useSwathProviderForTests({ name: 'Test Hail', swaths: async (area) => { asked = area; return { swaths: [{ date: '2026-06-01T20:00:00Z', severity: 'severe', hailInches: 1.75, windMph: 60, rainfallInches: 1.2, path: { kind: 'polygon', points: [[44.8, -91.52], [44.82, -91.52], [44.82, -91.48], [44.8, -91.48]] } }] } } })
    const r = await json(await auth('/api/storm-map/swaths', { method: 'POST', json: { days: 14 } }))
    expect(r.body).toMatchObject({ fetched: 1, provider: 'Test Hail' })
    expect(asked).toMatchObject({ lat: 44.81, lng: -91.5, radiusMiles: 30 })
    const [ev] = await t.db.select().from(t.schema.stormEvent).where(eq(t.schema.stormEvent.source, 'provider'))
    expect([ev.eventType, ev.hailSizeInches, ev.severity, ev.rainfallInches, (ev.path as any).kind]).toEqual(['hail', '1.75', 'severe', '1.20', 'polygon'])
  })

  test('storm leads scored, highest first', async () => {
    const ev = await ins(t.schema.stormEvent, { companyId, eventDate: new Date(), eventType: 'hail', hailSizeInches: '2.00', affectedZipCodes: ['54701'], path: { kind: 'circle', lat: 44.81, lng: -91.5, radiusMiles: 2 } })
    const old = await ins(t.schema.contact, { companyId, name: 'Old Roof', type: 'client' })
    const oldJob = await ins(t.schema.job, { companyId, number: 'J-OLD', title: 'Old', contactId: old.id, roofAge: 20 })
    await ins(t.schema.stormLead, { companyId, stormEventId: ev.id, address: '1 Far', zip: '54701', status: 'new' })
    await ins(t.schema.stormLead, { companyId, stormEventId: ev.id, address: '2 Near', zip: '54701', lat: '44.811', lng: '-91.501', contactId: old.id, jobId: oldJob.id, status: 'new' })
    const r = await json(await auth(`/api/storms/events/${ev.id}/leads?sort=score`))
    expect(r.body.data.map((l: any) => [l.address, l.score])).toEqual([['2 Near', 100], ['1 Far', 48]])
    expect(r.body.data[0].scoreReasons).toEqual(['2.00 in hail', 'inside the storm area', 'roof 20 years old', 'past customer'])
  })

  test('SalesRabbit: the most territories a rep may hold; who worked a territory and when', async () => {
    const rep = await ins(t.schema.user, { companyId, email: 'rep@test.example', firstName: 'Rae', lastName: 'Rep', role: 'field', passwordHash: 'x' })
    const a = await json(await auth('/api/territories', { method: 'POST', json: { name: 'A', zips: ['54701'] } }))
    const b = await json(await auth('/api/territories', { method: 'POST', json: { name: 'B', zips: ['54703'] } }))
    expect((await auth('/api/territories/settings/cap', { method: 'PUT', json: { maxTerritoriesPerRep: 1 } })).status).toBe(200)
    expect((await auth(`/api/territories/${a.body.id}/reps`, { method: 'PUT', json: { repIds: [rep.id] } })).status).toBe(200)
    const over = await json(await auth(`/api/territories/${b.body.id}/reps`, { method: 'PUT', json: { repIds: [rep.id] } }))
    expect([over.status, over.body.code]).toEqual([409, 'over_cap'])
    expect(over.body.error).toMatch(/Rae Rep already has 1 territories/)
    const sess = await ins(t.schema.canvassingSession, { companyId, userId: rep.id, name: 'Oct knock' })
    await ins(t.schema.canvassingStop, { companyId, sessionId: sess.id, userId: rep.id, zip: '54701', outcome: 'not_home', visitedAt: new Date('2026-10-01T15:00:00Z') })
    await ins(t.schema.canvassingStop, { companyId, sessionId: sess.id, userId: rep.id, zip: '54701', outcome: 'interested', visitedAt: new Date('2026-10-03T15:00:00Z') })
    const view = await json(await auth(`/api/territories/${a.body.id}`))
    expect(view.body.worked).toEqual([{ userId: rep.id, name: 'Rae Rep', doors: 2, first: '2026-10-01T15:00:00.000Z', last: '2026-10-03T15:00:00.000Z' }])
  })

  test('off: shut; the switch is hidden and roofing’s', async () => {
    await setFeatures(['territory_tools'])
    try { expect((await auth('/api/storm-map/swaths', { method: 'POST', json: {} })).status).toBe(404) } finally { await setFeatures(['storm_data_tools', 'territory_tools']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'storm_data_tools') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
