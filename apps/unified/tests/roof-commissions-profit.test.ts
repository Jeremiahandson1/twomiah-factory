// Commission rules on PROFIT (docs/parity/roof-commissions-costing.md #5 and #6; roofing parity row 1), through the real server:
//   · a plan can be MEASURED ON the job's gross profit — a percentage, or the brackets of a tiered plan — not only the contract
//     (AccuLynx: different rates by job-profit threshold); the same brackets read against the contract pay differently;
//   · the COMPANY'S MINIMUM PROFIT, in percent or in dollars, below which a plan pays nothing (AccuLynx), set by an owner/admin only.
// Nothing here reaches Stripe, the Factory or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootRoofKit } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => { k = await bootRoofKit() }, 120_000)

const BRACKETS = [{ min: 0, max: 4999.99, rate: 5 }, { min: 5000, max: 1000000, rate: 8 }]

/** A collected job: `contract` invoiced and paid, and one delivered supplier order of `material` dollars against it. */
async function paidJob(address: string, contract: number, material: number) {
  const jobId = await k.jobAt('invoiced', address, { assignedSalesRepId: k.ids.rep })
  if (material) expect((await k.order(jobId, 'delivered', 'ABC Supply', [['Shingles', 1, material]])).status).toBe(201)
  const inv = await k.sentInvoice(jobId, contract)
  await k.pay(inv.id, contract)
  expect(await k.settled(jobId, 'collected')).toBe('collected')
  return jobId
}
const amounts = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.planId, [Number(r.baseAmount), Number(r.rateApplied), Number(r.commissionAmount)]]))

describe('brackets and percentages measured on the job’s gross profit', () => {
  test('a plan names what it is measured on; a profit plan with no automatic seller is refused', async () => {
    const tiers = await k.plan({ name: 'Profit brackets', planType: 'tiered', tiers: BRACKETS, appliesToRole: 'sales_rep', autoEarn: 'job_sales_rep', measuredOn: 'gross_profit' })
    expect([tiers.status, tiers.body.measuredOn, tiers.body.planType]).toEqual([201, 'gross_profit', 'tiered'])
    const onContract = await k.plan({ name: 'Contract brackets', planType: 'tiered', tiers: BRACKETS, appliesToRole: 'sales_rep', autoEarn: 'job_sales_rep' })
    expect([onContract.status, onContract.body.measuredOn]).toEqual([201, 'contract'])
    const pct = await k.plan({ name: '20% of profit', planType: 'percent_of_invoice', percentRate: 20, appliesToRole: 'sales_rep', autoEarn: 'job_sales_rep', measuredOn: 'gross_profit' })
    expect([pct.status, pct.body.measuredOn]).toEqual([201, 'gross_profit'])
    k.ids.profitTiers = tiers.body.id; k.ids.contractTiers = onContract.body.id; k.ids.profitPct = pct.body.id
    // Measured on profit, but nobody is paid automatically: nothing could work the profit out, so the plan is refused.
    const bare = await k.plan({ name: 'Nobody', planType: 'percent_of_invoice', percentRate: 5, autoEarn: 'none', measuredOn: 'gross_profit' })
    expect([bare.status, typeof bare.body.error]).toEqual([400, 'string'])
    // …and a plan edited to it is refused the same way.
    const edit = await k.json(await k.as('owner')(`/api/commissions/plans/${k.ids.contractTiers}`, { method: 'PUT', json: { autoEarn: 'none', measuredOn: 'gross_profit' } }))
    expect(edit.status).toBe(400)
  })

  test('profit $5,000 falls in the upper bracket (8% of profit), profit $3,000 in the lower (5%); the contract plan reads $10,000 both times', async () => {
    const a = await paidJob('1 Profit Way', 10000, 5000)
    const made = await k.commissionsAfter(a, 3)
    expect(made.length).toBe(3)
    const byPlan = amounts(made)
    expect(byPlan[k.ids.profitTiers]).toEqual([5000, 8, 400])
    expect(byPlan[k.ids.profitPct]).toEqual([5000, 20, 1000])
    // The same brackets read against the contract: $10,000 is in the upper bracket → 8% of $10,000.
    expect(byPlan[k.ids.contractTiers]).toEqual([10000, 8, 800])
    const note = made.find((c) => c.planId === k.ids.profitTiers)!.notes
    expect(note).toContain('gross profit $5,000.00')

    const b = await paidJob('2 Profit Way', 10000, 7000)
    const byPlanB = amounts(await k.commissionsAfter(b, 3))
    expect(byPlanB[k.ids.profitTiers]).toEqual([3000, 5, 150])
    expect(byPlanB[k.ids.profitPct]).toEqual([3000, 20, 600])
    expect(byPlanB[k.ids.contractTiers]).toEqual([10000, 8, 800])
  })

  test('a job whose profit is outside every bracket, or nothing, earns nothing on a profit plan while the contract plan pays', async () => {
    const c = await paidJob('3 Profit Way', 4000, 5000) // lost $1,000
    await k.quiet()
    const rows = await k.commissionsAfter(c, 1)
    expect(rows.map((r) => r.planId)).toEqual([k.ids.contractTiers])
  })
})

describe('the company’s minimum profit', () => {
  test('only an owner or admin sets it, and it is checked for what it says', async () => {
    expect((await k.as('manager')('/api/roof-money/settings')).status).toBe(200)
    expect((await k.as('rep')('/api/roof-money/settings')).status).toBe(403)
    expect((await k.as('manager')('/api/roof-money/settings', { method: 'PUT', json: { minProfit: { kind: 'percent', value: 20 } } })).status).toBe(403)
    expect((await k.as('rep')('/api/roof-money/settings', { method: 'PUT', json: { minProfit: { kind: 'percent', value: 20 } } })).status).toBe(403)
    const bad = await k.json(await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { minProfit: { kind: 'percent', value: 140 } } }))
    expect([bad.status, typeof bad.body.error]).toEqual([400, 'string'])
    const badKind = await k.json(await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { minProfit: { kind: 'stars', value: 5 } } }))
    expect(badKind.status).toBe(400)
  })

  test('a minimum of 40% of the contract: a job at 30% pays no plan, a job at 50% pays them all', async () => {
    const set = await k.json(await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { minProfit: { kind: 'percent', value: 40 } } }))
    expect([set.status, set.body.minProfit]).toEqual([200, { kind: 'percent', value: 40 }])
    const low = await paidJob('4 Floor Ave', 10000, 7000) // profit 30%
    await k.quiet(400)
    expect(await k.commissionsOf(low)).toEqual([])
    const high = await paidJob('5 Floor Ave', 10000, 5000) // profit 50%
    expect((await k.commissionsAfter(high, 3)).length).toBe(3)
  })

  test('a minimum of $4,000: $3,000 profit pays nothing, $5,000 pays; removing the minimum pays again', async () => {
    expect((await k.json(await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { minProfit: { kind: 'amount', value: 4000 } } }))).status).toBe(200)
    const low = await paidJob('6 Floor Ave', 10000, 7000)
    await k.quiet(400)
    expect(await k.commissionsOf(low)).toEqual([])
    const high = await paidJob('7 Floor Ave', 10000, 5000)
    expect((await k.commissionsAfter(high, 3)).length).toBe(3)
    // The floor is the company's: taking it away, the held job pays when the office moves it again.
    expect((await k.json(await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { minProfit: null } }))).body.minProfit).toBeNull()
    const other = await paidJob('8 Floor Ave', 10000, 7000)
    expect((await k.commissionsAfter(other, 3)).length).toBe(3)
  })
})
