// crm-roof — the three server-side faults found while gating this template's write controls. (T42)
//
// The T42 HIGH was about the SCREEN ("twelve write controls are offered to every seat"), and gating
// buttons is not testable from here. What is testable is what the probe turned up behind them, and
// each of these was measured on rooftest with a write-free oracle before anything was changed:
//
//   route                                     owner  manager  staff(field)
//   POST /api/roof-reports/purchase            400     403      403         ← 1
//   POST /api/reviews/requests                 400     400      400         ← 2  no gate at all
//   POST /api/storms/events                    201     201      403         ← 3  …on an EMPTY body
//
// 1 · ONE ROUTE, TWO PRICES. The screen offers "DIY Measurement — Free" and "Professional Report —
//     $9.99" and posts both to /purchase, which asked `roof-reports:purchase`. Only admin and owner
//     hold that, so a MANAGER could not run the free drawing tool — while the matrix note on the
//     manager row says, in words, "a manager can run a report, take a measurement or file a finance
//     application and still not buy or settle one". A refused real need is worse than a leak.
//
//     HOW THIS IS TESTED WITHOUT A NETWORK CALL, which is the point of the ordering: the gate answers
//     before the body is validated. So a request with a MISSING ADDRESS separates the two cleanly —
//     403 means the gate refused, 400 means the gate passed and the handler's own validation stopped
//     it before `generateReportPreview` (which geocodes and fetches satellite imagery) is ever
//     reached. Every assertion below sends no address on purpose.
//
// 2 · AUTHENTICATED IS NOT AUTHORISED. Roof's reviews router carried `app.use('*', authenticate)` and
//     nothing else, so it LOOKED gated and was missed by the Sep-27 pass that gave every other roof
//     router its resource. The field rung reached POST /requests and was turned back only by the body
//     schema. Asking a customer for a review is `marketing:create` — the same resource the shared
//     integrations/reviews.ts already uses — and the field rung holds no marketing verb.
//
// 3 · A STORM EVENT WITH NO ZIP CODES IS NOT A STORM. Every field was defaulted, so `{}` inserted a
//     row and answered 201 — which is how the probe itself left two junk events on rooftest. The
//     screen already refuses to send one ("Enter at least one zip code"), so the server refusing it
//     breaks no caller: the new refusal already has its client.
//
// Both directions every time. A gate that also refuses the manager running the shop is not a fix.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, stormEvent, reviewRequest } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Ironside Roofing', slug: 'ironside-t43', email: 't43@test.local', state: 'OH',
  settings: {},
  // measurement_reports is what requireRoofReports looks for; without it every roof-reports route
  // answers 403 for the feature rather than the permission and the test would prove nothing.
  enabledFeatures: ['insurance', 'roof_reports', 'measurement_reports', 'storm_lead_gen', 'google_reviews'],
} as any).returning()

const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@ironside-t43.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const admin = await mk('admin', 'admin')
const manager = await mk('manager', 'manager')
// the roofing crew seat. Holds jobs:*, time:*, canvassing:create/update — and no marketing, no
// storms, no roof-reports verb at all.
const crew = await mk('field', 'crew')

// roof's contact table splits the name and makes first_name notNull — it does not carry `name`.
const [client] = await db.insert(contact).values({
  companyId: co.id, firstName: 'Marta', lastName: 'Vilaró', email: 'marta-t43@test.local',
} as any).returning()

const app = new Hono()
app.route('/api/roof-reports', (await import('./src/routes/roofReports.ts')).default)
app.route('/api/reviews', (await import('./src/routes/reviews.ts')).default)
app.route('/api/storms', (await import('./src/routes/storms.ts')).default)
app.route('/api/canvassing', (await import('./src/routes/canvassing.ts')).default)
// Same inline shape roof's src/index.ts uses — a ZodError is the caller's bad input, an error with
// its own 4xx keeps it, anything else surfaces as a 500 rather than being laundered into a refusal.
app.onError((err: any, c: any) => {
  if (err?.name === 'ZodError') {
    const first = (err.issues || [])[0] || {}
    const where = Array.isArray(first.path) && first.path.length ? first.path.join('.') + ': ' : ''
    return c.json({ error: where + (first.message || 'Validation error') }, 400)
  }
  const status = Number(err?.status || err?.statusCode || 0)
  if (status >= 400 && status < 500) return c.json({ error: err.message }, status)
  return c.json({ error: 'Internal server error', unexpected: String(err?.message || err) }, 500)
})

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asAdmin = as(admin), asManager = as(manager), asCrew = as(crew)

