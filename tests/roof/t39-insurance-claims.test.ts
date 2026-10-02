// crm-roof — insurance claims and supplements, the module this vertical exists for. (T39)
//
// WHY THIS SUITE EXISTS AT ALL. crm-roof had 230 endpoint declarations and ZERO vertical-specific
// tests: only the shared contract test, which proves two fleet-wide invariants and nothing about
// roofing. Roof has had two human rounds (T17, T18) and every fix they produced has been sitting
// unprotected ever since — a regression in any of them is invisible until somebody looks by hand.
//
// So this does not test "the endpoints answer". It pins the MONEY RULES those rounds established,
// each of which is a fault that actually shipped and was actually found:
//
//   T17 H2  A supplement's header total was whatever the client sent. SUP-001 stored $77,777.00
//           above a single $200.00 line item, and a supplement for -$600 was accepted. The money is
//           now computed server-side from qty × unitPrice and the client's `totalAmount` is ignored.
//   T17 H1  Approving a supplement double-counted the one just approved: it summed the approved rows
//           AND added `approvedAmount` again on top. Three approvals of 1,100 / 77,777 / -600 that
//           should have totalled 78,277 reported 77,677. The stale status made the condition always
//           true, so it was never a harmless no-op.
//   T17     There was no role check anywhere in this module, so a staff login could approve a
//           carrier's decision. approve and deny now carry requireManager.
//
// EVERY ASSERTION IS A FIGURE OR A REFUSAL, not a status code. A 200 on /approve proves nothing
// about what the claim now says the carrier owes.
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
const { company, user, contact, job } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Summit Ridge Roofing', slug: 'summit-ridge-claims', email: 'summit@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['insurance', 'roof_reports'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@summit.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const crew = await mkUser('field', 'crew')

const [homeowner] = await db.insert(contact).values({
  companyId: co.id, firstName: 'Dana', lastName: 'Okafor', email: 'dana@test.local',
} as any).returning()

// An INSURANCE job — the module refuses to open a claim on anything else, which is its own rule.
const [insJob] = await db.insert(job).values({
  companyId: co.id, contactId: homeowner.id, jobNumber: 'JOB-5001', jobType: 'insurance',
  status: 'lead', propertyAddress: '144 Shingle Ln', city: 'Columbus', state: 'OH', zip: '43215',
  // `source` is notNull with no default on this template — a roofing job always came from somewhere
  // (a storm canvass, a referral, a call). The first run of this file died on it.
  source: 'canvassing',
} as any).returning()
const [retailJob] = await db.insert(job).values({
  companyId: co.id, contactId: homeowner.id, jobNumber: 'JOB-5002', jobType: 'retail',
  status: 'lead', propertyAddress: '12 Cash Rd', city: 'Columbus', state: 'OH', zip: '43215', source: 'referral',
} as any).returning()

const app = new Hono()
app.route('/api/insurance', (await import('./src/routes/insurance.ts')).default)
/**
 * ROOF HAS NO EXPORTED errorHandler — its handler is inline in src/index.ts.
 *
 * Every other suite does `app.onError((await import('./src/utils/errors.ts')).errorHandler)`, and
 * here that is `undefined`, which fails as "this.errorHandler is not a function". roof/utils/errors.ts
 * exports only `notFound`. This is one of the ways roof is a different product — the thing the user
 * warned me about when they said generic expectations misfire on it.
 *
 * So the two behaviours the assertions below actually depend on are reproduced, matching index.ts:
 * a ZodError is the caller's bad input and answers 400 with the field named, and an error carrying
 * its own 4xx keeps it. Anything else is a real fault and must surface as 500 rather than being
 * swallowed into a tidy 400 — a test that turns server faults into refusals is how a 500 gets
 * counted as "correctly rejected".
 */
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
const asOwner = as(owner), asManager = as(manager), asCrew = as(crew)

const claimRow = async (id: string) => {
  const r: any = await db.execute(sql`SELECT supplement_amount, claim_status FROM insurance_claim WHERE id = ${id}`)
  return ((r as any).rows || r)[0]
}

// ══════════ a claim belongs to an insurance job, and only one ════════════════════════════════
console.log('\n══════════ opening the claim ══════════')
let claimId = ''
{
  const wrongType = await asOwner('POST', '/api/insurance/claims', {
    jobId: retailJob.id, claimNumber: 'CLM-NOPE', insuranceCompany: 'Buckeye Mutual',
  })
  check('a claim cannot be opened on a RETAIL job', wrongType.status === 400 && /insurance type/i.test(String(wrongType.json?.error)),
    { status: wrongType.status, body: wrongType.text?.slice(0, 140) })

  const made = await asOwner('POST', '/api/insurance/claims', {
    jobId: insJob.id, claimNumber: 'CLM-88213', insuranceCompany: 'Buckeye Mutual',
    causeOfLoss: 'hail', deductible: '1000.00',
  })
  check('a claim opens on the insurance job', made.status === 201, { status: made.status, body: made.text?.slice(0, 180) })
  claimId = made.json?.id
  check('…and starts with no supplement money on it', Number((await claimRow(claimId))?.supplement_amount) === 0,
    await claimRow(claimId))

  const dupe = await asOwner('POST', '/api/insurance/claims', {
    jobId: insJob.id, claimNumber: 'CLM-SECOND', insuranceCompany: 'Buckeye Mutual',
  })
  check('a second claim on the same job is refused', dupe.status === 409, { status: dupe.status, body: dupe.text?.slice(0, 140) })
}

// ══════════ T17 H2 · the header total is the LINE ITEMS, whatever the client says ═════════════
console.log('\n══════════ the supplement total is computed, not accepted ══════════')
let supA = '', supB = ''
{
  // The exact shape of the original fault: one $200 line item, a header total of $77,777.
  const lied = await asOwner('POST', `/api/insurance/claims/${claimId}/supplements`, {
    reason: 'Ridge cap not in scope',
    lineItems: [{ code: 'RFG-RIDGE', description: 'Ridge cap', qty: 1, unit: 'EA', unitPrice: 200, total: 77777 }],
    totalAmount: '77777.00',
  })
  check('a supplement is created', lied.status === 201, { status: lied.status, body: lied.text?.slice(0, 180) })
  supA = lied.json?.id
  check('…and its total is the LINE ITEMS ($200), not the $77,777 header the client sent',
    Number(lied.json?.totalAmount) === 200, { totalAmount: lied.json?.totalAmount })
  check('…and the line item total is recomputed too, not echoed',
    Number(lied.json?.lineItems?.[0]?.total) === 200, lied.json?.lineItems?.[0])
  check('…numbered automatically', lied.json?.supplementNumber === 'SUP-001', { n: lied.json?.supplementNumber })

  // Negative money is refused outright rather than stored.
  const negative = await asOwner('POST', `/api/insurance/claims/${claimId}/supplements`, {
    reason: 'credit back', lineItems: [{ description: 'Credit', qty: 1, unit: 'EA', unitPrice: -600 }],
  })
  check('a NEGATIVE line price is refused — a supplement for -$600 was once accepted', negative.status >= 400,
    { status: negative.status, body: negative.text?.slice(0, 140) })

  // Arithmetic that is not a round number, so the rounding is exercised.
  const real = await asOwner('POST', `/api/insurance/claims/${claimId}/supplements`, {
    reason: 'Extra squares after tear-off',
    lineItems: [
      { description: 'Shingles', qty: 12.5, unit: 'SQ', unitPrice: 88.33 },
      { description: 'Underlayment', qty: 3, unit: 'RL', unitPrice: 42.10 },
    ],
  })
  // 12.5 × 88.33 = 1104.125 → 1104.13 (each line rounds to the cent, then they sum)
  check('two line items sum to the cent: 1104.13 + 126.30 = 1230.43', Number(real.json?.totalAmount) === 1230.43,
    { totalAmount: real.json?.totalAmount, lineItems: real.json?.lineItems })
  supB = real.json?.id
  check('…and the second supplement is SUP-002', real.json?.supplementNumber === 'SUP-002', { n: real.json?.supplementNumber })
}

// ══════════ T17 · the carrier's decision is not every signed-in user's to record ══════════════
console.log('\n══════════ who may record an approval ══════════')
{
  await asOwner('POST', `/api/insurance/supplements/${supA}/submit`)
  const byCrew = await asCrew('POST', `/api/insurance/supplements/${supA}/approve`, { approvedAmount: '200.00' })
  check('a field crew member cannot approve a supplement', byCrew.status === 403, { status: byCrew.status, body: byCrew.text?.slice(0, 140) })
  check('…and nothing was approved on the claim', Number((await claimRow(claimId))?.supplement_amount) === 0,
    await claimRow(claimId))

  const denyByCrew = await asCrew('POST', `/api/insurance/supplements/${supA}/deny`, { denialReason: 'nope' })
  check('…nor deny one', denyByCrew.status === 403, { status: denyByCrew.status })
}

// ══════════ an approved amount is money ══════════════════════════════════════════════════════
console.log('\n══════════ the approved amount ══════════')
{
  const neg = await asManager('POST', `/api/insurance/supplements/${supA}/approve`, { approvedAmount: '-600.00' })
  check('a NEGATIVE approved amount is refused', neg.status === 400, { status: neg.status, body: neg.text?.slice(0, 140) })

  const nan = await asManager('POST', `/api/insurance/supplements/${supA}/approve`, { approvedAmount: 'lots' })
  check('…and a non-number is refused rather than becoming NaN', nan.status === 400, { status: nan.status })

  check('…and the claim still shows nothing approved', Number((await claimRow(claimId))?.supplement_amount) === 0,
    await claimRow(claimId))
}

// ══════════ T17 H1 · the claim total is the SUM of approvals, counted once ════════════════════
console.log('\n══════════ the claim total does not double-count ══════════')
{
  const first = await asManager('POST', `/api/insurance/supplements/${supA}/approve`, { approvedAmount: '1100.00' })
  check('a manager approves SUP-001 at $1,100', first.status === 200 && first.json?.status === 'approved',
    { status: first.status, body: first.text?.slice(0, 140) })
  check('…and the claim says exactly 1100.00 — not 2200', Number((await claimRow(claimId))?.supplement_amount) === 1100,
    await claimRow(claimId))

  await asOwner('POST', `/api/insurance/supplements/${supB}/submit`)
  const second = await asManager('POST', `/api/insurance/supplements/${supB}/approve`, { approvedAmount: '1230.43' })
  check('a manager approves SUP-002 at $1,230.43', second.status === 200, { status: second.status })

  // THE ASSERTION THE ROUND WAS ABOUT: 1100 + 1230.43, with the newest counted once.
  check('…and the claim total is 2330.43 — the most recent approval counted ONCE',
    Number((await claimRow(claimId))?.supplement_amount) === 2330.43, await claimRow(claimId))

  // Re-approving at a different figure REPLACES that supplement's contribution; it does not add.
  const revised = await asManager('POST', `/api/insurance/supplements/${supB}/approve`, { approvedAmount: '1000.00' })
  check('re-approving SUP-002 lower is accepted', revised.status === 200, { status: revised.status })
  check('…and the claim total is 2100.00, not 3330.43 — a revision replaces, it does not stack',
    Number((await claimRow(claimId))?.supplement_amount) === 2100, await claimRow(claimId))
}

// ══════════ a denial takes the money back off ════════════════════════════════════════════════
console.log('\n══════════ a denial moves money off the claim ══════════')
{
  const denied = await asManager('POST', `/api/insurance/supplements/${supB}/deny`, { denialReason: 'Not covered under policy' })
  check('a manager can deny a previously approved supplement', denied.status === 200, { status: denied.status, body: denied.text?.slice(0, 160) })
  check('…and the claim drops back to 1100.00 — only approvals count',
    Number((await claimRow(claimId))?.supplement_amount) === 1100, await claimRow(claimId))
}

// ══════════ the activity trail actually records who did what ═════════════════════════════════
console.log('\n══════════ the trail ══════════')
{
  const act = await asOwner('GET', `/api/insurance/claims/${claimId}/activity`)
  check('the claim activity reads', act.status === 200, { status: act.status })
  const rows: any[] = Array.isArray(act.json) ? act.json : (act.json?.data || [])
  check('…and carries the submissions, approvals and the denial', rows.length >= 4, { n: rows.length })
  // activityType is 'approval' and 'denial' — my first version matched /approved/i against it,
  // which 'approval' does not contain, so the assertion was looking for a row that never exists.
  check('…with a real figure in the approval line, not "$NaN" or "$undefined"',
    rows.some((r: any) => String(r.activityType ?? r.activity_type) === 'approval' && /\$1,100/.test(String(r.body))),
    rows.map((r: any) => `${r.activityType ?? r.activity_type}: ${String(r.body).slice(0, 60)}`))
  check('…and the denial is recorded with its reason',
    rows.some((r: any) => String(r.activityType ?? r.activity_type) === 'denial' && /Not covered under policy/.test(String(r.body))),
    rows.filter((r: any) => (r.activityType ?? r.activity_type) === 'denial').map((r: any) => String(r.body).slice(0, 80)))
  check('…and no row says NaN or undefined anywhere', !/NaN|undefined/.test(act.text), act.text?.slice(0, 200))
}

// ══════════ another company's claim is not reachable ═════════════════════════════════════════
console.log('\n══════════ company scoping ══════════')
{
  const [other] = await db.insert(company).values({
    name: 'Rival Roofing', slug: 'rival-claims', email: 'rival@test.local', state: 'OH', settings: {}, enabledFeatures: ['insurance'],
  } as any).returning()
  const [intruder] = await db.insert(user).values({
    email: 'intruder@rival.local', passwordHash: 'x', firstName: 'I', lastName: 'R',
    role: 'owner', companyId: other.id, isActive: true,
  } as any).returning()

  const peek = await as(intruder)('GET', `/api/insurance/claims/${claimId}/supplements`)
  const leaked = /SUP-00/.test(peek.text)
  check('another company cannot read these supplements', !leaked, { status: peek.status, body: peek.text?.slice(0, 160) })

  const approve = await as(intruder)('POST', `/api/insurance/supplements/${supA}/approve`, { approvedAmount: '99999.00' })
  check('…nor approve one', approve.status >= 400, { status: approve.status })
  check('…and the figure is untouched', Number((await claimRow(claimId))?.supplement_amount) === 1100, await claimRow(claimId))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
