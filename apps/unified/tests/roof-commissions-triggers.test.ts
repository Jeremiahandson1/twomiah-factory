// Earlier commission triggers and pre-commission draws (docs/parity/roof-commissions-costing.md #8, #9; roofing parity row 3),
// through the real server:
//   · a plan is ready on Approved, Completed, Invoiced or — as every plan was — Collected, optionally only at a $0 balance;
//   · an early trigger pays on the contract (or, once the work is Completed, on the gross profit), once, however often the job is
//     followed up, and never on a job that was already past the stage when the plan was switched on;
//   · a draw paid in advance when the job is turned in comes off the commission, which is made once the plan is ready.
// Nothing here reaches Stripe, the Factory or a real tenant.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootRoofKit } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => { k = await bootRoofKit([['est', 'field', 'Eva']]) }, 120_000)
beforeEach(async () => { await k.retireAllPlans() })

const move = (jobId: string, status: string) => k.as('owner')(`/api/jobs/${jobId}`, { method: 'PUT', json: { status } })
const rep8 = (rest: Record<string, unknown>) => k.plan({ name: `Rep 8% ${JSON.stringify(rest)}`, appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 8, autoEarn: 'job_sales_rep', ...rest })
const autoOf = (rows: any[]) => rows.filter((r) => r.source === 'auto')
/** The job is Invoiced, billed `price` and paid in full — which is what moves it to Collected. */
async function billAndPay(jobId: string, price = 10000) {
  expect((await move(jobId, 'invoiced')).status).toBe(200)
  const inv = await k.sentInvoice(jobId, price)
  await k.pay(inv.id, price)
  expect(await k.settled(jobId, 'collected')).toBe('collected')
  return inv
}
async function newJob(address: string, status = 'proposal_sent', value = 10000) {
  return k.jobAt(status, address, { assignedSalesRepId: k.ids.rep, estimatedRevenue: value })
}

describe('a plan names when it is ready', () => {
  test('the trigger is checked: an early one needs a person on the job and cannot be Approved on a profit', async () => {
    expect((await rep8({ triggerOn: 'whenever' })).status).toBe(400)
    expect((await k.plan({ name: 'No role', planType: 'flat_rate', flatRateAmount: 10, autoEarn: 'none', triggerOn: 'approved' })).status).toBe(400)
    expect((await rep8({ triggerOn: 'approved', measuredOn: 'gross_profit' })).status).toBe(400)
    const ok = await rep8({ triggerOn: 'completed', measuredOn: 'gross_profit', zeroBalanceOnly: true })
    expect([ok.status, ok.body.triggerOn, ok.body.zeroBalanceOnly]).toEqual([201, 'completed', true])
    const plain = await rep8({})
    expect([plain.body.triggerOn, plain.body.zeroBalanceOnly]).toEqual(['collected', false])
  })
})

describe('earlier triggers', () => {
  test('Approved: the commission is ready the moment the job is signed, on the contract, once', async () => {
    expect((await rep8({ triggerOn: 'approved' })).status).toBe(201)
    const jobId = await newJob('1 Approved Way')
    expect(await k.commissionsAfter(jobId, 0)).toEqual([])
    expect((await move(jobId, 'signed')).status).toBe(200)
    const made = autoOf(await k.commissionsAfter(jobId, 1))
    expect(made.length).toBe(1)
    expect([Number(made[0].baseAmount), Number(made[0].commissionAmount), made[0].userId]).toEqual([10000, 800, k.ids.rep])
    expect(made[0].notes).toContain('reached Approved')
    expect(made[0].invoiceId).toBeNull()
    // Moved on, back and on again, and the job paid: still the one commission.
    await move(jobId, 'material_ordered'); await move(jobId, 'signed')
    await billAndPay(jobId)
    await k.quiet()
    expect(autoOf(await k.commissionsOf(jobId)).length).toBe(1)
  })

  test('a job already past the stage when the plan was switched on waits to be paid, as before', async () => {
    const jobId = await newJob('2 Older Way', 'in_production')
    expect((await rep8({ triggerOn: 'approved' })).status).toBe(201)
    expect((await move(jobId, 'final_inspection')).status).toBe(200)
    await k.quiet()
    expect(await k.commissionsOf(jobId)).toEqual([])
    const inv = await billAndPay(jobId)
    const made = autoOf(await k.commissionsAfter(jobId, 1))
    expect(made.length).toBe(1)
    expect(made[0].invoiceId).toBe(inv.id)
  })

  test('Completed on gross profit: ready at final inspection, on what the job kept; not at Approved', async () => {
    expect((await rep8({ triggerOn: 'completed', measuredOn: 'gross_profit' })).status).toBe(201)
    const jobId = await newJob('3 Completed Way')
    expect((await k.order(jobId, 'delivered', 'ABC Supply', [['Shingles', 1, 4000]])).status).toBe(201)
    await move(jobId, 'signed'); await k.quiet()
    expect(await k.commissionsOf(jobId)).toEqual([])
    expect((await move(jobId, 'final_inspection')).status).toBe(200)
    const made = autoOf(await k.commissionsAfter(jobId, 1))
    // Contract $10,000 less $4,000 material → gross profit $6,000 → 8% = $480.
    expect([Number(made[0].baseAmount), Number(made[0].commissionAmount)]).toEqual([6000, 480])
    expect(made[0].notes).toContain('reached Completed')
  })

  test('Invoiced: ready when the job is moved to Invoiced; at a $0 balance only, not until every invoice is paid', async () => {
    expect((await rep8({ triggerOn: 'invoiced' })).status).toBe(201)
    const early = await newJob('4 Invoiced Way', 'final_inspection')
    expect((await move(early, 'invoiced')).status).toBe(200)
    expect(autoOf(await k.commissionsAfter(early, 1)).length).toBe(1)

    await k.retireAllPlans()
    expect((await rep8({ triggerOn: 'invoiced', zeroBalanceOnly: true })).status).toBe(201)
    const jobId = await newJob('5 Zero Way', 'final_inspection')
    const inv = await k.sentInvoice(jobId, 10000)
    expect((await move(jobId, 'invoiced')).status).toBe(200)
    await k.quiet()
    expect(await k.commissionsOf(jobId)).toEqual([])
    await k.pay(inv.id, 5000); await k.quiet()
    expect(await k.commissionsOf(jobId)).toEqual([])
    await k.pay(inv.id, 5000)
    const made = autoOf(await k.commissionsAfter(jobId, 1))
    expect(made.length).toBe(1)
    expect(made[0].notes).toContain('nothing owing')
  })

  test('Collected stays the default: nothing is paid before the job is paid in full', async () => {
    expect((await rep8({})).status).toBe(201)
    const jobId = await newJob('6 Default Way')
    await move(jobId, 'signed'); await move(jobId, 'final_inspection'); await move(jobId, 'invoiced'); await k.quiet()
    expect(await k.commissionsOf(jobId)).toEqual([])
    await billAndPay(jobId)
    expect(autoOf(await k.commissionsAfter(jobId, 1)).length).toBe(1)
  })
})

