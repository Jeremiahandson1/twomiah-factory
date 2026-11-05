// A roofing job's profit from the roofer's QuickBooks books (docs/parity/roof-commissions-costing.md #22; roofing parity row 5), through
// the real server against the faithful QuickBooks stand-in (tests/qboMock.ts: customers, invoices, the Profit and Loss report by
// customer, Intuit's refusals). Nothing reaches the internet.
//   · /api/job-books/:jobId reads the books: income, cost of goods, expenses and profit for the job's QuickBooks customer, beside this
//     app's own figures for the job before commissions, and the difference;
//   · it says plainly when QuickBooks is off, not connected, has no customer for the job, was revoked, or refuses — never a made-up figure;
//   · a contact with several jobs is reported as the customer's books and says how many other jobs share them; a customer chosen on the
//     job (checked in QuickBooks) is that job's alone;
//   · it only ever reads: not one write reaches QuickBooks; reading is reports:read, choosing the customer is reports:update.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootRoofKit, ROOF_FEATURES } from './roofMoneyKit.ts'
import { createQboMock } from './qboMock.ts'
import { readProfitAndLoss } from '../server/crm/roof/jobBooks.ts'

const qbo = createQboMock()
const realFetch = globalThis.fetch
let k: Awaited<ReturnType<typeof bootRoofKit>>
let jobA = ''
let jobB = ''
beforeAll(async () => {
  globalThis.fetch = qbo.fetch as any
  k = await bootRoofKit()
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch })

const books = (who: string, jobId: string) => (async () => k.json(await k.as(who)(`/api/job-books/${jobId}`)))()
const customer = (id: string, name: string) => qbo.customers.set(id, { Id: id, SyncToken: '0', DisplayName: name, Active: true })
const qbInvoice = (id: string, cid: string, total: number) => qbo.invoices.set(id, { Id: id, SyncToken: '0', CustomerRef: { value: cid }, TotalAmt: total, Balance: 0 })

describe('what it reads', () => {
  test('the report’s rows are read whatever their nesting; a missing net is worked out; other income and expense net', () => {
    const cell = (label: string, v: string) => ({ Summary: { ColData: [{ value: label }, { value: v }] } })
    const nested = { Rows: { Row: [
      { group: 'Income', ...cell('Total Income', '10000.00'), Rows: { Row: [{ group: 'Inner', ...cell('x', '1') }] } },
      { group: 'COGS', ...cell('Total COGS', '5000.00') },
      { group: 'Expenses', ...cell('Total Expenses', '1500.00') },
      { group: 'OtherIncome', ...cell('Other', '100.00') },
      { group: 'OtherExpenses', ...cell('Other', '40.00') },
      { group: 'NetIncome', ...cell('Net Income', '3560.00') },
    ] } }
    expect(readProfitAndLoss(nested)).toEqual({ income: 10000, costOfGoods: 5000, expenses: 1500, otherNet: -60, cost: 6440, profit: 3560 })
    const noNet = { Rows: { Row: [{ group: 'Income', ...cell('Total Income', '800') }, { group: 'Expenses', ...cell('Total Expenses', '300') }] } }
    expect(readProfitAndLoss(noNet)).toMatchObject({ income: 800, expenses: 300, profit: 500, cost: 300 })
    expect(readProfitAndLoss({})).toMatchObject({ income: 0, profit: 0, cost: 0 })
  })
})

describe('when QuickBooks cannot be read', () => {
  test('off, then not connected, then connected but the job has no customer — each said in words', async () => {
    jobA = await k.jobAt('invoiced', '1 Books Way')
    const off = await books('owner', jobA)
    expect(off.status).toBe(200)
    expect(off.body).toMatchObject({ state: 'off' })
    expect(off.body.message).toContain('not switched on')
    await k.setFeatures([...ROOF_FEATURES, 'quickbooks'])
    expect((await books('owner', jobA)).body).toMatchObject({ state: 'not_connected' })
    await k.t.services.crm.quickbooks.saveConnection(k.companyId, { accessToken: 'access-1', refreshToken: 'refresh-1', realmId: '9130', expiresIn: 3600 })
    const none = await books('owner', jobA)
    expect(none.body.state).toBe('no_customer')
    expect(none.body.message).toContain('QuickBooks customer')
    expect(qbo.writes().length).toBe(0)
  })

  test('a job that is not this company’s is not there', async () => {
    expect((await books('owner', 'no-such-job')).status).toBe(404)
  })
})

