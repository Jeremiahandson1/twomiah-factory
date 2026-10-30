// A paid add-on (the Exterior Visualizer, $59) is bought, not switched on. Higgs review 10/30: Settings › Features showed
// it with a switch under "Every feature is included in your plan", and the save took it — an owner could turn on a paid
// product for nothing. Both sides now hold one rule (featureRegistry isPaidAddOn): the catalogue marks it, the save refuses
// it, and one already on (bought) survives the owner's save.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const stored = async () => ((await t.db.select({ f: t.schema.company.enabledFeatures }).from(t.schema.company).where(eq(t.schema.company.id, companyId)))[0].f as string[]).slice().sort()
const store = async (f: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: f } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
}, 120_000)

test('the catalogue lists the Visualizer as a paid add-on, and nothing else as one', async () => {
  const cat = await (await as('/api/company/features/catalog')).json() as any
  const vis = cat.features.find((f: any) => f.id === 'visualizer')
  expect(vis?.addOn).toBe(true)
  expect(cat.features.filter((f: any) => f.addOn).map((f: any) => f.id)).toEqual(['visualizer'])
})

test("the owner's save refuses switching it on, and changes nothing", async () => {
  await store(['contacts', 'dashboard', 'jobs'])
  const before = await stored()
  const res = await as('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'dashboard', 'jobs', 'visualizer'] } })
  const body = await res.json() as any
  expect([res.status, body.code]).toEqual([400, 'paid_add_on'])
  expect(body.error).toContain('Exterior Visualizer is a paid add-on')
  expect(await stored()).toEqual(before)
})

test('one already on (bought) stays on through a save', async () => {
  await store(['contacts', 'dashboard', 'jobs', 'visualizer'])
  const res = await as('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'dashboard', 'jobs', 'visualizer'] } })
  expect(res.status).toBe(200)
  expect(await stored()).toContain('visualizer')
})
