// Test-tenant teardown (apps/api/src/services/testCleanup.ts hardDeleteTestTenant) for a unified tenant: its own service,
// repo and database server go through teardownUnifiedTenant — ONLY when the Factory recorded them as this tenant's —
// never the templates' guessed names; then Stripe, the Cloudflare zone, email auth, the twomiah.app record and the rows,
// as before. A failed delete keeps the rows (the proof of ownership) for the retry. A template tenant is torn down
// exactly as before, and its sweep never reaches a `-app` name.
// The Factory DB is a stand-in (mock.module of middleware/auth); GitHub/Render are stand-ins (fake hosts, or the global
// fetch for the template path); the functions are the real ones.
import { test, expect, mock, beforeEach } from 'bun:test'
import path from 'node:path'

process.env.RENDER_API_KEY = 'test-render'
process.env.GITHUB_ORG = 'acct'
process.env.GITHUB_TOKEN = 'test-gh'
delete process.env.TWOMIAH_APP_ZONE_ID
delete process.env.CLOUDFLARE_API_TOKEN
delete process.env.R2_ACCOUNT_ID

// ── the Factory DB ──
let rows: { tenants: any[]; factory_jobs: any[]; intake_feedback: any[] } = { tenants: [], factory_jobs: [], intake_feedback: [] }
const deleted: string[] = []
function table(name: keyof typeof rows) {
  const q: any = { filters: [] as Array<[string, unknown]>, op: 'select' }
  const match = (r: any) => q.filters.every(([k, v]: [string, unknown]) => r[k] === v)
  const api: any = {
    select: () => api,
    delete: () => { q.op = 'delete'; return api },
    eq: (k: string, v: unknown) => { q.filters.push([k, v]); return api },
    maybeSingle: async () => ({ data: rows[name].find(match) ?? null, error: null }),
    then: (resolve: any) => {
      if (q.op === 'delete') {
        const before = rows[name].length
        rows[name] = rows[name].filter((r) => !match(r))
        deleted.push(name)
        return resolve({ error: null, count: before - rows[name].length })
      }
      return resolve({ data: rows[name].filter(match), error: null })
    },
  }
  return api
}
const supabase = { from: (n: keyof typeof rows) => table(n) }
mock.module(path.resolve(import.meta.dir, '../../../apps/api/src/middleware/auth.ts'), () => ({ supabase, authenticate: async () => {}, requireRole: () => async () => {} }))

// ── GitHub and Render, for the template path (fetch) ──
let renderServices: any[] = []
let fetchCalls: string[] = []
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input?.url ?? input)
  const method = String(init.method || 'GET').toUpperCase()
  fetchCalls.push(method + ' ' + url)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url.startsWith('https://api.render.com/v1/services?')) return json(renderServices.map((s) => ({ cursor: '', service: s })))
  if (url.startsWith('https://api.render.com/v1/services/') && method === 'DELETE') return new Response(null, { status: 204 })
  if (url.startsWith('https://api.render.com/v1/postgres?')) return json([])
  if (url.startsWith('https://api.github.com/repos/') && method === 'DELETE') return new Response(null, { status: 204 })
  if (url.startsWith('https://api.github.com/repos/') && method === 'GET') return json({ message: 'Not Found' }, 404)
  throw new Error('unexpected fetch ' + method + ' ' + url)
}) as any

const { hardDeleteTestTenant, teardownUnifiedTestTenant } = await import('../../../apps/api/src/services/testCleanup')
const { emptyOwnership } = await import('../../../apps/api/src/services/resourceOwnership')

