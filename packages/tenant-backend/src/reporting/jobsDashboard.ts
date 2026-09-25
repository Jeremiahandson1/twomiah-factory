// The jobs-family home dashboard (contractor, field service, landscaping): counts for the stat cards,
// today's board, and the three recent-activity lists. Salon, vet, events and RV have their own dashboards
// built on their own tables; this is the one the three job-based CRMs used to carry as identical copies.
import { Hono } from 'hono'
import { eq, and, gte, lt, count, desc, inArray, sql } from 'drizzle-orm'
import { companyTimeZone, storeDayRange, jobLocalDay } from '../time/businessDay'
import { invoiceBalance } from '../invoicing/money'

export interface JobsDashboardTables { contact: any; project: any; job: any; quote: any; invoice: any }
export interface JobsDashboardDeps {
  db: any
  tables: JobsDashboardTables
  authenticate: any
  /**
   * May this caller see money? Invoice and quote screens are gated by invoices:read / quotes:read, but
   * the dashboard is gated by dashboard:read, which every role has — so a field technician was shown
   * outstanding balances, the open-invoice count and recent invoices with amounts, while the Invoices
   * page correctly refused them. The lock on the page was decoration.
   *
   * Optional: a template that does not wire it keeps exactly the behaviour it has today, rather than
   * silently hiding figures somebody relies on. (Field Service T30 HIGH)
   */
  canSee?: (role: string, permission: string, userId?: string) => Promise<boolean> | boolean
  options?: { openStatuses?: string[] }
}

