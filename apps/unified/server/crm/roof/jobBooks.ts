// A roofing job's profit as the roofer's QuickBooks books show it (roofing parity row 5; docs/parity/roof-commissions-costing.md #22).
// Where the roofer keeps the books in QuickBooks, the bills, cheques and card spend are entered there — not here — so the books are the
// truth for what a job cost. This reads them (it never writes to QuickBooks), at /api/job-books, behind the existing job_costing feature
// and, in the handler, the quickbooks switch:
//
//   GET /:jobId             the job's income, cost and profit from QuickBooks' Profit and Loss for the job's customer, beside this
//                           app's own figures for the same job (before commissions), and the difference     reports:read
//   PUT /:jobId/customer    choose the QuickBooks customer (or job) this job's books are kept under; null goes back to the contact's  reports:update
//   GET /customers?q=       search the QuickBooks customers by name, to choose from                                                      reports:update
//
// The job's QuickBooks customer is the one chosen on the job (job.qb_customer_id) and otherwise the contact's own (contact.qb_customer_id,
// set by the customer sync). QuickBooks' report is per customer, so when the contact has more than one job and none was chosen, the
// figures cover all of that customer's jobs and the answer says how many others share it — it is never presented as this job alone.
// QuickBooks' own refusal is shown in its words; nothing here is a guess when QuickBooks is not connected.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, ne } from 'drizzle-orm'
import { contact, invoice, job } from '../../db/schema/index.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from '../field/jobCostingService.ts'
import { connectionLost, quickBooksReason } from '../office/quickbooksAutoSync.ts'

const round2 = (n: number) => Math.round(n * 100) / 100
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10)
const quoted = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export interface BooksFigures { income: number; costOfGoods: number; expenses: number; otherNet: number; cost: number; profit: number }

/**
 * QuickBooks' Profit and Loss, as the report API returns it (Rows.Row[], each section with a group name and a Summary row whose second
 * cell is the total), reduced to what a roofer reads: income, cost of goods, expenses, the net of other income and expense, and the
 * net income. Sections can nest, so every row is walked.
 */
export function readProfitAndLoss(report: any): BooksFigures {
  const totals: Record<string, number> = {}
  const walk = (rows: any[]) => {
    for (const r of rows || []) {
      const cells = r?.Summary?.ColData
      if (r?.group && Array.isArray(cells) && cells.length > 1) totals[r.group] = Number(cells[1]?.value || 0)
      if (r?.Rows?.Row) walk(r.Rows.Row)
    }
  }
  walk(report?.Rows?.Row || [])
  const income = round2(totals.Income ?? 0)
  const costOfGoods = round2(totals.COGS ?? 0)
  const expenses = round2(totals.Expenses ?? 0)
  const otherNet = round2((totals.OtherExpenses ?? 0) - (totals.OtherIncome ?? 0))
  const profit = round2(totals.NetIncome ?? income - costOfGoods - expenses - otherNet)
  return { income, costOfGoods, expenses, otherNet, cost: round2(income - profit), profit }
}

