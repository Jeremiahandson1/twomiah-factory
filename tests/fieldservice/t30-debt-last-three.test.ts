// The last three modules that carried write routes any signed-in user of the company could drive.
//
//   fleet        /vehicles/:id/location, /trips/start, /trips/:id/end, /vehicles/:id/fuel
//                Everything else in that file is already fleet:create / fleet:update / fleet:delete, which
//                `field` does not hold at all. These four were never guarded.
//   reviews      /request/:jobId, /schedule/:jobId, /follow-up/:requestId — asking a customer for a public
//                review, in the company's name. Settings and the scheduled sweep were admin; these were
//                open to everyone.
//   warranties   POST /claims — the odd one out in its own file, where /templates, /templates/seed, / and
//                /from-templates are all warranties:create.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 260)) } }

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'T30 Debt Co', slug: 't30debt', email: 't30debt@test.local', settings: {},
  enabledFeatures: ['fleet', 'google_reviews', 'warranties', 'contacts', 'jobs'],
} as any).returning()
const mkUser = async (role: string, tag: string, extra?: string[]) =>
  (await db.insert(user).values({ email: `${tag}-t30debt@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id, ...(extra ? { extraPermissions: extra } : {}) } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')
// the escape hatch a rank cannot offer: one person handed review-chasing by name
const chaser = await mkUser('user', 'chaser', ['marketing:create'])

const app = new Hono()
app.route('/api/fleet', (await import('./src/routes/fleet.ts')).default)
app.route('/api/reviews', (await import('./src/routes/reviews.ts')).default)
app.route('/api/warranties', (await import('./src/routes/warranties.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const refused = (r: { status: number }) => r.status === 403
const gotPast = (r: { status: number }) => r.status !== 403
const NONE = '00000000-0000-0000-0000-000000000000'

console.log('\n── fleet: the driver actions nobody was guarding ──')
{
  const call = as(staff)
  check('staff cannot post a vehicle location', refused(await call('POST', `/api/fleet/vehicles/${NONE}/location`, { lat: 1, lng: 1 })))
  check('staff cannot start a trip', refused(await call('POST', '/api/fleet/trips/start', { vehicleId: NONE })))
  check('staff cannot end one', refused(await call('POST', `/api/fleet/trips/${NONE}/end`, {})))
  check('staff cannot log fuel', refused(await call('POST', `/api/fleet/vehicles/${NONE}/fuel`, { gallons: 10 })))
  const m = await as(manager)('POST', `/api/fleet/vehicles/${NONE}/fuel`, { gallons: 10 })
  check('…while a manager gets past the guard', gotPast(m), { status: m.status, body: m.json })
  check('…and the refusal named fleet:update', (await call('POST', '/api/fleet/trips/start', { vehicleId: NONE })).json?.required === 'fleet:update')
}

console.log('\n── reviews: asking a customer for a public review is marketing ──')
{
  const call = as(staff)
  check('staff cannot send a review request', refused(await call('POST', `/api/reviews/request/${NONE}`, {})))
  check('staff cannot schedule one', refused(await call('POST', `/api/reviews/schedule/${NONE}`, {})))
  check('staff cannot chase one', refused(await call('POST', `/api/reviews/follow-up/${NONE}`, {})))
  check('…and the refusal named marketing:create', (await call('POST', `/api/reviews/request/${NONE}`, {})).json?.required === 'marketing:create')
  const m = await as(manager)('POST', `/api/reviews/request/${NONE}`, {})
  check('a manager gets past the guard', gotPast(m), { status: m.status, body: m.json })
  const g = await as(chaser)('POST', `/api/reviews/request/${NONE}`, {})
  check('…and so does one technician the owner handed marketing:create by name', gotPast(g), { status: g.status, body: g.json })
}

console.log('\n── warranties: filing a claim is the same family as raising the warranty ──')
{
  const s = await as(staff)('POST', '/api/warranties/claims', { warrantyId: NONE, description: 'probe' })
  check('staff cannot file a warranty claim', refused(s), { status: s.status, body: s.json })
  check('…and is told it needs warranties:create', s.json?.required === 'warranties:create', { body: s.json })
  const m = await as(manager)('POST', '/api/warranties/claims', { warrantyId: NONE, description: 'probe' })
  check('a manager can', gotPast(m), { status: m.status, body: m.json })
  const o = await as(owner)('POST', '/api/warranties/claims', { warrantyId: NONE, description: 'probe' })
  check('…and an owner', gotPast(o), { status: o.status })
}

console.log(`\nfs-t30-debt-last-three: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
