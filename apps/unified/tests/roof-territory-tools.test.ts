// Roofing parity row 23 — territories finished (Spotio; data/territoryImport.ts, crm/roof/field/territories.ts; territory_tools, not
// ready). Fails without the change: no KML import, no "Belongs To", no redraw from the screen, the phone never asked.
//   · KML import by Spotio's rules: a new title creates, a matching title reshapes, simple polygons only (holes and multi-shapes
//     named and skipped), many in one file;
//   · Belongs To: set and cleared; a loop refused;
//   · the boundary is changed by the ordinary edit (the screen's Redraw); /locate answers what the phone says;
//   · off: shut; the switch is hidden.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { readKml, makesLoop } from '../server/data/territoryImport.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'canvassing_tool', 'storm_tracking', 'canvass_territories', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ring = (lng: number, lat: number, d = 0.01) => `${lng},${lat},0 ${lng + d},${lat},0 ${lng + d},${lat + d},0 ${lng},${lat + d},0 ${lng},${lat},0`
const placemark = (name: string, body: string) => `<Placemark><name>${name}</name>${body}</Placemark>`
const poly = (coords: string, hole = '') => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>${hole}</Polygon>`
const kml = (...marks: string[]) => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${marks.join('')}</Document></kml>`
const upload = (text: string) => { const fd = new FormData(); fd.set('file', new File([text], 'areas.kml', { type: 'application/vnd.google-earth.kml+xml' })); return auth('/api/territories/import', { method: 'POST', body: fd }) }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['territory_tools'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
}, 120_000)

describe('row 23: the rules', () => {
  test('KML: simple polygons in, holes and multi-shapes and points named and skipped', () => {
    const r = readKml(kml(
      placemark('North', poly(ring(-91.5, 44.8))),
      placemark('Holey', poly(ring(-91.4, 44.8), `<innerBoundaryIs><LinearRing><coordinates>${ring(-91.395, 44.805, 0.001)}</coordinates></LinearRing></innerBoundaryIs>`)),
      placemark('Two', `<MultiGeometry>${poly(ring(-91.3, 44.8))}${poly(ring(-91.2, 44.8))}</MultiGeometry>`),
      placemark('Pin', '<Point><coordinates>-91.5,44.8,0</coordinates></Point>'),
    ))
    if ('error' in r) throw new Error(r.error)
    expect(r.shapes.map((s) => s.name)).toEqual(['North'])
    expect(r.shapes[0].points.length).toBe(4) // the closing corner dropped
    expect(r.shapes[0].points[0]).toEqual([44.8, -91.5]) // [lat, lng]
    expect(r.skipped.map((s) => s.name)).toEqual(['Holey', 'Two', 'Pin'])
    expect('error' in readKml('<html></html>')).toBe(true)
  })
  test('Belongs To may not loop', () => {
    const parents = new Map<string, string | null>([['a', null], ['b', 'a'], ['c', 'b']])
    expect(makesLoop('a', 'c', parents)).toBe(true)
    expect(makesLoop('c', 'a', parents)).toBe(false)
    expect(makesLoop('a', 'a', parents)).toBe(true)
  })
})

describe('row 23: the routes', () => {
  test('import: a new title creates, a matching title reshapes', async () => {
    const first = await json(await upload(kml(placemark('North', poly(ring(-91.5, 44.8))), placemark('South', poly(ring(-91.5, 44.7))))))
    expect(first.body).toMatchObject({ created: 2, updated: 0 })
    const again = await json(await upload(kml(placemark('north', poly(ring(-91.6, 44.9, 0.02))), placemark('East', poly(ring(-91.4, 44.8))))))
    expect(again.body).toMatchObject({ created: 1, updated: 1 })
    const all = (await json(await auth('/api/territories'))).body.data
    expect(all.map((x: any) => x.name).sort()).toEqual(['East', 'North', 'South'])
    expect(all.find((x: any) => x.name === 'North').boundary.points[0]).toEqual([44.9, -91.6])
    expect((await upload('not kml')).status).toBe(400)
  })

  test('Belongs To: set, refused when it would loop, cleared; the boundary is redrawn by the ordinary edit', async () => {
    const all = (await json(await auth('/api/territories'))).body.data
    const north = all.find((x: any) => x.name === 'North'), south = all.find((x: any) => x.name === 'South')
    expect((await auth(`/api/territories/${south.id}/parent`, { method: 'PUT', json: { parentId: north.id } })).status).toBe(200)
    expect((await auth(`/api/territories/${north.id}/parent`, { method: 'PUT', json: { parentId: south.id } })).status).toBe(400)
    expect((await json(await auth('/api/territories'))).body.data.find((x: any) => x.id === south.id).parentId).toBe(north.id)
    expect((await auth(`/api/territories/${south.id}/parent`, { method: 'PUT', json: { parentId: null } })).status).toBe(200)
    const redrawn = await json(await auth(`/api/territories/${south.id}`, { method: 'PUT', json: { boundary: { kind: 'circle', lat: 44.7, lng: -91.5, radiusMiles: 2 } } }))
    expect(redrawn.body.boundary).toMatchObject({ kind: 'circle', radiusMiles: 2 })
  })

  test('the phone’s answer: outside one’s own territory', async () => {
    const all = (await json(await auth('/api/territories'))).body.data
    const north = all.find((x: any) => x.name === 'North')
    const me = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.companyId, companyId)))[0]
    await auth(`/api/territories/${north.id}/reps`, { method: 'PUT', json: { repIds: [me.id] } })
    const inEast = await json(await auth('/api/territories/locate?lat=44.805&lng=-91.395'))
    expect(inEast.body).toMatchObject({ inMine: false, hasTerritory: true })
    expect(inEast.body.inside.map((x: any) => x.name)).toEqual(['East'])
  })

  test('off: shut; the switch is hidden and roofing’s', async () => {
    await setFeatures([])
    try { expect((await upload(kml(placemark('X', poly(ring(-91.5, 44.8)))))).status).toBe(404) } finally { await setFeatures(['territory_tools']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'territory_tools') as any
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm-roof']])
  })
})
