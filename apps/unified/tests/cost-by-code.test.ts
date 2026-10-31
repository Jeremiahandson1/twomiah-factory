// Actual cost by cost code (contractor parity, item 1): time, expenses and vendor bills can be filed under a cost code, and with the
// (not ready) feature `cost_by_code` the project budget route returns what each budget line has really cost and the profit it will
// make. Server half, through the real app; the screen half is cost-by-code-ui.test.ts (a DOM installed as globals stops the
// in-memory database booting, so the two live in separate files — see job-budgets-routes.test.ts).
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any
const BASE = ['contacts', 'projects', 'jobs', 'job_costing', 'job_budgets', 'expense_tracking', 'time_tracking', 'vendor_bills']

describe('the feature', () => {
  test('is registered, not ready, and offered to the general contractor only', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'cost_by_code')
    expect(f).toBeTruthy()
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm'])
  })
})

async function boot(features: string[]) {
  const t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
  // The one place a row is written straight to the database: typed by the table it goes into.
  const ins = async <T extends PgTable>(table: T, values: T['$inferInsert']) => ((await t.db.insert(table).values(values as any).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  await ins(t.schema.user, { companyId: s.company.id, email: 'field@test.example', firstName: 'Field', lastName: 'Seat', role: 'field', passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
  const field = as(await login('field@test.example', 'Correct-horse-1'))
  const [ownerRow] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example')).limit(1)
  const companyId = s.company.id as string
  const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able' })
  const vendor = await ins(t.schema.contact, { companyId, type: 'vendor', name: 'Lumber Yard' })
  const project = await ins(t.schema.project, { companyId, number: 'PRJ-00001', name: 'Kitchen remodel', contactId: customer.id })
  const job = await ins(t.schema.job, { companyId, number: 'JOB-00001', title: 'Kitchen remodel — build', projectId: project.id, contactId: customer.id })
  await ins(t.schema.projectBudgetLine, { companyId, projectId: project.id, costCode: '02-Demo', estimatedCost: '800', estimatedPrice: '1000', uncostedLines: 0 })
  await ins(t.schema.projectBudgetLine, { companyId, projectId: project.id, costCode: '06-Framing', estimatedCost: '820', estimatedPrice: '1080', uncostedLines: 0 })
  return { t, ins, owner, field, companyId, ownerId: ownerRow.id as string, customer, vendor, project, job }
}

/** Costs on the job: framing 1000 (expense 900 typed in lower case + 2h at $50), demo 500 (one open bill; a void one is not spend),
 *  100 nobody coded, 70 on a code the budget does not have. */
async function spend(x: Awaited<ReturnType<typeof boot>>) {
  const { t, ins, companyId, ownerId, job, vendor } = x
  await ins(t.schema.expense, { companyId, category: 'materials', description: 'Lumber', amount: '900', jobId: job.id, costCode: '06-framing' })
  await ins(t.schema.timeEntry, { companyId, userId: ownerId, hours: '2', hourlyRate: '50', jobId: job.id, costCode: '06-Framing' })
  await ins(t.schema.vendorBill, { companyId, vendorId: vendor.id, amount: '500', status: 'open', jobId: job.id, costCode: '02-Demo' })
  await ins(t.schema.vendorBill, { companyId, vendorId: vendor.id, amount: '999', status: 'void', jobId: job.id, costCode: '02-Demo' })
  await ins(t.schema.expense, { companyId, category: 'other', description: 'Dump fee', amount: '100', jobId: job.id })
  await ins(t.schema.expense, { companyId, category: 'other', description: 'Paint', amount: '70', jobId: job.id, costCode: '09-Paint' })
}

describe('the budget route', () => {
  test('on: every budget line carries what it cost and the profit it will make, and the lines add up to the project actual', async () => {
    const x = await boot([...BASE, 'cost_by_code'])
    await spend(x)
    const r = await x.owner(`/api/job-costing/budget/${x.project.id}`)
    expect(r.status).toBe(200)
    const b = await json(r)
    const by = Object.fromEntries(b.lines.map((l: any) => [l.costCode, l]))
    // framing: 900 + 2 × 50 = 1000 against 820 budgeted → 180 over; priced 1080 → 80 profit
    expect([by['06-Framing'].actualCost, by['06-Framing'].overBy, by['06-Framing'].profit]).toEqual([1000, 180, 80])
    // demo: the open bill only (the void one is not spend) → under budget, so the profit is the budget's: 1000 − 800
    expect([by['02-Demo'].actualCost, by['02-Demo'].overBy, by['02-Demo'].profit]).toEqual([500, 0, 200])
    expect(by['02-Demo'].margin).toBe(20)
    // cost nobody coded, and cost on a code the budget lacks, are listed — never lost
    expect(b.unbudgeted).toEqual(expect.arrayContaining([{ costCode: 'Uncoded', actualCost: 100 }, { costCode: '09-Paint', actualCost: 70 }]))
    expect(b.unbudgeted.length).toBe(2)
    expect(b.actualCost).toBe(1670)
    expect(b.remainingCost).toBe(-50)
    expect(b.totalProfit).toBe(110) // 80 + 200 − 100 − 70
    expect(b.byCode).toBe(true)
  }, 120_000)

  test('the lines and the unbudgeted list reconcile with the Job Costing roll-up of the same project', async () => {
    const x = await boot([...BASE, 'cost_by_code'])
    await spend(x)
    const b = await json(await x.owner(`/api/job-costing/budget/${x.project.id}`))
    const summed = b.lines.reduce((s: number, l: any) => s + l.actualCost, 0) + b.unbudgeted.reduce((s: number, u: any) => s + u.actualCost, 0)
    expect(Math.round(summed * 100) / 100).toBe(b.actualCost)
    const roll = await json(await x.owner(`/api/job-costing/summary?projectId=${x.project.id}`))
    expect(Number(roll.totals.totalCost)).toBe(b.actualCost)
  }, 120_000)

  test('off: the route answers as it did, with no per-line actuals', async () => {
    const x = await boot(BASE)
    await spend(x)
    const b = await json(await x.owner(`/api/job-costing/budget/${x.project.id}`))
    expect(b.byCode).toBeUndefined()
    expect(b.lines[0].actualCost).toBeUndefined()
    expect(b.lines[0].profit).toBeUndefined()
  }, 120_000)

  test('a seat without reports:read is refused, with the feature on', async () => {
    const x = await boot([...BASE, 'cost_by_code'])
    expect((await x.field(`/api/job-costing/budget/${x.project.id}`)).status).toBe(403)
  }, 120_000)
})

describe('filing a cost under a code', () => {
  test('an expense, a time entry and a vendor bill each keep the cost code they were saved with, and can change it', async () => {
    const x = await boot([...BASE, 'cost_by_code'])
    const { t, owner, job, vendor } = x
    const e = await owner('/api/expenses', { method: 'POST', json: { category: 'materials', description: 'Nails', amount: 12, jobId: job.id, costCode: '06-Framing' } })
    expect(e.status).toBe(201)
    const entry = await owner('/api/time', { method: 'POST', json: { hours: 1.5, hourlyRate: 40, jobId: job.id, costCode: '06-Framing' } })
    expect(entry.status).toBe(201)
    const bill = await owner('/api/bills', { method: 'POST', json: { vendorId: vendor.id, amount: 300, jobId: job.id, costCode: '02-Demo' } })
    expect(bill.status).toBe(201)
    const eId = (await json(e)).id, tId = (await json(entry)).id, bId = (await json(bill)).id
    const read = async () => ({
      e: (await t.db.select().from(t.schema.expense).where(eq(t.schema.expense.id, eId)))[0]?.costCode,
      t: (await t.db.select().from(t.schema.timeEntry).where(eq(t.schema.timeEntry.id, tId)))[0]?.costCode,
      b: (await t.db.select().from(t.schema.vendorBill).where(eq(t.schema.vendorBill.id, bId)))[0]?.costCode,
    })
    expect(await read()).toEqual({ e: '06-Framing', t: '06-Framing', b: '02-Demo' })
    expect((await owner(`/api/bills/${bId}`, { method: 'PUT', json: { costCode: '06-Framing' } })).status).toBe(200)
    expect((await owner(`/api/time/${tId}`, { method: 'PUT', json: { costCode: null } })).status).toBe(200)
    expect(await read()).toEqual({ e: '06-Framing', t: null, b: '06-Framing' })
  }, 120_000)
})
