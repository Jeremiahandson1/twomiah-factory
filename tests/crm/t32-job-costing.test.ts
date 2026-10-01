// T32 B3 — job costing was wrong in six different directions at once, and every one of them
// pointed the owner at a profit figure that did not exist.
//
// The scenario below is the report's, built to the same shape: one project carrying TWO jobs, one
// invoice raised against the project, a second invoice raised against one job's quote, a draft
// invoice that is not revenue yet, labour logged at a real rate, an expense, a subcontractor, a
// vendor bill, and a VOID vendor bill that must not count.
//
// What was wrong:
//   (a) revenue was attributed by invoice.projectId, so each of the project's jobs claimed the
//       WHOLE project invoice and the page total counted it once per job — $11,183 became $22,366.
//   (b) vendor bills never reached job costing at all, although /api/bills/summary/job/:id already
//       knew about them, so real spend was missing from cost and inflated profit.
//   (c) the detail priced labour at the entry's rate and the summary priced the SAME hours at a flat
//       $50/h, so one job had two different costs depending which screen you were on.
//   (d) revenue included sales tax, which is the state's money and never the company's.
//   (e) draft invoices counted as revenue, although the rest of invoicing excludes draft and void.
//   (f) the totals row covered only the newest page of jobs (50 by API default, 100 from the
//       screen) out of 118, so the headline figures silently described a subset.
//
// Every assertion here is a figure, not a status code: this is a report, and a report that answers
// 200 with the wrong number is worse than one that fails.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
/** Money comparison in cents — a report that is a tenth of a cent out is still wrong, but 0.1 + 0.2 is not. */
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)
const isMoney = (actual: unknown, expected: number) => cents(actual) === cents(expected)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const {
  company, user, contact, project, quote, invoice, job, timeEntry, expense, vendorBill,
} = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Costing Co', slug: 'costing-co', email: 'cost@test.local', state: 'OH', settings: {},
  enabledFeatures: ['job_costing', 'vendor_bills', 'time_tracking', 'expenses'],
} as any).returning()
// The owner has NO hourly rate — their logged hours are hours nobody can price, which the report
// must say out loud rather than price at an invented default.
const [owner] = await db.insert(user).values({
  email: 'owner-cost@test.local', passwordHash: 'x', firstName: 'Owen', lastName: 'Ward',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [tech] = await db.insert(user).values({
  email: 'tech-cost@test.local', passwordHash: 'x', firstName: 'Tess', lastName: 'Ng',
  role: 'field', companyId: co.id, isActive: true, hourlyRate: '28.75',
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Harbour Mills', type: 'customer',
} as any).returning()
const [vendorCo] = await db.insert(contact).values({
  companyId: co.id, name: 'Acme Supply', type: 'vendor',
} as any).returning()

const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Mill Refit', number: 'PRJ-COST-1', status: 'active',
} as any).returning()

const mkQuote = async (number: string, total: number) => (await db.insert(quote).values({
  companyId: co.id, contactId: client.id, projectId: proj.id, number, name: number,
  status: 'approved', subtotal: total.toFixed(2), total: total.toFixed(2),
} as any).returning())[0]
const q1 = await mkQuote('QT-C1', 9000)
const q2 = await mkQuote('QT-C2', 2000)

const COMPLETED = new Date('2026-09-15T15:00:00Z')
const mkJob = async (number: string, opts: Record<string, unknown> = {}) => (await db.insert(job).values({
  companyId: co.id, contactId: client.id, number, title: `Work ${number}`,
  status: 'completed', completedAt: COMPLETED, ...opts,
} as any).returning())[0]

// Two jobs on ONE project — the shape that made the invoice count twice.
const j1 = await mkJob('JOB-C1', { projectId: proj.id, quoteId: q1.id, estimatedValue: '9000.00', estimatedHours: '10.00' })
const j2 = await mkJob('JOB-C2', { projectId: proj.id, quoteId: q2.id, estimatedValue: '2000.00' })
// Three more jobs so a page smaller than the job list can be asked for (fault f).
const spare = [await mkJob('JOB-C3'), await mkJob('JOB-C4'), await mkJob('JOB-C5')]