/** GitHub and Render for the unified path, through the Hosts shape the build uses. */
function fakeHosts(state: { service?: any; db?: any; repo?: boolean; failDelete?: 'service' | 'repo' | 'database' }) {
  const removed: string[] = []
  const hosts: any = {
    repoFullName: (n: string) => 'acct/' + n,
    findService: async (n: string) => (state.service?.name === n ? state.service : null),
    findDatabase: async (n: string) => (state.db?.name === n ? state.db : null),
    getRepo: async (full: string) => (state.repo && full === 'acct/acme-app' ? { full_name: full } : null),
    deleteService: async (id: string) => { if (state.failDelete === 'service') throw new Error('Render 500'); removed.push('service ' + id); return true },
    deleteRepo: async (full: string) => { if (state.failDelete === 'repo') throw new Error('GitHub 500'); removed.push('repo ' + full); return true },
    deleteDatabase: async (id: string) => { if (state.failDelete === 'database') throw new Error('Render 500'); removed.push('database ' + id); return true },
  }
  return { hosts, removed }
}
const appService = { id: 'srv-u', name: 'acme-app', repo: 'https://github.com/acct/acme-app', serviceDetails: { url: 'https://acme-app.onrender.com' } }
const appDb = { id: 'dpg-u1-a', name: 'acme-app-db' }
const owned = (o: Partial<{ serviceIds: string[]; hosts: string[]; repos: string[]; databaseIds: string[] }>) => {
  const x = emptyOwnership()
  for (const k of ['serviceIds', 'hosts', 'repos', 'databaseIds'] as const) for (const v of o[k] || []) x[k].add(v)
  return async () => x
}

beforeEach(() => {
  rows = { tenants: [], factory_jobs: [], intake_feedback: [] }
  deleted.length = 0
  renderServices = []
  fetchCalls = []
})

test('unified: what the records say is the tenant\'s is removed — the service, its repo and its database server', async () => {
  const { hosts, removed } = fakeHosts({ service: appService, db: appDb, repo: true })
  const steps = await teardownUnifiedTestTenant({ id: 't1', slug: 'acme' }, { hosts, loadOwned: owned({ serviceIds: ['srv-u'], repos: ['acct/acme-app'], databaseIds: ['dpg-u1-a'] }) })
  expect(removed).toEqual(['service srv-u', 'repo acct/acme-app', 'database dpg-u1-a'])
  expect(steps.every((s) => s.status === 'ok')).toBe(true)
})

test('unified: the service at the stored URL is the tenant\'s, and so is the repo it is built from', async () => {
  const { hosts, removed } = fakeHosts({ service: appService, db: appDb, repo: true })
  // Only tenants.render_backend_url and tenants.database_url recorded (no job ids).
  await teardownUnifiedTestTenant({ id: 't1', slug: 'acme' }, { hosts, loadOwned: owned({ hosts: ['acme-app.onrender.com'], databaseIds: ['dpg-u1-a'] }) })
  expect(removed).toEqual(['service srv-u', 'repo acct/acme-app', 'database dpg-u1-a'])
})

test('unified: nothing recorded — everything with the names is left and reported, nothing deleted', async () => {
  const { hosts, removed } = fakeHosts({ service: appService, db: appDb, repo: true })
  const steps = await teardownUnifiedTestTenant({ id: 't1', slug: 'acme' }, { hosts, loadOwned: owned({}) })
  expect(removed).toEqual([])
  expect(steps.map((s) => s.step)).toEqual(['unified_left', 'unified_left', 'unified_left'])
})

test('unified: records that cannot be read, or Render that cannot be asked, delete nothing', async () => {
  const { hosts, removed } = fakeHosts({ service: appService, db: appDb, repo: true })
  const a = await teardownUnifiedTestTenant({ id: 't1', slug: 'acme' }, { hosts, loadOwned: async () => { throw new Error('db down') } })
  expect(a[0].status).toBe('error')
  hosts.findService = async () => { throw new Error('Render 503') }
  const b = await teardownUnifiedTestTenant({ id: 't1', slug: 'acme' }, { hosts, loadOwned: owned({ serviceIds: ['srv-u'] }) })
  expect(b[0]).toMatchObject({ status: 'error' })
  expect(removed).toEqual([])
})

