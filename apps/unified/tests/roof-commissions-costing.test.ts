// Commissions and job costing for roofers (docs/parity/roof-commissions-costing.md; roofing depth, gap 2), through the real
// server as the roofing vertical:
//   · Commission Tracking and Job Costing are offered to a roofing business (the registry lists them for crm-roof);
//   · a plan can pay the job's SALES REP (job.assignedSalesRepId) once the whole job is paid: when the last invoice is paid
//     the job reaches Collected and the rep earns — 8% of the CONTRACT (before tax), and 25% of the job's GROSS PROFIT
//     (the contract less its material orders and its crew's pay) — once each, however often the payment is followed up;
//   · a deposit paid while the job is still being sold or built earns nothing; a job with no sales rep earns nobody anything;
//     a margin plan on a job that lost money earns nothing, while the contract plan still pays; a job moved to Collected by
//     hand (Advance) pays the rep too;
//   · the job's P&L (Job Costing) carries the material orders (only those placed), the crew's pay by the square, the
//     supplements, and the clocked-hours rule that stops a crew being costed twice;
//   · the seat without the permission is refused by the server — commissions, plans and job costing — and what a crew is paid
//     is withheld from a seat without margin:read; with the feature off the routes are not there.
// Nothing here reaches Stripe, the Factory or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'invoices', 'commission_tracking', 'job_costing', 'materials', 'crews', 'insurance_workflow', 'time_tracking']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await setFeatures(FEATURES)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  // Rita sells roofs (a field seat, as roofing runs its reps); Mo is a manager; Val is the read-only office seat.
  for (const [key, role, first] of [['rep', 'field', 'Rita'], ['manager', 'manager', 'Mo'], ['viewer', 'viewer', 'Val']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: first, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()
  ids.home = home.id
}, 120_000)

const settled = async (jobId: string, want: string) => {
  for (let i = 0; i < 40; i++) {
    const [row] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId))
    if (row.status === want) return want
    await new Promise((r) => setTimeout(r, 50))
  }
  return (await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId)))[0].status as string
}
const commissionsOf = async (jobId: string) =>
  (await t.db.select().from(t.schema.commission).where(and(eq(t.schema.commission.companyId, companyId), eq(t.schema.commission.jobId, jobId)))) as any[]
/** A commission follows the payment after the reply, so wait for it rather than read at once. */
const commissionsAfter = async (jobId: string, count: number) => {
  for (let i = 0; i < 40; i++) { if ((await commissionsOf(jobId)).length >= count) break; await new Promise((r) => setTimeout(r, 50)) }
  return commissionsOf(jobId)
}

async function jobAt(status: string, address: string, extra: Record<string, unknown> = {}) {
  const made = await json(await as('owner')('/api/jobs', { method: 'POST', json: {
    contactId: ids.home, jobType: 'insurance', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301',
    estimatedRevenue: 12000, totalSquares: 30, ...extra,
  } }))
  expect([address, made.status]).toEqual([address, 201])
  await t.db.update(t.schema.job).set({ status } as any).where(eq(t.schema.job.id, made.body.id))
  return made.body.id as string
}
/** An invoice on the job for `price` before tax, sent. */
async function sentInvoice(jobId: string, price: number) {
  const inv = await json(await as('owner')('/api/invoices', { method: 'POST', json: { contactId: ids.home, jobId, lineItems: [{ description: 'Roof replacement', quantity: 1, unitPrice: price }] } }))
  expect(inv.status).toBe(201)
  expect((await as('owner')(`/api/invoices/${inv.body.id}/send`, { method: 'POST' })).status).toBe(200)
  return inv.body as { id: string; number: string }
}
const pay = async (invoiceId: string, amount: number) =>
  expect((await as('owner')(`/api/invoices/${invoiceId}/payments`, { method: 'POST', json: { amount, method: 'check' } })).status).toBe(201)
