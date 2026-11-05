// Commissions for the job's OTHER people (docs/parity/roof-commissions-costing.md #7; roofing parity row 2), through the real server:
//   · a job carries more than its sales rep: an estimator, a canvasser, the office, a production manager and a sales manager
//     (several people may hold a role) — named on the job at /api/job-people, by a seat that may dispatch;
//   · a plan pays ONE role (autoEarn 'job_estimator' …), on the contract (total sales), the gross profit or the NET profit, and every
//     person holding that role is paid it automatically when the job is paid — AccuLynx's additional and management commissions;
//   · net profit is the gross profit less what the other plans paid out, worked out last — never on a profit the plan itself reduced;
//   · a plan that names people pays them only; someone added to a job already paid is paid at once; someone who has left is not.
// Nothing here reaches Stripe, the Factory or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootRoofKit } from './roofMoneyKit.ts'

let k: Awaited<ReturnType<typeof bootRoofKit>>
beforeAll(async () => {
  k = await bootRoofKit([['est1', 'field', 'Eva'], ['est2', 'field', 'Ed'], ['canv1', 'field', 'Cal'], ['canv2', 'field', 'Cy'], ['office', 'viewer', 'Olga'], ['pm', 'manager', 'Pat'], ['sm', 'manager', 'Sam']])
}, 120_000)

const putPeople = (who: string, jobId: string, people: Array<{ role: string; userId: string }>) =>
  k.as(who)(`/api/job-people/${jobId}`, { method: 'PUT', json: { people } })
const byPerson = (rows: any[]) => {
  const out: Record<string, any[]> = {}
  for (const r of rows) (out[r.userId] ||= []).push([Number(r.baseAmount), Number(r.commissionAmount)])
  return out
}
async function paidJob(address: string, contract: number, material: number, people: Array<{ role: string; userId: string }> = []) {
  const jobId = await k.jobAt('invoiced', address, { assignedSalesRepId: k.ids.rep })
  if (people.length) expect((await putPeople('manager', jobId, people)).status).toBe(200)
  if (material) expect((await k.order(jobId, 'delivered', 'ABC Supply', [['Shingles', 1, material]])).status).toBe(201)
  const inv = await k.sentInvoice(jobId, contract)
  await k.pay(inv.id, contract)
  expect(await k.settled(jobId, 'collected')).toBe('collected')
  return jobId
}

describe('plans that pay the job’s other people', () => {
  test('a plan pays one role; the roles are offered and checked; a bad role is refused', async () => {
    const mk = async (name: string, autoEarn: string, rest: Record<string, unknown>) => {
      const r = await k.plan({ name, appliesToRole: 'all', autoEarn, ...rest })
      expect([name, r.status, r.body.autoEarn]).toEqual([name, 201, autoEarn])
      return r.body.id as string
    }
    k.ids.pRep = await mk('Rep 8%', 'job_sales_rep', { planType: 'percent_of_invoice', percentRate: 8 })
    k.ids.pEst = await mk('Estimator 2% of sales', 'job_estimator', { planType: 'percent_of_invoice', percentRate: 2 })
    k.ids.pCanv = await mk('Canvasser $50', 'job_canvasser', { planType: 'flat_rate', flatRateAmount: 50, userIds: [k.ids.canv1] })
    k.ids.pOffice = await mk('Office $25', 'job_office', { planType: 'flat_rate', flatRateAmount: 25 })
    k.ids.pPm = await mk('Production manager 3% of gross profit', 'job_production_manager', { planType: 'percent_of_invoice', percentRate: 3, measuredOn: 'gross_profit' })
    // Created BEFORE the plans it reads, to show the order a plan was made in does not matter.
    k.ids.pSm = await mk('Sales manager 10% of net profit', 'job_sales_manager', { planType: 'percent_of_invoice', percentRate: 10, measuredOn: 'net_profit' })
    const bad = await k.plan({ name: 'Nobody', planType: 'flat_rate', flatRateAmount: 5, autoEarn: 'job_plumber' })
    expect(bad.status).toBe(400)
    // Net profit, like gross profit, needs a person on the job to be paid automatically.
    const bare = await k.plan({ name: 'Bare', planType: 'percent_of_invoice', percentRate: 5, autoEarn: 'none', measuredOn: 'net_profit' })
    expect(bare.status).toBe(400)
  })
})

describe('who is on the job', () => {
  test('only a seat that may dispatch changes them; the pay structure’s readers see them; the people must be on the team', async () => {
    const jobId = await k.jobAt('signed', '1 People Way', { assignedSalesRepId: k.ids.rep })
    k.ids.peopleJob = jobId
    const people = [{ role: 'estimator', userId: k.ids.est1 }]
    expect((await putPeople('rep', jobId, people)).status).toBe(403)
    expect((await putPeople('viewer', jobId, people)).status).toBe(403)
    expect((await k.as('rep')(`/api/job-people?jobId=${jobId}`)).status).toBe(403)
    const set = await k.json(await putPeople('manager', jobId, [...people, { role: 'estimator', userId: k.ids.est2 }, { role: 'office', userId: k.ids.office }]))
    expect(set.status).toBe(200)
    expect(set.body.data.map((p: any) => [p.role, p.userName]).sort()).toEqual([['estimator', 'Ed Seat'], ['estimator', 'Eva Seat'], ['office', 'Olga Seat']])
    const read = await k.json(await k.as('manager')(`/api/job-people?jobId=${jobId}`))
    expect(read.body.data.length).toBe(3)
    // Not a role the job has, not a person on this account.
    expect((await putPeople('manager', jobId, [{ role: 'plumber', userId: k.ids.est1 }])).status).toBe(400)
    expect((await putPeople('manager', jobId, [{ role: 'office', userId: 'nobody-here' }])).status).toBe(400)
    // A job that is not this company's is not there.
    expect((await putPeople('manager', 'no-such-job', people)).status).toBe(404)
    // The same person twice in a role is one row.
    const twice = await k.json(await putPeople('manager', jobId, [...people, ...people]))
    expect(twice.body.data.length).toBe(1)
  })
})

