// Landscaping parity row 3 — finding lawn, beds and hardscape from the air, everything up to the provider (data/aerialDetect.ts,
// POST /api/area-pricing/sites/:id/detect; aerial_detect, not ready). Fails without the change: the route and the interface did not exist.
//   · no provider connected: a plain-words 501 (NO_PROVIDER) — the step left is the provider account;
//   · a provider's outlines come back typed and checked as drawn shapes are, labelled "found automatically, check it", odd ones
//     dropped and counted — and NOTHING is saved until the ordinary save;
//   · a provider failure is a 502 in plain words; off, the route is shut; the switch is hidden.
import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { useAerialProviderForTests } from '../server/data/aerialDetect.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let siteId: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'area_pricing', ...list] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const VIEW = { center: { lat: 44.81, lng: -91.5 }, bounds: { north: 44.811, south: 44.809, east: -91.499, west: -91.501 } }
const square = (lat: number, lng: number, d = 0.0002): Array<[number, number]> => [[lat, lng], [lat + d, lng], [lat + d, lng + d], [lat, lng + d]]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['aerial_detect'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const ct = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Elm Owner', type: 'client' } as any).returning()) as any[])[0]
  const site = ((await t.db.insert(t.schema.site).values({ companyId, contactId: ct.id, name: 'Elm', address: '1 Elm St', city: 'Eau Claire', state: 'WI' } as any).returning()) as any[])[0]
  siteId = site.id
})
afterEach(() => useAerialProviderForTests(null))

describe('row 3: aerial detection up to the provider', () => {
  test('no provider connected: said plainly, nothing saved', async () => {
    const res = await post(owner, `/api/area-pricing/sites/${siteId}/detect`, VIEW)
    expect(res.status).toBe(501)
    const body = await res.json()
    expect(body.code).toBe('NO_PROVIDER')
    expect(body.error).toMatch(/no(ne is)? connected|provider/i)
  })

  test('a provider’s outlines come back typed and checked, labelled to check, odd ones dropped — and none saved', async () => {
    let asked: any = null
    useAerialProviderForTests({
      name: 'Test Imagery',
      detect: async (input) => {
        asked = input
        return { shapes: [
          { areaType: 'lawnSqft', label: 'Front lawn', path: square(44.81, -91.5) },
          { areaType: 'bedSqft', path: square(44.8103, -91.5003, 0.00005) },
          { areaType: 'poolSqft', path: square(44.81, -91.5) }, // not a type we measure
          { areaType: 'lawnSqft', path: [[44.81, -91.5], [44.8101, -91.5]] }, // two corners
        ] }
      },
    })
    const res = await post(owner, `/api/area-pricing/sites/${siteId}/detect`, VIEW)
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.provider).toBe('Test Imagery')
    expect(out.shapes.map((s: any) => s.areaType)).toEqual(['lawnSqft', 'bedSqft'])
    expect(out.shapes[0].label).toBe('Front lawn — found automatically, check it')
    expect(out.shapes[1].label).toBe('found automatically, check it')
    expect(out.dropped).toBe(2)
    expect(asked.address).toBe('1 Elm St, Eau Claire, WI')
    expect(asked.center).toEqual(VIEW.center)
    // Nothing kept until the office saves.
    expect((await t.db.select().from(t.schema.siteShape).where(eq(t.schema.siteShape.siteId, siteId))).length).toBe(0)
  })

  test('a provider failure is said in plain words; a view off the map is refused; off, the route is shut', async () => {
    useAerialProviderForTests({ name: 'Test Imagery', detect: async () => { throw new Error('quota used up') } })
    const res = await post(owner, `/api/area-pricing/sites/${siteId}/detect`, VIEW)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Test Imagery could not find the areas: quota used up/)
    expect((await post(owner, `/api/area-pricing/sites/${siteId}/detect`, { center: { lat: 200, lng: 0 } })).status).toBe(400)
    await setFeatures([])
    try { expect((await post(owner, `/api/area-pricing/sites/${siteId}/detect`, VIEW)).status).toBe(404) } finally { await setFeatures(['aerial_detect']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'aerial_detect') as any
    expect(f?.hidden).toBeFalsy()
    expect(f?.templates).toEqual(['crm-landscaping'])
  })
})