const order = (jobId: string, orderStatus: string, supplier: string, lines: Array<[string, number, number]>) =>
  as('owner')('/api/materials', { method: 'POST', json: { jobId, supplier, orderStatus, lineItems: lines.map(([description, qty, unitPrice]) => ({ description, qty, unit: 'ea', unitPrice })) } })

describe('what is offered', () => {
  test('Commission Tracking and Job Costing are offered to a roofing business, and a plan may pay the job’s sales rep', async () => {
    const offered = getFeaturesForTemplate('crm-roof').map((f: any) => f.id)
    expect(offered).toContain('commission_tracking')
    expect(offered).toContain('job_costing')
    const crew = await json(await as('owner')('/api/crews', { method: 'POST', json: { name: 'Ridge Crew', foremanName: 'Ray', foremanPhone: '715-555-0199', size: 4, payPerSquare: 45 } }))
    expect([crew.status, crew.body.payPerSquare]).toEqual([201, '45.00'])
    ids.crew = crew.body.id
    // Two plans for the rep: 8% of the contract, and 25% of the job's gross profit. A margin plan can be automatic here.
    const contract = await json(await as('owner')('/api/commissions/plans', { method: 'POST', json: { name: 'Rep 8% of contract', planType: 'percent_of_invoice', percentRate: 8, appliesToRole: 'sales_rep', autoEarn: 'job_sales_rep' } }))
    const profit = await json(await as('owner')('/api/commissions/plans', { method: 'POST', json: { name: 'Rep 25% of profit', planType: 'percent_of_margin', percentRate: 25, appliesToRole: 'sales_rep', autoEarn: 'job_sales_rep' } }))
    expect([contract.status, contract.body.autoEarn, !!contract.body.autoSince]).toEqual([201, 'job_sales_rep', true])
    expect([profit.status, profit.body.autoEarn, profit.body.planType]).toEqual([201, 'job_sales_rep', 'percent_of_margin'])
    ids.contractPlan = contract.body.id
    ids.profitPlan = profit.body.id
    // …and the other trades' rule is unchanged: a margin plan cannot be automatic by the old choices.
    const old = await json(await as('owner')('/api/commissions/plans', { method: 'POST', json: { name: 'Old margin', planType: 'percent_of_margin', percentRate: 10, autoEarn: 'job_assignee' } }))
    expect([old.status, old.body.code]).toEqual([400, 'margin_not_automatic'])
  })
})