export function createJobBooksRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const costing = createJobCostingService(d)
  const qb = d.services.quickbooks as any
  const app = new Hono<AppEnv>()

  const ownJob = async (companyId: string, id: string) =>
    (await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, companyId))).limit(1))[0]
  /** Why QuickBooks cannot be read, or null when it can. */
  async function unavailable(companyId: string): Promise<{ state: string; message: string } | null> {
    if (!(await d.features.isFeatureEnabled(companyId, 'quickbooks'))) return { state: 'off', message: 'QuickBooks is not switched on for this account.' }
    const status = await qb.getConnectionStatus(companyId)
    if (!status.connected) return { state: 'not_connected', message: 'QuickBooks is not connected. Connect it under Settings, Integrations.' }
    return null
  }

  // Declared before /:jobId so "customers" is not read as a job.
  app.get('/customers', requirePermission('reports:update'), async (c) => {
    const me = c.get('user')
    const q = String(c.req.query('q') || '').trim()
    if (q.length < 2) return fail(c, 400, 'Type at least two letters of the customer’s name.', 'validation_failed', { q: 'Type at least two letters.' })
    const no = await unavailable(me.companyId)
    if (no) return fail(c, 409, no.message, no.state)
    try {
      const rows = await qb.query(me.companyId, 'Customer', `DisplayName like '%${quoted(q)}%'`)
      return listAll(c, rows.slice(0, 20).map((r: any) => ({ id: String(r.Id), name: String(r.DisplayName ?? r.FullyQualifiedName ?? r.Id) })))
    } catch (e) {
      return fail(c, 502, `QuickBooks did not answer: ${quickBooksReason(e)}`, 'quickbooks_error')
    }
  })

  app.get('/:jobId', requirePermission('reports:read'), async (c) => {
    const me = c.get('user')
    const row = await ownJob(me.companyId, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    const no = await unavailable(me.companyId)
    if (no) return one(c, no)

    let customerId: string | null = row.qbCustomerId ?? null
    let customerName: string | null = row.qbCustomerName ?? null
    let scope: 'job' | 'customer' = 'job'
    let otherJobs = 0
    if (!customerId && row.contactId) {
      const [ct] = await db.select({ qb: contact.qbCustomerId, name: contact.name }).from(contact).where(and(eq(contact.id, row.contactId), eq(contact.companyId, me.companyId))).limit(1)
      if (ct?.qb) {
        customerId = ct.qb; customerName = ct.name; scope = 'customer'
        otherJobs = (await db.select({ id: job.id }).from(job).where(and(eq(job.companyId, me.companyId), eq(job.contactId, row.contactId), ne(job.id, row.id)))).length
      }
    }
    if (!customerId) {
      return one(c, { state: 'no_customer', message: 'This job is not under a QuickBooks customer yet. Choose one, or send the customer to QuickBooks first.' })
    }

    // From the first thing the job did to today: the job's start, or its earliest invoice if that came before.
    const [first] = await db.select({ d: invoice.issueDate }).from(invoice).where(and(eq(invoice.companyId, me.companyId), eq(invoice.jobId, row.id))).orderBy(asc(invoice.issueDate)).limit(1)
    const from = day([row.createdAt, first?.d].filter(Boolean).map((x: any) => new Date(x)).sort((a: Date, b: Date) => a.getTime() - b.getTime())[0])
    const to = day(new Date())
    let figures: BooksFigures
    try {
      const report = await qb.apiRequest(me.companyId, 'GET', `/reports/ProfitAndLoss?customer=${encodeURIComponent(customerId)}&start_date=${from}&end_date=${to}&accounting_method=Accrual`)
      figures = readProfitAndLoss(report)
    } catch (e) {
      if (connectionLost(e)) return one(c, { state: 'not_connected', message: 'QuickBooks is not connected any more. Connect it again under Settings, Integrations.' })
      return one(c, { state: 'error', message: `QuickBooks did not give the report: ${quickBooksReason(e)}` })
    }

    // This app's own figures for the same job, before commissions (QuickBooks' books do not hold what this app computes as commission).
    let app_: { revenue: number; cost: number; profit: number } | null = null
    try {
      const a: any = await costing.getJobCostAnalysis(row.id, me.companyId)
      const cost = round2(Number(a.actual.totalCost || 0) - Number(a.actual.commissionCost || 0))
      app_ = { revenue: round2(Number(a.actual.revenue || 0)), cost, profit: round2(Number(a.actual.revenue || 0) - cost) }
    } catch { app_ = null }
    return one(c, {
      state: 'ok', scope, otherJobs, customer: { id: customerId, name: customerName }, from, to, ...figures,
      margin: figures.income > 0 ? Math.round((figures.profit / figures.income) * 1000) / 10 : null,
      app: app_, difference: app_ ? round2(figures.profit - app_.profit) : null,
    })
  })

  const choose = z.object({ qbCustomerId: z.string().trim().min(1, 'Choose a QuickBooks customer.').max(64).nullable() })
  app.put('/:jobId/customer', requirePermission('reports:update'), async (c) => {
    const me = c.get('user')
    const parsed = choose.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const row = await ownJob(me.companyId, c.req.param('jobId'))
    if (!row) return fail(c, 404, 'Job not found')
    let name: string | null = null
    if (parsed.data.qbCustomerId) {
      const no = await unavailable(me.companyId)
      if (no) return fail(c, 409, no.message, no.state)
      try {
        const found = await qb.apiRequest(me.companyId, 'GET', `/customer/${encodeURIComponent(parsed.data.qbCustomerId)}`)
        name = String(found?.Customer?.DisplayName ?? parsed.data.qbCustomerId)
      } catch (e) {
        return fail(c, 400, `QuickBooks does not have that customer: ${quickBooksReason(e)}`, 'no_such_customer', { qbCustomerId: 'Choose a customer from the list.' })
      }
    }
    await db.update(job).set({ qbCustomerId: parsed.data.qbCustomerId, qbCustomerName: name, updatedAt: new Date() } as any).where(and(eq(job.id, row.id), eq(job.companyId, me.companyId)))
    return one(c, { qbCustomerId: parsed.data.qbCustomerId, qbCustomerName: name })
  })

  return app
}