describe('pre-commission draws', () => {
  test('a draw is given once the job is turned in, and comes off the commission', async () => {
    const plan = await rep8({})
    const jobId = await newJob('7 Draw Way', 'proposal_sent')
    const draw = (body: Record<string, unknown>, who = 'owner') =>
      k.as(who)('/api/commission-draws', { method: 'POST', json: { jobId, userId: k.ids.rep, planId: plan.body.id, amount: 300, ...body } })
    // Not turned in yet.
    expect((await draw({})).status).toBe(409)
    await move(jobId, 'signed')
    // Only a seat that may create a commission gives one; the person must hold the plan's role.
    expect((await draw({}, 'rep')).status).toBe(403)
    expect((await draw({ userId: k.ids.est })).status).toBe(400)
    expect((await draw({ amount: 0 })).status).toBe(400)
    const given = await k.json(await draw({}))
    expect([given.status, given.body.source, Number(given.body.commissionAmount), given.body.jobId]).toEqual([201, 'draw', 300, jobId])
    const listed = await k.json(await k.as('manager')(`/api/commission-draws?jobId=${jobId}`))
    expect(listed.body.data.length).toBe(1)

    await billAndPay(jobId)
    const made = autoOf(await k.commissionsAfter(jobId, 2))
    // 8% of $10,000 = $800; $300 drawn → $500 now; the two add up to the commission.
    expect(made.length).toBe(1)
    expect(Number(made[0].commissionAmount)).toBe(500)
    expect(made[0].notes).toContain('$300.00 already drawn')
    const all = (await k.commissionsOf(jobId)).filter((r) => r.status !== 'void')
    expect(all.reduce((sum, r) => sum + Number(r.commissionAmount), 0)).toBe(800)
    // Nothing is left to draw against once the plan has paid.
    expect((await draw({})).status).toBe(409)
  })

  test('a voided draw comes off nothing; a draw as large as the commission leaves nothing more to pay', async () => {
    const plan = await rep8({})
    const voided = await newJob('8 Voided Way', 'signed')
    const given = await k.json(await k.as('owner')('/api/commission-draws', { method: 'POST', json: { jobId: voided, userId: k.ids.rep, planId: plan.body.id, amount: 300 } }))
    expect((await k.as('owner')(`/api/commissions/${given.body.id}/void`, { method: 'POST', json: { reason: 'Given in error' } })).status).toBe(200)
    await billAndPay(voided)
    expect(Number(autoOf(await k.commissionsAfter(voided, 2))[0].commissionAmount)).toBe(800)

    const whole = await newJob('9 Whole Way', 'signed')
    expect((await k.as('owner')('/api/commission-draws', { method: 'POST', json: { jobId: whole, userId: k.ids.rep, planId: plan.body.id, amount: 800 } })).status).toBe(201)
    await billAndPay(whole)
    await k.quiet()
    expect(autoOf(await k.commissionsOf(whole))).toEqual([])
    expect((await k.commissionsOf(whole)).length).toBe(1)
  })
})
