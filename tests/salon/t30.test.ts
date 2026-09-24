// Salon T30 — the three new findings.
//
// L1  a send with no mail provider must not report success in production
// L2  the Reviews list's subject column says what the request was about
// L3  an appointment needs a client
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord, reviewRequest } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const app = new Hono()
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.onError(errorHandler)

let n = 0
const mk = async (slug: string, settings: Record<string, unknown> = {}) => {
  const [co] = await db.insert(company).values({ name: 'Shears ' + slug, slug: slug + ++n, email: slug + n + '@t.local', settings: { timezone: 'UTC', ...settings }, enabledFeatures: ['salon_booking', 'client_profiles', 'google_reviews'] } as any).returning()
  const [owner] = await db.insert(user).values({ email: `o-${slug}${n}@t.local`, passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
  return { co, owner }
}
const as = (co: any, u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── L3 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── L3: a chair is booked FOR somebody ──')
{
  const { co, owner } = await mk('l3')
  const O = as(co, owner)
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Real Client' } as any).returning()

  const nobody = await O('POST', '/api/appointments', { startTime: new Date(Date.now() + 3600_000).toISOString() })
  check('an appointment with no client is refused', nobody.status === 400, { status: nobody.status, error: nobody.json?.error })
  check('…and says what to do about it', /needs a client/i.test(String(nobody.json?.error)), nobody.json)

  const withClient = await O('POST', '/api/appointments', { contactId: client.id, startTime: new Date(Date.now() + 7200_000).toISOString() })
  check('…while a real booking still works', withClient.status === 201, withClient.json)

  const ghost = await O('POST', '/api/appointments', { contactId: 'nope_not_a_client', startTime: new Date(Date.now() + 9000_000).toISOString() })
  check('…and an unknown client is still a 404, not a 400', ghost.status === 404, { status: ghost.status })
}

// ── L2 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── L2: the Reviews list says what the request was about ──')
{
  const { co } = await mk('l2', { googleReviewUrl: 'https://g.page/r/abc/review', reviewRequestEnabled: true, reviewChannel: 'email' })
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Visited Client', email: 'v@t.local' } as any).returning()
  const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Balayage', durationMin: 90, price: '180' } as any).returning()
  // the visit happened, then the request was raised
  await db.insert(serviceRecord).values({ companyId: co.id, contactId: client.id, serviceId: svc.id, priceCharged: '180', performedAt: new Date(Date.now() - 60_000) } as any)
  await db.insert(reviewRequest).values({ companyId: co.id, contactId: client.id, jobId: null, channel: 'email', status: 'sent', reviewLink: 'https://g.page/r/abc/review', sentAt: new Date() } as any)

  const reviews = await import('./src/services/reviews.ts')
  const list = await reviews.getReviewRequests(co.id, {})
  const row = (list?.data || [])[0]
  check('the request is listed', !!row, list)
  check('…and its subject names the visit, not a blank', !!row?.job?.title, { job: row?.job })
  check('…with the service on it', /Balayage/.test(String(row?.job?.title)), { title: row?.job?.title })

  // a request raised BEFORE any visit has nothing to point at, and must not invent one
  const { co: co2 } = await mk('l2b', { googleReviewUrl: 'https://g.page/r/abc/review' })
  const [c2] = await db.insert(contact).values({ companyId: co2.id, type: 'client', name: 'No Visits', email: 'n@t.local' } as any).returning()
  await db.insert(reviewRequest).values({ companyId: co2.id, contactId: c2.id, jobId: null, channel: 'email', status: 'pending', reviewLink: 'https://g.page/r/abc/review' } as any)
  const list2 = await reviews.getReviewRequests(co2.id, {})
  check('a client with no visit is left blank rather than given a made-up one', !(list2?.data || [])[0]?.job, (list2?.data || [])[0]?.job)
}

// ── L1 ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── L1: a send with no provider does not claim success in production ──')
{
  const email = (await import('./src/services/email.ts')).default
  const before = process.env.NODE_ENV

  process.env.NODE_ENV = 'development'
  const dev = await email.sendRaw({ to: 'dev@t.local', subject: 'dev mode', html: '<p>x</p>' })
  check('in development it still logs to the console and reports dev', dev?.success === true && dev?.dev === true, dev)

  process.env.NODE_ENV = 'production'
  let threw: Error | null = null
  try { await email.sendRaw({ to: 'prod@t.local', subject: 'production, no provider', html: '<p>x</p>' }) }
  catch (e: any) { threw = e }
  check('in production with no provider it REFUSES instead of reporting success', !!threw, { threw: threw?.message })
  check('…naming the missing configuration', /SMTP_HOST|provider/i.test(String(threw?.message)), threw?.message)

  process.env.NODE_ENV = before
}

console.log(`\nt30: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
