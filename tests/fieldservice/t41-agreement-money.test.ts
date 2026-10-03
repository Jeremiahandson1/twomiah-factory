// crm-fieldservice — T41. What a contract is WORTH is not part of reading the contract.
//
// THE FINDING, on three verticals at once, because they all run one shared module
// (packages/tenant-backend/src/agreements/agreements.ts):
//
//   "Staff sees recurring revenue: Agreements shows Monthly Revenue $49 / Annual $588 and contract
//    prices, from /api/agreements/reports/stats."            — Landscaping, a MEDIUM
//   "Staff sees agreement revenue tiles, job estimatedValue" — Field service
//   "Staff sees job estimatedValue and agreement price and revenue" — Showcase
//
// The module's convention is "writes are gated, reads are open", which is right for a technician who
// needs to know a customer is on a plan and when the next visit is due. It is wrong for the money.
//
// WHAT IS PINNED, AND IN BOTH DIRECTIONS. The gate is `invoices:read` — the fleet's "may see money"
// permission, which manager and viewer hold and `field` does not, and which /api/invoices already
// refuses staff with. So the technician keeps the operational half (counts, who, which plan, when it
// ends) and loses only the figures. A redaction that blanks the page would be its own bug.
//
// This module had NO test anywhere in the repo before this file.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, agreementPlan, serviceAgreement } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'FS Agreements', slug: 'fs-agree-t41', email: 'fsa@test.local', state: 'OH', settings: {},
  enabledFeatures: ['service_agreements', 'maintenance_contracts', 'invoices'],
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-fsa@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')
const tech = await mk('field', 'tech')
const viewer = await mk('viewer', 'onlooker')

const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Beechwood Flats', type: 'client', email: 'bw-fsa@test.local',
} as any).returning()

const [plan] = await db.insert(agreementPlan).values({
  companyId: co.id, name: 'Quarterly Maintenance', description: 'Four visits a year',
  price: '49.00', billingFrequency: 'monthly', visitsIncluded: 4, active: true,
} as any).returning()

// $49 a month = $588 a year, the exact figures the report quotes.
const soon = new Date(); soon.setDate(soon.getDate() + 20)
const [agreement] = await db.insert(serviceAgreement).values({
  companyId: co.id, contactId: client.id, planId: plan.id, number: 'AGR-T41-1',
  name: 'Beechwood quarterly', status: 'active', renewalType: 'manual',
  startDate: new Date('2026-01-01'), endDate: soon,
  billingFrequency: 'monthly', amount: '49.00',
} as any).returning()

