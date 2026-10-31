// The roofing job P&L (docs/parity/roof-commissions-costing.md #20, #16, #22, #23; roofing parity row 5), through the real server.
//   · commissions a job's people earned are a COST of the job: the Job Costing screen's cost and profit are after them, and the
//     lines behind them go only to a seat that reads commissions;
//   · a commission on profit is worked out on the profit BEFORE commissions, so a payout never reduces its own base (no circle),
//     however often the job is followed up and whoever is added late.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootRoofKit } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => { k = await bootRoofKit([['est', 'field', 'Eva'], ['sm', 'manager', 'Sam']]) }, 120_000)

const analysis = async (who: string, jobId: string) => k.json(await k.as(who)(`/api/job-costing/job/${jobId}`))

describe('commissions are a cost of the job', () => {
  test('gross-profit and net-profit plans pay on the profit before commissions; the screen shows the cost and profit after them', async () => {
    expect((await k.plan({ name: 'Rep 10% of gross profit', appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'job_sales_rep', measuredOn: 'gross_profit' })).status).toBe(201)
    expect((await k.plan({ name: 'Sales manager 10% of net profit', appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'job_sales_manager', measuredOn: 'net_profit' })).status).toBe(201)
    expect((await k.plan({ name: 'Estimator 10% of gross profit', appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 10, autoEarn: 'job_estimator', measuredOn: 'gross_profit' })).status).toBe(201)
    const jobId = await k.jobAt('invoiced', '1 PL Way', { assignedSalesRepId: k.ids.rep })
    expect((await k.as('manager')(`/api/job-people/${jobId}`, { method: 'PUT', json: { people: [{ role: 'sales_manager', userId: k.ids.sm }] } })).status).toBe(200)
    expect((await k.order(jobId, 'delivered', 'ABC Supply', [['Shingles', 1, 4000]])).status).toBe(201)
    const inv = await k.sentInvoice(jobId, 10000)
    await k.pay(inv.id, 10000)
    expect(await k.settled(jobId, 'collected')).toBe('collected')
    const made = await k.commissionsAfter(jobId, 2)
    const by = Object.fromEntries(made.map((c) => [c.userId, Number(c.commissionAmount)]))
    // Gross profit $10,000 − $4,000 = $6,000 → rep 10% = $600; net = $6,000 − $600 = $5,400 → 10% = $540.
    expect(by[k.ids.rep]).toBe(600)
    expect(by[k.ids.sm]).toBe(540)

    const a = await analysis('owner', jobId)
    expect(a.status).toBe(200)
    expect(a.body.actual.commissionCost).toBe(1140)
    expect(a.body.actual.totalCost).toBe(5140)
    expect(a.body.actual.profit).toBe(4860)
    expect(a.body.roof.commissionCost).toBe(1140)
    // The estimate has no commission in it, so the variance is the work's: materials only.
    expect(a.body.variance.cost).toBe(4000)
    // The roll-up agrees.
    const sum = await k.json(await k.as('owner')('/api/job-costing/summary'))
    expect(sum.body.jobs.find((j: any) => j.id === jobId).profit).toBe(4860)
    k.ids.plJob = jobId
  })

  test('following the job up again, or adding a person late, never works a commission on the profit left after commissions', async () => {
    const jobId = k.ids.plJob
    await (k.t.services as any).crm.afterInvoicePaid((await k.t.db.select().from(k.t.schema.invoice))[0].id)
    expect((await k.commissionsOf(jobId)).length).toBe(2)
    // A new estimator on a 10%-of-gross-profit plan is paid $600 (10% of $6,000), not $486 (10% of the $4,860 left after commissions).
    expect((await k.as('manager')(`/api/job-people/${jobId}`, { method: 'PUT', json: { people: [{ role: 'sales_manager', userId: k.ids.sm }, { role: 'estimator', userId: k.ids.est }] } })).status).toBe(200)
    const made = await k.commissionsAfter(jobId, 3)
    expect(Number(made.find((c) => c.userId === k.ids.est)!.commissionAmount)).toBe(600)
    const a = await analysis('owner', jobId)
    expect(a.body.actual.commissionCost).toBe(1740)
    expect(a.body.actual.profit).toBe(4260)
  })

  test('a voided commission is no longer a cost; the lines behind the cost go only to a seat that reads commissions', async () => {
    const jobId = k.ids.plJob
    const est = (await k.commissionsOf(jobId)).find((c) => c.userId === k.ids.est)!
    const asManager = await analysis('manager', jobId)
    expect(asManager.body.commissionDetail.map((r: any) => [r.person, r.amount]).sort()).toEqual([['Eva Seat', 600], ['Rita Seat', 600], ['Sam Seat', 540]])
    // The company takes commissions away from the manager: the total stays in the cost, the people do not.
    expect((await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { commissionViewerRoles: [] } })).status).toBe(200)
    const blind = await analysis('manager', jobId)
    expect(blind.status).toBe(200)
    expect(blind.body.actual.commissionCost).toBe(1740)
    expect(blind.body.commissionDetail).toBeUndefined()
    expect((await k.as('owner')('/api/roof-money/settings', { method: 'PUT', json: { commissionViewerRoles: ['manager'] } })).status).toBe(200)

    expect((await k.as('owner')(`/api/commissions/${est.id}/void`, { method: 'POST', json: { reason: 'Wrong person' } })).status).toBe(200)
    const a = await analysis('owner', jobId)
    expect(a.body.actual.commissionCost).toBe(1140)
    expect(a.body.actual.profit).toBe(4860)
  })
})

