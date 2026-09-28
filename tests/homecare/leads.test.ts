// crm-homecare — /api/leads exists, and its writes are the office's.
//
// Two bugs met in this module and both are covered here.
//
// 1. IT NEVER MOUNTED. services/audit.ts imported `auditLog`, which homecare's schema did not
//    define (it has `auditLogs`, a different, clinical table). The named import threw, leads.ts is
//    the only homecare route that imports the audit service, and index.ts mounts it as
//    `try { ... } catch {}` — so the failure was discarded and /api/leads was simply absent, while
//    the sidebar showed Lead Inbox and Lead Sources and both pages called it. Defining auditLog
//    fixed it. The first assertion below is therefore the important one: the module loads at all.
//
// 2. ITS GATES DID NOTHING. leads.ts came from the contractor CRM carrying
//    requirePermission('contacts:delete') and friends; homecare shipped a pass-through
//    permissions stub so those files would import, so every one of them refused nobody. f8c2b608
//    replaced the six writes with requireAdmin.
//
// Reads stay open — a caregiver seeing the lead inbox was never the problem.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, leadSource, auditLog } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

// The table the whole thing hinged on must exist after the boot reconcile.
await db.select().from(auditLog).limit(1)
check('the audit_log table exists after reconcile', true)

const [ag] = await db.insert(agencies).values({ name: 'Leads Care Agency', slug: 'leadscare' } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-leads@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const caregiver = await mkUser('caregiver', 'caregiver')

// THE regression assertion: this import is what used to throw.
const leadsRoutes = (await import('./src/routes/leads.ts')).default
check('routes/leads.ts imports (it used to throw on auditLog)', !!leadsRoutes)

const app = new Hono()
app.route('/api/leads', leadsRoutes)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const refused = (r: { status: number }) => r.status === 403
const reached = (r: { status: number }) => r.status !== 403 && r.status !== 401

// It is actually serving, not 404-ing like an unmounted router.
{
  const r = await as(admin)('GET', '/api/leads')
  check('GET /api/leads is served, not missing', r.status === 200, { status: r.status, error: r.json?.error })
}

// ── the six writes: office only ─────────────────────────────────────────────────
const [src] = await db.insert(leadSource).values({ platform: 'web', label: 'Website form', companyId: ag.id } as any).returning()
const WRITES: Array<[string, string, unknown]> = [
  ['POST', '/api/leads/sources', { platform: 'web', label: 'Probe' }],
  ['PUT', `/api/leads/sources/${src.id}`, { label: 'Renamed' }],
  ['DELETE', `/api/leads/sources/${src.id}`, undefined],
  ['PUT', '/api/leads/nope000/status', { status: 'contacted' }],
  ['POST', '/api/leads/nope000/convert', {}],
  ['DELETE', '/api/leads/nope000', undefined],
]
for (const [m, p, body] of WRITES) {
  const cg = await as(caregiver)(m, p, body)
  check(`a caregiver is refused: ${m} ${p}`, refused(cg), { status: cg.status, error: cg.json?.error })
  check('…with homecare\'s own message', cg.json?.error === 'Admin access required', cg.json)
}

// The office must still be able to work.
{
  const a = await as(admin)('PUT', '/api/leads/nope000/status', { status: 'contacted' })
  check('an admin reaches PUT /api/leads/:id/status', reached(a), { status: a.status, error: a.json?.error })
  const o = await as(owner)('POST', '/api/leads/nope000/convert', {})
  check('an owner reaches POST /api/leads/:id/convert', reached(o), { status: o.status, error: o.json?.error })
  const c = await as(admin)('POST', '/api/leads/sources', { platform: 'web', label: 'Admin source' })
  check('an admin can create a lead source', c.status === 200 || c.status === 201, { status: c.status, error: c.json?.error })
}

// ── reads stay open ─────────────────────────────────────────────────────────────
for (const p of ['/api/leads/sources', '/api/leads', '/api/leads/stats']) {
  const r = await as(caregiver)('GET', p)
  check(`a caregiver may still read ${p}`, reached(r), { status: r.status, error: r.json?.error })
}

console.log(`\nhomecare-leads: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