describe('the rep is paid when the job is paid', () => {
  test('the last invoice paid collects the job, and the rep earns 8% of the contract and 25% of the gross profit, once', async () => {
    const jobId = await jobAt('invoiced', '1 Shingle Way', { assignedSalesRepId: ids.rep, assignedCrewId: ids.crew })
    ids.paidJob = jobId
    // Costs: a delivered supplier order ($3,650), an order still only a list and a cancelled one (neither is spend), and the
    // crew's pay — 30 squares at $45 = $1,350. Total cost $5,000.
    expect((await order(jobId, 'delivered', 'ABC Supply', [['Architectural shingles', 90, 35], ['Underlayment', 10, 50]])).status).toBe(201)
    expect((await order(jobId, 'not_ordered', 'ABC Supply', [['Ridge vent', 20, 12]])).status).toBe(201)
    expect((await order(jobId, 'cancelled', 'SRS', [['Drip edge', 40, 9]])).status).toBe(201)
    // The carrier's supplements: one approved ($1,200), one waiting ($400).
    const claim = await json(await as('owner')('/api/insurance/claims', { method: 'POST', json: { jobId, claimNumber: 'CLM-1', insuranceCompany: 'Acme Mutual' } }))
    expect(claim.status).toBe(201)
    const sup = async (reason: string, price: number) => (await json(await as('owner')(`/api/insurance/claims/${claim.body.id}/supplements`, { method: 'POST', json: { reason, lineItems: [{ description: reason, qty: 1, unit: 'ea', unitPrice: price }] } }))).body.id as string
    const approved = await sup('Hidden decking rot', 1500)
    const waiting = await sup('Code-required drip edge', 400)
    for (const id of [approved, waiting]) expect((await as('owner')(`/api/insurance/supplements/${id}/submit`, { method: 'POST' })).status).toBe(200)
    expect((await as('owner')(`/api/insurance/supplements/${approved}/approve`, { method: 'POST', json: { approvedAmount: '1200' } })).status).toBe(200)

    // The contract: one invoice, $10,000 before tax. Paying it collects the job and the rep's commissions follow.
    const inv = await sentInvoice(jobId, 10000)
    await pay(inv.id, 10000)
    expect(await settled(jobId, 'collected')).toBe('collected')
    const made = await commissionsAfter(jobId, 2)
    expect(made.length).toBe(2)
    const byPlan = Object.fromEntries(made.map((c) => [c.planId, c]))
    const c8 = byPlan[ids.contractPlan], c25 = byPlan[ids.profitPlan]
    expect([c8.userId, c8.source, c8.status, Number(c8.baseAmount), Number(c8.rateApplied), Number(c8.commissionAmount)]).toEqual([ids.rep, 'auto', 'pending', 10000, 8, 800])
    // Gross profit = $10,000 contract − $3,650 material orders − $1,350 crew pay.
    expect([c25.userId, Number(c25.baseAmount), Number(c25.rateApplied), Number(c25.commissionAmount)]).toEqual([ids.rep, 5000, 25, 1250])
    expect(c25.notes).toContain('gross profit $5,000.00')
    expect(c8.invoiceId).toBe(inv.id)

    // The payment is followed up again (a retried webhook, the office pressing a button): nothing is paid twice.
    await (t.services as any).crm.afterInvoicePaid(inv.id)
    await (t.services as any).crm.commissionEarner.earnForInvoice(inv.id)
    expect((await commissionsOf(jobId)).length).toBe(2)

    // The rep sees what they earned — on the list and on a statement — and sees no one else's.
    const mine = await json(await as('rep')('/api/commissions'))
    expect(mine.status).toBe(200)
    expect(mine.body.data.filter((c: any) => c.jobId === jobId).map((c: any) => Number(c.commissionAmount)).sort((a: number, b: number) => a - b)).toEqual([800, 1250])
    const stmt = await json(await as('rep')('/api/commissions/statement'))
    expect([stmt.status, stmt.body.totals.pending >= 2050]).toEqual([200, true])
    // The owner approves one: the usual order still holds.
    expect((await as('owner')(`/api/commissions/${c8.id}/approve`, { method: 'POST' })).status).toBe(200)
  })

  test('a deposit on a job still being sold or built earns the rep nothing; the balance, once paid, earns on the whole contract', async () => {
    const jobId = await jobAt('signed', '2 Ridge Rd', { assignedSalesRepId: ids.rep })
    const deposit = await sentInvoice(jobId, 2000)
    await pay(deposit.id, 2000)
    await new Promise((r) => setTimeout(r, 300))
    expect(await commissionsOf(jobId)).toEqual([])
    // Built and billed: the balance is the second invoice; paying it collects the job and the 8% is on $8,000, not on the part.
    await t.db.update(t.schema.job).set({ status: 'invoiced' } as any).where(eq(t.schema.job.id, jobId))
    const balance = await sentInvoice(jobId, 6000)
    await pay(balance.id, 6000)
    expect(await settled(jobId, 'collected')).toBe('collected')
    const made = await commissionsAfter(jobId, 1)
    // No crew rate or squares counted against it yet and no orders: gross profit = the contract, so both plans pay on $8,000.
    const contract = made.find((c) => c.planId === ids.contractPlan)!
    expect([Number(contract.baseAmount), Number(contract.commissionAmount)]).toEqual([8000, 640])
  })

  test('a job with no sales rep earns nobody anything', async () => {
    const jobId = await jobAt('invoiced', '3 Gable Ct')
    const inv = await sentInvoice(jobId, 4000)
    await pay(inv.id, 4000)
    expect(await settled(jobId, 'collected')).toBe('collected')
    await new Promise((r) => setTimeout(r, 300))
    expect(await commissionsOf(jobId)).toEqual([])
  })

  test('a job that lost money: the contract plan pays, the gross-profit plan pays nothing', async () => {
    const jobId = await jobAt('invoiced', '4 Soffit St', { assignedSalesRepId: ids.rep })
    expect((await order(jobId, 'ordered', 'ABC Supply', [['Shingles', 100, 30]])).status).toBe(201)
    const inv = await sentInvoice(jobId, 2000)
    await pay(inv.id, 2000)
    expect(await settled(jobId, 'collected')).toBe('collected')
    const made = await commissionsAfter(jobId, 1)
    await new Promise((r) => setTimeout(r, 200))
    const all = await commissionsOf(jobId)
    expect(made.length).toBe(1)
    expect(all.map((c) => [c.planId, Number(c.commissionAmount)])).toEqual([[ids.contractPlan, 160]])
  })

  test('moving a paid job to Collected by hand pays the rep too', async () => {
    const jobId = await jobAt('invoiced', '5 Valley Vw', { assignedSalesRepId: ids.rep })
    // The invoice was paid while the books were being tidied; nobody has moved the job. (Written straight to the table.)
    const [co] = [{ companyId }]
    await t.db.insert(t.schema.invoice).values({
      ...co, contactId: ids.home, jobId, number: 'INV-HAND-1', status: 'paid', subtotal: '3000', total: '3000', taxAmount: '0', amountPaid: '3000', paidAt: new Date(),
    } as any)
    expect(await commissionsOf(jobId)).toEqual([])
    expect((await as('owner')(`/api/jobs/${jobId}/advance`, { method: 'POST' })).status).toBe(200)
    const made = await commissionsAfter(jobId, 2)
    expect(made.map((c) => Number(c.commissionAmount)).sort((a, b) => a - b)).toEqual([240, 750])
  })
})

