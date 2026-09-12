// Reports — ONE implementation for every CRM template, vendored into each tenant at generation.
// Revenue (invoiced / collected / outstanding / overdue), monthly trend, top customers, job, project,
// team and quote statistics, and the period summary the Reports page opens with.
//
// Money rules (same as the invoicing module): an invoice counts as "invoiced" once issued and still
// standing (not draft / void / refunded); "collected" is the payment ledger, where a refund is a
// negative row, so it is always net of refunds; a customer's balance never reopens after a refund.
import { Hono } from 'hono'
import { eq, and, gte, lte, lt, sql, count, sum, inArray, desc, isNotNull } from 'drizzle-orm'

export interface ReportingTables {
  invoice: any
  payment: any
  job: any
  project: any
  quote: any
  timeEntry: any
  user: any
  contact: any
}

export interface ReportingOptions {
  /** Invoice statuses that are billed and collectable. Default sent/open/viewed/partial. */
  openStatuses?: string[]
  /** Upper bound for the monthly trend. Default 36. */
  maxMonths?: number
}

export interface ReportingDeps {
  db: any
  tables: ReportingTables
  authenticate: any
  requirePermission: (permission: string) => any
  options?: ReportingOptions
}

export class ReportError extends Error { status = 400 }

const DAY_MS = 86_400_000
const ISSUED = ['void', 'refunded', 'draft']
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export interface DateRange { gte?: Date; lte?: Date }

/** Query dates → a range. endDate is inclusive of its whole day. Garbage is a 400, not a 500. */
export function parseRange(startDate?: string, endDate?: string): DateRange {
  const parse = (v: string | undefined, label: string) => {
    if (v === undefined || v === '') return undefined
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) throw new ReportError(`${label} is not a valid date.`)
    return d
  }
  const gte = parse(startDate, 'startDate')
  const end = parse(endDate, 'endDate')
  const lte = end ? new Date(end.getTime() + DAY_MS - 1) : undefined
  if (gte && lte && gte > lte) throw new ReportError('startDate must be on or before endDate.')
  return { gte, lte }
}