test('hardDeleteTestTenant, unified: owned-only teardown, then the rows; the template sweep never runs', async () => {
  rows.tenants = [{ id: 't1', slug: 'acme', engine: 'unified', is_test_tenant: true, industry: 'roofing' }]
  rows.factory_jobs = [{ tenant_id: 't1' }]
  // A template-looking service with the slug exists (someone else's): the name sweep would have deleted it.
  renderServices = [{ id: 'srv-x', name: 'acme-roof-api' }]
  const { hosts, removed } = fakeHosts({ service: appService, db: appDb, repo: true })
  const r = await hardDeleteTestTenant('t1', { hosts, loadOwned: owned({ serviceIds: ['srv-u'], repos: ['acct/acme-app'], databaseIds: ['dpg-u1-a'] }) })
  expect(r.success).toBe(true)
  expect(removed).toEqual(['service srv-u', 'repo acct/acme-app', 'database dpg-u1-a'])
  expect(fetchCalls.filter((c) => c.startsWith('DELETE'))).toEqual([])
  expect(r.steps.map((s) => s.step)).toContain('twomiah_subdomain')
  expect(r.steps.map((s) => s.step)).not.toContain('render_services')
  expect(r.steps.map((s) => s.step)).not.toContain('github_repo')
  expect(rows.tenants).toEqual([])
  expect(rows.factory_jobs).toEqual([])
})

test('hardDeleteTestTenant, unified: a failed delete keeps the rows, so the retry can still prove ownership', async () => {
  rows.tenants = [{ id: 't1', slug: 'acme', engine: 'unified', is_test_tenant: true }]
  rows.factory_jobs = [{ tenant_id: 't1' }]
  const { hosts } = fakeHosts({ service: appService, db: appDb, repo: true, failDelete: 'database' })
  const r = await hardDeleteTestTenant('t1', { hosts, loadOwned: owned({ serviceIds: ['srv-u'], repos: ['acct/acme-app'], databaseIds: ['dpg-u1-a'] }) })
  expect(r.success).toBe(false)
  expect(r.steps.find((s) => s.step === 'unified_error')?.detail).toContain('Render 500')
  expect(rows.tenants.length).toBe(1)
  expect(rows.factory_jobs.length).toBe(1)
})

test('hardDeleteTestTenant, template: as before — the name sweep and the repo; never a -app name; no unified step', async () => {
  rows.tenants = [{ id: 't2', slug: 'acme', is_test_tenant: true, industry: 'roofing' }]
  renderServices = [{ id: 'srv-roof', name: 'acme-roof-api' }, { id: 'srv-site', name: 'acme-site' }, { id: 'srv-u', name: 'acme-app' }]
  const r = await hardDeleteTestTenant('t2')
  expect(r.success).toBe(true)
  const dels = fetchCalls.filter((c) => c.startsWith('DELETE'))
  expect(dels).toContain('DELETE https://api.render.com/v1/services/srv-roof')
  expect(dels).toContain('DELETE https://api.render.com/v1/services/srv-site')
  expect(dels).not.toContain('DELETE https://api.render.com/v1/services/srv-u')
  expect(dels).toContain('DELETE https://api.github.com/repos/acct/acme')
  const names = r.steps.map((s) => s.step)
  expect(names).toEqual(['safety_check', 'stripe_cancel', 'render_services', 'render_postgres', 'github_repo', 'r2_bucket', 'cloudflare_zone', 'sendgrid_domain_auth', 'factory_jobs_delete', 'intake_feedback_delete', 'tenant_row_delete'])
})

test('the safety gate holds for a unified tenant too', async () => {
  rows.tenants = [{ id: 't3', slug: 'acme', engine: 'unified', is_test_tenant: false }]
  const { hosts, removed } = fakeHosts({ service: appService, db: appDb, repo: true })
  const r = await hardDeleteTestTenant('t3', { hosts, loadOwned: owned({ serviceIds: ['srv-u'] }) })
  expect(r.success).toBe(false)
  expect(removed).toEqual([])
  expect(rows.tenants.length).toBe(1)
})
