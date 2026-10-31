// Reports a builder buys on (brief item 8): receivables aging (every trade with invoices) and work in progress + a job-profit list
// (the trades with job costing). Features ar_aging and wip_report, registered not ready. The aging must agree with the Reports
// page's own "Outstanding now" and "Overdue now" — two numbers for one fact is how a builder stops trusting both.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate } from '@twomiah/tenant-backend'

const json = async (r: Response) => (await r.json()) as any
const ON = ['contacts', 'projects', 'jobs', 'quotes', 'invoices', 'change_orders', 'reports', 'job_costing', 'ar_aging', 'wip_report']
const DAY = 86_400_000
const dayAgo = (n: number) => { const d = new Date(Date.now() - n * DAY); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

async function boot(vertical = 'contractor', features = ON) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const seat = async (role: string) => {
    await ins(t.schema.user, { companyId: s.company.id, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return as(await login(`${role}@test.example`, 'Correct-horse-1'))
  }
  const companyId = s.company.id as string
  let n = 0
  const invoice = (over: any) => ins(t.schema.invoice, { companyId, number: `INV-${String(++n).padStart(4, '0')}`, status: 'sent', subtotal: over.total, total: over.total, ...over })
  return { t, ins, owner, seat, companyId, invoice }
}

describe('receivables aging', () => {
  async function ledger() {
    const x = await boot()
    const ruiz = await x.ins(x.t.schema.contact, { companyId: x.companyId, type: 'client', name: 'Ruiz Family' })
    const okafor = await x.ins(x.t.schema.contact, { companyId: x.companyId, type: 'client', name: 'Okafor Homes' })
    // Ruiz: not yet due 100; 10 days late 200; 45 days late 300 (of which 100 paid → 200 owed); 120 days late 400
    await x.invoice({ contactId: ruiz.id, total: '100', dueDate: dayAgo(-5) })
    await x.invoice({ contactId: ruiz.id, total: '200', dueDate: dayAgo(10) })
    await x.invoice({ contactId: ruiz.id, total: '300', amountPaid: '100', status: 'partial', dueDate: dayAgo(45) })
    await x.invoice({ contactId: ruiz.id, total: '400', dueDate: dayAgo(120) })
    // Okafor: 70 days late 500; no due date 50 (counts as current); a paid one, a draft and a void owe nothing
    await x.invoice({ contactId: okafor.id, total: '500', dueDate: dayAgo(70) })
    await x.invoice({ contactId: okafor.id, total: '50', dueDate: null })
    await x.invoice({ contactId: okafor.id, total: '999', amountPaid: '999', status: 'paid', dueDate: dayAgo(30) })
    await x.invoice({ contactId: okafor.id, total: '888', status: 'draft', dueDate: dayAgo(30) })
    await x.invoice({ contactId: okafor.id, total: '777', status: 'void', dueDate: dayAgo(30) })
    return { ...x, ruiz, okafor }
  }

  test('buckets every unpaid balance by days past due, by customer, biggest debt first', async () => {
    const x = await ledger()
    const r = await x.owner('/api/receivables/aging')
    expect(r.status).toBe(200)
    const a = await json(r)
    expect(a.totals).toEqual({ current: 150, days1to30: 200, days31to60: 200, days61to90: 500, over90: 400, total: 1450 })
    expect(a.invoiceCount).toBe(6)
    expect(a.customers.map((c: any) => c.name)).toEqual(['Ruiz Family', 'Okafor Homes'])      // 900 owed, then 550
    const ruiz = a.customers.find((c: any) => c.name === 'Ruiz Family')
    expect(ruiz).toMatchObject({ current: 100, days1to30: 200, days31to60: 200, days61to90: 0, over90: 400, total: 900, invoiceCount: 4 })
    const okafor = a.customers.find((c: any) => c.name === 'Okafor Homes')
    expect(okafor).toMatchObject({ current: 50, days61to90: 500, total: 550, invoiceCount: 2 })
  }, 90_000)

  test('agrees with the Reports page: the total is "Outstanding now" and the late buckets are "Overdue now"', async () => {
    const x = await ledger()
    const a = await json(await x.owner('/api/receivables/aging'))
    const rep = await json(await x.owner('/api/reports/dashboard'))
    expect(a.totals.total).toBeCloseTo(rep.revenue.outstanding, 2)
    expect(a.totals.days1to30 + a.totals.days31to60 + a.totals.days61to90 + a.totals.over90).toBeCloseTo(rep.revenue.overdue, 2)
  }, 90_000)

  test('a business with nothing owed gets an empty answer, and a refunded sale is not owed', async () => {
    const x = await boot()
    expect((await json(await x.owner('/api/receivables/aging'))).customers).toEqual([])
    const c = await x.ins(x.t.schema.contact, { companyId: x.companyId, type: 'client', name: 'Lee' })
    await x.invoice({ contactId: c.id, total: '300', amountPaid: '300', amountRefunded: '300', status: 'refunded', dueDate: dayAgo(5) })
    expect((await json(await x.owner('/api/receivables/aging'))).totals.total).toBe(0)
  }, 90_000)

  test('one business never sees another’s balances', async () => {
    const x = await ledger()
    const y = await boot()
    expect((await json(await y.owner('/api/receivables/aging'))).totals.total).toBe(0)
    expect((await json(await x.owner('/api/receivables/aging'))).totals.total).toBe(1450)
  }, 120_000)

  test('needs reports:read and the feature; a business without it has no such route', async () => {
    const x = await ledger()
    const field = await x.seat('field')
    expect((await field('/api/receivables/aging')).status).toBe(403)
    const manager = await x.seat('manager')
    expect((await manager('/api/receivables/aging')).status).toBe(200)
    const off = await boot('contractor', ON.filter((f) => f !== 'ar_aging'))
    expect((await off.owner('/api/receivables/aging')).status).toBe(403)
  }, 120_000)

  test('works for the other trades with invoices (field service, roofing, landscaping), each on its own tenant', async () => {
    for (const vertical of ['fieldservice', 'roofing', 'landscaping']) {
      const x = await boot(vertical, ['contacts', 'jobs', 'quotes', 'invoices', 'reports', 'ar_aging'])
      const c = await x.ins(x.t.schema.contact, { companyId: x.companyId, type: 'client', name: 'Pat' })
      await x.invoice({ contactId: c.id, total: '250', dueDate: dayAgo(40) })
      const a = await json(await x.owner('/api/receivables/aging'))
      expect(a.totals).toMatchObject({ days31to60: 250, total: 250 })
    }
  }, 240_000)
})

describe('work in progress', () => {
  async function build() {
    const x = await boot()
    const ruiz = await x.ins(x.t.schema.contact, { companyId: x.companyId, type: 'client', name: 'Ruiz Family' })
    const house = await x.ins(x.t.schema.project, { companyId: x.companyId, number: 'PRJ-0001', name: 'Ruiz addition', status: 'active', contactId: ruiz.id, progress: 30 })
    // Sold for 100,000 + a 10,000 approved change (a pending 5,000 one does not count). Budgeted cost 80,000.
    await x.ins(x.t.schema.quote, { companyId: x.companyId, number: 'QTE-0001', name: 'Ruiz addition', status: 'approved', subtotal: '100000', total: '100000', projectId: house.id, contactId: ruiz.id })
    await x.ins(x.t.schema.changeOrder, { companyId: x.companyId, projectId: house.id, number: 'CO-001', title: 'Bigger deck', status: 'approved', amount: '10000' })
    await x.ins(x.t.schema.changeOrder, { companyId: x.companyId, projectId: house.id, number: 'CO-002', title: 'Skylight', status: 'pending', amount: '5000' })
    await x.ins(x.t.schema.projectBudgetLine, { companyId: x.companyId, projectId: house.id, costCode: 'Framing', estimatedCost: '50000', estimatedPrice: '60000', uncostedLines: 0 })
    await x.ins(x.t.schema.projectBudgetLine, { companyId: x.companyId, projectId: house.id, costCode: 'Finish', estimatedCost: '30000', estimatedPrice: '40000', uncostedLines: 0 })
    // Cost so far 20,000 on a job of the project; billed 35,000 (one invoice on the project, one on the job) + a draft that counts for nothing.
    const framing = await x.ins(x.t.schema.job, { companyId: x.companyId, number: 'JOB-0001', title: 'Framing', status: 'in_progress', projectId: house.id, contactId: ruiz.id })
    await x.ins(x.t.schema.expense, { companyId: x.companyId, jobId: framing.id, category: 'materials', amount: '20000', date: new Date() })
    await x.invoice({ contactId: ruiz.id, projectId: house.id, total: '25000' })
    await x.invoice({ contactId: ruiz.id, jobId: framing.id, total: '10000' })
    await x.invoice({ contactId: ruiz.id, projectId: house.id, total: '9999', status: 'draft' })
    // A finished project is not WIP.
    await x.ins(x.t.schema.project, { companyId: x.companyId, number: 'PRJ-0002', name: 'Old shed', status: 'completed', progress: 100 })
    return { ...x, ruiz, house }
  }

  test('each open project: contract incl. approved changes, billed, cost, % complete (cost to cost) and over/under billing', async () => {
    const x = await build()
    const r = await x.owner('/api/wip')
    expect(r.status).toBe(200)
    const w = await json(r)
    expect(w.rows.length).toBe(1)
    const p = w.rows[0]
    expect(p).toMatchObject({ kind: 'project', name: 'Ruiz addition', contractValue: 110000, approvedChanges: 10000, contractSource: 'quotes', billed: 35000, costToDate: 20000, percentComplete: 25, percentSource: 'cost', earned: 27500, overUnder: 7500 })
    expect(w.totals).toMatchObject({ contractValue: 110000, billed: 35000, costToDate: 20000, overUnder: 7500 })
  }, 90_000)

  test('with no budget costs the project’s own progress is the % complete, and the row says so', async () => {
    const x = await build()
    await x.t.db.delete(x.t.schema.projectBudgetLine)
    const p = (await json(await x.owner('/api/wip'))).rows[0]
    expect(p).toMatchObject({ percentComplete: 30, percentSource: 'progress', earned: 33000, overUnder: 2000 })
  }, 90_000)

  test('with no approved quote the project’s estimated value stands in, marked as an estimate', async () => {
    const x = await boot()
    await x.ins(x.t.schema.project, { companyId: x.companyId, number: 'PRJ-0009', name: 'Bid job', status: 'planning', estimatedValue: '40000', progress: 50 })
    const p = (await json(await x.owner('/api/wip'))).rows[0]
    expect(p).toMatchObject({ contractValue: 40000, contractSource: 'estimate', earned: 20000, billed: 0, overUnder: -20000 })
  }, 90_000)

  test('an open job on no project is its own row; without a quote’s costs it has no % complete or over/under rather than a guess', async () => {
    const x = await boot('fieldservice', ['contacts', 'jobs', 'quotes', 'invoices', 'reports', 'job_costing', 'wip_report'])
    const c = await x.ins(x.t.schema.contact, { companyId: x.companyId, type: 'client', name: 'Pat' })
    const j = await x.ins(x.t.schema.job, { companyId: x.companyId, number: 'JOB-0001', title: 'Furnace swap', status: 'in_progress', contactId: c.id, estimatedValue: '6000' })
    await x.ins(x.t.schema.expense, { companyId: x.companyId, jobId: j.id, category: 'materials', amount: '1500', date: new Date() })
    await x.invoice({ contactId: c.id, jobId: j.id, total: '2000' })
    await x.ins(x.t.schema.job, { companyId: x.companyId, number: 'JOB-0002', title: 'Done', status: 'completed', contactId: c.id })
    const w = await json(await x.owner('/api/wip'))
    expect(w.rows.length).toBe(1)
    expect(w.rows[0]).toMatchObject({ kind: 'job', name: 'Furnace swap', contractValue: 6000, billed: 2000, costToDate: 1500, percentComplete: null, percentSource: 'none', earned: null, overUnder: null })
  }, 90_000)

  test('needs reports:read and the feature', async () => {
    const x = await build()
    expect((await (await x.seat('field'))('/api/wip')).status).toBe(403)
    expect((await (await x.seat('manager'))('/api/wip')).status).toBe(200)
    const off = await boot('contractor', ON.filter((f) => f !== 'wip_report'))
    expect((await off.owner('/api/wip')).status).toBe(403)
  }, 120_000)
})

describe('registered not ready', () => {
  test('both features are hidden; aging is named for every trade with a Reports page except home care (its Billing page has its own), WIP for the four job-costing trades', () => {
    const ar = FEATURE_REGISTRY.find((r: any) => r.id === 'ar_aging') as any
    const wip = FEATURE_REGISTRY.find((r: any) => r.id === 'wip_report') as any
    expect(ar.hidden).toBe(true); expect(wip.hidden).toBe(true)
    const reports = FEATURE_REGISTRY.find((r: any) => r.id === 'reports') as any
    expect([...ar.templates].sort()).toEqual(reports.templates.filter((t: string) => t !== 'crm-homecare').sort())
    // Roofing has Job Costing (a roof's P&L, PR #170) but its own Reports page (web/src/crm/pages/roof/jobs/ReportsPage.tsx),
    // which has no WIP card: offered there, the feature would switch on nothing.
    expect([...wip.templates].sort()).toEqual((FEATURE_REGISTRY.find((r: any) => r.id === 'job_costing') as any).templates.filter((t: string) => t !== 'crm-roof').sort())
    for (const t of ar.templates) expect(getAdvertisableFeaturesForTemplate(t).map((r: any) => r.id)).not.toContain('ar_aging')
  })
})