export function createReportingService(deps: ReportingDeps) {
  const { db, tables: t } = deps
  const open = deps.options?.openStatuses || ['sent', 'open', 'viewed', 'partial']
  const maxMonths = deps.options?.maxMonths || 36
  const issued = sql`${t.invoice.status} NOT IN (${sql.join(ISSUED.map(s => sql`${s}`), sql`, `)})`
  const isOpen = inArray(t.invoice.status, open)
  const inRange = (col: any, range: DateRange) => [range.gte ? gte(col, range.gte) : undefined, range.lte ? lte(col, range.lte) : undefined].filter(Boolean) as any[]

  // ---------------------------------------------------------------- revenue

  async function revenueOverview(companyId: string, range: DateRange) {
    const [inv] = await db.select({ total: sum(t.invoice.total), count: count() }).from(t.invoice)
      .where(and(eq(t.invoice.companyId, companyId), issued, ...inRange(t.invoice.createdAt, range)))
    const [col] = await db.select({ total: sum(t.payment.amount) }).from(t.payment)
      .innerJoin(t.invoice, eq(t.payment.invoiceId, t.invoice.id))
      .where(and(eq(t.invoice.companyId, companyId), ...inRange(t.payment.paidAt, range)))
    // Balances are a point-in-time figure — what is owed right now, whatever the period picker says.
    const [out] = await db.select({ total: sql<string>`coalesce(sum(greatest(${t.invoice.total}::numeric - ${t.invoice.amountPaid}::numeric, 0)), 0)`, count: count() })
      .from(t.invoice).where(and(eq(t.invoice.companyId, companyId), isOpen))
    const [over] = await db.select({ total: sql<string>`coalesce(sum(greatest(${t.invoice.total}::numeric - ${t.invoice.amountPaid}::numeric, 0)), 0)`, count: count() })
      .from(t.invoice).where(and(eq(t.invoice.companyId, companyId), isOpen, isNotNull(t.invoice.dueDate), lt(t.invoice.dueDate, new Date())))
    const invoiced = r2(num(inv.total)), collected = r2(num(col.total))
    return {
      invoiced, invoiceCount: Number(inv.count),
      collected,
      outstanding: r2(num(out.total)), outstandingCount: Number(out.count),
      overdue: r2(num(over.total)), overdueCount: Number(over.count),
      collectionRate: invoiced > 0 ? Math.min(100, Math.round((collected / invoiced) * 100)) : 0,
    }
  }

  async function revenueByMonth(companyId: string, monthsRaw: number) {
    const months = Math.min(maxMonths, Math.max(1, Math.round(num(monthsRaw) || 12)))
    const start = new Date(); start.setMonth(start.getMonth() - months + 1); start.setDate(1); start.setHours(0, 0, 0, 0)
    const [invoices, payments] = await Promise.all([
      db.select({ total: t.invoice.total, createdAt: t.invoice.createdAt }).from(t.invoice)
        .where(and(eq(t.invoice.companyId, companyId), gte(t.invoice.createdAt, start), issued)),
      db.select({ amount: t.payment.amount, paidAt: t.payment.paidAt }).from(t.payment)
        .innerJoin(t.invoice, eq(t.payment.invoiceId, t.invoice.id))
        .where(and(eq(t.invoice.companyId, companyId), gte(t.payment.paidAt, start))),
    ])
    const rows: Record<string, { month: string; invoiced: number; collected: number }> = {}
    for (let i = 0; i < months; i++) { const d = new Date(start); d.setMonth(d.getMonth() + i); rows[monthKey(d)] = { month: monthKey(d), invoiced: 0, collected: 0 } }
    for (const inv of invoices) { const k = monthKey(new Date(inv.createdAt)); if (rows[k]) rows[k].invoiced = r2(rows[k].invoiced + num(inv.total)) }
    for (const p of payments) { if (!p.paidAt) continue; const k = monthKey(new Date(p.paidAt)); if (rows[k]) rows[k].collected = r2(rows[k].collected + num(p.amount)) }
    return Object.values(rows)
  }

  /**
   * Top customers by what they actually paid (net of refunds), with what was invoiced alongside.
   * Drafts, void and refunded invoices are not revenue and are not counted.
   */
  async function revenueByCustomer(companyId: string, range: DateRange, limitRaw: number) {
    const limit = Math.min(100, Math.max(1, Math.round(num(limitRaw) || 10)))
    const collectedExpr = sql<string>`coalesce(sum(${t.invoice.amountPaid}::numeric - coalesce(${t.invoice.amountRefunded}, 0)::numeric), 0)`
    const rows = await db.select({ contactId: t.invoice.contactId, invoiced: sum(t.invoice.total), collected: collectedExpr, count: count() })
      .from(t.invoice)
      .where(and(eq(t.invoice.companyId, companyId), isNotNull(t.invoice.contactId), issued, ...inRange(t.invoice.createdAt, range)))
      .groupBy(t.invoice.contactId)
      .orderBy(desc(collectedExpr), desc(sum(t.invoice.total)))
      .limit(limit)
    const ids = rows.map((r: any) => r.contactId).filter(Boolean) as string[]
    if (!ids.length) return []
    const contacts = await db.select({ id: t.contact.id, name: t.contact.name, company: t.contact.company }).from(t.contact)
      .where(and(eq(t.contact.companyId, companyId), inArray(t.contact.id, ids)))
    const byId = new Map(contacts.map((c: any) => [c.id, c]))
    return rows.map((r: any) => {
      const invoiced = r2(num(r.invoiced)), collected = r2(Math.max(0, num(r.collected)))
      return { contact: byId.get(r.contactId) || { id: r.contactId, name: 'Unknown' }, invoiced, collected, total: collected, invoiceCount: Number(r.count) }
    })
  }

  // ---------------------------------------------------------------- jobs

  async function jobStats(companyId: string, range: DateRange) {
    const where = and(eq(t.job.companyId, companyId), ...inRange(t.job.createdAt, range))
    const byStatus = await db.select({ status: t.job.status, count: count() }).from(t.job).where(where).groupBy(t.job.status)
    const counts: Record<string, number> = {}
    let total = 0
    for (const s of byStatus) { counts[s.status] = Number(s.count); total += Number(s.count) }
    const completed = counts.completed || 0
    return { total, byStatus: counts, completed, completionRate: total > 0 ? Math.round((completed / total) * 100) : 0, scheduled: counts.scheduled || 0, inProgress: counts.in_progress || 0, cancelled: counts.cancelled || 0 }
  }

  async function jobsByType(companyId: string, range: DateRange) {
    const rows = await db.select({ type: t.job.type, count: count() }).from(t.job)
      .where(and(eq(t.job.companyId, companyId), isNotNull(t.job.type), ...inRange(t.job.createdAt, range))).groupBy(t.job.type)
    return rows.map((r: any) => ({ type: r.type || 'Uncategorized', count: Number(r.count) }))
  }

  async function jobsByAssignee(companyId: string, range: DateRange) {
    const rows = await db.select({ assignedToId: t.job.assignedToId, count: count() }).from(t.job)
      .where(and(eq(t.job.companyId, companyId), isNotNull(t.job.assignedToId), ...inRange(t.job.createdAt, range))).groupBy(t.job.assignedToId)
    const ids = rows.map((r: any) => r.assignedToId).filter(Boolean) as string[]
    if (!ids.length) return []
    const users = await db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(inArray(t.user.id, ids))
    const byId = new Map(users.map((u: any) => [u.id, u]))
    return rows.map((r: any) => ({ user: byId.get(r.assignedToId), count: Number(r.count) }))
  }

  // ---------------------------------------------------------------- projects

  async function projectStats(companyId: string) {
    const [byStatus, [value]] = await Promise.all([
      db.select({ status: t.project.status, count: count() }).from(t.project).where(eq(t.project.companyId, companyId)).groupBy(t.project.status),
      db.select({ value: sum(t.project.estimatedValue) }).from(t.project).where(eq(t.project.companyId, companyId)),
    ])
    const counts: Record<string, number> = {}
    let total = 0
    for (const s of byStatus) { counts[s.status] = Number(s.count); total += Number(s.count) }
    return { total, active: counts.active || 0, completed: counts.completed || 0, onHold: counts.on_hold || 0, totalValue: r2(num(value.value)) }
  }

  async function projectProfitability(companyId: string, limitRaw: number) {
    const limit = Math.min(100, Math.max(1, Math.round(num(limitRaw) || 10)))
    const projects = await db.select({ id: t.project.id, name: t.project.name, number: t.project.number, estimatedValue: t.project.estimatedValue, status: t.project.status })
      .from(t.project).where(eq(t.project.companyId, companyId)).orderBy(desc(t.project.estimatedValue)).limit(limit)
    const ids = projects.map((p: any) => p.id)
    if (!ids.length) return []
    const [invoiceTotals, jobCounts] = await Promise.all([
      db.select({ projectId: t.invoice.projectId, invoiced: sum(t.invoice.total), collected: sql<string>`coalesce(sum(${t.invoice.amountPaid}::numeric - coalesce(${t.invoice.amountRefunded}, 0)::numeric), 0)` })
        .from(t.invoice).where(and(inArray(t.invoice.projectId, ids), issued)).groupBy(t.invoice.projectId),
      db.select({ projectId: t.job.projectId, count: count() }).from(t.job).where(inArray(t.job.projectId, ids)).groupBy(t.job.projectId),
    ])
    const inv = new Map(invoiceTotals.map((i: any) => [i.projectId, i]))
    const jobs = new Map(jobCounts.map((j: any) => [j.projectId, Number(j.count)]))
    return projects.map((p: any) => {
      const i: any = inv.get(p.id)
      const invoiced = r2(num(i?.invoiced)), collected = r2(Math.max(0, num(i?.collected)))
      return { id: p.id, name: p.name, number: p.number, status: p.status, value: r2(num(p.estimatedValue)), invoiced, collected, jobCount: jobs.get(p.id) || 0, collectionRate: invoiced > 0 ? Math.min(100, Math.round((collected / invoiced) * 100)) : 0 }
    })
  }

  // ---------------------------------------------------------------- team

  async function teamProductivity(companyId: string, range: DateRange) {
    const [time, jobs] = await Promise.all([
      db.select({ userId: t.timeEntry.userId, hours: sum(t.timeEntry.hours), count: count() }).from(t.timeEntry)
        .where(and(eq(t.timeEntry.companyId, companyId), ...inRange(t.timeEntry.date, range))).groupBy(t.timeEntry.userId),
      db.select({ assignedToId: t.job.assignedToId, count: count() }).from(t.job)
        .where(and(eq(t.job.companyId, companyId), eq(t.job.status, 'completed'), isNotNull(t.job.assignedToId), ...inRange(t.job.completedAt, range))).groupBy(t.job.assignedToId),
    ])
    const ids = [...new Set([...time.map((x: any) => x.userId), ...jobs.map((j: any) => j.assignedToId)])].filter(Boolean) as string[]
    if (!ids.length) return []
    const users = await db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, role: t.user.role }).from(t.user).where(inArray(t.user.id, ids))
    const byId = new Map(users.map((u: any) => [u.id, u]))
    const timeBy = new Map(time.map((x: any) => [x.userId, x]))
    const jobsBy = new Map(jobs.map((j: any) => [j.assignedToId, j]))
    return ids.map(id => {
      const tm: any = timeBy.get(id), jb: any = jobsBy.get(id)
      return { user: byId.get(id), hoursWorked: Math.round(num(tm?.hours) * 10) / 10, timeEntries: Number(tm?.count || 0), jobsCompleted: Number(jb?.count || 0) }
    }).sort((a, b) => b.hoursWorked - a.hoursWorked || b.jobsCompleted - a.jobsCompleted)
  }

  // ---------------------------------------------------------------- quotes

  async function quoteStats(companyId: string, range: DateRange) {
    const where = and(eq(t.quote.companyId, companyId), ...inRange(t.quote.createdAt, range))
    const byStatus = await db.select({ status: t.quote.status, count: count(), value: sum(t.quote.total) }).from(t.quote).where(where).groupBy(t.quote.status)
    const data: Record<string, { count: number; value: number }> = {}
    let total = 0, totalValue = 0
    for (const s of byStatus) { data[s.status] = { count: Number(s.count), value: r2(num(s.value)) }; total += Number(s.count); totalValue += num(s.value) }
    const approved = data.approved || { count: 0, value: 0 }
    // Conversion = approved ÷ decided (approved + rejected/declined/expired) — measures the cohort against itself.
    const decided = approved.count + (data.rejected?.count || 0) + (data.declined?.count || 0) + (data.expired?.count || 0)
    return {
      total, totalValue: r2(totalValue),
      approved: approved.count, approvedValue: approved.value,
      pending: (data.draft?.count || 0) + (data.sent?.count || 0),
      rejected: (data.rejected?.count || 0) + (data.declined?.count || 0),
      expired: data.expired?.count || 0,
      conversionRate: decided > 0 ? Math.round((approved.count / decided) * 100) : 0,
    }
  }

  // ---------------------------------------------------------------- summary + activity

  async function recentActivity(companyId: string, limit = 10) {
    const [invoices, jobs, quotes] = await Promise.all([
      db.select({ id: t.invoice.id, number: t.invoice.number, total: t.invoice.total, status: t.invoice.status, createdAt: t.invoice.createdAt }).from(t.invoice).where(eq(t.invoice.companyId, companyId)).orderBy(desc(t.invoice.createdAt)).limit(5),
      db.select({ id: t.job.id, number: t.job.number, title: t.job.title, status: t.job.status, createdAt: t.job.createdAt }).from(t.job).where(eq(t.job.companyId, companyId)).orderBy(desc(t.job.createdAt)).limit(5),
      db.select({ id: t.quote.id, number: t.quote.number, total: t.quote.total, status: t.quote.status, createdAt: t.quote.createdAt }).from(t.quote).where(eq(t.quote.companyId, companyId)).orderBy(desc(t.quote.createdAt)).limit(5),
    ])
    return [
      ...invoices.map((i: any) => ({ type: 'invoice' as const, ...i })),
      ...jobs.map((j: any) => ({ type: 'job' as const, ...j })),
      ...quotes.map((q: any) => ({ type: 'quote' as const, ...q })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit)
  }

  /** The Reports page opener. Honours the period the page asked for (default: last 30 days). */
  async function dashboardSummary(companyId: string, range: DateRange) {
    const now = new Date()
    const effective: DateRange = range.gte || range.lte ? range : { gte: new Date(now.getTime() - 30 * DAY_MS), lte: now }
    const days = effective.gte && effective.lte ? Math.max(1, Math.round((effective.lte.getTime() - effective.gte.getTime()) / DAY_MS)) : null
    const [revenue, jobs, projects, quotes, activity] = await Promise.all([
      revenueOverview(companyId, effective), jobStats(companyId, effective), projectStats(companyId), quoteStats(companyId, effective), recentActivity(companyId, 10),
    ])
    return {
      period: days ? `${days} days` : 'all time',
      range: { startDate: effective.gte?.toISOString() || null, endDate: effective.lte?.toISOString() || null },
      revenue, jobs, projects, quotes, recentActivity: activity,
    }
  }

  return { revenueOverview, revenueByMonth, revenueByCustomer, jobStats, jobsByType, jobsByAssignee, projectStats, projectProfitability, teamProductivity, quoteStats, dashboardSummary, recentActivity }
}

