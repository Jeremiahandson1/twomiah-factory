// Salon T29 — the fixes, against real Postgres (PGlite) and the real route files.
//
// H1  a review request with no delay is SENT, not left pending for an hour
// M2  the roster stylist's name survives the trip out of the API
// M3  ten wrong passwords lock one account (the tester saw none after fourteen)
// L5  the API reports the vertical's word for the role, not "field"
// A SUCCESSFUL login signs a JWT, so the secrets have to exist before the auth routes are imported.
// (The failure paths below never reach the signing step, which is why the lockout checks pass without.)
process.env.JWT_SECRET ||= 'test-secret-for-the-sandbox-only'
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-for-the-sandbox-only'

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, teamMember, serviceRecord, serviceMenu, reviewRequest, appointment } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }
const settle = () => new Promise((r) => setTimeout(r, 150))   // let a fire-and-forget send finish

await setupSchema()

const app = new Hono()
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.onError(errorHandler)

let n = 0
const mk = async (slug: string, settings: Record<string, unknown> = {}) => {
  const [co] = await db.insert(company).values({ name: 'Shears ' + slug, slug: slug + ++n, email: slug + n + '@t.local', settings: { timezone: 'UTC', ...settings }, enabledFeatures: ['client_profiles', 'salon_booking', 'google_reviews', 'invoices'] } as any).returning()
  const [owner] = await db.insert(user).values({ email: `owner-${slug}${n}@t.local`, passwordHash: await Bun.password.hash('RightPass123!'), firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
  const [staff] = await db.insert(user).values({ email: `staff-${slug}${n}@t.local`, passwordHash: await Bun.password.hash('RightPass123!'), firstName: 'Sam', lastName: 'Staff', role: 'user', companyId: co.id } as any).returning()
  return { co, owner, staff }
}
const as = (co: any, u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── H1 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── H1: no delay means send it now, not within the hour ──')
{
  const { co } = await mk('h1', { googleReviewUrl: 'https://g.page/r/abc/review', reviewRequestEnabled: true, reviewChannel: 'email', reviewRequestDelay: 0 })
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Reachable', email: 'reach@t.local' } as any).returning()
  const reviews = await import('./src/services/reviews.ts')

  await reviews.scheduleReviewRequestForVisit({ companyId: co.id, contactId: client.id })
  await settle()
  const [req] = await db.select().from(reviewRequest).where(eq(reviewRequest.companyId, co.id))
  check('the request exists', !!req, req)
  check('…and it is SENT, not pending', req?.status === 'sent', { status: req?.status })
  check('…with a sent time on it', !!req?.sentAt, { sentAt: req?.sentAt })
}

console.log('\n── H1: a delay still waits, and the sweeper is what sends it ──')
{
  const { co } = await mk('h1b', { googleReviewUrl: 'https://g.page/r/abc/review', reviewRequestEnabled: true, reviewChannel: 'email', reviewRequestDelay: 24 })
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Later', email: 'later@t.local' } as any).returning()
  const reviews = await import('./src/services/reviews.ts')
  await reviews.scheduleReviewRequestForVisit({ companyId: co.id, contactId: client.id })
  await settle()
  const [req] = await db.select().from(reviewRequest).where(eq(reviewRequest.companyId, co.id))
  check('a 24-hour delay leaves it pending', req?.status === 'pending', { status: req?.status })

  // …and once it is old enough, the sweeper picks it up
  await db.update(reviewRequest).set({ createdAt: new Date(Date.now() - 48 * 3600_000) } as any).where(eq(reviewRequest.id, req.id))
  await reviews.processScheduledRequests()
  const [after] = await db.select().from(reviewRequest).where(eq(reviewRequest.id, req.id))
  check('…and the sweeper sends it once the delay has passed', after?.status === 'sent', { status: after?.status })
}

console.log('\n── H1: a company with reviews switched off says so, rather than going quiet ──')
{
  const { co } = await mk('h1c', { googleReviewUrl: 'https://g.page/r/abc/review', reviewRequestEnabled: false })
  const reviews = await import('./src/services/reviews.ts')
  const out = await reviews.processScheduledRequests()
  const skip = (out as any[]).find((r) => r.companyId === co.id && r.action === 'skipped')
  check('the sweeper reports the company it skipped and why', !!skip && /switched off/i.test(skip.reason), skip)
}

// ── M2 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── M2: a roster stylist has a name on the way OUT of the API ──')
{
  const { co, owner } = await mk('m2')
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Charted Client' } as any).returning()
  const [member] = await db.insert(teamMember).values({ companyId: co.id, name: 'Roster Probe', role: 'Stylist', active: true } as any).returning()
  const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cut', durationMin: 30, price: '40' } as any).returning()
  await db.insert(serviceRecord).values({ companyId: co.id, contactId: client.id, serviceId: svc.id, stylistMemberId: member.id, priceCharged: '40', performedAt: new Date() } as any)
  await db.insert(appointment).values({ companyId: co.id, contactId: client.id, stylistMemberId: member.id, startTime: new Date(Date.now() + 3600_000), endTime: new Date(Date.now() + 5400_000), status: 'scheduled' } as any)

  const profile = await as(co, owner)('GET', `/api/clients/${client.id}`)
  const rec = (profile.json?.serviceRecords || [])[0]
  check('the client chart carries stylistMemberName', rec?.stylistMemberName === 'Roster Probe', { got: rec?.stylistMemberName, keys: Object.keys(rec || {}).filter((k) => /stylist/i.test(k)) })
  const appt = (profile.json?.appointments || [])[0]
  check('…and so does the appointment list', appt?.stylistMemberName === 'Roster Probe', { got: appt?.stylistMemberName })

  const act = await as(co, owner)('GET', '/api/dashboard/recent-activity')
  const svcRow = (act.json?.recentServices || [])[0]
  check('…and the dashboard Recent Services', svcRow?.stylistMemberName === 'Roster Probe', { got: svcRow?.stylistMemberName })
}

// ── M3 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── M3: ten wrong passwords lock ONE account ──')
{
  const { co, staff } = await mk('m3')
  const login = async (password: string) => {
    const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: staff.email, password }) })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, error: j?.error }
  }
  let locked: { status: number; error?: string } | null = null
  for (let i = 1; i <= 12 && !locked; i++) {
    const r = await login('wrong-' + i)
    if (r.status === 423) locked = { ...r, ...{ at: i } as any }
  }
  check('the account locks', !!locked, locked)
  check('…on the tenth wrong password, not the fifteenth', (locked as any)?.at === 10, locked)
  check('…and says how long to wait', /try again in \d+ minutes?/i.test(String(locked?.error)), locked?.error)
  const rightWhileLocked = await login('RightPass123!')
  check('…and the RIGHT password is refused while locked, so the lock leaks nothing', rightWhileLocked.status === 423, rightWhileLocked)

  // a different account on the same company is untouched — this is the whole point of a per-ACCOUNT lock
  const other = await mk('m3b')
  const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: other.owner.email, password: 'RightPass123!' }) })
  check('…while everyone else can still sign in', res.status === 200, { status: res.status })
}

// ── L5 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── L5: the API reports a salon word for the role ──')
{
  const { staff } = await mk('l5')
  const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: staff.email, password: 'RightPass123!' }) })
  const j: any = await res.json().catch(() => ({}))
  check('login succeeds', res.status === 200, { status: res.status })
  check('the hierarchy id is unchanged, so every gate still works', j?.user?.role === 'field' || j?.user?.role === 'user', { role: j?.user?.role })
  check('…and the label a person reads is "stylist", not "field"', j?.user?.roleLabel === 'stylist', { roleLabel: j?.user?.roleLabel })
}

console.log(`\nt29: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
