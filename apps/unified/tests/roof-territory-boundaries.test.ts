// Roofing parity row 24 — a territory from a ZIP, city, county or state boundary (Spotio "Select Territory"; the US Census's free
// TIGERweb shapes; data/censusBoundary.ts, GET /api/territories/boundary; territory_boundaries, not ready). Fails without the change.
//   · the queries are TIGERweb's own layers; the answers parsed are REAL ones recorded 11/06 (tests/fixtures/census-*.json):
//     Eau Claire County (a Polygon) and ZIP 54701 (a MultiPolygon of 2 parts, 264 corners at the finest offset);
//   · too many corners → asked again coarser until it fits 200; several parts → the largest, said;
//   · not found / the service down → plain words; off → shut; the switch is hidden.
import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { boundaryQuery, findBoundary, mainPart } from '../server/data/censusBoundary.ts'
import { useBoundaryFetcherForTests } from '../server/crm/roof/field/territories.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, 'fixtures', name), 'utf8'))
const COUNTY = fixture('census-county-eau-claire.json')
const ZIP = fixture('census-zcta-54701.json')
/** The ZIP answer made coarser, as TIGERweb does at a larger maxAllowableOffset. */
const coarser = (d: any, every: number) => ({ ...d, features: d.features.map((f: any) => ({ ...f, geometry: { ...f.geometry, coordinates: f.geometry.coordinates.map((poly: any) => poly.map((ring: any) => [...ring.filter((_: any, i: number) => i % every === 0), ring[0]])) } })) })

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string) => t.call(p, { headers: { Authorization: `Bearer ${owner}` } })
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'canvassing_tool', 'canvass_territories', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

describe('row 24: the Census queries and real answers', () => {
  test('each kind asks its TIGERweb layer', () => {
    expect(boundaryQuery('zip', '54701', '', 0.002)).toContain('/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?where=' + encodeURIComponent("ZCTA5='54701'"))
    expect(boundaryQuery('county', 'Eau Claire', 'wi', 0.002)).toContain('/tigerWMS_Current/MapServer/82/query?where=' + encodeURIComponent("UPPER(BASENAME)='EAU CLAIRE' AND STATE='55'"))
    // "Eau Claire County", as people type it (roofing live test 11/07); a city keeps its "City".
    expect(boundaryQuery('county', 'Eau Claire County', 'WI', 0.002)).toContain(encodeURIComponent("UPPER(BASENAME)='EAU CLAIRE' AND STATE='55'"))
    expect(boundaryQuery('city', 'Carson City', 'NV', 0.002)).toContain(encodeURIComponent("UPPER(BASENAME)='CARSON CITY'"))
    expect(boundaryQuery('city', "O'Fallon", 'MO', 0.002)).toContain(encodeURIComponent("UPPER(BASENAME)='O''FALLON' AND STATE='29'"))
    expect(boundaryQuery('state', '', 'WI', 0.002)).toContain('/MapServer/80/query?where=' + encodeURIComponent("STATE='55'"))
    expect(boundaryQuery('zip', '547', '', 0.002)).toBeNull()
    expect(boundaryQuery('county', 'X', 'ZZ', 0.002)).toBeNull()
  })

  test('the real county (a Polygon) and the real ZIP (2 parts: the largest kept)', () => {
    const c = mainPart(COUNTY.features[0].geometry)!
    expect(c.parts).toBe(1)
    expect(c.points.length).toBe(10) // 11 with the closing corner
    expect(c.points[0][0]).toBeGreaterThan(44) // [lat, lng] — Eau Claire is at 44.7°N, 91.3°W
    expect(c.points[0][1]).toBeLessThan(-90)
    const z = mainPart(ZIP.features[0].geometry)!
    expect(z.parts).toBe(2)
    expect(z.points.length).toBe(263)
  })

  test('too many corners: asked again coarser until it fits; the parts said', async () => {
    const asked: string[] = []
    const out = await findBoundary('zip', '54701', '', async (url) => { asked.push(url); return url.includes('maxAllowableOffset=0.0005') ? ZIP : coarser(ZIP, 2) })
    expect(out).toMatchObject({ status: 'ok', name: 'ZCTA5 54701', parts: 2 })
    if (out.status === 'ok') expect(out.points.length).toBeLessThanOrEqual(200)
    expect(asked.length).toBe(2)
    expect(await findBoundary('county', 'Nowhere', 'WI', async () => ({ features: [] }))).toMatchObject({ status: 'error', code: 'NOT_FOUND' })
    expect(await findBoundary('county', 'Eau Claire', 'WI', async () => { throw new Error('timeout') })).toMatchObject({ status: 'error', code: 'UNAVAILABLE' })
  })
})

describe('row 24: the route', () => {
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'roofing' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await setFeatures(['territory_boundaries'])
    owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  }, 120_000)
  afterEach(() => useBoundaryFetcherForTests(undefined))

  test('the county outline, ready to save as a territory', async () => {
    useBoundaryFetcherForTests(async () => COUNTY)
    const r = await json(await auth('/api/territories/boundary?kind=county&name=Eau%20Claire&state=WI'))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ name: 'Eau Claire County', parts: 1, note: null })
    expect(r.body.boundary.kind).toBe('polygon')
    // It saves as any drawn territory does.
    const saved = await t.call('/api/territories', { method: 'POST', headers: { Authorization: `Bearer ${owner}` }, json: { name: r.body.name, boundary: r.body.boundary } })
    expect(saved.status).toBe(201)
  })

  test('not found and the service down in plain words; off shut; hidden', async () => {
    useBoundaryFetcherForTests(async () => ({ features: [] }))
    expect((await auth('/api/territories/boundary?kind=city&name=Nowhere&state=WI')).status).toBe(404)
    useBoundaryFetcherForTests(async () => { throw new Error('down') })
    expect((await auth('/api/territories/boundary?kind=zip&name=54701')).status).toBe(502)
    expect((await auth('/api/territories/boundary?kind=zip&name=5')).status).toBe(400)
    await setFeatures([])
    try { expect((await auth('/api/territories/boundary?kind=zip&name=54701')).status).toBe(404) } finally { await setFeatures(['territory_boundaries']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'territory_boundaries') as any
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm-roof']])
  })
})
