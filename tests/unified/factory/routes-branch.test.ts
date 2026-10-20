// The Factory's routes branch on tenants.engine (routes/factory/deploy.ts): Update Code, resync-shared-code and
// flip-to-crm take the unified path for a unified tenant and the template path, unchanged, for every other.
// Only the Factory database is a stand-in (middleware/auth's supabase); nothing here reaches GitHub or Render.
import { test, expect, mock, beforeAll } from 'bun:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fakeStore } from './fakeStore'

const UNIFIED = '11111111-1111-4111-8111-111111111111'
const TEMPLATE = '22222222-2222-4222-8222-222222222222'
const NO_INDUSTRY = '33333333-3333-4333-8333-333333333333'
const store = fakeStore({
  tenants: [
    { id: UNIFIED, slug: 'uni-co', name: 'Uni Co', engine: 'unified', products: ['crm', 'website'], industry: 'roofing' },
    // A row from a Factory DB without the engine column: no `engine` at all.
    { id: TEMPLATE, slug: 'tmpl-co', name: 'Tmpl Co', products: ['website'], industry: 'roofing' },
    { id: NO_INDUSTRY, slug: 'tmpl-two', name: 'Tmpl Two', products: ['website'] },
  ],
  factory_jobs: [],
})

// The Factory's own Hono (tests/ has none of its own).
const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
let app: any
beforeAll(async () => {
  Object.assign(process.env, { RENDER_API_KEY: 'k', RENDER_OWNER_ID: 'o', GITHUB_TOKEN: 't', GITHUB_ORG: 'acct', RENDER_GIT_COMMIT: 'abcdef1' })
  const authPath = '../../../apps/api/src/middleware/auth'
  const real = await import(authPath)
  mock.module(authPath, () => ({ ...real, supabase: store, requireRole: () => async (_c: any, next: any) => next() }))
  const { registerDeployRoutes } = await import('../../../apps/api/src/routes/factory/deploy')
  app = new Hono()
  registerDeployRoutes(app as any)
})

const post = (p: string) => app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })

test('Update Code on a unified tenant goes to updateUnifiedTenantCode (it has no unified build yet: refused, nothing done)', async () => {
  const body: any = await (await post(`/customers/${UNIFIED}/update-code`)).json()
  expect(body.success).toBe(false)
  expect(body.errors[0]).toContain('no unified build recorded')
  expect(store.writes).toHaveLength(0)
})

test('resync-shared-code: unified → the unified update; a template tenant → the template path as before', async () => {
  const u: any = await (await post(`/customers/${UNIFIED}/resync-shared-code`)).json()
  expect(u.errors[0]).toContain('no unified build recorded')
  const res = await post(`/customers/${TEMPLATE}/resync-shared-code`)
  expect(res.status).toBe(400)
  expect(((await res.json()) as any).error).toBe('No previous build found for this tenant.')
})

test('flip-to-crm refuses a unified tenant; a template tenant gets the template checks', async () => {
  const u = await post(`/customers/${UNIFIED}/flip-to-crm`)
  expect(u.status).toBe(409)
  expect(((await u.json()) as any).error).toContain('unified')
  // A template tenant passes the unified check and meets the template path's own (here: no industry — no flip starts).
  const t = await post(`/customers/${NO_INDUSTRY}/flip-to-crm`)
  expect(t.status).toBe(400)
  expect(((await t.json()) as any).error).toBe('Tenant has no industry set')
})
