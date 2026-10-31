// Two reports a builder buys on (brief item 8): who owes what and how late (AR aging), and where each open piece of work
// stands against what it was sold for (WIP). Both read only — nothing here moves money.
//
//   GET /api/receivables/aging   feature ar_aging    reports:read   what is owed, by customer, by how many days past due
//   GET /api/wip                 feature wip_report  reports:read   each open project (and each open job not on a project)
//
// AR AGING counts exactly the invoices and balances the Reports page's "Outstanding now" counts (issued = not draft / void /
// refunded; balance = invoiceBalance), so its total is that figure and its overdue buckets add up to that page's "Overdue now".
// Buckets are days past the due date on the business's own calendar day: Current (not yet due), 1–30, 31–60, 61–90, 90+ —
// the same cut-offs as home care's Billing aging (data/homecareBillingRoutes.ts). One difference, on purpose: an invoice with
// no due date is Current here (the Reports page cannot call it overdue either), where home care counts it from the day sent.
//
// WIP (work in progress), per open project:
//   contract value = the project's approved quotes + its approved change orders (the project's estimated value, marked as
//                    such, when no quote has been approved yet)
//   billed         = invoices raised on the project or on its jobs, drafts and voids left out, each counted once
//   cost to date   = what its jobs have cost so far (labour, materials, expenses, vendor bills — the Job Costing figures)
//   % complete     = cost to date ÷ the budget's cost where the approved quotes gave one (cost-to-cost); else the project's own
//                    progress figure. The answer says which.
//   earned         = contract value × % complete;  over / under billing = billed − earned (positive: billed ahead of the work)
// A job that is open and on no project is its own row (a field-service business has no projects): contract value is its quote,
// % complete is cost ÷ the quote's estimated cost when the quote carries one — otherwise it has no % and no over/under, and
// the row says why rather than guess.
import { Hono } from 'hono'
import { and, asc, eq, inArray, isNull, notInArray, or } from 'drizzle-orm'
import { businessToday, companyTimeZone, invoiceBalance, round2 } from '@twomiah/tenant-backend'
import { changeOrder, contact, invoice, job, project, projectBudgetLine, quote } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from './jobCostingService.ts'

const DAY = 86_400_000
/** Not issued: a draft, void or fully-returned invoice is not owed (reporting.ts ISSUED). */
const NOT_ISSUED = ['void', 'refunded', 'draft']
/** Not billed: a draft or void is not billed. A refunded sale was still billed (reporting.ts BILLED). */
const NOT_BILLED = ['void', 'draft']
const BUCKETS = ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'] as const
type Bucket = typeof BUCKETS[number]
export const bucketFor = (daysPastDue: number): Bucket =>
  daysPastDue <= 0 ? 'current' : daysPastDue <= 30 ? 'days1to30' : daysPastDue <= 60 ? 'days31to60' : daysPastDue <= 90 ? 'days61to90' : 'over90'
const empty = () => ({ current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 })

export function createReceivablesRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/aging', requirePermission('reports:read'), async (c) => {
    const me = c.get('user') as any
    const today = businessToday(await companyTimeZone(db, me.companyId))
    const rows = await db.select({
      id: invoice.id, status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded,
      dueDate: invoice.dueDate, contactId: invoice.contactId, contactName: contact.name,
    }).from(invoice).leftJoin(contact, eq(invoice.contactId, contact.id))
      .where(and(eq(invoice.companyId, me.companyId), notInArray(invoice.status, NOT_ISSUED))) as any[]

    const totals = empty()
    const byCustomer = new Map<string, any>()
    let invoiceCount = 0
    for (const r of rows) {
      const balance = invoiceBalance(r)
      if (balance <= 0.005) continue
      // Whole days past the due date; a due date is a calendar day kept at UTC midnight (money.ts dueDateFromTerms).
      const daysPast = r.dueDate ? Math.round((today.getTime() - Date.UTC(new Date(r.dueDate).getUTCFullYear(), new Date(r.dueDate).getUTCMonth(), new Date(r.dueDate).getUTCDate())) / DAY) : 0
      const b = bucketFor(daysPast)
      const key = r.contactId || '-'
      const row = byCustomer.get(key) || { contactId: r.contactId || null, name: r.contactName || 'No customer on the invoice', invoiceCount: 0, ...empty() }
      row[b] = round2(row[b] + balance); row.total = round2(row.total + balance); row.invoiceCount++
      byCustomer.set(key, row)
      totals[b] = round2(totals[b] + balance); totals.total = round2(totals.total + balance); invoiceCount++
    }
    const customers = [...byCustomer.values()].sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)))
    return one(c, { asOf: today.toISOString().slice(0, 10), totals, customers, invoiceCount })
  })

  return app
}