describe('a crew’s lump-sum price from a work order is the job’s labour', () => {
  const makeOrder = (who: string, jobId: string, extra: Record<string, unknown> = {}) =>
    k.as(who)('/api/work-orders', { method: 'POST', json: { jobId, title: 'Tear off and re-roof', recipientName: 'Ray', recipientPhone: '715-555-0199', ...extra } })
  const roofOf = async (jobId: string) => (await analysis('owner', jobId)).body

  test('a sent work order with a price replaces the pay by the square; a draft, a cancelled one, and a seat without margin:read do not', async () => {
    const crew = await k.json(await k.as('owner')('/api/crews', { method: 'POST', json: { name: 'Ridge Crew', foremanName: 'Ray', foremanPhone: '715-555-0199', size: 4, payPerSquare: 45 } }))
    expect(crew.status).toBe(201)
    const jobId = await k.jobAt('in_production', '2 Crew Way', { assignedCrewId: crew.body.id, totalSquares: 30 })
    // No work order: the crew is paid by the square — 30 squares × $45.
    let b = await roofOf(jobId)
    expect([b.roof.crewBasis, b.roof.crewCost]).toEqual(['per_square', 1350])

    // Only a seat that reads what the shop pays sets or sees the price.
    expect((await makeOrder('rep', jobId, { price: 2000 })).status).toBe(403)
    const made = await k.json(await makeOrder('owner', jobId, { price: 2000, crewId: crew.body.id }))
    expect([made.status, made.body.price, made.body.status]).toEqual([201, 2000, 'draft'])
    const forRep = await k.json(await k.as('manager')(`/api/work-orders/${made.body.id}`))
    expect(forRep.body.price).toBe(2000)
    const forViewer = await k.json(await k.as('viewer')(`/api/work-orders/${made.body.id}`))
    expect('price' in forViewer.body).toBe(false)

    // A draft is not a commitment: still by the square.
    b = await roofOf(jobId)
    expect([b.roof.crewBasis, b.roof.crewCost]).toEqual(['per_square', 1350])
    // Sent (no texting set up here, but the order is made ready and sent): the lump sum stands in for it.
    process.env.FRONTEND_URL ||= 'https://crm.example.com'
    expect((await k.as('owner')(`/api/work-orders/${made.body.id}/send`, { method: 'POST', json: {} })).status).toBe(200)
    b = await roofOf(jobId)
    expect([b.roof.crewBasis, b.roof.crewCost, b.roof.workOrderCost]).toEqual(['lump_sum', 2000, 2000])
    expect(b.actual.laborCost).toBe(2000)
    expect(b.workOrderDetail.map((w: any) => [w.title, w.cost])).toEqual([['Tear off and re-roof', 2000]])
    // The price is not on the crew's own link.
    const token = (await k.t.db.select().from(k.t.schema.workOrder))[0].publicToken
    const crewSide = await k.json(await k.t.call(`/api/crew-link/${token}`))
    expect(JSON.stringify(crewSide.body)).not.toContain('2000')

    // A second sub on the job at $500 adds to it; a cancelled order does not count.
    const extra = await k.json(await makeOrder('owner', jobId, { price: 500, title: 'Gutters' }))
    expect((await k.as('owner')(`/api/work-orders/${extra.body.id}/send`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await roofOf(jobId)).roof.crewCost).toBe(2500)
    expect((await k.as('owner')(`/api/work-orders/${extra.body.id}/cancel`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await roofOf(jobId)).roof.crewCost).toBe(2000)
    // Cancel the priced one too and it falls back to the pay by the square.
    expect((await k.as('owner')(`/api/work-orders/${made.body.id}/cancel`, { method: 'POST', json: {} })).status).toBe(200)
    b = await roofOf(jobId)
    expect([b.roof.crewBasis, b.roof.crewCost]).toEqual(['per_square', 1350])
  })

  test('the price is checked, can be cleared, and hours clocked on the job still win', async () => {
    const jobId = await k.jobAt('in_production', '3 Crew Way', { totalSquares: 20 })
    expect((await makeOrder('owner', jobId, { price: -5 })).status).toBe(400)
    expect((await makeOrder('owner', jobId, { price: 'lots' })).status).toBe(400)
    const o = await k.json(await makeOrder('owner', jobId, { price: 800 }))
    const cleared = await k.json(await k.as('owner')(`/api/work-orders/${o.body.id}`, { method: 'PUT', json: { price: null } }))
    expect(cleared.body.price).toBeNull()
    // Priced and sent, but the crew also clocked hours: the hours are the labour, the lump sum is not counted beside them.
    expect((await k.as('owner')(`/api/work-orders/${o.body.id}`, { method: 'PUT', json: { price: 800 } })).status).toBe(200)
    process.env.FRONTEND_URL ||= 'https://crm.example.com'
    expect((await k.as('owner')(`/api/work-orders/${o.body.id}/send`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await roofOf(jobId)).roof.crewCost).toBe(800)
    await k.t.db.insert(k.t.schema.timeEntry).values({ companyId: k.companyId, userId: k.ids.owner, jobId, date: new Date(), hours: '4', hourlyRate: '30', description: 'Clocked' } as any)
    const clocked = await roofOf(jobId)
    expect([clocked.roof.crewBasis, clocked.roof.crewCost, clocked.actual.laborCost]).toEqual(['clocked', 0, 120])
  })
})