describe('everyone on the job is paid when it is paid', () => {
  test('rep 8%, two estimators 2% each, the named canvasser $50, office $25, production manager 3% of gross profit, sales manager 10% of net profit', async () => {
    const jobId = await paidJob('2 People Way', 10000, 5000, [
      { role: 'estimator', userId: k.ids.est1 }, { role: 'estimator', userId: k.ids.est2 },
      { role: 'canvasser', userId: k.ids.canv1 }, { role: 'canvasser', userId: k.ids.canv2 },
      { role: 'office', userId: k.ids.office }, { role: 'production_manager', userId: k.ids.pm }, { role: 'sales_manager', userId: k.ids.sm },
    ])
    const made = await k.commissionsAfter(jobId, 7)
    expect(made.length).toBe(7)
    const got = byPerson(made)
    // Contract $10,000; material $5,000 → gross profit $5,000.
    expect(got[k.ids.rep]).toEqual([[10000, 800]])
    expect(got[k.ids.est1]).toEqual([[10000, 200]])
    expect(got[k.ids.est2]).toEqual([[10000, 200]])
    // The plan names Cal: Cy holds the role and is not paid.
    expect(got[k.ids.canv1]).toEqual([[10000, 50]])
    expect(got[k.ids.canv2]).toBeUndefined()
    expect(got[k.ids.office]).toEqual([[10000, 25]])
    expect(got[k.ids.pm]).toEqual([[5000, 150]])
    // Net profit = gross $5,000 less what the OTHER plans paid ($800 + $200 + $200 + $50 + $25 + $150 = $1,425) = $3,575 → 10% = $357.50.
    expect(got[k.ids.sm]).toEqual([[3575, 357.5]])
    const sm = made.find((c) => c.userId === k.ids.sm)!
    expect(sm.notes).toContain('net profit $3,575.00')
    expect(sm.notes).toContain('sales manager')
    expect(made.every((c) => c.source === 'auto' && c.status === 'pending')).toBe(true)
    k.ids.paidJob = jobId

    // Followed up again — a retried webhook, another person added — nobody is paid twice.
    await (k.t.services as any).crm.afterInvoicePaid((await k.t.db.select().from(k.t.schema.invoice).where(eq(k.t.schema.invoice.jobId, jobId)))[0].id)
    expect((await putPeople('manager', jobId, (await k.json(await k.as('manager')(`/api/job-people?jobId=${jobId}`))).body.data.map((p: any) => ({ role: p.role, userId: p.userId })))).status).toBe(200)
    expect((await k.commissionsOf(jobId)).length).toBe(7)
  })

  test('someone added to a job that is already paid is paid at once; someone who has left the team is not', async () => {
    const jobId = await paidJob('3 People Way', 10000, 5000, [{ role: 'estimator', userId: k.ids.est1 }])
    expect((await k.commissionsAfter(jobId, 2)).length).toBe(2) // the rep and the estimator
    await k.t.db.update(k.t.schema.user).set({ isActive: false } as any).where(eq(k.t.schema.user.id, k.ids.est2))
    const before = (await k.commissionsOf(jobId)).length
    // The seat that left cannot be newly put on a job…
    const refused = await k.json(await putPeople('manager', jobId, [{ role: 'estimator', userId: k.ids.est1 }, { role: 'estimator', userId: k.ids.est2 }]))
    expect(refused.status).toBe(400)
    // …but a seat that is still here, added after the job was paid, earns now.
    expect((await putPeople('manager', jobId, [{ role: 'estimator', userId: k.ids.est1 }, { role: 'production_manager', userId: k.ids.pm }])).status).toBe(200)
    const after = await k.commissionsAfter(jobId, before + 1)
    expect(after.length).toBe(before + 1)
    expect(byPerson(after)[k.ids.pm]).toEqual([[5000, 150]])
    await k.t.db.update(k.t.schema.user).set({ isActive: true } as any).where(eq(k.t.schema.user.id, k.ids.est2))
  })

  test('the people’s earnings are their own to see: a field seat reads its commission and nobody else’s', async () => {
    const mine = await k.json(await k.as('est1')('/api/commissions'))
    expect(mine.status).toBe(200)
    expect(mine.body.data.length).toBeGreaterThan(0)
    expect(mine.body.data.every((c: any) => c.userId === k.ids.est1)).toBe(true)
    const stmt = await k.json(await k.as('est1')('/api/commissions/statement'))
    expect(stmt.body.lines.some((l: any) => l.jobId === k.ids.paidJob && Number(l.commissionAmount) === 200)).toBe(true)
  })
})
