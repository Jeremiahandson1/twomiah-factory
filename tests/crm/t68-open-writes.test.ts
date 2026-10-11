// T68 — three copy-pasted write routes asked nothing but a login, in all eight CRMs that carry them.
//
// Found classifying RV's ungated writes after the viewer round closed RV's appointments: the lender application
// (wisetack POST /applications, financing POST /apply) and the weather fill-in on a daily log
// (weather POST /daily-log/:id/populate). No screen calls them; any seat with a token could. They now ask
// invoices:create (an application sends a customer's details to a lender for money owed) and daily-logs:update.
//
// Asserted through the contractor's REAL route files (the other seven are byte-identical copies). The allowed seats
// are sent requests that stop before anything external is called — no contact, no provider, an unknown log — so
// "not refused" is proved without touching a lender or a weather service.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

// Wisetack answers 503 before sign-in unless it is configured. Placeholder values let the permission decide;
// no request below reaches the code that would use them.
process.env.WISETACK_API_KEY = 'test-placeholder'
process.env.WISETACK_PARTNER_ID = 'test-placeholder'

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Aspen Build', slug: 'aspen-t68', email: 'aspen-t68@test.local', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@aspen.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), crew = await mk('field', 'crew'), viewer = await mk('viewer', 'viewer')

const app = new Hono()
app.route('/api/wisetack', (await import('./src/routes/wisetack.ts')).default)
app.route('/api/financing', (await import('./src/routes/financing.ts')).default)
app.route('/api/weather', (await import('./src/routes/weather.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const routes: [string, string, unknown, string][] = [
  ['a Wisetack application', '/api/wisetack/applications', { amount: 5000 }, 'invoices:create'],
  ['a financing application', '/api/financing/apply', { amount: 5000 }, 'invoices:create'],
  ['the weather on a daily log', '/api/weather/daily-log/no-such-log/populate', {}, 'daily-logs:update'],
]
for (const [label, path, body, perm] of routes) {
  for (const [seat, who] of [['viewer', viewer], ['crew', crew]] as const) {
    const r = await as(who)('POST', path, body)
    check(`${seat}: ${label} is refused (403, asks ${perm})`, r.status === 403 && r.json?.required === perm, { status: r.status, body: r.json })
  }
  for (const [seat, who] of [['owner', owner], ['manager', manager]] as const) {
    const r = await as(who)('POST', path, body)
    check(`${seat}: ${label} gets past the permission (${r.status})`, r.status !== 403 && r.status !== 401, { status: r.status, body: r.json })
  }
}

console.log(`\nt68 open writes: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