const round2 = (n: number) => Math.round(n * 100) / 100
describe('the job’s P&L', () => {
  test('job costing carries the material orders placed, the crew’s pay by the square, and the supplements', async () => {
    const detail = await json(await as('owner')(`/api/job-costing/job/${ids.paidJob}`))
    expect(detail.status).toBe(200)
    const b = detail.body
    // Revenue is the invoice before tax; the cost is the material orders that were placed plus the crew; the list and the
    // cancelled order are not spend.
    // The commissions this job's people earned are a cost of it too (roofing parity row 5): $5,000 of work, then the commissions.
    expect(b.actual).toMatchObject({ revenue: 10000, materialCost: 3650, laborCost: 1350 })
    expect(round2(b.actual.totalCost - b.actual.commissionCost)).toBe(5000)
    expect(round2(b.actual.profit + b.actual.commissionCost)).toBe(5000)
    expect(b.roof).toMatchObject({ materialOrderCost: 3650, crewCost: 1350, crewBasis: 'per_square', crewName: 'Ridge Crew', squares: 30, payPerSquare: 45 })
    expect(b.roof.supplements).toMatchObject({ approved: 1200, pending: 400, denied: 0, count: 2 })
    // The estimate is the job's value plus what the carrier approved on top.
    expect(b.estimated.revenue).toBe(13200)
    expect(b.materialOrderDetail.map((o: any) => [o.supplier, o.cost])).toEqual([['ABC Supply', 3650]])
    expect(b.crewDetail).toEqual([{ crew: 'Ridge Crew', squares: 30, payPerSquare: 45, cost: 1350 }])
    expect(b.supplementDetail.map((s: any) => [s.number, s.status, s.approved])).toEqual([['SUP-001', 'approved', 1200], ['SUP-002', 'submitted', null]])

    const summary = await json(await as('owner')('/api/job-costing/summary'))
    const row = summary.body.jobs.find((j: any) => j.id === ids.paidJob)
    expect(summary.status).toBe(200)
    expect([row.invoicedRevenue, row.materialCost, row.laborCost, round2(row.totalCost - row.commissionCost), round2(row.profit + row.commissionCost)]).toEqual([10000, 3650, 1350, 5000, 5000])
    // The roll-up can be read by stage, the roofer’s own filter.
    const collected = await json(await as('owner')('/api/job-costing/summary?status=collected'))
    expect(collected.body.jobs.some((j: any) => j.id === ids.paidJob)).toBe(true)
  })

  test('hours clocked on the job are costed as hours; the crew’s pay is not counted beside them', async () => {
    const jobId = await jobAt('in_production', '6 Fascia Pl', { assignedCrewId: ids.crew })
    await t.db.insert(t.schema.timeEntry).values({ companyId, userId: ids.manager, jobId, hours: '10', hourlyRate: '30' } as any)
    const detail = await json(await as('owner')(`/api/job-costing/job/${jobId}`))
    expect(detail.body.actual).toMatchObject({ laborCost: 300, laborHours: 10 })
    expect(detail.body.roof).toMatchObject({ crewCost: 0, crewBasis: 'clocked' })
    expect(detail.body.crewDetail).toEqual([])
  })

  test('a crew with no rate, or a job with no squares, is “not known” — never a free crew', async () => {
    const [bare] = await t.db.insert(t.schema.crew).values({ companyId, name: 'New Crew', foremanName: 'Nia', foremanPhone: '715-555-0188', size: 3 } as any).returning()
    const jobId = await jobAt('signed', '7 Eave Ave', { assignedCrewId: bare.id })
    const detail = await json(await as('owner')(`/api/job-costing/job/${jobId}`))
    expect(detail.body.roof).toMatchObject({ crewBasis: 'unknown', crewCost: 0, payPerSquare: null })
    expect(detail.body.actual.laborCost).toBe(0)
  })
})

