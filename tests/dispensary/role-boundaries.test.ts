// crm-dispensary — where the counter stops and the back office starts (phase B, f3113269),
// and the forked-matrix regression that shipped green (1394c506).
//
// THE REGRESSION IS THE REASON THIS FILE EXISTS. Gating support.ts on support-kb:* added those
// resources to the SHARED BASE_ROLE_PERMISSIONS, which eight templates inherit through
// createPermissions(). crm-dispensary does not: middleware/permissions.ts declares its own
// ROLE_PERMISSIONS and never reads the shared one, so hasPermission fell through to a list without
// those entries and refused everyone except the owner. Dispensary admins lost the knowledge base.
// check-permission-vocabulary.ts could not see it — it validates against the shared matrix, which is
// exactly where the grant had been added. CI was green the whole time.
//
// A static guard now covers that class (check-forked-permission-matrix.ts). This covers it the other
// way: by asking the real routes, through the real forked matrix, whether the right person is let in.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Boundaries Dispensary', slug: 'bounds', email: 'bounds@test.local',
  settings: {}, enabledFeatures: ['orders', 'products', 'contacts', 'custom_reports', 'documents', 'two_way_texting', 'pos'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-bounds@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('user', 'budtender')
const viewer = await mkUser('viewer', 'viewer')

const app = new Hono()
for (const [mount, file] of [
  ['/api/support', 'support'],
  ['/api/reports', 'reports'],
  ['/api/sms', 'sms'],
  ['/api/pos', 'pos'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const refused = (r: { status: number }) => r.status === 403
const reached = (r: { status: number }) => r.status !== 403 && r.status !== 401

// ── the regression: admin must keep the knowledge base ──────────────────────────
for (const [m, p] of [['POST', '/api/support/kb'], ['PUT', '/api/support/kb/nope000'], ['DELETE', '/api/support/kb/nope000']] as const) {
  const a = await as(admin)(m, p, {})
  check(`admin reaches ${m} ${p} (the 1394c506 regression)`, reached(a), { status: a.status, error: a.json?.error })
  const o = await as(owner)(m, p, {})
  check(`owner reaches ${m} ${p}`, reached(o), { status: o.status, error: o.json?.error })
  check(`budtender refused ${m} ${p}`, refused(await as(budtender)(m, p, {})))
}
{
  const a = await as(admin)('POST', '/api/support/sla-policies', {})
  check('admin reaches POST /api/support/sla-policies', reached(a), { status: a.status, error: a.json?.error })
  check('budtender refused POST /api/support/sla-policies', refused(await as(budtender)('POST', '/api/support/sla-policies', {})))
}

// ── getting help is not an admin privilege ──────────────────────────────────────
for (const [m, p] of [['POST', '/api/support/tickets'], ['POST', '/api/support/tickets/nope000/messages']] as const) {
  const r = await as(budtender)(m, p, {})
  check(`a budtender may still ${m} ${p}`, reached(r), { status: r.status, error: r.json?.error })
}

// ── manager+ : the back office ──────────────────────────────────────────────────
const MANAGER_ONLY: Array<[string, string]> = [
  ['POST', '/api/reports/saved'],
  ['PUT', '/api/reports/saved/nope000'],
  ['DELETE', '/api/reports/widgets/nope000'],
  ['POST', '/api/sms/templates'],
  ['POST', '/api/sms/auto-responders'],
]
for (const [m, p] of MANAGER_ONLY) {
  check(`budtender refused: ${m} ${p}`, refused(await as(budtender)(m, p, {})))
  const mr = await as(manager)(m, p, {})
  check(`manager reaches:   ${m} ${p}`, reached(mr), { status: mr.status, error: mr.json?.error })
}

// ── budtender+ : the counter keeps working ──────────────────────────────────────
for (const [m, p] of [['POST', '/api/sms/send'], ['POST', '/api/pos/cart/add']] as const) {
  const bt = await as(budtender)(m, p, {})
  check(`budtender still works: ${m} ${p}`, reached(bt), { status: bt.status, error: bt.json?.error })
  check(`viewer refused:        ${m} ${p}`, refused(await as(viewer)(m, p, {})))
}

console.log(`\ndispensary-role-boundaries: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