// ══════════ 1 · the free measurement a manager was refused ══════════════════════════════════════
console.log('\n══════════ roof reports: the free tool and the paid one are different questions ══════════')
{
  // No address in any of these: the gate answers first, so 400 proves "allowed through" and 403
  // proves "refused" without the handler ever geocoding anything.
  const freeForManager = await asManager('POST', '/api/roof-reports/purchase', { mode: 'manual' })
  check('T42: a MANAGER may run the free DIY measurement — this was 403 before',
    freeForManager.status === 400, { status: freeForManager.status, body: freeForManager.json })
  check('…and it is the handler stopping them, not the gate — the address is what is missing',
    /address/i.test(String(freeForManager.json?.error || '')), freeForManager.json)

  const paidForManager = await asManager('POST', '/api/roof-reports/purchase', { mode: 'auto' })
  check('…but a manager still may NOT buy the $9.99 report — the spend stays admin',
    paidForManager.status === 403, { status: paidForManager.status, body: paidForManager.json })
  check('…and the refusal names the permission it wanted',
    paidForManager.json?.required === 'roof-reports:purchase', paidForManager.json)

  for (const [label, call] of [['the admin', asAdmin], ['the owner', asOwner]] as const) {
    const paid = await call('POST', '/api/roof-reports/purchase', { mode: 'auto' })
    check(`${label} may still buy one`, paid.status === 400, { status: paid.status })
  }

  const crewFree = await asCrew('POST', '/api/roof-reports/purchase', { mode: 'manual' })
  check('the crew seat may not run either one — it holds no roof-reports verb',
    crewFree.status === 403, { status: crewFree.status, body: crewFree.json })
  check('…and that refusal names the CREATE verb, because that is what the free mode asks',
    crewFree.json?.required === 'roof-reports:create', crewFree.json)

  // the other writes in that file, which were already keyed correctly
  const crewDelete = await asCrew('DELETE', '/api/roof-reports/00000000-0000-0000-0000-000000000000')
  check('the crew seat may not delete a report', crewDelete.status === 403, { status: crewDelete.status })
  const mgrDelete = await asManager('DELETE', '/api/roof-reports/00000000-0000-0000-0000-000000000000')
  check('…a manager may, and gets a 404 for an id that does not exist', mgrDelete.status === 404, { status: mgrDelete.status })
}

// ══════════ 2 · the reviews router, which had no resource ════════════════════════════════════════
console.log('\n══════════ reviews: authenticated is not authorised ══════════')
{
  const body = { contactId: client.id, channel: 'email' as const }

  const crewAsk = await asCrew('POST', '/api/reviews/requests', body)
  check('T42: the crew seat may NOT ask a customer for a review — it reached this handler before',
    crewAsk.status === 403, { status: crewAsk.status, body: crewAsk.json })
  check('…and the refusal names marketing:create',
    crewAsk.json?.required === 'marketing:create', crewAsk.json)

  const mgrAsk = await asManager('POST', '/api/reviews/requests', body)
  check('a manager may — the people who chase reviews are the people who run the desk',
    mgrAsk.status === 201, { status: mgrAsk.status, body: mgrAsk.json })
  const requestId = mgrAsk.json?.id

  check('…and nothing was written for the seat that was refused',
    (await db.select().from(reviewRequest)).length === 1, 'more than one request row')

  const crewSent = await asCrew('POST', `/api/reviews/requests/${requestId}/mark-sent`)
  check('the crew seat may not mark one sent', crewSent.status === 403, { status: crewSent.status })
  const mgrSent = await asManager('POST', `/api/reviews/requests/${requestId}/mark-sent`)
  check('…a manager may', mgrSent.status === 200 && mgrSent.json?.status === 'sent', { status: mgrSent.status, body: mgrSent.json })

  const crewReview = await asCrew('POST', '/api/reviews', { rating: 5, platform: 'google' })
  check('the crew seat may not record a received review', crewReview.status === 403, { status: crewReview.status })
  const mgrReview = await asManager('POST', '/api/reviews', { rating: 5, platform: 'google' })
  check('…a manager may', mgrReview.status === 201, { status: mgrReview.status, body: mgrReview.json })

  const crewSync = await asCrew('POST', '/api/reviews/sync/gmb')
  check('the crew seat may not pull from Google', crewSync.status === 403, { status: crewSync.status })
  const mgrSync = await asManager('POST', '/api/reviews/sync/gmb')
  check('…a manager gets past the gate, and then the honest "not connected yet"',
    mgrSync.status === 503 && mgrSync.json?.error === 'not_configured', { status: mgrSync.status, body: mgrSync.json })

  const crewDelete = await asCrew('DELETE', `/api/reviews/requests/${requestId}`)
  check('the crew seat may not remove a request from the record', crewDelete.status === 403, { status: crewDelete.status })
  const mgrDelete = await asManager('DELETE', `/api/reviews/requests/${requestId}`)
  check('…a manager may', mgrDelete.status === 204, { status: mgrDelete.status })

  // …and the READS stay open, deliberately: a crew seeing the shop's rating is not a leak.
  const crewList = await asCrew('GET', '/api/reviews/requests')
  check('the crew seat can still READ the requests — the gate is on the writes only',
    crewList.status === 200, { status: crewList.status })
  const crewSummary = await asCrew('GET', '/api/reviews/summary')
  check('…and the rating summary that feeds the dashboard tile', crewSummary.status === 200, { status: crewSummary.status })
}