describe('who may, and where it is offered', () => {
  test('a seat without the permission is refused by the server', async () => {
    // The rep (field) reads their own earnings but no plans, no costing, and cannot make or approve anything.
    expect((await as('rep')('/api/commissions/plans')).status).toBe(403)
    expect((await as('rep')('/api/commissions/plans', { method: 'POST', json: { name: 'Mine', planType: 'flat_rate', flatRateAmount: 99999, autoEarn: 'job_sales_rep' } })).status).toBe(403)
    expect((await as('rep')('/api/commissions', { method: 'POST', json: { userId: ids.rep, commissionAmount: 500 } })).status).toBe(403)
    expect((await as('rep')('/api/job-costing/summary')).status).toBe(403)
    expect((await as('rep')(`/api/job-costing/job/${ids.paidJob}`)).status).toBe(403)
    // The office viewer holds neither commissions:read nor reports:read.
    expect((await as('viewer')('/api/commissions/plans')).status).toBe(403)
    expect((await as('viewer')('/api/job-costing/summary')).status).toBe(403)
    // A manager reads the plans and the costing but does not make or change a plan.
    expect((await as('manager')('/api/commissions/plans')).status).toBe(200)
    expect((await as('manager')('/api/job-costing/summary')).status).toBe(200)
    expect((await as('manager')('/api/commissions/plans', { method: 'POST', json: { name: 'Mo', planType: 'flat_rate', flatRateAmount: 5 } })).status).toBe(403)
    expect((await as('manager')(`/api/commissions/plans/${ids.contractPlan}`, { method: 'PUT', json: { percentRate: 50 } })).status).toBe(403)
    // The rep cannot approve their own pay.
    const own = (await commissionsOf(ids.paidJob)).find((c) => c.status === 'pending')!
    expect((await as('rep')(`/api/commissions/${own.id}/approve`, { method: 'POST' })).status).toBe(403)
  })

  test('what a crew is paid is withheld from a seat without margin:read, and not written by one', async () => {
    const asManager = await json(await as('manager')('/api/crews'))
    expect(asManager.body.data.find((c: any) => c.id === ids.crew).payPerSquare).toBe('45.00')
    const asViewer = await json(await as('viewer')('/api/crews'))
    expect(asViewer.status).toBe(200)
    expect('payPerSquare' in asViewer.body.data.find((c: any) => c.id === ids.crew)).toBe(false)
    expect('payPerSquare' in (await json(await as('viewer')(`/api/crews/${ids.crew}`))).body).toBe(false)
    // The job's crew card is stripped the same way; the owner’s is not.
    expect('payPerSquare' in (await json(await as('viewer')(`/api/jobs/${ids.paidJob}`))).body.crew).toBe(false)
    expect((await json(await as('owner')(`/api/jobs/${ids.paidJob}`))).body.crew.payPerSquare).toBe('45.00')
    // A seat that may edit crews (a grant) but holds no margin:read is still refused the rate — and may rename the crew.
    const hash = await Bun.password.hash(PASS, 'bcrypt')
    await t.db.insert(t.schema.user).values({ email: 'lead@test.example', passwordHash: hash, firstName: 'Lou', lastName: 'Lead', role: 'field', companyId, extraPermissions: ['crews:update', 'crews:create'] } as any)
    tokens.lead = await login('lead@test.example', PASS)
    const rate = await json(await as('lead')(`/api/crews/${ids.crew}`, { method: 'PUT', json: { payPerSquare: 1 } }))
    expect([rate.status, rate.body.code]).toEqual([403, 'crew_pay_not_permitted'])
    expect((await as('lead')('/api/crews', { method: 'POST', json: { name: 'Sneaky', foremanName: 'S', foremanPhone: '715-555-0100', size: 2, payPerSquare: 1 } })).status).toBe(403)
    const rename = await json(await as('lead')(`/api/crews/${ids.crew}`, { method: 'PUT', json: { foremanName: 'Raymond' } }))
    expect([rename.status, 'payPerSquare' in rename.body]).toEqual([200, false])
    expect((await t.db.select().from(t.schema.crew).where(eq(t.schema.crew.id, ids.crew)))[0].payPerSquare).toBe('45.00')
  })

  test('with the features off the routes are not there, and a plan that pays the sales rep is refused outside roofing', async () => {
    await setFeatures(['jobs', 'contacts', 'invoices'])
    expect((await as('owner')('/api/commissions')).status).not.toBe(200)
    expect((await as('owner')('/api/job-costing/summary')).status).not.toBe(200)
    // Switched off, a paid job earns nothing (the feature is checked when the commission is worked out).
    const jobId = await jobAt('invoiced', '8 Rake Rd', { assignedSalesRepId: ids.rep })
    const inv = await sentInvoice(jobId, 1000)
    await pay(inv.id, 1000)
    expect(await settled(jobId, 'collected')).toBe('collected')
    await new Promise((r) => setTimeout(r, 300))
    expect(await commissionsOf(jobId)).toEqual([])
    await setFeatures(FEATURES)

    const other = await bootTenant({ vertical: 'contractor' })
    const seeded = await seedOwner(other)
    await other.db.update(other.schema.company).set({ enabledFeatures: ['commission_tracking'] } as any).where(eq(other.schema.company.id, seeded.company.id))
    other.services.features.forgetFeatures()
    const tok = (await (await other.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
    const refused = await other.call('/api/commissions/plans', { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, json: { name: 'Rep', planType: 'percent_of_invoice', percentRate: 5, autoEarn: 'job_sales_rep' } })
    expect(refused.status).toBe(400)
  }, 60_000)
})
