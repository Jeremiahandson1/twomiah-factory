// What a full refund of an EARLIER invoice does to a roofing job's commission (docs/parity/roof-commissions-costing.md #14; roofing
// parity row 4). The decision: a Collected commission is worked out on the job paid in full and hangs on the last invoice paid. The
// shared earner takes it back when THAT invoice is refunded in full; now the same happens when ANY other invoice of the job is
// refunded in full — the job is no longer paid in full. A commission not yet paid out is cancelled; one already paid out gets a
// negative line. A PARTIAL refund changes nothing, and a commission made at an earlier trigger (not hung on an invoice) and a draw
// are not touched.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { bootRoofKit } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => { k = await bootRoofKit() }, 120_000)
beforeEach(async () => { await k.retireAllPlans() })

const rep8 = (rest: Record<string, unknown> = {}) => k.plan({ name: `Rep 8% ${Math.random()}`, appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 8, autoEarn: 'job_sales_rep', ...rest })
const refund = (invoiceId: string, amount: number) => k.as('owner')(`/api/invoices/${invoiceId}/refund`, { method: 'POST', json: { amount, reason: 'Customer cancelled this part' } })
/** A job with an earlier invoice ($4,000) and a last one ($6,000), both paid, so it is Collected and the commission hangs on the last. */
async function twoInvoiceJob(address: string) {
  const jobId = await k.jobAt('invoiced', address, { assignedSalesRepId: k.ids.rep })
  const early = await k.sentInvoice(jobId, 4000)
  const last = await k.sentInvoice(jobId, 6000)
  await k.pay(early.id, 4000)
  await k.pay(last.id, 6000)
  expect(await k.settled(jobId, 'collected')).toBe('collected')
  const made = (await k.commissionsAfter(jobId, 1)).filter((c) => c.source === 'auto')
  expect(made.length).toBe(1)
  expect([Number(made[0].commissionAmount), made[0].invoiceId]).toEqual([800, last.id])
  return { jobId, early, last, commission: made[0] }
}
const live = async (jobId: string) => (await k.commissionsOf(jobId))

describe('a refund of an earlier invoice', () => {
  test('a partial refund changes nothing; a full one cancels the commission that was not yet paid out', async () => {
    await rep8()
    const { jobId, early } = await twoInvoiceJob('1 Refund Way')
    expect((await refund(early.id, 1000)).status).toBe(200)
    await k.quiet()
    expect((await live(jobId)).map((c) => c.status)).toEqual(['pending'])
    expect((await refund(early.id, 3000)).status).toBe(200)
    await k.quiet()
    const rows = await live(jobId)
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('cancelled')
    expect(rows[0].notes).toContain('was refunded in full')
    // It is not earned again by the next follow-up.
    await (k.t.services as any).crm.afterInvoicePaid(early.id)
    await k.quiet()
    expect((await live(jobId)).length).toBe(1)
  })

  test('a commission already paid out gets a negative line of the same size', async () => {
    await rep8()
    const { jobId, early, commission } = await twoInvoiceJob('2 Refund Way')
    expect((await k.as('owner')(`/api/commissions/${commission.id}/approve`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await k.as('owner')(`/api/commissions/${commission.id}/mark-paid`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await refund(early.id, 4000)).status).toBe(200)
    await k.quiet()
    const rows = await live(jobId)
    expect(rows.length).toBe(2)
    const back = rows.find((r) => r.source === 'reversal')!
    expect([Number(back.commissionAmount), back.reversalOf]).toEqual([-800, commission.id])
    expect(rows.find((r) => r.id === commission.id)!.status).toBe('paid')
    // The follow-up again takes nothing twice.
    await (k.t.services as any).crm.afterInvoicePaid(early.id)
    await k.quiet()
    expect((await live(jobId)).length).toBe(2)
  })

  test('the last invoice refunded in full still takes it back, as before', async () => {
    await rep8()
    const { jobId, last } = await twoInvoiceJob('3 Refund Way')
    expect((await refund(last.id, 6000)).status).toBe(200)
    await k.quiet()
    expect((await live(jobId)).map((c) => c.status)).toEqual(['cancelled'])
  })

  test('a commission made at an earlier trigger is not taken back', async () => {
    const plan = await rep8({ triggerOn: 'approved' })
    expect(plan.status).toBe(201)
    const jobId = await k.jobAt('proposal_sent', '4 Refund Way', { assignedSalesRepId: k.ids.rep, estimatedRevenue: 10000 })
    expect((await k.as('owner')(`/api/jobs/${jobId}`, { method: 'PUT', json: { status: 'signed' } })).status).toBe(200)
    expect((await k.commissionsAfter(jobId, 1)).length).toBe(1)
    // Nothing is left to draw against: the Approved trigger has paid it.
    expect((await k.as('owner')('/api/commission-draws', { method: 'POST', json: { jobId, userId: k.ids.rep, planId: plan.body.id, amount: 100 } })).status).toBe(409)
    expect((await k.as('owner')(`/api/jobs/${jobId}`, { method: 'PUT', json: { status: 'invoiced' } })).status).toBe(200)
    const early = await k.sentInvoice(jobId, 4000)
    const last = await k.sentInvoice(jobId, 6000)
    await k.pay(early.id, 4000); await k.pay(last.id, 6000)
    expect(await k.settled(jobId, 'collected')).toBe('collected')
    expect((await refund(early.id, 4000)).status).toBe(200)
    await k.quiet()
    const rows = await live(jobId)
    expect(rows.map((r) => [r.source, r.status])).toEqual([['auto', 'pending']])
  })

  test('a draw already paid out stays when an earlier invoice is refunded', async () => {
    const plan = await rep8()
    const jobId = await k.jobAt('signed', '5 Refund Way', { assignedSalesRepId: k.ids.rep })
    expect((await k.as('owner')('/api/commission-draws', { method: 'POST', json: { jobId, userId: k.ids.rep, planId: plan.body.id, amount: 100 } })).status).toBe(201)
    expect((await k.as('owner')(`/api/jobs/${jobId}`, { method: 'PUT', json: { status: 'invoiced' } })).status).toBe(200)
    const early = await k.sentInvoice(jobId, 4000)
    const last = await k.sentInvoice(jobId, 6000)
    await k.pay(early.id, 4000); await k.pay(last.id, 6000)
    expect(await k.settled(jobId, 'collected')).toBe('collected')
    const made = await k.commissionsAfter(jobId, 2)
    expect(made.map((r) => [r.source, Number(r.commissionAmount)]).sort()).toEqual([['auto', 700], ['draw', 100]])
    expect((await refund(early.id, 4000)).status).toBe(200)
    await k.quiet()
    expect((await live(jobId)).map((r) => [r.source, r.status]).sort()).toEqual([['auto', 'cancelled'], ['draw', 'pending']])
  })
})