export function createWipRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const jobCosting = createJobCostingService(d)
  const app = new Hono<AppEnv>()
  const sumBy = <T,>(rows: T[], key: (r: T) => string | null, val: (r: T) => number) => {
    const m = new Map<string, number>()
    for (const r of rows) { const k = key(r); if (k) m.set(k, round2((m.get(k) || 0) + val(r))) }
    return m
  }

  app.get('/', requirePermission('reports:read'), async (c) => {
    const me = c.get('user') as any
    const companyId = me.companyId as string
    const closed = ['completed', 'cancelled']
    const projects = await db.select().from(project)
      .where(and(eq(project.companyId, companyId), notInArray(project.status, closed))).orderBy(asc(project.name)) as any[]
    const projectIds = projects.map((p) => p.id)

    // Jobs: every job on an open project (their cost counts however done), and the open jobs that are on no project.
    const onProjects = projectIds.length ? await db.select().from(job).where(and(eq(job.companyId, companyId), inArray(job.projectId, projectIds))) as any[] : []
    const loose = await db.select().from(job)
      .where(and(eq(job.companyId, companyId), isNull(job.projectId), notInArray(job.status, ['completed', 'cancelled', 'canceled']))) as any[]
    const jobIds = [...onProjects, ...loose].map((j) => j.id)
    const costs = await jobCosting.costsByJob(companyId, jobIds)
    const projectOfJob = new Map<string, string>(onProjects.map((j) => [j.id, j.projectId]))

    // Billed: each invoice once, to the project it is on — or its job's project — or the loose job it bills.
    const invs = (projectIds.length || loose.length) ? await db.select({ id: invoice.id, total: invoice.total, projectId: invoice.projectId, jobId: invoice.jobId, status: invoice.status }).from(invoice)
      .where(and(eq(invoice.companyId, companyId), notInArray(invoice.status, NOT_BILLED),
        or(projectIds.length ? inArray(invoice.projectId, projectIds) : undefined, jobIds.length ? inArray(invoice.jobId, jobIds) : undefined))) as any[] : []
    const billedToProject = sumBy(invs, (i) => (i.projectId && projectIds.includes(i.projectId) ? i.projectId : i.jobId ? projectOfJob.get(i.jobId) || null : null), (i) => Number(i.total) || 0)
    const looseIds = new Set(loose.map((j) => j.id))
    const billedToJob = sumBy(invs, (i) => (!(i.projectId && projectIds.includes(i.projectId)) && i.jobId && looseIds.has(i.jobId) ? i.jobId : null), (i) => Number(i.total) || 0)

    const quotes = projectIds.length ? await db.select({ projectId: quote.projectId, total: quote.total }).from(quote)
      .where(and(eq(quote.companyId, companyId), eq(quote.status, 'approved'), inArray(quote.projectId, projectIds))) as any[] : []
    const cos = projectIds.length ? await db.select({ projectId: changeOrder.projectId, amount: changeOrder.amount }).from(changeOrder)
      .where(and(eq(changeOrder.companyId, companyId), eq(changeOrder.status, 'approved'), inArray(changeOrder.projectId, projectIds))) as any[] : []
    const budgets = projectIds.length ? await db.select().from(projectBudgetLine).where(and(eq(projectBudgetLine.companyId, companyId), inArray(projectBudgetLine.projectId, projectIds))) as any[] : []
    const quoted = sumBy(quotes, (q) => q.projectId, (q) => Number(q.total) || 0)
    const changed = sumBy(cos, (o) => o.projectId, (o) => Number(o.amount) || 0)
    const budgetCost = sumBy(budgets, (b) => b.projectId, (b) => Number(b.estimatedCost) || 0)
    const uncosted = sumBy(budgets, (b) => b.projectId, (b) => Number(b.uncostedLines) || 0)

    const rows: any[] = []
    for (const p of projects) {
      const cost = round2([...onProjects].filter((j) => j.projectId === p.id).reduce((s, j) => s + (costs.get(j.id)?.totalCost || 0), 0))
      const approvedQuotes = quoted.get(p.id) || 0
      const approvedChanges = changed.get(p.id) || 0
      const estimate = Number(p.estimatedValue) || 0
      const contractSource = approvedQuotes > 0 ? 'quotes' : estimate > 0 ? 'estimate' : 'none'
      const contract = round2((approvedQuotes > 0 ? approvedQuotes : estimate) + approvedChanges)
      const budgetedCost = budgetCost.get(p.id) || 0
      const costToCost = budgetedCost > 0
      const percent = costToCost ? Math.min(100, Math.round((cost / budgetedCost) * 1000) / 10) : Number(p.progress) || 0
      const billed = billedToProject.get(p.id) || 0
      const earned = round2(contract * percent / 100)
      rows.push({
        kind: 'project', id: p.id, number: p.number, name: p.name, status: p.status,
        contractValue: contract, approvedChanges, contractSource,
        billed, costToDate: cost, percentComplete: percent, percentSource: costToCost ? 'cost' : 'progress',
        costsMissingOnBudget: Number(uncosted.get(p.id) || 0) > 0,
        earned, overUnder: round2(billed - earned),
      })
    }
    // A job on no project: its quote is the contract; with no estimated cost on the quote there is no honest % complete.
    const loosest = loose.length ? await jobCosting.getJobCostingSummary(companyId, { limit: 500 } as any) : null
    const summaryById = new Map<string, any>(((loosest as any)?.jobs || []).map((j: any) => [j.id, j]))
    for (const j of loose) {
      const s = summaryById.get(j.id)
      const contract = round2(s?.estimatedRevenue || 0)
      const estCost = Number(s?.estimatedCost) || 0
      const cost = costs.get(j.id)?.totalCost || 0
      const billed = billedToJob.get(j.id) || 0
      const hasPercent = estCost > 0
      const percent = hasPercent ? Math.min(100, Math.round((cost / estCost) * 1000) / 10) : null
      const earned = hasPercent ? round2(contract * (percent as number) / 100) : null
      rows.push({
        kind: 'job', id: j.id, number: j.number, name: j.title, status: j.status,
        contractValue: contract, approvedChanges: 0, contractSource: contract > 0 ? 'quotes' : 'none',
        billed, costToDate: cost, percentComplete: percent, percentSource: hasPercent ? 'cost' : 'none',
        costsMissingOnBudget: false, earned, overUnder: earned === null ? null : round2(billed - earned),
      })
    }
    const sum = (k: string) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0))
    return one(c, {
      rows,
      totals: { contractValue: sum('contractValue'), billed: sum('billed'), costToDate: sum('costToDate'), earned: sum('earned'), overUnder: sum('overUnder') },
      truncated: !!(loosest as any)?.truncated,
    })
  })

  return app
}
