// Six modules the CRM templates mounted for everyone, which no screen in any copy calls: each is gated on its feature
// (RULEBOOK §6), so a business without it — a website-only one here — cannot reach them, and one with it can.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token: string
let companyId: string
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list }).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

const SIGNED_IN = [
  ['GET', '/api/routing/optimize-day', 'route_optimization'],
  ['GET', '/api/maps/jobs', 'map_view'],
  ['GET', '/api/weather/forecast?lat=44.8&lon=-91.5', 'jobs'],
  ['POST', '/api/financing/apply', 'consumer_financing'],
] as const

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
})

describe('modules no screen calls are their feature\'s', () => {
  test('a business without the feature is refused each one', async () => {
    await features(['contacts'])
    for (const [method, path] of SIGNED_IN) {
      const res = await as(path, { method, json: method === 'POST' ? {} : undefined })
      expect({ path, status: res.status }).toEqual({ path, status: 403 })
    }
    // The public two answer as if they were not there.
    expect((await t.call('/api/pricebook-present/no-such-link')).status).toBe(404)
    expect((await t.call('/api/wisetack/webhook', { method: 'POST', json: {} })).status).toBe(404)
  })

  test('with the feature on, each gate opens', async () => {
    for (const [method, path, feature] of SIGNED_IN) {
      await features(['contacts', feature])
      const res = await as(path, { method, json: method === 'POST' ? {} : undefined })
      expect({ path, gated: res.status === 403 && (await res.clone().json().catch(() => ({}))).code === 'FEATURE_NOT_ENABLED' }).toEqual({ path, gated: false })
    }
  })
})