// ══════════ 3 · a storm event with no zip codes ═════════════════════════════════════════════════
console.log('\n══════════ storms: an event with nothing to match against ══════════')
{
  const before = (await db.select().from(stormEvent)).length

  const empty = await asManager('POST', '/api/storms/events', {})
  check('T42: an empty body is refused — it answered 201 and inserted a row before',
    empty.status === 400, { status: empty.status, body: empty.json })
  check('…and says what was missing', /zip/i.test(String(empty.json?.error || '')), empty.json)

  for (const [label, payload] of [
    ['an empty array', { affectedZipCodes: [] }],
    ['blank strings', { affectedZipCodes: ['', '  '] }],
    ['the wrong type', { affectedZipCodes: '44101' }],
  ] as [string, any][]) {
    const r = await asManager('POST', '/api/storms/events', payload)
    check(`…and so is ${label}`, r.status === 400, { status: r.status, body: r.json })
  }

  check('nothing was inserted by any of those',
    (await db.select().from(stormEvent)).length === before, 'a row was created')

  const real = await asManager('POST', '/api/storms/events', {
    eventType: 'hail', affectedZipCodes: ['44101', ' 44102 '], hailSizeInches: 1.75,
    description: 'Line of storms through the east side',
  })
  check('a real event is still accepted', real.status === 201, { status: real.status, body: real.json })
  check('…with the blank-trimmed zips stored', JSON.stringify(real.json?.affectedZipCodes) === JSON.stringify(['44101', ' 44102 ']),
    real.json?.affectedZipCodes)
  check('…and exactly one row added', (await db.select().from(stormEvent)).length === before + 1, 'wrong row count')

  const crewEvent = await asCrew('POST', '/api/storms/events', { affectedZipCodes: ['44101'] })
  check('the crew seat still may not raise a storm event at all', crewEvent.status === 403, { status: crewEvent.status })
}

// ══════════ 4 · a write with nothing to write answered 500 ══════════════════════════════════════
// Found by the same probe, and the measurement mattered: my first reading was that the 500 came from
// an empty request BODY hitting `await c.req.json()`. It did not — a perfectly valid `{}` 500s too,
// and so does a body of unrelated keys, which a client can send on any version skew. The cause is
// Drizzle refusing an empty SET clause, so the caller who changed nothing was told the server broke.
console.log('\n══════════ an update that names no field ══════════')
{
  const NOPE = '00000000-0000-0000-0000-000000000000'

  for (const [label, body] of [
    ['an empty object', {}],
    ['keys the route does not recognise', { nope: 1, alsoNope: 'x' }],
  ] as [string, any][]) {
    const r = await asManager('PUT', `/api/storms/leads/${NOPE}`, body)
    check(`T42: a storm-lead update with ${label} is a 400, not a 500`, r.status === 400, { status: r.status, body: r.json })
  }

  const stop = await asManager('PUT', `/api/canvassing/stops/${NOPE}`, {})
  check('T42: …and the same on a canvassing stop', stop.status === 400, { status: stop.status, body: stop.json })

  // the allowed direction: a real field still reaches the database, and a missing row is a 404
  const real = await asManager('PUT', `/api/storms/leads/${NOPE}`, { status: 'contacted' })
  check('…while an update that DOES name a field reaches the row and 404s for a bad id',
    real.status === 404, { status: real.status, body: real.json })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
