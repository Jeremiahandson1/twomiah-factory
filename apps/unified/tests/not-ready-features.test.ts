// A not-ready feature is switched on by no path, and its screens' API refuses while it is off (owner, 2026-10-19: "none
// of those roof features should be on" — roof reports and measurements, the instant estimator, storm radar — "ads
// shouldnt be on util it is tested"). Through the real server as a roofer:
//   · those four are the registry's not-ready features (hidden), and the owner's Features page lists none of them;
//   · the owner's save, the Factory's first setup and the Factory's feature sync each leave them off;
//   · each one's API answers a refusal, never its data: Ads, storm radar, measurements, roof reports (403), the public
//     estimator (404, as a public module with its feature off).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const KEY = 'factory-key-for-not-ready-test'
const NOT_READY = FEATURE_REGISTRY.filter((f) => f.hidden).map((f) => f.id)
const OWNER_NAMED = ['measurement_reports', 'instant_estimator', 'storm_radar_overlay', 'paid_ads']

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const featuresNow = async () => ((await t.db.select({ f: t.schema.company.enabledFeatures }).from(t.schema.company).where(eq(t.schema.company.id, companyId)))[0].f as string[])

beforeAll(async () => {
  process.env.FACTORY_SYNC_KEY = KEY
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts'] } as any).where(eq(t.schema.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
}, 120_000)

describe('not-ready features', () => {
  test('the four the owner named are not ready, and the Features page offers none that is not ready', async () => {
    expect(NOT_READY).toEqual(expect.arrayContaining(OWNER_NAMED))
    const catalog = await (await as('/api/company/features/catalog')).json() as { features: Array<{ id: string }> }
    expect(catalog.features.length).toBeGreaterThan(0)
    expect(catalog.features.map((f) => f.id).filter((id) => NOT_READY.includes(id))).toEqual([])
  })

  test("the owner's save refuses each one, by name", async () => {
    for (const id of NOT_READY) {
      const r = await as('/api/company/features', { method: 'PUT', json: { features: ['jobs', 'contacts', id] } })
      expect(r.status).toBe(400)
      expect((await r.json() as any).code).toBe('feature_not_ready')
    }
    expect((await featuresNow()).filter((f) => NOT_READY.includes(f))).toEqual([])
  })

  test("the Factory's feature sync drops them and keeps the rest", async () => {
    const r = await t.call('/api/internal/sync-features', { method: 'POST', json: { features: ['jobs', 'contacts', 'storm_lead_gen', ...NOT_READY] }, headers: { 'X-Factory-Key': KEY } })
    expect(r.status).toBeLessThan(300)
    const now = await featuresNow()
    expect(now).toEqual(expect.arrayContaining(['jobs', 'contacts', 'storm_lead_gen']))
    expect(now.filter((f) => NOT_READY.includes(f))).toEqual([])
  })

  test("each one's API refuses while it is off", async () => {
    for (const p of ['/api/ads/overview', '/api/storm-radar/events', '/api/measurements', '/api/measurements/credits/info', '/api/roof-reports']) {
      const r = await as(p)
      expect([p, r.status]).toEqual([p, 403])
    }
    const buy = await as('/api/measurements/credits/purchase', { method: 'POST', json: { quantity: 1000 } })
    expect(buy.status).toBe(403)
    expect((await t.call(`/api/estimator/config/${encodeURIComponent('test-builders')}`)).status).toBe(404)
  })
})

describe("a new tenant's first setup", () => {
  test('a not-ready feature sent by the Factory is left off, and the estimator with it', async () => {
    const fresh = await bootTenant({ vertical: 'roofing' })
    const res = await fresh.call('/api/internal/provision', {
      method: 'POST', headers: { 'X-Factory-Key': KEY },
      json: {
        company: { name: 'Ridge Roofing', slug: 'ridge-roofing', phone: '555-0100', city: 'Akron', state: 'OH', timezone: 'America/New_York' },
        owner: { email: 'owner@ridge.example', passwordHash: await Bun.password.hash('Owner-pass-1-long', 'bcrypt'), firstName: 'Rae', lastName: 'Ridge' },
        features: ['contacts', 'jobs', ...NOT_READY],
        industry: 'Roofing',
        site: { pages: [{ slug: 'home', title: 'Home', sections: [] }] },
      },
    })
    expect(res.status).toBe(201)
    const [co] = await fresh.db.select().from(fresh.schema.company)
    expect((co.enabledFeatures as string[]).filter((f) => NOT_READY.includes(f))).toEqual([])
    expect(co.enabledFeatures).toEqual(expect.arrayContaining(['contacts', 'jobs']))
    expect((co as any).estimatorEnabled).toBe(false)
  })
})
