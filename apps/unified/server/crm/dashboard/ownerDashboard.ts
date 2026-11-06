// /api/owner-dashboard — what needs the owner's attention today, and where the crew is (feature owner_dashboard, not ready).
//
//   GET /   dashboard:read   { attention: [{ id, label, count, amount?, detail?, href }], crewToday?: [{ person, jobs }] }
//
// Each part is sent only to a seat that may see it, and only where the business has what it counts — the key or the item is
// absent otherwise, so a screen can tell "not yours to see" from "none". The items, each with the permission and the feature
// that make it:
//   quotes_waiting   quotes:read   + quotes          sent or opened, and no answer for 7 days or more (the company's calendar)
//   bills_due        bills:read    + vendor_bills    open bills past due or due in the next 7 days, and what is left to pay on them
//   unassigned_jobs  jobs:read-all + jobs            jobs in the next 7 days (today included) that nobody is on
//   over_budget      reports:read  + job_budgets     active projects whose cost so far is past what the approved quote budgeted
// Cash in, what is owed and who is waiting on an answer are the money strip's (dashboard-strip) and are not repeated here.
// crewToday (jobs:read-all): today's jobs by the person who leads them, the same rule as the Jobs-today tile. Nothing moves money.
import { Hono } from 'hono'
import { and, eq, inArray, ne, notInArray } from 'drizzle-orm'
import { companyTimeZone, storeDayRange, storeDateString, markerDay, markerDayIsOver, daysUntilMarker, jobsTodayCondition, round2 } from '@twomiah/tenant-backend'
import { job, jobAssignee, vendorBill, project, user as userTable, quote, projectBudgetLine } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { createQuoteBudget } from '../billing/quoteBudget.ts'
import { AWAITING } from '../billing/quoteFollowUp.ts'
import { daysWaiting } from '../leads/leadPipeline.ts'

export const QUOTE_WAITING_DAYS = 7
export const WINDOW_DAYS = 7
const OVER_BUDGET_LIMIT = 25
const DONE_JOB = ['completed', 'cancelled']

export interface Attention { id: string; label: string; count: number; amount?: number; detail?: string[]; href: string }

/** A job's own calendar day: a booking carries a real instant (read on the company's clock); every other job a day marker. */
export const jobDay = (j: { scheduledDate: Date | string | null; source?: string | null }, tz: string): string | null =>
  !j.scheduledDate ? null : j.source === 'online_booking' ? storeDateString(new Date(j.scheduledDate), tz) : markerDay(j.scheduledDate)

