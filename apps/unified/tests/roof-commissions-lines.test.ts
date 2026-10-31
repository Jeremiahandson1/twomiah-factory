// Every commission line names its job (docs/parity/roof-commissions-costing.md #11; roofing parity row 4): the list a seat reads and
// the statement carry the job's NUMBER, so a rep reads "which job was this" off the line. A seat reads its own lines only.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootRoofKit } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => { k = await bootRoofKit() }, 120_000)

describe('the job on every line', () => {
  test('the rep’s list and statement carry the job number; a line with no job has none', async () => {
    expect((await k.plan({ name: 'Rep 8%', appliesToRole: 'all', planType: 'percent_of_invoice', percentRate: 8, autoEarn: 'job_sales_rep' })).status).toBe(201)
    const jobId = await k.jobAt('invoiced', '1 Lines Way', { assignedSalesRepId: k.ids.rep })
    const inv = await k.sentInvoice(jobId, 10000)
    await k.pay(inv.id, 10000)
    expect(await k.settled(jobId, 'collected')).toBe('collected')
    await k.commissionsAfter(jobId, 1)
    const [row] = await k.t.db.select().from(k.t.schema.job).where(eq(k.t.schema.job.id, jobId))
    expect(row.number).toBeTruthy()

    const mine = await k.json(await k.as('rep')('/api/commissions'))
    expect(mine.status).toBe(200)
    const line = mine.body.data.find((c: any) => c.jobId === jobId)
    expect(line.jobNumber).toBe(row.number)
    const stmt = await k.json(await k.as('rep')('/api/commissions/statement'))
    expect(stmt.body.lines.find((l: any) => l.jobId === jobId).jobNumber).toBe(row.number)

    // A one-off recorded by hand against no job has a null number, not a missing key.
    expect((await k.as('owner')('/api/commissions', { method: 'POST', json: { userId: k.ids.rep, commissionAmount: 25, notes: 'Bonus' } })).status).toBe(201)
    const again = await k.json(await k.as('rep')('/api/commissions'))
    const bonus = again.body.data.find((c: any) => c.notes === 'Bonus')
    expect(bonus.jobNumber).toBeNull()
    // The owner reading everyone's gets the number too.
    const all = await k.json(await k.as('owner')('/api/commissions'))
    expect(all.body.data.find((c: any) => c.jobId === jobId).jobNumber).toBe(row.number)
  })
})
