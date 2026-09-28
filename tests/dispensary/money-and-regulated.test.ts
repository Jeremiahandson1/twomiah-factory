// crm-dispensary — the money and regulated-product writes (phase A, ce1138e8).
//
// 33 routes were reachable by any signed-in user. The worst was POST /api/pay-by-bank/charge, which
// moves money out of a customer's bank account through Plaid and could be called by a budtender —
// the role every ordinary employee gets, because POST /api/company/users accepts admin|manager|user|
// field and ROLE_MAPPING sends both `user` and `field` to budtender.
//
// Written per ROLE and per DIRECTION, because "a budtender is refused" alone would pass on a fix
// that also locked the floor out of the till. The over-correction is the real danger here: opening
// and closing a cash drawer is a budtender's own shift work and must keep working.
//
// Method: probe with ids that do not exist. A 403 means the gate refused; a 400/404 means the gate
// passed and the handler ran. That distinction is the whole assertion, and it writes nothing.
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
  name: 'Phase A Dispensary', slug: 'phasea', email: 'phasea@test.local',
  settings: {}, enabledFeatures: ['cash_management', 'wholesale', 'cultivation', 'manufacturing', 'pay_by_bank'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-phasea@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('user', 'budtender')   // stored `user`, normalised to budtender
const driver = await mkUser('driver', 'driver')
const viewer = await mkUser('viewer', 'viewer')

const app = new Hono()
for (const [mount, file] of [
  ['/api/cash', 'cash'],
  ['/api/pay-by-bank', 'pay-by-bank'],
  ['/api/wholesale', 'wholesale'],
  ['/api/cultivation', 'cultivation'],
  ['/api/manufacturing', 'manufacturing'],
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

// ── manager+ : back office and money ────────────────────────────────────────────
const MANAGER_ONLY: Array<[string, string]> = [
  ['POST', '/api/pay-by-bank/charge'],
  ['POST', '/api/pay-by-bank/link-token'],
  ['DELETE', '/api/pay-by-bank/accounts/nope000'],
  ['PUT', '/api/wholesale/customers/nope000'],
  ['DELETE', '/api/wholesale/customers/nope000'],
  ['PUT', '/api/wholesale/orders/nope000/ship'],
  ['PUT', '/api/cultivation/plants/nope000'],
  ['POST', '/api/cultivation/plants/nope000/destroy'],
  ['POST', '/api/cultivation/plants/nope000/harvest'],
  ['PUT', '/api/manufacturing/jobs/nope000'],
  ['DELETE', '/api/manufacturing/jobs/nope000'],
]
for (const [m, p] of MANAGER_ONLY) {
  check(`budtender refused: ${m} ${p}`, refused(await as(budtender)(m, p, {})))
  check(`driver refused:    ${m} ${p}`, refused(await as(driver)(m, p, {})))
  check(`viewer refused:    ${m} ${p}`, refused(await as(viewer)(m, p, {})))
  const mr = await as(manager)(m, p, {})
  check(`manager reaches:   ${m} ${p}`, reached(mr), { status: mr.status, error: mr.json?.error })
}

// The refusal must be the ROLE layer, not something incidental.
const body = (await as(budtender)('POST', '/api/pay-by-bank/charge', {})).json
check('the refusal names the rank it wanted', body?.error === 'Insufficient role' && body?.required === 'manager' && body?.yourRole === 'budtender', body)

// ── budtender+ : the till must keep working ─────────────────────────────────────
const TILL: Array<[string, string]> = [
  ['POST', '/api/cash/sessions/open'],
  ['POST', '/api/cash/sessions/nope000/close'],
]
for (const [m, p] of TILL) {
  const bt = await as(budtender)(m, p, {})
  check(`budtender still works: ${m} ${p}`, reached(bt), { status: bt.status, error: bt.json?.error })
  const ow = await as(owner)(m, p, {})
  check(`owner still works:     ${m} ${p}`, reached(ow), { status: ow.status, error: ow.json?.error })
  check(`driver refused:        ${m} ${p}`, refused(await as(driver)(m, p, {})))
  check(`viewer refused:        ${m} ${p}`, refused(await as(viewer)(m, p, {})))
}

// ── reads stay open, which is the convention everywhere in this repo ────────────
for (const p of ['/api/wholesale/customers', '/api/cultivation/plants', '/api/cash/sessions']) {
  const r = await as(viewer)('GET', p)
  check(`viewer may still read ${p}`, reached(r), { status: r.status, error: r.json?.error })
}

console.log(`\ndispensary-money-and-regulated: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