export type ReportingService = ReturnType<typeof createReportingService>

export function createReportingRoutes(deps: ReportingDeps) {
  const svc = createReportingService(deps)
  const app = new Hono()
  app.use('*', deps.authenticate)
  const guard = deps.requirePermission('reports:read')
  app.onError((e, c) => {
    if (e instanceof ReportError) return c.json({ error: e.message }, 400)
    throw e
  })
  const cid = (c: any) => (c.get('user') as any).companyId
  const range = (c: any) => parseRange(c.req.query('startDate'), c.req.query('endDate'))
  const int = (c: any, key: string, fallback: number) => { const v = c.req.query(key); if (v === undefined || v === '') return fallback; const n = Number(v); if (!Number.isFinite(n)) throw new ReportError(`${key} must be a number.`); return n }

  app.get('/dashboard', guard, async (c) => c.json(await svc.dashboardSummary(cid(c), range(c))))
  app.get('/revenue', guard, async (c) => c.json(await svc.revenueOverview(cid(c), range(c))))
  app.get('/revenue/monthly', guard, async (c) => c.json(await svc.revenueByMonth(cid(c), int(c, 'months', 12))))
  app.get('/revenue/customers', guard, async (c) => c.json(await svc.revenueByCustomer(cid(c), range(c), int(c, 'limit', 10))))
  app.get('/jobs', guard, async (c) => c.json(await svc.jobStats(cid(c), range(c))))
  app.get('/jobs/types', guard, async (c) => c.json(await svc.jobsByType(cid(c), range(c))))
  app.get('/jobs/assignees', guard, async (c) => c.json(await svc.jobsByAssignee(cid(c), range(c))))
  app.get('/projects', guard, async (c) => c.json(await svc.projectStats(cid(c))))
  app.get('/projects/profitability', guard, async (c) => c.json(await svc.projectProfitability(cid(c), int(c, 'limit', 10))))
  app.get('/team', guard, async (c) => c.json(await svc.teamProductivity(cid(c), range(c))))
  app.get('/quotes', guard, async (c) => c.json(await svc.quoteStats(cid(c), range(c))))
  return app
}
