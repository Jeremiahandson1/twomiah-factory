// Worksheet approval before a job's figures count (docs/parity/roof-commissions-costing.md #23; roofing parity row 5), through the
// real server. Off, nothing changes. On (the company's money rule), a job's costing is "waiting for approval" until the owner or an
// admin signs it off, and until then: a commission on profit is not made (a plan on the contract still is, unless the company holds a
// minimum profit), and the job's profit is left out of the job-costing totals and the profit by month — listed, marked not approved.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootRoofKit } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => { k = await bootRoofKit() }, 120_000)

const setRequired = (who: string, on: boolean) => k.as(who)('/api/roof-money/settings', { method: 'PUT', json: { requireWorksheetApproval: on } })
const summary = async () => (await k.json(await k.as('owner')('/api/job-costing/summary'))).body
const worksheet = async (who: string, jobId: string) => k.json(await k.as(who)(`/api/job-worksheet/${jobId}`))
async function paidJob(address: string) {
  const jobId = await k.jobAt('invoiced', address, { assignedSalesRepId: k.ids.rep })
  expect((await k.order(jobId, 'delivered', 'ABC Supply', [['Shingles', 1, 4000]])).status).toBe(201)
  const inv = await k.sentInvoice(jobId, 10000)
  await k.pay(inv.id, 10000)
  expect(await k.settled(jobId, 'collected')).toBe('collected')
  return jobId
}

describe('worksheet approval', () => {
  test('off by default: a job’s profit counts as it always did, and it reads as not required', async () => {
    expect((await k.plan({ name: 'Rep 8% of contract', appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 8, autoEarn: 'job_sales_rep' })).status).toBe(201)
    expect((await k.plan({ name: 'Rep 10% of gross profit', appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'job_sales_rep', measuredOn: 'gross_profit' })).status).toBe(201)
    const jobId = await paidJob('1 Sheet Way')
    expect((await k.commissionsAfter(jobId, 2)).length).toBe(2)
    const s = await worksheet('manager', jobId)
    expect([s.status, s.body.required, s.body.approved]).toEqual([200, false, false])
    expect((await summary()).totals.profit).toBeGreaterThan(0)
    expect((await summary()).jobs.every((j: any) => j.counted)).toBe(true)
    k.ids.offJob = jobId
  })

  test('only a seat that may change commission rules switches it on', async () => {
    expect((await setRequired('manager', true)).status).toBe(403)
    const on = await k.json(await setRequired('owner', true))
    expect([on.status, on.body.requireWorksheetApproval]).toEqual([200, true])
  })

  test('until it is approved: the profit commission waits, the contract one does not, and the job is left out of the totals', async () => {
    const jobId = await paidJob('2 Sheet Way')
    const made = await k.commissionsAfter(jobId, 1)
    await k.quiet()
    const now = await k.commissionsOf(jobId)
    // 8% of the contract is made; the 10%-of-gross-profit plan waits for the figures to count.
    expect(now.map((c) => Number(c.commissionAmount))).toEqual([800])
    expect(made.length).toBe(1)
    const s = await worksheet('owner', jobId)
    expect([s.body.required, s.body.approved]).toEqual([true, false])
    const sum = await summary()
    const row = sum.jobs.find((j: any) => j.id === jobId)
    expect(row.counted).toBe(false)
    // The earlier job (approved nowhere either) is also out: nothing is counted yet.
    expect(sum.unapprovedJobs).toBe(2)
    expect(sum.totals.invoicedRevenue).toBe(0)
    expect(sum.totals.profit).toBe(0)
    const byMonth = await k.json(await k.as('owner')('/api/job-costing/by-category?groupBy=month'))
    expect(byMonth.body.data).toEqual([])
    // The job's own costing still shows its figures — that is what the approver reads — and says the worksheet is waiting.
    const detail = await k.json(await k.as('owner')(`/api/job-costing/job/${jobId}`))
    expect(detail.body.actual.revenue).toBe(10000)
    expect(detail.body.worksheet).toMatchObject({ required: true, approved: false })
    k.ids.sheetJob = jobId
  })

  test('approving needs reports:update (not a manager); it keeps the figures seen, makes the waiting commission and counts the job', async () => {
    const jobId = k.ids.sheetJob
    expect((await k.as('manager')(`/api/job-worksheet/${jobId}/approve`, { method: 'POST', json: {} })).status).toBe(403)
    expect((await k.as('owner')('/api/job-worksheet/no-such-job/approve', { method: 'POST', json: {} })).status).toBe(404)
    const ok = await k.json(await k.as('owner')(`/api/job-worksheet/${jobId}/approve`, { method: 'POST', json: { note: 'Checked against the supplier bills' } }))
    expect([ok.status, ok.body.approved, ok.body.snapshot, ok.body.note]).toEqual([200, true, { revenue: 10000, cost: 4000, profit: 6000 }, 'Checked against the supplier bills'])
    expect(ok.body.approvedByName).toBe('Olive Owner')
    // 10% of the $6,000 gross profit joins the 8% of the contract.
    const made = await k.commissionsAfter(jobId, 2)
    expect(made.map((c) => Number(c.commissionAmount)).sort((a, b) => a - b)).toEqual([600, 800])
    // Approving twice changes nothing.
    expect((await k.as('owner')(`/api/job-worksheet/${jobId}/approve`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await k.commissionsOf(jobId)).length).toBe(2)
    const sum = await summary()
    expect(sum.jobs.find((j: any) => j.id === jobId).counted).toBe(true)
    expect(sum.unapprovedJobs).toBe(1)
    expect(sum.totals.invoicedRevenue).toBe(10000)
    // Commissions are a cost of the job (row 5), so the counted profit is after the $1,400 earned.
    expect(sum.totals.profit).toBe(4600)
    const byMonth = await k.json(await k.as('owner')('/api/job-costing/by-category?groupBy=month'))
    expect(byMonth.body.data.reduce((a: number, r: any) => a + r.jobCount, 0)).toBe(1)
  })

  test('reopening takes the job out of the totals again but never takes a commission back; switching the rule off counts everything', async () => {
    const jobId = k.ids.sheetJob
    expect((await k.as('manager')(`/api/job-worksheet/${jobId}/reopen`, { method: 'POST', json: {} })).status).toBe(403)
    const reopened = await k.json(await k.as('owner')(`/api/job-worksheet/${jobId}/reopen`, { method: 'POST', json: {} }))
    expect([reopened.status, reopened.body.approved]).toEqual([200, false])
    expect((await k.commissionsOf(jobId)).length).toBe(2)
    expect((await summary()).totals.profit).toBe(0)
    expect((await setRequired('owner', false)).status).toBe(200)
    const sum = await summary()
    expect(sum.jobs.every((j: any) => j.counted)).toBe(true)
    expect(sum.totals.invoicedRevenue).toBe(20000)
  })

  test('with a minimum profit, even a plan on the contract waits for the worksheet', async () => {
    expect((await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { requireWorksheetApproval: true, minProfit: { kind: 'percent', value: 10 } } })).status).toBe(200)
    const jobId = await paidJob('3 Sheet Way')
    await k.quiet(); await k.quiet()
    expect(await k.commissionsOf(jobId)).toEqual([])
    expect((await k.as('owner')(`/api/job-worksheet/${jobId}/approve`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await k.commissionsAfter(jobId, 2)).length).toBe(2)
  })
})