const app = new Hono()
app.route('/api/agreements', (await import('./src/routes/agreements.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** Any money key, anywhere in a payload. */
const MONEY = ['monthlyRecurringRevenue', 'annualRecurringRevenue', 'amount', 'price', 'totalBilled', 'discountPercent']
const moneyKeys = (payload: unknown): string[] => {
  const found = new Set<string>()
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    for (const [k, val] of Object.entries(v)) {
      if (MONEY.includes(k) && val !== null && val !== undefined) found.add(k)
      walk(val)
    }
  }
  walk(payload)
  return [...found].sort()
}

// ══════════ the owner and manager see the money ═════════════════════════════════════════════════
console.log('\n── the office sees the revenue ──')
{
  const stats = await as(owner)('GET', '/api/agreements/reports/stats')
  check('the stats tiles answer for the owner', stats.status === 200, { status: stats.status, body: stats.text?.slice(0, 160) })
  check('…with one active agreement', Number(stats.json?.activeAgreements) === 1, stats.json)
  check('…and $49.00 monthly recurring revenue', Number(stats.json?.monthlyRecurringRevenue) === 49, stats.json)
  check('…and $588.00 annual — the figures the report quotes', Number(stats.json?.annualRecurringRevenue) === 588, stats.json)

  const mgr = await as(manager)('GET', '/api/agreements/reports/stats')
  check('a manager sees the revenue too — it holds invoices:read', Number(mgr.json?.monthlyRecurringRevenue) === 49,
    moneyKeys(mgr.json))

  const list = await as(owner)('GET', '/api/agreements?limit=50')
  check('the owner reads the contract price', moneyKeys(list.json).includes('amount'), moneyKeys(list.json))
}

// ══════════ THE TECHNICIAN DOES NOT ═══════════════════════════════════════════════════════════════
console.log('\n── the technician keeps the work and loses the figures ──')
{
  const stats = await as(tech)('GET', '/api/agreements/reports/stats')
  // The tiles are NOT refused — blanking the page would be the wrong fix.
  check('T41: the stats tiles still answer for a technician', stats.status === 200,
    { status: stats.status, body: stats.text?.slice(0, 160) })
  check('T41: …and still carry the COUNTS, which are operational',
    Number(stats.json?.activeAgreements) === 1 && 'expiringIn30Days' in (stats.json || {}), stats.json)
  // THE ASSERTION THIS FILE EXISTS FOR.
  check('T41: …but NOT the monthly or annual recurring revenue', moneyKeys(stats.json).length === 0,
    moneyKeys(stats.json))

  const list = await as(tech)('GET', '/api/agreements?limit=50')
  check('T41: a technician can still read the agreement list', list.status === 200, { status: list.status })
  check('T41: …and it still names the contract, so the visit can be done',
    /Beechwood quarterly/.test(list.text || ''), (list.json?.data || []).length)
  check('T41: …with no contract price on it', moneyKeys(list.json).length === 0, moneyKeys(list.json))

  const detail = await as(tech)('GET', `/api/agreements/${agreement.id}`)
  check('T41: the DETAIL opens', detail.status === 200, { status: detail.status })
  check('T41: …named, dated, and priceless', !!detail.json?.name && moneyKeys(detail.json).length === 0,
    { name: detail.json?.name, money: moneyKeys(detail.json) })

  const expiring = await as(tech)('GET', '/api/agreements/reports/expiring?days=60')
  check('T41: the expiring report answers — an expiring contract is a thing to act on', expiring.status === 200,
    { status: expiring.status })
  check('T41: …without what it is worth', moneyKeys(expiring.json).length === 0, moneyKeys(expiring.json))

  // "What is due to be billed, and for how much" has no operational half, so it is refused outright.
  const due = await as(tech)('GET', '/api/agreements/billing/due')
  check('T41: billing/due is REFUSED for a technician, not redacted', due.status === 403,
    { status: due.status, body: due.text?.slice(0, 160) })
  const dueMgr = await as(manager)('GET', '/api/agreements/billing/due')
  check('T41: …and allowed for a manager, who bills', dueMgr.status === 200, { status: dueMgr.status })
}

// ══════════ a viewer holds invoices:read, so it is NOT the rank that decides ════════════════════
console.log('\n── it is the permission, not the rung ──')
{
  const stats = await as(viewer)('GET', '/api/agreements/reports/stats')
  check('T41: a VIEWER — below field on no ladder that matters — does see the revenue, because it holds invoices:read',
    Number(stats.json?.monthlyRecurringRevenue) === 49, { money: moneyKeys(stats.json), status: stats.status })
  check('T41: …which is the point: the gate is invoices:read and not a rank',
    moneyKeys(stats.json).length > 0, moneyKeys(stats.json))
}

// ══════════ widening nothing: the writes are still gated ════════════════════════════════════════
{
  const w = await as(tech)('POST', '/api/agreements', {
    contactId: client.id, planId: plan.id, name: 'Tech made this', amount: 1,
  })
  check('a technician still cannot create an agreement', w.status === 403, { status: w.status })
  const b = await as(tech)('POST', `/api/agreements/${agreement.id}/bill`)
  check('…nor bill one', b.status === 403, { status: b.status })
}

// ══════════ and the same leak on a JOB ══════════════════════════════════════════════════════════
//
// "Staff sees agreement revenue tiles, job estimatedValue" — the second half of the same finding,
// in the shared jobs module. T32 M7 stopped a technician CHANGING what a job is worth (it had
// dropped JOB-00119 from $11,183 to $1) and left them able to read it.
//
// Three reads return the whole job row and all three carried it: the list, the single read, and
// /today — which is the technician's own screen, so missing it would have left the value on the one
// surface this is actually about.
console.log('\n── what the work is worth ──')
{
  const { job } = await import('./db/schema.ts')
  const jobsApp = new Hono()
  jobsApp.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
  jobsApp.onError((await import('./src/utils/errors.ts')).errorHandler)
  const asJobs = (who: any) => async (path: string) => {
    const res = await jobsApp.request(path, { headers: { 'x-test-user': who.id } })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const today = new Date()
  const [j1] = await db.insert(job).values({
    companyId: co.id, contactId: client.id, number: 'JOB-T41-1', title: 'Boiler service',
    status: 'scheduled', scheduledDate: today, estimatedValue: '11183.00',
  } as any).returning()

  const ownerList = await asJobs(owner)('/api/jobs?limit=50')
  check('the owner reads the job list', ownerList.status === 200, { status: ownerList.status })
  check('…with the estimated value on it', /11183/.test(ownerList.text || ''), moneyKeys(ownerList.json))

  // THE ASSERTIONS. estimatedValue is not in the MONEY list above, so check the text directly.
  const techList = await asJobs(tech)('/api/jobs?limit=50')
  check('T41: a technician still reads the job list — it is their work',
    techList.status === 200 && /Boiler service/.test(techList.text || ''), { status: techList.status })
  check('T41: …with NO estimated value', !/11183/.test(techList.text || '') && !/estimatedValue/.test(techList.text || ''),
    (techList.text || '').slice(0, 200))

  const techOne = await asJobs(tech)(`/api/jobs/${j1.id}`)
  check('T41: the single read opens for a technician', techOne.status === 200, { status: techOne.status })
  check('T41: …also without it', !/11183/.test(techOne.text || ''), (techOne.text || '').slice(0, 200))

  const techToday = await asJobs(tech)('/api/jobs/today')
  check('T41: /today — the technician\'s own screen — answers', techToday.status === 200, { status: techToday.status })
  check('T41: …and does not carry the value either', !/11183/.test(techToday.text || ''),
    (techToday.text || '').slice(0, 200))

  // The hours are NOT withheld: how long the work takes is the technician's own business.
  const mgrOne = await asJobs(manager)(`/api/jobs/${j1.id}`)
  check('T41: a manager still sees the value', /11183/.test(mgrOne.text || ''), (mgrOne.text || '').slice(0, 120))
}

// ══════════ T41 · the Visits column that said " remaining" ══════════════════════════════════════
//
//   landscaping: "Agreements Visits column shows 'remaining' with no number."
//
// The page rendered `{agreement.visitsRemaining} remaining` and nothing had ever computed
// visitsRemaining, so React printed the undefined as nothing: every row of every vertical that sells
// maintenance agreements said the word with no figure in front of it. The pieces were all there —
// the plan's allowance, and the agreement_visit rows — and were never put together.
//
// Pinned here: the arithmetic, that a BOOKED visit counts as spent (it is already promised), and the
// term boundary, because renewAgreement moves startDate forward on the same row and last year's
// visits must not eat this year's allowance.
console.log('\n── how many visits are left ──')
{
  const { agreementVisit } = await import('./db/schema.ts')
  const listed = async (who: any) => {
    const r = await as(who)('GET', '/api/agreements?limit=50')
    return (r.json?.data || []).find((a: any) => a.id === agreement.id)
  }

  const fresh = await listed(owner)
  check('T41: the figure is SENT at all — it simply did not exist before', fresh?.visitsRemaining === 4,
    { visitsRemaining: fresh?.visitsRemaining, included: fresh?.visitsIncluded })
  check('T41: …with the plan\'s allowance beside it, so the screen can say "4 of 4"', fresh?.visitsIncluded === 4, fresh)

  // Book two and complete one of them, through the endpoints the screen uses.
  const v1 = await as(owner)('POST', `/api/agreements/${agreement.id}/visits`, { scheduledDate: '2026-03-10T09:00:00Z' })
  const v2 = await as(owner)('POST', `/api/agreements/${agreement.id}/visits`, { scheduledDate: '2026-06-10T09:00:00Z' })
  check('T41: two visits are booked', v1.status === 201 && v2.status === 201, { v1: v1.status, v2: v2.status })
  const done = await as(owner)('POST', `/api/agreements/visits/${v1.json?.id}/complete`, {})
  check('T41: …and one completed', done.status === 200, { status: done.status, body: done.text?.slice(0, 160) })

  const after = await listed(owner)
  check('T41: one done, one booked, so TWO of the four are left', after?.visitsRemaining === 2,
    { remaining: after?.visitsRemaining, completed: after?.visitsCompleted, scheduled: after?.visitsScheduled })
  check('T41: …and the breakdown is sent, not just the total',
    after?.visitsCompleted === 1 && after?.visitsScheduled === 1, after)

  // A visit before this term started belongs to the term before it.
  await db.insert(agreementVisit).values({
    agreementId: agreement.id, scheduledDate: new Date('2025-06-01T09:00:00Z'), status: 'completed', completedAt: new Date('2025-06-01T11:00:00Z'),
  } as any)
  const stillTwo = await listed(owner)
  check('T41: a visit from the PREVIOUS term does not eat this term\'s allowance', stillTwo?.visitsRemaining === 2,
    { remaining: stillTwo?.visitsRemaining, completed: stillTwo?.visitsCompleted })

  // The detail read shapes it the same way — the screen must not have to ask twice.
  const detail = await as(owner)('GET', `/api/agreements/${agreement.id}`)
  check('T41: the detail read agrees with the list', detail.json?.visitsRemaining === 2 && detail.json?.visitsIncluded === 4,
    { remaining: detail.json?.visitsRemaining, included: detail.json?.visitsIncluded })

  // A plan with no allowance must read "no cap", not "0 left" — so the server sends null, not 0.
  const [openPlan] = await db.insert(agreementPlan).values({
    companyId: co.id, name: 'As needed', price: '0.00', billingFrequency: 'monthly', visitsIncluded: 0, active: true,
  } as any).returning()
  const [openAgreement] = await db.insert(serviceAgreement).values({
    companyId: co.id, contactId: client.id, planId: openPlan.id, number: 'AGR-T41-2',
    name: 'Beechwood as-needed', status: 'active', renewalType: 'manual',
    startDate: new Date('2026-01-01'), endDate: soon, billingFrequency: 'monthly', amount: '0.00',
  } as any).returning()
  const open = (((await as(owner)('GET', '/api/agreements?limit=50')).json?.data) || []).find((a: any) => a.id === openAgreement.id)
  check('T41: a plan with no visit allowance reports null, not 0 — "unlimited" is not "used up"',
    open?.visitsRemaining === null && open?.visitsIncluded === 0,
    { remaining: open?.visitsRemaining, included: open?.visitsIncluded })

  // And a technician, who may not see the money, still sees how many visits are left: that is the work.
  const techRow = await listed(tech)
  check('T41: a technician still sees the visits left — operational, not financial', techRow?.visitsRemaining === 2,
    { remaining: techRow?.visitsRemaining, money: moneyKeys(techRow) })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
