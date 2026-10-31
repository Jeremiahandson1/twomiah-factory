// The Factory's routes branch on tenants.engine (routes/factory/deploy.ts): Update Code, resync-shared-code and
// flip-to-crm take the unified path for a unified tenant and the template path, unchanged, for every other.
// Only the Factory database is a stand-in (middleware/auth's supabase); nothing here reaches GitHub or Render.
import { test, expect, mock, beforeAll, afterAll } from 'bun:test'
import { installAuth, restoreAuth } from './stubs.ts'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fakeStore } from './fakeStore'

const UNIFIED = '11111111-1111-4111-8111-111111111111'
const TEMPLATE = '22222222-2222-4222-8222-222222222222'
const NO_INDUSTRY = '33333333-3333-4333-8333-333333333333'
const UNIFIED_BUILT = '44444444-4444-4444-8444-444444444444'
const UNIFIED_BUSY = '55555555-5555-4555-8555-555555555555'
const store = fakeStore({
  tenants: [
    { id: UNIFIED, slug: 'uni-co', name: 'Uni Co', engine: 'unified', products: ['crm', 'website'], industry: 'roofing' },
    // A row from a Factory DB without the engine column: no `engine` at all.
    { id: TEMPLATE, slug: 'tmpl-co', name: 'Tmpl Co', products: ['website'], industry: 'roofing' },
    { id: NO_INDUSTRY, slug: 'tmpl-two', name: 'Tmpl Two', products: ['website'] },
    { id: UNIFIED_BUILT, slug: 'uni-built', name: 'Uni Built', engine: 'unified', products: ['crm'], industry: 'roofing' },
    { id: UNIFIED_BUSY, slug: 'uni-busy', name: 'Uni Busy', engine: 'unified', products: ['crm'], industry: 'roofing' },
  ],
  // A job without a recorded service: the background update stops at its first check, so nothing reaches GitHub/Render.
  factory_jobs: [
    { id: 'job-built', tenant_id: UNIFIED_BUILT, status: 'complete', created_at: '2026-10-20T10:00:00Z' },
    { id: 'job-busy', tenant_id: UNIFIED_BUSY, status: 'deploying', created_at: '2026-10-20T10:00:00Z' },
  ],
})

// The Factory's own Hono (tests/ has none of its own).
const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
let app: any
beforeAll(async () => {
  Object.assign(process.env, { RENDER_API_KEY: 'k', RENDER_OWNER_ID: 'o', GITHUB_TOKEN: 't', GITHUB_ORG: 'acct', RENDER_GIT_COMMIT: 'abcdef1' })
  installAuth({ supabase: store, requireRole: () => async (_c: any, next: any) => next() })
  const { registerDeployRoutes } = await import('../../../apps/api/src/routes/factory/deploy')
  app = new Hono()
  registerDeployRoutes(app as any)
})
afterAll(restoreAuth)

const post = (p: string) => app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })

test('Update Code on a unified tenant with no build: refused at once, nothing done', async () => {
  const res = await post(`/customers/${UNIFIED}/update-code`)
  expect(res.status).toBe(400)
  expect(((await res.json()) as any).error).toContain('deploy it first')
  expect(store.writes).toHaveLength(0)
})

test('Update Code on a unified tenant answers at once and runs in the background; the job carries the outcome', async () => {
  // Render's edge cuts a request held ~100s; the update waits minutes for the new code (2026-10-20: "Update failed").
  const res = await post(`/customers/${UNIFIED_BUILT}/update-code`)
  const body: any = await res.json()
  expect(res.status).toBe(200)
  expect(body).toMatchObject({ success: true, started: true, status: 'deploying' })
  expect(store.writes.find((w) => w.table === 'factory_jobs' && w.values.status === 'deploying')?.where).toEqual([['id', 'job-built']])
  // the background run ends (here: no service recorded) and says so on the job
  for (let i = 0; i < 50 && store.tables.factory_jobs.find((j) => j.id === 'job-built')!.status === 'deploying'; i++) await new Promise((r) => setTimeout(r, 20))
  const job = store.tables.factory_jobs.find((j) => j.id === 'job-built')!
  expect(job.status).toBe('failed')
  expect(job.error_message).toContain('no unified build recorded')
})

test('a second Update Code while one runs is refused', async () => {
  const res = await post(`/customers/${UNIFIED_BUSY}/update-code`)
  expect(res.status).toBe(409)
  expect(store.tables.factory_jobs.find((j) => j.id === 'job-busy')!.status).toBe('deploying')
})

test('resync-shared-code: unified → the unified update; a template tenant → the template path as before', async () => {
  const u = await post(`/customers/${UNIFIED}/resync-shared-code`)
  expect(u.status).toBe(400)
  expect(((await u.json()) as any).error).toContain('deploy it first')
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