// ── revenue ───────────────────────────────────────────────────────────────────────────────────────
const mkInvoice = async (number: string, v: { subtotal: number; tax: number; status: string; projectId?: string; quoteId?: string }) =>
  (await db.insert(invoice).values({
    companyId: co.id, contactId: client.id, number, status: v.status,
    subtotal: v.subtotal.toFixed(2), taxAmount: v.tax.toFixed(2), taxRate: '5.50',
    total: (v.subtotal + v.tax).toFixed(2), amountPaid: '0',
    projectId: v.projectId ?? null, quoteId: v.quoteId ?? null,
  } as any).returning())[0]

// The project invoice: raised against the project, belonging to neither job on its own.
const invProject = await mkInvoice('INV-C1', { subtotal: 10600, tax: 583, status: 'sent', projectId: proj.id })
// JOB-C2's own invoice: it carries the project too, so it is ALSO in the project pool — it must be
// attributed to JOB-C2 once and must not also be shared back out to JOB-C1.
const invJob2 = await mkInvoice('INV-C2', { subtotal: 2000, tax: 100, status: 'paid', projectId: proj.id, quoteId: q2.id })
// Not revenue: a draft nobody has sent, and a void invoice.
await mkInvoice('INV-C3', { subtotal: 5000, tax: 0, status: 'draft', projectId: proj.id })
await mkInvoice('INV-C4', { subtotal: 4000, tax: 0, status: 'void', projectId: proj.id })

// ── cost on JOB-C1 ────────────────────────────────────────────────────────────────────────────────
// 12 hours by the tech with no rate on the entry → priced from the tech's own $28.75 = $345.00
await db.insert(timeEntry).values({
  companyId: co.id, userId: tech.id, jobId: j1.id, hours: '12.00', date: COMPLETED, description: 'Strip and prep',
} as any)
// 4 hours by the owner, who has no rate anywhere → $0, and the report must disclose the 4 hours.
await db.insert(timeEntry).values({
  companyId: co.id, userId: owner.id, jobId: j1.id, hours: '4.00', date: COMPLETED, description: 'Site visit',
} as any)
await db.insert(expense).values({
  companyId: co.id, jobId: j1.id, date: COMPLETED, category: 'materials', amount: '11.40', description: 'Fixings',
} as any)
await db.insert(expense).values({
  companyId: co.id, jobId: j1.id, date: COMPLETED, category: 'subcontractor', amount: '500.00', description: 'Crane hire',
} as any)
const mkBill = async (number: string, amount: number, status: string) => (await db.insert(vendorBill).values({
  companyId: co.id, vendorId: vendorCo.id, jobId: j1.id, number, amount: amount.toFixed(2),
  amountPaid: '0', status, billDate: COMPLETED,
} as any).returning())[0]
await mkBill('AC-5512', 1974.12, 'open')
await mkBill('AC-5513', 900, 'void') // void money is not spend

const LABOUR = 345.00
const EXPENSES = 511.40
const BILLED = 1974.12
const J1_COST = LABOUR + EXPENSES + BILLED // 2830.52
const PROJECT_REV = 10600 // ex-tax
const JOB2_REV = 2000     // ex-tax
const ALL_REV = PROJECT_REV + JOB2_REV

