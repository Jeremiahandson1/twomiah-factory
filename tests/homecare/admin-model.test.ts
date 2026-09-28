// crm-homecare — the binary model, exercised through real routes.
//
// homecare has no permission matrix. `authenticate` for staff, then `requireAdmin` (admin OR owner)
// for anything privileged — 69 route-level uses — and that is the whole thing. The line it draws is
// office vs care: an administrator configures what care looks like, a caregiver records the care
// they gave. adl.ts is the clearest example in the codebase and the precedent the leads fix followed:
// /requirements POST and DELETE are admin, /log is not.
//
// Both directions on purpose. A caregiver being unable to log an ADL, or to see what is required of
// them, would be a worse bug than the one this guards — it would stop the actual work.
//
// NOT covered here, deliberately: /api/leads. It does not mount. services/audit.ts imports
// `auditLog` while homecare's schema exports `auditLogs`, so the import throws, leads.ts is the only
// route file that imports audit, and index.ts wraps it in `try { ... } catch {}`. See the suite
// README note — that is a product bug to decide on, not something to paper over with a test.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [ag] = await db.insert(agencies).values({ name: 'Admin Model Agency', slug: 'adminmodel' } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-am@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const caregiver = await mkUser('caregiver', 'caregiver')

const app = new Hono()
for (const [mount, file] of [
  ['/api/adl', 'adl'],
  ['/api/caregiver-rates', 'caregiverRates'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

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

// ── admin-only: configuring the care, and the money ─────────────────────────────
const ADMIN_ONLY: Array<[string, string, unknown]> = [
  ['POST', '/api/adl/requirements', { clientId: 'nope000', activity: 'bathing' }],
  ['DELETE', '/api/adl/requirements/nope000', undefined],
  ['PUT', '/api/caregiver-rates/nope000', { hourlyRate: 30 }],
]
for (const [m, p, body] of ADMIN_ONLY) {
  const cg = await as(caregiver)(m, p, body)
  check(`a caregiver is refused: ${m} ${p}`, refused(cg), { status: cg.status, error: cg.json?.error })
  check('…with homecare\'s own message', cg.json?.error === 'Admin access required', cg.json)

  const a = await as(admin)(m, p, body)
  check(`an admin reaches:     ${m} ${p}`, reached(a), { status: a.status, error: a.json?.error })
  const o = await as(owner)(m, p, body)
  check(`an owner reaches:     ${m} ${p}`, reached(o), { status: o.status, error: o.json?.error })
}

// ── the care itself is NOT an admin privilege ───────────────────────────────────
// This is the half a careless fix breaks. requireAdmin on /log would stop every caregiver
// recording the work they were employed to do.
{
  const r = await as(caregiver)('POST', '/api/adl/log', { clientId: 'nope000', activity: 'bathing', completed: true })
  check('a caregiver may still POST /api/adl/log', reached(r), { status: r.status, error: r.json?.error })
}
for (const p of ['/api/adl/client/nope000/requirements', '/api/adl/client/nope000/logs', '/api/caregiver-rates/nope000']) {
  const r = await as(caregiver)('GET', p)
  check(`a caregiver may still read ${p}`, reached(r), { status: r.status, error: r.json?.error })
}

// ── an unknown role is not quietly promoted ─────────────────────────────────────
{
  const stranger = await mkUser('client', 'client')
  const r = await as(stranger)('POST', '/api/adl/requirements', { clientId: 'nope000', activity: 'bathing' })
  check('a client role cannot configure requirements', refused(r), { status: r.status, error: r.json?.error })
}

console.log(`\nhomecare-admin-model: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
