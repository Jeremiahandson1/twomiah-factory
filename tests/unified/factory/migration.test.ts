// The Factory's side of the assisted migration (apps/api/src/unified/migration.ts, home care parity row 10): staff's calls are
// checked (a unified home-care tenant with a service and a key; only the migration paths) and passed to the tenant's own
// internal door with its Factory key and the staff member's email, and the tenant's answer comes back as it is.
import { test, expect, describe } from 'bun:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { stubAuth } from './stubs.ts'

// hono as the Factory has it (this folder has no node_modules of its own)
const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono') as typeof import('hono')

stubAuth({ authenticate: async () => {}, requireRole: () => async (_c: any, next: any) => { await next() } })
const { createMigrationProxy, migrationReady, passable, registerMigrationRoutes } = await import('../../../apps/api/src/unified/migration.ts')

const ID = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222'
const care = { id: ID, slug: 'sunny-care', business_name: 'Sunny Care', industry: 'homecare', engine: 'unified', render_backend_url: 'https://sunny-care.test/', factory_sync_key: 'key-sunny' }
const roofer = { id: OTHER, slug: 'acme-roof', industry: 'roofing', engine: 'unified', render_backend_url: 'https://acme.test', factory_sync_key: 'k' }
const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = []
let answer: { status: number; body: any } = { status: 200, body: { data: [] } }
let reachable = true
const deps = {
  tenant: async (id: string) => (id === ID ? care : id === OTHER ? roofer : null),
  tenants: async () => [care, { ...care, id: OTHER, slug: 'new-care', render_backend_url: null }],
  fetch: (async (url: string, init: any = {}) => {
    if (!reachable) throw new Error('connect ECONNREFUSED')
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  }) as any,
}

describe('which tenants the assisted migration can work on', () => {
  test('a unified home-care tenant with a service and a key; every other case says why not', () => {
    expect(migrationReady(care)).toEqual({ ok: true })
    expect(migrationReady({ ...care, industry: 'Home Care' })).toEqual({ ok: true })
    expect((migrationReady(roofer) as any).why).toContain('another trade')
    expect((migrationReady({ ...care, engine: 'templates' }) as any).why).toContain('old template')
    expect((migrationReady({ ...care, render_backend_url: null }) as any).why).toContain('no running service')
    expect((migrationReady({ ...care, factory_sync_key: null }) as any).why).toContain('no Factory key')
    expect((migrationReady(null) as any).why).toContain('not found')
  })
  test('only the migration paths pass through', () => {
    expect(passable('GET', '/requests')).toBe(true)
    expect(passable('POST', '/requests/abc123/import')).toBe(true)
    expect(passable('PUT', '/requests/abc123/status')).toBe(true)
    expect(passable('DELETE', '/requests/abc123')).toBe(false)
    expect(passable('GET', '/../provision')).toBe(false)
    expect(passable('POST', '/requests/abc123/import/../../sync-features')).toBe(false)
  })
})

describe('the pass-through', () => {
  const proxy = createMigrationProxy(deps)
  test('a write carries the Factory key and the staff member as "by"; a read carries no body; the tenant\'s answer comes back as it is', async () => {
    calls.length = 0
    answer = { status: 201, body: { created: 2, batchId: 'b1' } }
    const out = await proxy.forward(ID, 'POST', '/requests/r1/import', { fileId: 'f1', kind: 'clients', dryRun: false }, 'staff@twomiah.com')
    expect(out).toEqual({ status: 201, body: { created: 2, batchId: 'b1' } })
    expect(calls[0]).toMatchObject({ url: 'https://sunny-care.test/api/internal/care-migration/requests/r1/import', method: 'POST', headers: { 'X-Factory-Key': 'key-sunny' }, body: { fileId: 'f1', kind: 'clients', dryRun: false, by: 'staff@twomiah.com' } })
    answer = { status: 200, body: { data: [{ id: 'r1' }] } }
    const read = await proxy.forward(ID, 'GET', '/requests', undefined, 'staff@twomiah.com')
    expect(read.body.data[0].id).toBe('r1')
    expect(calls[1].body).toBeUndefined()
    // the tenant's refusal (no feature) is handed back unchanged
    answer = { status: 403, body: { error: 'This agency does not have assisted migration turned on.', code: 'FEATURE_NOT_ENABLED' } }
    expect((await proxy.forward(ID, 'GET', '/requests', undefined, 'x')).status).toBe(403)
  })
  test('a tenant that is not ready, a path that is not ours, a bad id, and a service that does not answer', async () => {
    expect((await proxy.forward(OTHER, 'GET', '/requests', undefined, 'x')).body.code).toBe('not_ready')
    expect((await proxy.forward(ID, 'DELETE', '/requests/r1', undefined, 'x')).status).toBe(404)
    expect((await proxy.forward('nope', 'GET', '/requests', undefined, 'x')).status).toBe(400)
    reachable = false
    const down = await proxy.forward(ID, 'GET', '/requests', undefined, 'x')
    expect(down.status).toBe(502)
    expect(down.body.code).toBe('tenant_unreachable')
    reachable = true
  })
  test('the list says which tenants are ready and never shows their keys', async () => {
    const rows = await proxy.list()
    expect(rows.map((r) => [r.slug, r.ready])).toEqual([['sunny-care', true], ['new-care', false]])
    expect(rows[1].why).toContain('no running service')
    expect(rows.every((r) => r.factory_sync_key === undefined)).toBe(true)
  })
})

describe('mounted on the Factory', () => {
  test('the routes answer under /migration, stamping the signed-in staff member', async () => {
    const app = new Hono<any>()
    app.use('*', async (c, next) => { c.set('user', { email: 'owner@twomiah.com' }); c.set('userRole', 'owner'); await next() })
    registerMigrationRoutes(app as any, deps)
    calls.length = 0
    answer = { status: 200, body: { id: 'r1', status: 'done' } }
    const res = await app.request(`/migration/${ID}/requests/r1/status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'r1', status: 'done' })
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://sunny-care.test/api/internal/care-migration/requests/r1/status', body: { status: 'done', by: 'owner@twomiah.com' } })
    const list = await app.request('/migration/tenants')
    expect((await list.json()).data.length).toBe(2)
  })
})