describe('the job’s books', () => {
  test('income, cost of goods and expenses from QuickBooks beside this app’s own figures, and the difference', async () => {
    customer('C1', 'Lee Marsh')
    await k.t.db.update(k.t.schema.contact).set({ qbCustomerId: 'C1' } as any).where(eq(k.t.schema.contact.id, k.ids.home))
    // This app: $10,000 billed and paid, shingles $4,800 ordered and delivered.
    expect((await k.order(jobA, 'delivered', 'ABC Supply', [['Shingles', 1, 4800]])).status).toBe(201)
    const inv = await k.sentInvoice(jobA, 10000)
    await k.pay(inv.id, 10000)
    // QuickBooks: the same $10,000 invoice; the bookkeeper entered shingles $5,000 and a dump fee and fuel $1,500 against the customer.
    qbInvoice('I1', 'C1', 10000)
    qbo.spend.push({ customerId: 'C1', amount: 5000, account: 'Materials', kind: 'COGS' }, { customerId: 'C1', amount: 1500, account: 'Dump fees', kind: 'Expenses' })
    const r = await books('owner', jobA)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ state: 'ok', scope: 'customer', otherJobs: 0, customer: { id: 'C1', name: 'Lee Marsh' }, income: 10000, costOfGoods: 5000, expenses: 1500, cost: 6500, profit: 3500, margin: 35 })
    // The report asked QuickBooks for this customer, from the job's start to today, on the accrual basis.
    const asked = qbo.calls.filter((c) => c.path.endsWith('/reports/ProfitAndLoss')).length
    expect(asked).toBeGreaterThan(0)
    expect(r.body.app).toEqual({ revenue: 10000, cost: 4800, profit: 5200 })
    expect(r.body.difference).toBe(-1700) // the books show $1,700 less profit than this app knows of
    expect(r.body.from <= r.body.to).toBe(true)
  })

  test('a contact with another job: the figures are the customer’s and say so; a customer chosen on the job is that job’s alone', async () => {
    jobB = await k.jobAt('invoiced', '2 Books Way')
    const shared = await books('owner', jobA)
    expect(shared.body).toMatchObject({ scope: 'customer', otherJobs: 1 })
    // The owner searches QuickBooks and chooses the job's own customer there.
    customer('C2', 'Lee Marsh - 2 Books Way')
    qbInvoice('I2', 'C2', 3000)
    qbo.spend.push({ customerId: 'C2', amount: 1000, account: 'Materials', kind: 'COGS' })
    const found = await k.json(await k.as('owner')('/api/job-books/customers?q=marsh'))
    expect(found.status).toBe(200)
    expect(found.body.data.map((x: any) => x.id).sort()).toEqual(['C1', 'C2'])
    expect((await k.as('owner')('/api/job-books/customers?q=m')).status).toBe(400)
    const chose = await k.json(await k.as('owner')(`/api/job-books/${jobB}/customer`, { method: 'PUT', json: { qbCustomerId: 'C2' } }))
    expect(chose.body).toMatchObject({ qbCustomerId: 'C2', qbCustomerName: 'Lee Marsh - 2 Books Way' })
    const own = await books('owner', jobB)
    expect(own.body).toMatchObject({ state: 'ok', scope: 'job', otherJobs: 0, income: 3000, costOfGoods: 1000, profit: 2000, customer: { id: 'C2' } })
    // A customer QuickBooks does not have is refused in words; clearing goes back to the contact's own.
    const bad = await k.json(await k.as('owner')(`/api/job-books/${jobB}/customer`, { method: 'PUT', json: { qbCustomerId: 'NOPE' } }))
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('QuickBooks does not have that customer')
    expect((await books('owner', jobB)).body.customer.id).toBe('C2')
    expect((await k.as('owner')(`/api/job-books/${jobB}/customer`, { method: 'PUT', json: { qbCustomerId: null } })).status).toBe(200)
    expect((await books('owner', jobB)).body).toMatchObject({ scope: 'customer', customer: { id: 'C1' } })
  })
})

describe('when QuickBooks says no', () => {
  test('a revoked connection and a customer QuickBooks no longer has are said as they are; nothing is invented', async () => {
    qbo.revoke(true)
    const revoked = await books('owner', jobA)
    expect(revoked.body.state).toBe('not_connected')
    expect(revoked.body.message).toContain('not connected any more')
    qbo.revoke(false)
    qbo.customers.delete('C1')
    const gone = await books('owner', jobA)
    expect(gone.body.state).toBe('error')
    expect(gone.body.message).toContain('QuickBooks did not give the report')
    expect(gone.body.message).toContain('Invalid Reference Id')
    expect(gone.body.income).toBeUndefined()
    customer('C1', 'Lee Marsh')
  })

  test('reading never writes: not one request to QuickBooks was a write', () => {
    expect(qbo.writes().length).toBe(0)
  })
})

describe('who may', () => {
  test('a manager reads job costing so reads the books; choosing the customer is the owner’s; a field seat and a missing sign-in get nothing', async () => {
    expect((await books('manager', jobA)).status).toBe(200)
    expect((await k.as('manager')(`/api/job-books/${jobA}/customer`, { method: 'PUT', json: { qbCustomerId: 'C1' } })).status).toBe(403)
    expect((await k.as('manager')('/api/job-books/customers?q=marsh')).status).toBe(403)
    expect((await books('rep', jobA)).status).toBe(403)
    expect((await k.t.call(`/api/job-books/${jobA}`)).status).toBe(401)
  })

  test('the job_costing feature gates it: off, the route refuses', async () => {
    await k.setFeatures(ROOF_FEATURES.filter((f) => f !== 'job_costing').concat('quickbooks'))
    expect((await books('owner', jobA)).status).toBe(403)
    await k.setFeatures([...ROOF_FEATURES, 'quickbooks'])
  })
})