const app = new Hono()
app.route('/api/job-costing', (await import('./src/routes/jobCosting.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ══════════ (a) one invoice, counted once ═══════════════════════════════════════════════════════
{
  const r = await get('/api/job-costing/summary?limit=100')
  check('the summary answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })
  const rows: any[] = r.json?.jobs || []
  const row1 = rows.find((x) => x.number === 'JOB-C1')
  const row2 = rows.find((x) => x.number === 'JOB-C2')

  check('the project invoice is counted ONCE in the page total, not once per job',
    isMoney(r.json?.totals?.invoicedRevenue, ALL_REV),
    { total: r.json?.totals?.invoicedRevenue, expected: ALL_REV, doubleCounted: PROJECT_REV * 2 + JOB2_REV })

  check('…each job still shows the project invoice it shares',
    isMoney(row1?.invoicedRevenue, PROJECT_REV) && isMoney(row2?.invoicedRevenue, PROJECT_REV + JOB2_REV),
    { 'JOB-C1': row1?.invoicedRevenue, 'JOB-C2': row2?.invoicedRevenue })

  check('…and says how much of its revenue is shared, so two jobs showing the same money is explained',
    isMoney(row1?.sharedRevenue, PROJECT_REV) && isMoney(row2?.directRevenue, JOB2_REV),
    { shared1: row1?.sharedRevenue, direct2: row2?.directRevenue })

  check('an invoice raised on a job\'s own quote is that job\'s alone, never shared back out',
    isMoney(row1?.directRevenue, 0), { direct1: row1?.directRevenue })
}

// ══════════ (d) + (e) sales tax is not revenue, and a draft is not revenue ══════════════════════
{
  const r = await get('/api/job-costing/summary?limit=100')
  check('sales tax is excluded from revenue — it is the state\'s money, not the company\'s',
    isMoney(r.json?.totals?.invoicedRevenue, ALL_REV),
    { withTax: ALL_REV + 683, got: r.json?.totals?.invoicedRevenue })
  const d = await get(`/api/job-costing/job/${j1.id}`)
  check('a draft invoice is not revenue (the rule invoicing already uses)',
    isMoney(d.json?.actual?.revenue, PROJECT_REV), { got: d.json?.actual?.revenue, draftWouldAdd: 5000 })
  check('…and neither is a void one', isMoney(d.json?.actual?.revenue, PROJECT_REV), d.json?.actual?.revenue)
  check('…and the tax that was excluded is reported, not just dropped',
    isMoney(d.json?.actual?.salesTax, 583), { salesTax: d.json?.actual?.salesTax })
}

// ══════════ (b) vendor bills are cost ══════════════════════════════════════════════════════════
{
  const d = await get(`/api/job-costing/job/${j1.id}`)
  check('vendor bills reach job costing', isMoney(d.json?.actual?.billedCost, BILLED),
    { billedCost: d.json?.actual?.billedCost, expected: BILLED })
  check('…a VOID bill is not spend', isMoney(d.json?.actual?.billedCost, BILLED), d.json?.actual?.billedCost)
  check('…and they are in the total cost', isMoney(d.json?.actual?.totalCost, J1_COST),
    { totalCost: d.json?.actual?.totalCost, expected: J1_COST })
  check('…with the bills listed, so the figure can be checked against the vendor',
    (d.json?.billDetail || []).length === 1 && d.json.billDetail[0].number === 'AC-5512',
    d.json?.billDetail)
}

// ══════════ (c) one job, ONE cost ══════════════════════════════════════════════════════════════
{
  const d = await get(`/api/job-costing/job/${j1.id}`)
  const s = await get('/api/job-costing/summary?limit=100')
  const row1 = (s.json?.jobs || []).find((x: any) => x.number === 'JOB-C1')

  check('labour is priced at the rate on the entry, falling back to the person\'s own rate',
    isMoney(d.json?.actual?.laborCost, LABOUR), { laborCost: d.json?.actual?.laborCost, expected: LABOUR })
  check('…the summary agrees with the detail to the cent',
    isMoney(row1?.totalCost, d.json?.actual?.totalCost),
    { summary: row1?.totalCost, detail: d.json?.actual?.totalCost, oldFlatRate: 16 * 50 + EXPENSES })
  check('…so the flat $50/hour is gone', !isMoney(row1?.totalCost, 16 * 50 + EXPENSES), row1?.totalCost)
  check('hours nobody can price are reported as such, not priced at a number we made up',
    Number(d.json?.actual?.unratedLaborHours || 0) === 4 && isMoney(d.json?.actual?.laborCost, LABOUR),
    { unrated: d.json?.actual?.unratedLaborHours, laborCost: d.json?.actual?.laborCost })
  check('…and the summary row carries the same disclosure',
    Number(row1?.unratedLaborHours || 0) === 4, row1?.unratedLaborHours)
  check('all 16 hours are still counted as hours', Number(d.json?.actual?.laborHours) === 16, d.json?.actual?.laborHours)
}

// ══════════ (f) the totals describe every job, not the newest page ═════════════════════════════
{
  const r = await get('/api/job-costing/summary?limit=2')
  check('a smaller page returns a smaller page', (r.json?.jobs || []).length === 2, (r.json?.jobs || []).length)
  check('…but the totals still cover every job that matched',
    isMoney(r.json?.totals?.invoicedRevenue, ALL_REV) && isMoney(r.json?.totals?.totalCost, J1_COST),
    { revenue: r.json?.totals?.invoicedRevenue, cost: r.json?.totals?.totalCost })
  check('…and the count is the number of jobs, not the size of the page',
    r.json?.count === 5, { count: r.json?.count })
  check('…and the page says it is a page', r.json?.returned === 2 && r.json?.truncated === true,
    { returned: r.json?.returned, truncated: r.json?.truncated })
}

// ══════════ by month — the table that read all zeros ═══════════════════════════════════════════
{
  const r = await get('/api/job-costing/by-category?groupBy=month')
  check('by-category answers', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })
  const sept = (Array.isArray(r.json) ? r.json : []).find((g: any) => g.key === '2026-09')
  check('the month the work completed is there with all five jobs', sept?.jobCount === 5, r.json)
  check('…with the revenue the roll-up shows, counted once', isMoney(sept?.revenue, ALL_REV),
    { revenue: sept?.revenue, expected: ALL_REV })
  check('…and the cost the roll-up shows, bills and real rates included', isMoney(sept?.cost, J1_COST),
    { cost: sept?.cost, expected: J1_COST, oldFlatRate: 16 * 50 + EXPENSES })
  check('…so the By month table reconciles with the totals above it',
    isMoney(sept?.profit, ALL_REV - J1_COST), { profit: sept?.profit, expected: ALL_REV - J1_COST })
}

// ══════════ the status filter means the same thing on both halves of the screen ════════════════
{
  // The roll-up's status dropdown filters the job table; the month table must obey it too, or the
  // two tables on one screen describe different sets of jobs and neither reconciles.
  await db.insert(job).values({
    companyId: co.id, contactId: client.id, number: 'JOB-C6', title: 'Still running',
    status: 'in_progress', projectId: null,
  } as any)
  const all = await get('/api/job-costing/by-category?groupBy=month')
  const allJobs = (Array.isArray(all.json) ? all.json : []).reduce((n: number, g: any) => n + g.jobCount, 0)
  check('with no status filter, by month covers every job', allJobs === 6, { allJobs })
  const done = await get('/api/job-costing/by-category?groupBy=month&status=completed')
  const doneJobs = (Array.isArray(done.json) ? done.json : []).reduce((n: number, g: any) => n + g.jobCount, 0)
  check('…and honours the status the roll-up was filtered by', doneJobs === 5, { doneJobs })
}

// ══════════ scoping — a report is still a tenant boundary ══════════════════════════════════════
{
  const [other] = await db.insert(company).values({
    name: 'Other Co', slug: 'other-cost', email: 'other@test.local', state: 'OH', settings: {},
    enabledFeatures: ['job_costing'],
  } as any).returning()
  const [otherJob] = await db.insert(job).values({
    companyId: other.id, number: 'JOB-X1', title: 'Theirs', status: 'completed', completedAt: COMPLETED,
  } as any).returning()
  const r = await get(`/api/job-costing/job/${otherJob.id}`)
  check('another tenant\'s job is not found, not 500 and not answered', r.status === 404, { status: r.status })
  const s = await get('/api/job-costing/summary?limit=100')
  check('…and it is not in the roll-up', !(s.json?.jobs || []).some((x: any) => x.number === 'JOB-X1'), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
