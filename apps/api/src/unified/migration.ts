/**
 * Assisted migration, the Factory's side (home care parity row 10, docs/parity/homecare-import.md). Twomiah staff, from
 * the platform's Migration screen, work an agency's migration request: the files it sent, a dry run and the real run of
 * the SAME importer the agency has, the record-count comparison old vs new, the sign-off checklist and the status. Every
 * call is passed to the tenant's own service — POST/GET/PUT /api/internal/care-migration/… with its Factory key
 * (apps/unified/server/crm/homecare/office/migration.ts) — so the data is read and written where it lives and the Factory
 * database holds none of it. Only a unified home-care tenant with care_migration answers; the tenant refuses the rest.
 *
 *   GET  /migration/tenants                       the unified home-care tenants staff may work on
 *   GET  /migration/:tenantId/requests            · GET /migration/:tenantId/requests/:id
 *   GET  /migration/:tenantId/files/:id           the file (base64), for staff to look at the sheet
 *   GET  /migration/:tenantId/requests/:id/comparison · GET /migration/:tenantId/kinds
 *   POST /migration/:tenantId/requests/:id/import { fileId, kind, mapping?, sheet?, dateFormat?, updateMatches?, edits?, dryRun? }
 *   POST /migration/:tenantId/requests/:id/attach { fileId, kind, dryRun?, dateFormat? }
 *   PUT  /migration/:tenantId/requests/:id/signoff { item, done }   · PUT …/status { status, staffNote? }
 *   POST /migration/:tenantId/batches/:id/undo
 * Owner or admin. `by` on every write is the signed-in staff member's email, stamped on the tenant's records.
 */
import type { FactoryApp } from '../routes/factory/shared'
import { UUID_RE } from '../routes/factory/shared'
import { supabase, requireRole } from '../middleware/auth'
import { isUnifiedTenant } from './factory'

export interface MigrationTenant { id: string; slug: string; business_name?: string | null; industry?: string | null; engine?: string | null; render_backend_url?: string | null; factory_sync_key?: string | null; status?: string | null }

export interface MigrationDeps {
  /** One tenant by id, or null. */
  tenant: (id: string) => Promise<MigrationTenant | null>
  /** The tenants the screen lists: unified, home care, with a service address. */
  tenants: () => Promise<MigrationTenant[]>
  fetch: (input: string, init?: RequestInit) => Promise<Response>
}

/** Is this tenant one the assisted migration can work on: a unified home-care agency with a running service? */
export function migrationReady(t: MigrationTenant | null | undefined): { ok: true } | { ok: false; why: string } {
  if (!t) return { ok: false, why: 'That customer was not found.' }
  if (!isUnifiedTenant(t)) return { ok: false, why: 'That customer runs the old template, which has no assisted migration.' }
  if (String(t.industry || '').toLowerCase() !== 'homecare' && !/home\s*care/i.test(String(t.industry || ''))) return { ok: false, why: 'Assisted migration is a home-care feature; that customer is another trade.' }
  if (!t.render_backend_url) return { ok: false, why: 'That customer has no running service yet.' }
  if (!t.factory_sync_key) return { ok: false, why: 'That customer has no Factory key, so the Factory cannot speak to its service.' }
  return { ok: true }
}

/** The paths the Factory passes through, each with its method — nothing else on the tenant's internal door is reachable from here. */
const PASS: Array<{ method: string; re: RegExp }> = [
  { method: 'GET', re: /^\/requests$/ }, { method: 'GET', re: /^\/requests\/[a-z0-9]+$/ }, { method: 'GET', re: /^\/files\/[a-z0-9]+$/ },
  { method: 'GET', re: /^\/requests\/[a-z0-9]+\/comparison$/ }, { method: 'GET', re: /^\/kinds$/ },
  { method: 'POST', re: /^\/requests\/[a-z0-9]+\/import$/ }, { method: 'POST', re: /^\/requests\/[a-z0-9]+\/attach$/ },
  { method: 'PUT', re: /^\/requests\/[a-z0-9]+\/signoff$/ }, { method: 'PUT', re: /^\/requests\/[a-z0-9]+\/status$/ },
  { method: 'POST', re: /^\/batches\/[a-z0-9]+\/undo$/ },
]
export const passable = (method: string, path: string) => PASS.some((p) => p.method === method && p.re.test(path))

export function createMigrationProxy(deps: MigrationDeps) {
  /** One call to the tenant's internal door, as the Factory. */
  async function call(t: MigrationTenant, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const url = String(t.render_backend_url).replace(/\/$/, '') + '/api/internal/care-migration' + path
    try {
      const res = await deps.fetch(url, {
        method, headers: { 'Content-Type': 'application/json', 'X-Factory-Key': String(t.factory_sync_key) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: res.status, body: await res.json().catch(() => null) }
    } catch (e: any) {
      return { status: 502, body: { error: `The customer's service did not answer (${e?.message || 'no reply'}).`, code: 'tenant_unreachable' } }
    }
  }

  /** Staff's call, checked and passed through: the tenant must be ready, the path one of ours, and `by` stamped on writes. */
  async function forward(tenantId: string, method: string, path: string, body: Record<string, any> | undefined, by: string): Promise<{ status: number; body: any }> {
    if (!UUID_RE.test(tenantId)) return { status: 400, body: { error: 'Invalid customer id.' } }
    const t = await deps.tenant(tenantId)
    const ready = migrationReady(t)
    if (!ready.ok) return { status: 400, body: { error: ready.why, code: 'not_ready' } }
    if (!passable(method, path)) return { status: 404, body: { error: 'Not found.' } }
    return call(t!, method, path, method === 'GET' ? undefined : { ...(body || {}), by })
  }

  async function list(): Promise<Array<MigrationTenant & { ready: boolean; why: string | null }>> {
    const rows = await deps.tenants()
    return rows.map((t) => { const r = migrationReady(t); return { ...t, factory_sync_key: undefined, ready: r.ok, why: r.ok ? null : r.why } })
  }

  return { call, forward, list }
}

/** The live deps: the Factory's own database. */
export const liveMigrationDeps = (): MigrationDeps => ({
  tenant: async (id) => {
    const { data } = await supabase.from('tenants').select('id, slug, business_name, industry, engine, render_backend_url, factory_sync_key, status').eq('id', id).single()
    return (data as MigrationTenant) || null
  },
  tenants: async () => {
    const { data } = await supabase.from('tenants').select('id, slug, business_name, industry, engine, render_backend_url, factory_sync_key, status').eq('engine', 'unified').order('created_at', { ascending: false }).limit(500)
    return ((data as MigrationTenant[]) || []).filter((t) => /home\s*care|^homecare$/i.test(String(t.industry || '')))
  },
  fetch: (input, init) => fetch(input, init),
})

export function registerMigrationRoutes(app: FactoryApp, deps: MigrationDeps = liveMigrationDeps()) {
  const proxy = createMigrationProxy(deps)
  const staff = requireRole('owner', 'admin')
  const by = (c: any) => String((c.get('user') as any)?.email || c.get('userId') || 'staff')

  app.get('/migration/tenants', staff, async (c) => c.json({ data: await proxy.list() }))
  app.all('/migration/:tenantId/*', staff, async (c) => {
    const tenantId = c.req.param('tenantId')
    const path = c.req.path.replace(/^.*\/migration\/[^/]+/, '')
    const method = c.req.method.toUpperCase()
    const body = method === 'GET' ? undefined : await c.req.json().catch(() => ({}))
    const out = await proxy.forward(tenantId, method, path, body, by(c))
    return c.json(out.body ?? { error: 'No reply.' }, out.status as any)
  })
}