export function createOwnerDashboardRoutes(d: CrmDeps) {
  const { db } = d
  const mayWith = canSeeWith(d.permissions)
  const { requirePermission } = d.permissions
  const quoteBudget = createQuoteBudget(d)
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('dashboard:read'), async (c) => {
    const me = c.get('user')
    const companyId = me.companyId
    const [features, tz] = await Promise.all([d.features.enabledFeaturesFor(companyId), companyTimeZone(db, companyId)])
    const may = (p: string) => mayWith(me.role, p, me.userId)
    const now = new Date()
    const attention: Attention[] = []

    if (features.includes('quotes') && await may('quotes:read')) {
      const rows = await db.select({ total: quote.total, sentAt: quote.sentAt, issueDate: quote.issueDate }).from(quote)
        .where(and(eq(quote.companyId, companyId), inArray(quote.status, AWAITING)))
      const stale = rows.filter((q: any) => daysWaiting(q.sentAt || q.issueDate, tz, now) >= QUOTE_WAITING_DAYS)
      attention.push({ id: 'quotes_waiting', label: `Quotes with no answer for ${QUOTE_WAITING_DAYS} days or more`, count: stale.length, amount: round2(stale.reduce((s: number, q: any) => s + Number(q.total), 0)), href: '/crm/quotes' })
    }

    if (features.includes('vendor_bills') && await may('bills:read')) {
      const rows = await db.select({ amount: vendorBill.amount, amountPaid: vendorBill.amountPaid, dueDate: vendorBill.dueDate }).from(vendorBill)
        .where(and(eq(vendorBill.companyId, companyId), inArray(vendorBill.status, ['open', 'partial'])))
      const due = rows.filter((b: any) => b.dueDate && (markerDayIsOver(b.dueDate, tz) || daysUntilMarker(b.dueDate, tz, now) <= WINDOW_DAYS))
      attention.push({ id: 'bills_due', label: `Bills past due or due in the next ${WINDOW_DAYS} days`, count: due.length, amount: round2(due.reduce((s: number, b: any) => s + (Number(b.amount) - Number(b.amountPaid || 0)), 0)), href: '/crm/bills' })
    }

    const mayAllJobs = features.includes('jobs') && await may('jobs:read-all')
    if (mayAllJobs) {
      const today = storeDateString(now, tz)
      const horizon = storeDateString(new Date(now.getTime() + WINDOW_DAYS * 86_400_000), tz)
      const rows = await db.select({ id: job.id, scheduledDate: job.scheduledDate, source: job.source, assignedToId: job.assignedToId, assignedToMemberId: job.assignedToMemberId })
        .from(job).where(and(eq(job.companyId, companyId), notInArray(job.status, DONE_JOB)))
      const helpers = new Set<string>((await db.select({ id: jobAssignee.jobId }).from(jobAssignee).where(eq(jobAssignee.companyId, companyId))).map((r: any) => r.id))
      const open = rows.filter((j: any) => { const day = jobDay(j, tz); return !!day && day >= today && day <= horizon && !j.assignedToId && !j.assignedToMemberId && !helpers.has(j.id) })
      attention.push({ id: 'unassigned_jobs', label: `Jobs in the next ${WINDOW_DAYS} days that nobody is on`, count: open.length, href: '/crm/jobs' })
    }

    if (features.includes('job_budgets') && features.includes('projects') && await may('reports:read')) {
      const withBudget = await db.select({ projectId: projectBudgetLine.projectId }).from(projectBudgetLine).where(eq(projectBudgetLine.companyId, companyId))
      const ids = [...new Set<string>(withBudget.map((r: any) => r.projectId))]
      const active = ids.length ? await db.select({ id: project.id, name: project.name }).from(project)
        .where(and(eq(project.companyId, companyId), inArray(project.id, ids), ne(project.status, 'completed'), ne(project.status, 'cancelled'))) : []
      const over: Array<{ name: string; by: number }> = []
      for (const p of active.slice(0, OVER_BUDGET_LIMIT) as any[]) {
        const b = await quoteBudget.budgetWithActuals(companyId, p.id)
        if (b.remainingCost < 0) over.push({ name: p.name, by: round2(-b.remainingCost) })
      }
      over.sort((a, b) => b.by - a.by)
      attention.push({ id: 'over_budget', label: 'Projects over their budget', count: over.length, amount: round2(over.reduce((s, o) => s + o.by, 0)), detail: over.slice(0, 5).map((o) => o.name), href: '/crm/projects' })
    }

    const out: { attention: Attention[]; crewToday?: Array<{ person: { id: string; name: string } | null; jobs: Array<{ id: string; number: string; title: string; status: string; scheduledTime: string | null }> }> } = { attention }
    if (mayAllJobs) {
      const rows = await db.select({ id: job.id, number: job.number, title: job.title, status: job.status, scheduledTime: job.scheduledTime, assignedToId: job.assignedToId, first: userTable.firstName, last: userTable.lastName })
        .from(job).leftJoin(userTable, eq(job.assignedToId, userTable.id))
        .where(and(eq(job.companyId, companyId), jobsTodayCondition(job, tz)))
      const by = new Map<string, any>()
      for (const r of rows as any[]) {
        const key = r.assignedToId || ''
        const g = by.get(key) || { person: r.assignedToId ? { id: r.assignedToId, name: `${r.first || ''} ${r.last || ''}`.trim() || 'Someone on the team' } : null, jobs: [] }
        g.jobs.push({ id: r.id, number: r.number, title: r.title, status: r.status, scheduledTime: r.scheduledTime })
        by.set(key, g)
      }
      out.crewToday = [...by.values()].sort((a, b) => (a.person ? 0 : 1) - (b.person ? 0 : 1) || String(a.person?.name || '').localeCompare(String(b.person?.name || '')))
    }
    return one(c, out)
  })

  return app
}
