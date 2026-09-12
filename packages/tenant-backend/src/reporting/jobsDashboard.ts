// The jobs-family home dashboard (contractor, field service, landscaping): counts for the stat cards,
// today's board, and the three recent-activity lists. Salon, vet, events and RV have their own dashboards
// built on their own tables; this is the one the three job-based CRMs used to carry as identical copies.
import { Hono } from 'hono'
import { eq, and, gte, lt, count, desc, inArray, sql } from 'drizzle-orm'

export interface JobsDashboardTables { contact: any; project: any; job: any; quote: any; invoice: any }
export interface JobsDashboardDeps {
  db: any
  tables: JobsDashboardTables
  authenticate: any
  options?: { openStatuses?: string[] }
}

const ISSUED = ['void', 'refunded', 'draft']
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function createJobsDashboardRoutes(deps: JobsDashboardDeps) {
  const { db, tables: t } = deps
  const open = deps.options?.openStatuses || ['sent', 'open', 'viewed', 'partial']
  const app = new Hono()
  app.use('*', deps.authenticate)
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch { return fallback } }

  app.get('/stats', async (c) => {
    const companyId = (c.get('user') as any).companyId
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today.getTime() + 86_400_000)

    const [contactRows, projectsByStatus, jobsByStatus, todayRows, completedTodayRows, quotes, invoices] = await Promise.all([
      safe(() => db.select({ value: count() }).from(t.contact).where(eq(t.contact.companyId, companyId)), [{ value: 0 }]),
      safe(() => db.select({ status: t.project.status, c: count() }).from(t.project).where(eq(t.project.companyId, companyId)).groupBy(t.project.status), [] as any[]),
      safe(() => db.select({ status: t.job.status, c: count() }).from(t.job).where(eq(t.job.companyId, companyId)).groupBy(t.job.status), [] as any[]),
      // Today's board: work scheduled for today that is still live.
      safe(() => db.select({ status: t.job.status, c: count() }).from(t.job)
        .where(and(eq(t.job.companyId, companyId), gte(t.job.scheduledDate, today), lt(t.job.scheduledDate, tomorrow), sql`${t.job.status} <> 'cancelled'`)).groupBy(t.job.status), [] as any[]),
      safe(() => db.select({ value: count() }).from(t.job)
        .where(and(eq(t.job.companyId, companyId), eq(t.job.status, 'completed'), gte(t.job.completedAt, today), lt(t.job.completedAt, tomorrow))), [{ value: 0 }]),
      safe(() => db.select({ status: t.quote.status, total: t.quote.total }).from(t.quote).where(eq(t.quote.companyId, companyId)), [] as any[]),
      safe(() => db.select({ status: t.invoice.status, total: t.invoice.total, amountPaid: t.invoice.amountPaid, dueDate: t.invoice.dueDate }).from(t.invoice).where(eq(t.invoice.companyId, companyId)), [] as any[]),
    ])

    const byStatus = (rows: any[]) => Object.fromEntries(rows.map(r => [r.status, Number(r.c)]))
    const sumCounts = (rows: any[]) => rows.reduce((s, r) => s + Number(r.c), 0)
    const todayByStatus = byStatus(todayRows)

    const quoteStats = { total: quotes.length, pending: 0, approved: 0, totalValue: 0, approvedValue: 0 }
    for (const q of quotes) {
      const v = num(q.total)
      quoteStats.totalValue = r2(quoteStats.totalValue + v)
      if (q.status === 'draft' || q.status === 'sent') quoteStats.pending++
      if (q.status === 'approved') { quoteStats.approved++; quoteStats.approvedValue = r2(quoteStats.approvedValue + v) }
    }

    // Open = issued and not settled. Drafts, void and refunded invoices are not money owed; the old
    // dashboard counted every non-paid invoice (void ones included) as "open" and summed their totals.
    const now = new Date()
    const invoiceStats = { total: 0, outstanding: 0, overdue: 0, paid: 0, totalValue: 0, outstandingValue: 0, overdueValue: 0 }
    for (const inv of invoices) {
      if (ISSUED.includes(inv.status)) continue
      invoiceStats.total++
      invoiceStats.totalValue = r2(invoiceStats.totalValue + num(inv.total))
      if (inv.status === 'paid') { invoiceStats.paid++; continue }
      if (open.includes(inv.status)) {
        const balance = Math.max(0, num(inv.total) - num(inv.amountPaid))
        invoiceStats.outstanding++
        invoiceStats.outstandingValue = r2(invoiceStats.outstandingValue + balance)
        if (inv.dueDate && new Date(inv.dueDate) < now) { invoiceStats.overdue++; invoiceStats.overdueValue = r2(invoiceStats.overdueValue + balance) }
      }
    }

    return c.json({
      contacts: Number(contactRows[0]?.value ?? 0),
      projects: { total: sumCounts(projectsByStatus), byStatus: byStatus(projectsByStatus) },
      jobs: {
        total: sumCounts(jobsByStatus),
        byStatus: byStatus(jobsByStatus),
        today: sumCounts(todayRows),
        todayByStatus,
        dispatchedToday: (todayByStatus.dispatched || 0) + (todayByStatus.en_route || 0),
        inProgressToday: todayByStatus.in_progress || 0,
        completedToday: Number(completedTodayRows[0]?.value ?? 0),
      },
      quotes: quoteStats,
      invoices: invoiceStats,
    })
  })

  app.get('/recent-activity', async (c) => {
    const companyId = (c.get('user') as any).companyId
    const [recentJobs, recentQuotes, recentInvoices] = await Promise.all([
      safe(() => db.select({ id: t.job.id, number: t.job.number, title: t.job.title, status: t.job.status, scheduledDate: t.job.scheduledDate, updatedAt: t.job.updatedAt })
        .from(t.job).where(eq(t.job.companyId, companyId)).orderBy(desc(t.job.updatedAt)).limit(5), [] as any[]),
      safe(() => db.select({ id: t.quote.id, number: t.quote.number, name: t.quote.name, status: t.quote.status, total: t.quote.total, updatedAt: t.quote.updatedAt })
        .from(t.quote).where(eq(t.quote.companyId, companyId)).orderBy(desc(t.quote.updatedAt)).limit(5), [] as any[]),
      safe(() => db.select({ id: t.invoice.id, number: t.invoice.number, status: t.invoice.status, total: t.invoice.total, amountPaid: t.invoice.amountPaid, dueDate: t.invoice.dueDate, updatedAt: t.invoice.updatedAt })
        .from(t.invoice).where(and(eq(t.invoice.companyId, companyId), sql`${t.invoice.status} <> 'draft'`)).orderBy(desc(t.invoice.updatedAt)).limit(5), [] as any[]),
    ])
    const now = new Date()
    return c.json({
      recentJobs,
      recentQuotes,
      recentInvoices: recentInvoices.map((inv: any) => {
        const balance = ISSUED.includes(inv.status) ? 0 : Math.max(0, num(inv.total) - num(inv.amountPaid))
        const status = open.includes(inv.status) && inv.dueDate && new Date(inv.dueDate) < now ? 'overdue' : inv.status
        return { ...inv, balance: r2(balance), status }
      }),
    })
  })

  return app
}
