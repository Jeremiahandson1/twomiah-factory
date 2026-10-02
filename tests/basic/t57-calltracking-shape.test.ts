// crm-basic — the call-tracking screen read camelCase and the service answered snake_case. (T57)
//
// Found while sweeping for the phantom `_count` field the contractor's takeoff list had (T35 N3).
// CallTrackingPage.tsx is written entirely in camelCase — `phoneNumber`, `forwardTo`, `callerName`,
// `callerNumber`, `startTime`, `recordingUrl`, `firstTimeCaller` — and services/calltracking.ts
// handed Postgres's own snake_case straight out through a local `rows()` helper. So on a screen whose
// whole job is showing phone numbers, the Phone Number column, the Forward To column and most of the
// call list rendered blank, and the per-number call count read 0 because `_count.calls` is a Prisma
// shape this codebase has never produced.
//
// crm-basic has never had a QA round, which is why nobody had reported any of it.
//
// THE ASSERTIONS ARE THE NAMES THE SCREEN ACTUALLY READS, not "the endpoint answered 200". That is
// the lesson from the salon round where 72 green assertions and 18/18 mutations missed a figure the
// screen rendered wrong: an endpoint can be perfectly correct and still answer in a vocabulary the
// page does not speak.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Showcase Gym', slug: 'showcase-gym', email: 'gym@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['call_tracking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner@gym.local', passwordHash: 'x', firstName: 'O', lastName: 'W',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// A tracking number with a forwarding number, and one call against it. Written with raw SQL because
// that is how this module reads them, so the test cannot drift from the thing it is testing.
await db.execute(sql`
  INSERT INTO tracking_number (id, company_id, phone_number, forward_to, source, name, active, created_at)
  VALUES ('tn-1', ${co.id}, '+16085550143', '+16085550199', 'google', 'Google Ads line', true, NOW())
`)
await db.execute(sql`
  INSERT INTO call_log (id, company_id, tracking_number_id, caller_number, caller_name, duration,
                        status, start_time, recording_url, first_time_caller, is_lead, created_at)
  VALUES ('cl-1', ${co.id}, 'tn-1', '+16085550101', 'Dana Caller', 95,
          'completed', NOW(), 'https://example.test/rec/cl-1.mp3', true, true, NOW())
`)

// ══════════ the tracking-number list ══════════════════════════════════════════════════════════
{
  const r = await api('GET', '/api/calltracking/numbers')
  check('the numbers list answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 160) })
  const row = (Array.isArray(r.json) ? r.json : r.json?.data || [])[0]
  check('…with the row', !!row, r.text?.slice(0, 200))

  // The three fields the screen prints, by the names it prints them under.
  check('phoneNumber — the column the whole screen exists for', row?.phoneNumber === '+16085550143', { phoneNumber: row?.phoneNumber })
  check('forwardTo', row?.forwardTo === '+16085550199', { forwardTo: row?.forwardTo })
  check('callCount — one call against this number', Number(row?.callCount) === 1, { callCount: row?.callCount })

  // …and the old names are gone, so nothing can quietly read both.
  check('…and no snake_case keys are left on the row',
    !Object.keys(row || {}).some((k) => k.includes('_')), Object.keys(row || {}).filter((k) => k.includes('_')))
  check('…and `_count` is not invented anywhere', !/_count/.test(r.text), r.text?.slice(0, 160))
}

// ══════════ the call list ═════════════════════════════════════════════════════════════════════
{
  const r = await api('GET', '/api/calltracking/calls')
  check('the call list answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 160) })
  const call = (r.json?.data || [])[0]
  check('…with the call', !!call, r.text?.slice(0, 200))
  for (const [field, expected] of [
    ['callerName', 'Dana Caller'],
    ['callerNumber', '+16085550101'],
    ['recordingUrl', 'https://example.test/rec/cl-1.mp3'],
  ] as Array<[string, string]>) {
    check(`${field} — read by the call list`, call?.[field] === expected, { [field]: call?.[field] })
  }
  check('startTime is there, so the list can order and print it', !!call?.startTime, { startTime: call?.startTime })
  check('firstTimeCaller — the badge on a new caller', call?.firstTimeCaller === true, { firstTimeCaller: call?.firstTimeCaller })
  check('…and no snake_case keys on a call row either',
    !Object.keys(call || {}).some((k) => k.includes('_')), Object.keys(call || {}).filter((k) => k.includes('_')))
}

// ══════════ the attribution figures, which are read INSIDE the service and must not have moved ══
{
  const r = await api('GET', '/api/calltracking/reports/attribution')
  check('attribution still answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })
  // Those queries are aggregates whose aliases are mapped to camelCase by hand on the way out, so
  // they were deliberately NOT camelised. If somebody camelises them later, these go red rather than
  // the numbers silently becoming undefined.
  const totals = r.json?.totals || r.json
  check('…with a total call count that is a number, not undefined',
    Number.isFinite(Number(totals?.totalCalls)) && Number(totals?.totalCalls) >= 1, { totalCalls: totals?.totalCalls })
  const bySource = r.json?.bySource || []
  check('…and per-source counts that survived', Array.isArray(bySource) && Number(bySource[0]?.calls) === 1,
    { bySource: bySource[0] })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