const ISSUED = ['void', 'refunded', 'draft']
/** Money is hidden only when we have been given a way to ask AND the answer is no. */
const MONEY_PERMISSION = 'invoices:read'
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function createJobsDashboardRoutes(deps: JobsDashboardDeps) {
  const { db, tables: t } = deps
  const open = deps.options?.openStatuses || ['sent', 'open', 'viewed', 'partial']
  const app = new Hono()
  /**
   * True when the caller may see money. No `canSee` wired → true, so an un-migrated template is
   * unchanged; a thrown lookup also answers true, because a dashboard that cannot read the permission
   * list must not start hiding an owner's own figures.
   */
  const maySeeMoney = async (c: any) => {
    if (!deps.canSee) return true
    const u = c.get('user') as any
    try { return await deps.canSee(u?.role, MONEY_PERMISSION, u?.userId) } catch { return true }
  }
  app.use('*', deps.authenticate)
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch { return fallback } }

  app.get('/stats', async (c) => {
    const companyId = (c.get('user') as any).companyId
    // The store's day, not the server's. setHours(0,0,0,0) is UTC midnight on Render, so this board
    // rolled over at 8pm in Ohio and "completed today" counted only what was finished after 7pm.
    // Unconfigured companies resolve to UTC and are unaffected. (T24 N1, the shared surfaces)
    const tz = await companyTimeZone(db, companyId)
    const { start: today, end: tomorrow, date: localToday } = storeDayRange(tz)

    const [contactRows, projectsByStatus, jobsByStatus, todayRows, completedTodayRows, quotes, invoices] = await Promise.all([
      safe(() => db.select({ value: count() }).from(t.contact).where(eq(t.contact.companyId, companyId)), [{ value: 0 }]),
      safe(() => db.select({ status: t.project.status, c: count() }).from(t.project).where(eq(t.project.companyId, companyId)).groupBy(t.project.status), [] as any[]),
      safe(() => db.select({ status: t.job.status, c: count() }).from(t.job).where(eq(t.job.companyId, companyId)).groupBy(t.job.status), [] as any[]),
      // Today's board: work scheduled for today that is still live.
      // scheduled_date holds a calendar-day marker for a job made here and a real instant for one made
      // by a booking, so the day is taken per row — see jobLocalDay.
      safe(() => db.select({ status: t.job.status, c: count() }).from(t.job)
        .where(and(eq(t.job.companyId, companyId), sql`${jobLocalDay(t.job.scheduledDate, t.job.source, tz)} = ${localToday}::date`, sql`${t.job.status} <> 'cancelled'`)).groupBy(t.job.status), [] as any[]),
      safe(() => db.select({ value: count() }).from(t.job)
        .where(and(eq(t.job.companyId, companyId), eq(t.job.status, 'completed'), gte(t.job.completedAt, today), lt(t.job.completedAt, tomorrow))), [{ value: 0 }]),
      safe(() => db.select({ status: t.quote.status, total: t.quote.total }).from(t.quote).where(eq(t.quote.companyId, companyId)), [] as any[]),
      safe(() => db.select({ status: t.invoice.status, total: t.invoice.total, amountPaid: t.invoice.amountPaid, amountRefunded: t.invoice.amountRefunded, dueDate: t.invoice.dueDate }).from(t.invoice).where(eq(t.invoice.companyId, companyId)), [] as any[]),
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
    // What was BILLED (total / totalValue) is gross — a refunded sale was still invoiced, and is still
    // counted here, exactly as Reports and the invoice /stats count it (T14 H4 → #204). Only draft and
    // void never happened.
    const now = new Date()
    const invoiceStats = { total: 0, outstanding: 0, overdue: 0, paid: 0, totalValue: 0, outstandingValue: 0, overdueValue: 0 }
    for (const inv of invoices) {
      if (inv.status === 'draft' || inv.status === 'void') continue
      invoiceStats.total++
      invoiceStats.totalValue = r2(invoiceStats.totalValue + num(inv.total))
      if (ISSUED.includes(inv.status)) continue // refunded: billed, but nothing is owed and it is not "paid"
      if (inv.status === 'paid') { invoiceStats.paid++; continue }
      if (open.includes(inv.status)) {
        const balance = invoiceBalance(inv)
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
        // still to do: everything that isn't finished or called off — what an "open jobs" tile means.
        // (Landscaping T14 M2: the portal's "Open Jobs" showed every job, completed and cancelled included)
        open: sumCounts(jobsByStatus) - (byStatus(jobsByStatus).completed || 0) - (byStatus(jobsByStatus).cancelled || 0),
        byStatus: byStatus(jobsByStatus),
        today: sumCounts(todayRows),
        todayByStatus,
        dispatchedToday: (todayByStatus.dispatched || 0) + (todayByStatus.en_route || 0),
        inProgressToday: todayByStatus.in_progress || 0,
        completedToday: Number(completedTodayRows[0]?.value ?? 0),
      },
      quotes: quoteStats,
      // Money only for a caller entitled to it. The counts a technician needs (jobs, schedule) stay.
      invoices: (await maySeeMoney(c)) ? invoiceStats : undefined,
    })
  })

  app.get('/recent-activity', async (c) => {
    const companyId = (c.get('user') as any).companyId
    const [recentJobs, recentQuotes, recentInvoices] = await Promise.all([
      safe(() => db.select({ id: t.job.id, number: t.job.number, title: t.job.title, status: t.job.status, scheduledDate: t.job.scheduledDate, updatedAt: t.job.updatedAt })
        .from(t.job).where(eq(t.job.companyId, companyId)).orderBy(desc(t.job.updatedAt)).limit(5), [] as any[]),
      safe(() => db.select({ id: t.quote.id, number: t.quote.number, name: t.quote.name, status: t.quote.status, total: t.quote.total, updatedAt: t.quote.updatedAt })
        .from(t.quote).where(eq(t.quote.companyId, companyId)).orderBy(desc(t.quote.updatedAt)).limit(5), [] as any[]),
      safe(() => db.select({ id: t.invoice.id, number: t.invoice.number, status: t.invoice.status, total: t.invoice.total, amountPaid: t.invoice.amountPaid, amountRefunded: t.invoice.amountRefunded, dueDate: t.invoice.dueDate, updatedAt: t.invoice.updatedAt })
        .from(t.invoice).where(and(eq(t.invoice.companyId, companyId), sql`${t.invoice.status} <> 'draft'`)).orderBy(desc(t.invoice.updatedAt)).limit(5), [] as any[]),
    ])
    const now = new Date()
    // A quote total and an invoice balance are both company money. Recent JOBS are the work itself and
    // stay — that is what the panel is for on a technician's screen.
    const money = await maySeeMoney(c)
    return c.json({
      recentJobs,
      recentQuotes: money ? recentQuotes : [],
      recentInvoices: !money ? [] : recentInvoices.map((inv: any) => {
        const balance = ISSUED.includes(inv.status) ? 0 : invoiceBalance(inv)
        const status = open.includes(inv.status) && inv.dueDate && new Date(inv.dueDate) < now ? 'overdue' : inv.status
        return { ...inv, balance: r2(balance), status }
      }),
    })
  })

  return app
}
