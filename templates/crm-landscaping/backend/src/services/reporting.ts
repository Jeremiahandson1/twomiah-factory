/**
 * Reporting Service
 *
 * Analytics and reporting for:
 * - Revenue & invoicing
 * - Job performance
 * - Project progress
 * - Team productivity
 * - Customer insights
 */

import { db } from '../../db/index.ts'
import { invoice, payment, job, project, quote, timeEntry, user, contact } from '../../db/schema.ts'
import { eq, and, gte, lte, sql, count, sum, inArray, desc, not, isNotNull } from 'drizzle-orm'

// ============================================
// REVENUE REPORTS
// ============================================

/**
 * Get revenue overview
 */
export async function getRevenueOverview(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string }) {
  const dateConditions = buildDateConditions(startDate, endDate)

  // Total invoiced
  const invoiceConditions = [eq(invoice.companyId, companyId)]
  if (dateConditions.gte) invoiceConditions.push(gte(invoice.createdAt, dateConditions.gte))
  if (dateConditions.lte) invoiceConditions.push(lte(invoice.createdAt, dateConditions.lte))

  const [invoiced] = await db
    .select({ total: sum(invoice.total), count: count() })
    .from(invoice)
    .where(and(...invoiceConditions))

  // Total collected
  const paymentConditions: any[] = []
  if (dateConditions.gte) paymentConditions.push(gte(payment.paidAt, dateConditions.gte))
  if (dateConditions.lte) paymentConditions.push(lte(payment.paidAt, dateConditions.lte))

  const [collected] = await db
    .select({ total: sum(payment.amount) })
    .from(payment)
    .innerJoin(invoice, eq(payment.invoiceId, invoice.id))
    .where(and(eq(invoice.companyId, companyId), ...paymentConditions))

  // Outstanding balance
  const [outstanding] = await db
    .select({ total: sql<string>`coalesce(sum(${invoice.total}::numeric - ${invoice.amountPaid}::numeric), 0)` })
    .from(invoice)
    .where(and(eq(invoice.companyId, companyId), sql`${invoice.status} IN ('sent', 'partial', 'overdue')`))

  // Overdue
  const [overdue] = await db
    .select({
      total: sql<string>`coalesce(sum(${invoice.total}::numeric - ${invoice.amountPaid}::numeric), 0)`,
      count: count(),
    })
    .from(invoice)
    .where(
      and(
        eq(invoice.companyId, companyId),
        sql`${invoice.status} IN ('sent', 'partial')`,
        lte(invoice.dueDate, new Date())
      )
    )

  const invoicedTotal = Number(invoiced.total || 0)
  const collectedTotal = Number(collected.total || 0)

  return {
    invoiced: invoicedTotal,
    invoiceCount: invoiced.count,
    collected: collectedTotal,
    outstanding: Number(outstanding.total || 0),
    overdue: Number(overdue.total || 0),
    overdueCount: overdue.count,
    collectionRate: invoicedTotal ? Math.round((collectedTotal / invoicedTotal) * 100) : 0,
  }
}

/**
 * Get revenue by month
 */
export async function getRevenueByMonth(companyId: string, { months = 12 }: { months?: number }) {
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - months + 1)
  startDate.setDate(1)
  startDate.setHours(0, 0, 0, 0)

  const invoices = await db
    .select({ total: invoice.total, createdAt: invoice.createdAt })
    .from(invoice)
    .where(and(eq(invoice.companyId, companyId), gte(invoice.createdAt, startDate)))

  const payments = await db
    .select({ amount: payment.amount, paidAt: payment.paidAt })
    .from(payment)
    .innerJoin(invoice, eq(payment.invoiceId, invoice.id))
    .where(and(eq(invoice.companyId, companyId), gte(payment.paidAt, startDate)))

  // Group by month
  const monthlyData: Record<string, { month: string; invoiced: number; collected: number }> = {}

  for (let i = 0; i < months; i++) {
    const date = new Date(startDate)
    date.setMonth(date.getMonth() + i)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    monthlyData[key] = { month: key, invoiced: 0, collected: 0 }
  }

  invoices.forEach((inv) => {
    const key = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`
    if (monthlyData[key]) {
      monthlyData[key].invoiced += Number(inv.total)
    }
  })

  payments.forEach((pay) => {
    if (!pay.paidAt) return
    const key = `${pay.paidAt.getFullYear()}-${String(pay.paidAt.getMonth() + 1).padStart(2, '0')}`
    if (monthlyData[key]) {
      monthlyData[key].collected += Number(pay.amount)
    }
  })

  return Object.values(monthlyData)
}

/**
 * Get revenue by customer
 */
export async function getRevenueByCustomer(
  companyId: string,
  { startDate, endDate, limit = 10 }: { startDate?: string; endDate?: string; limit?: number }
) {
  const conditions: any[] = [eq(invoice.companyId, companyId), isNotNull(invoice.contactId)]
  const dateConditions = buildDateConditions(startDate, endDate)
  if (dateConditions.gte) conditions.push(gte(invoice.createdAt, dateConditions.gte))
  if (dateConditions.lte) conditions.push(lte(invoice.createdAt, dateConditions.lte))

  const results = await db
    .select({
      contactId: invoice.contactId,
      total: sum(invoice.total),
      count: count(),
    })
    .from(invoice)
    .where(and(...conditions))
    .groupBy(invoice.contactId)
    .orderBy(desc(sum(invoice.total)))
    .limit(limit)

  const contactIds = results.map((r) => r.contactId).filter(Boolean) as string[]
  if (contactIds.length === 0) return []

  const contacts = await db
    .select({ id: contact.id, name: contact.name, company: contact.company })
    .from(contact)
    .where(inArray(contact.id, contactIds))

  const contactMap = new Map(contacts.map((c) => [c.id, c]))

  return results.map((r) => ({
    contact: contactMap.get(r.contactId!),
    total: Number(r.total || 0),
    invoiceCount: r.count,
  }))
}

// ============================================
// JOB REPORTS
// ============================================

/**
 * Get job statistics
 */
export async function getJobStats(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string }) {
  const conditions: any[] = [eq(job.companyId, companyId)]
  const dateConditions = buildDateConditions(startDate, endDate)
  if (dateConditions.gte) conditions.push(gte(job.createdAt, dateConditions.gte))
  if (dateConditions.lte) conditions.push(lte(job.createdAt, dateConditions.lte))

  const [totalResult] = await db
    .select({ value: count() })
    .from(job)
    .where(and(...conditions))
  const total = totalResult.value

  const byStatus = await db
    .select({ status: job.status, count: count() })
    .from(job)
    .where(and(...conditions))
    .groupBy(job.status)

  const statusCounts: Record<string, number> = {}
  byStatus.forEach((s) => {
    statusCounts[s.status] = s.count
  })

  const completed = statusCounts['completed'] || 0
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

  return {
    total,
    byStatus: statusCounts,
    completed,
    completionRate,
    scheduled: statusCounts['scheduled'] || 0,
    inProgress: statusCounts['in_progress'] || 0,
    cancelled: statusCounts['cancelled'] || 0,
  }
}

/**
 * Get jobs by type/category
 */
export async function getJobsByType(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string }) {
  const conditions: any[] = [eq(job.companyId, companyId), isNotNull(job.type)]
  const dateConditions = buildDateConditions(startDate, endDate)
  if (dateConditions.gte) conditions.push(gte(job.createdAt, dateConditions.gte))
  if (dateConditions.lte) conditions.push(lte(job.createdAt, dateConditions.lte))

  const results = await db
    .select({ type: job.type, count: count() })
    .from(job)
    .where(and(...conditions))
    .groupBy(job.type)

  return results.map((r) => ({
    type: r.type || 'Uncategorized',
    count: r.count,
  }))
}

/**
 * Get jobs by assignee
 */
export async function getJobsByAssignee(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string }) {
  const conditions: any[] = [eq(job.companyId, companyId), isNotNull(job.assignedToId)]
  const dateConditions = buildDateConditions(startDate, endDate)
  if (dateConditions.gte) conditions.push(gte(job.createdAt, dateConditions.gte))
  if (dateConditions.lte) conditions.push(lte(job.createdAt, dateConditions.lte))

  const results = await db
    .select({ assignedToId: job.assignedToId, count: count() })
    .from(job)
    .where(and(...conditions))
    .groupBy(job.assignedToId)

  const userIds = results.map((r) => r.assignedToId).filter(Boolean) as string[]
  if (userIds.length === 0) return []

  const users = await db
    .select({ id: user.id, firstName: user.firstName, lastName: user.lastName })
    .from(user)
    .where(inArray(user.id, userIds))

  const userMap = new Map(users.map((u) => [u.id, u]))

  return results.map((r) => ({
    user: userMap.get(r.assignedToId!),
    count: r.count,
  }))
}

// ============================================
// PROJECT REPORTS
// ============================================

/**
 * Get project statistics
 */
export async function getProjectStats(companyId: string) {
  const [totalResult] = await db.select({ value: count() }).from(project).where(eq(project.companyId, companyId))
  const total = totalResult.value

  const byStatus = await db
    .select({ status: project.status, count: count() })
    .from(project)
    .where(eq(project.companyId, companyId))
    .groupBy(project.status)

  const [totalValue] = await db
    .select({ value: sum(project.estimatedValue) })
    .from(project)
    .where(eq(project.companyId, companyId))

  const statusCounts: Record<string, number> = {}
  byStatus.forEach((s) => {
    statusCounts[s.status] = s.count
  })

  return {
    total,
    active: statusCounts['active'] || 0,
    completed: statusCounts['completed'] || 0,
    onHold: statusCounts['on_hold'] || 0,
    totalValue: Number(totalValue.value || 0),
  }
}

/**
 * Get project profitability
 */
export async function getProjectProfitability(companyId: string, { limit = 10 }: { limit?: number }) {
  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      number: project.number,
      estimatedValue: project.estimatedValue,
      status: project.status,
    })
    .from(project)
    .where(eq(project.companyId, companyId))
    .orderBy(desc(project.estimatedValue))
    .limit(limit)

  const projectIds = projects.map((p) => p.id)
  if (projectIds.length === 0) return []

  // Get invoice totals per project
  const invoiceTotals = await db
    .select({
      projectId: invoice.projectId,
      totalInvoiced: sum(invoice.total),
      totalPaid: sum(invoice.amountPaid),
    })
    .from(invoice)
    .where(inArray(invoice.projectId, projectIds))
    .groupBy(invoice.projectId)

  const invoiceMap = new Map(invoiceTotals.map((i) => [i.projectId, i]))

  // Get job counts per project
  const jobCounts = await db
    .select({ projectId: job.projectId, count: count() })
    .from(job)
    .where(inArray(job.projectId, projectIds))
    .groupBy(job.projectId)

  const jobMap = new Map(jobCounts.map((j) => [j.projectId, j.count]))

  return projects.map((p) => {
    const inv = invoiceMap.get(p.id)
    const invoiced = Number(inv?.totalInvoiced || 0)
    const collected = Number(inv?.totalPaid || 0)

    return {
      id: p.id,
      name: p.name,
      number: p.number,
      status: p.status,
      value: Number(p.estimatedValue || 0),
      invoiced,
      collected,
      jobCount: jobMap.get(p.id) || 0,
      collectionRate: invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0,
    }
  })
}

// ============================================
// TEAM REPORTS
// ============================================

/**
 * Get team productivity
 */
export async function getTeamProductivity(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string }) {
  const dateConditions = buildDateConditions(startDate, endDate)

  // Time entries by user
  const timeConditions: any[] = [eq(timeEntry.companyId, companyId)]
  if (dateConditions.gte) timeConditions.push(gte(timeEntry.date, dateConditions.gte))
  if (dateConditions.lte) timeConditions.push(lte(timeEntry.date, dateConditions.lte))

  const timeByUser = await db
    .select({
      userId: timeEntry.userId,
      totalHours: sum(timeEntry.hours),
      count: count(),
    })
    .from(timeEntry)
    .where(and(...timeConditions))
    .groupBy(timeEntry.userId)

  // Jobs completed by user
  const jobConditions: any[] = [eq(job.companyId, companyId), eq(job.status, 'completed'), isNotNull(job.assignedToId)]
  if (dateConditions.gte) jobConditions.push(gte(job.completedAt, dateConditions.gte))
  if (dateConditions.lte) jobConditions.push(lte(job.completedAt, dateConditions.lte))

  const jobsByUser = await db
    .select({ assignedToId: job.assignedToId, count: count() })
    .from(job)
    .where(and(...jobConditions))
    .groupBy(job.assignedToId)

  // Get user details
  const userIds = [
    ...new Set([...timeByUser.map((t) => t.userId), ...jobsByUser.map((j) => j.assignedToId)]),
  ].filter(Boolean) as string[]

  if (userIds.length === 0) return []

  const users = await db
    .select({ id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role })
    .from(user)
    .where(inArray(user.id, userIds))

  const userMap = new Map(users.map((u) => [u.id, u]))
  const timeMap = new Map(timeByUser.map((t) => [t.userId, t]))
  const jobMap = new Map(jobsByUser.map((j) => [j.assignedToId!, j]))

  return userIds
    .map((userId) => {
      const u = userMap.get(userId)
      const time = timeMap.get(userId)
      const jobs = jobMap.get(userId)

      return {
        user: u,
        hoursWorked: Math.round(Number(time?.totalHours || 0) * 10) / 10,
        timeEntries: time?.count || 0,
        jobsCompleted: jobs?.count || 0,
      }
    })
    .sort((a, b) => b.hoursWorked - a.hoursWorked)
}

// ============================================
// QUOTE REPORTS
// ============================================

/**
 * Get quote statistics
 */
export async function getQuoteStats(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string }) {
  const conditions: any[] = [eq(quote.companyId, companyId)]
  const dateConditions = buildDateConditions(startDate, endDate)
  if (dateConditions.gte) conditions.push(gte(quote.createdAt, dateConditions.gte))
  if (dateConditions.lte) conditions.push(lte(quote.createdAt, dateConditions.lte))

  const [totalResult] = await db
    .select({ value: count() })
    .from(quote)
    .where(and(...conditions))
  const total = totalResult.value

  const byStatus = await db
    .select({
      status: quote.status,
      count: count(),
      totalValue: sum(quote.total),
    })
    .from(quote)
    .where(and(...conditions))
    .groupBy(quote.status)

  const [totalValue] = await db
    .select({ value: sum(quote.total) })
    .from(quote)
    .where(and(...conditions))

  const statusData: Record<string, { count: number; value: number }> = {}
  byStatus.forEach((s) => {
    statusData[s.status] = { count: s.count, value: Number(s.totalValue || 0) }
  })

  const approved = statusData['approved'] || { count: 0, value: 0 }
  const conversionRate = total > 0 ? Math.round((approved.count / total) * 100) : 0

  return {
    total,
    totalValue: Number(totalValue.value || 0),
    approved: approved.count,
    approvedValue: approved.value,
    pending: (statusData['draft']?.count || 0) + (statusData['sent']?.count || 0),
    rejected: statusData['rejected']?.count || 0,
    conversionRate,
  }
}

// ============================================
// DASHBOARD SUMMARY
// ============================================

/**
 * Get complete dashboard data
 */
export async function getDashboardSummary(companyId: string) {
  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [revenue, jobs, projects, quotes, recentActivity] = await Promise.all([
    getRevenueOverview(companyId, {
      startDate: thirtyDaysAgo.toISOString(),
      endDate: today.toISOString(),
    }),
    getJobStats(companyId, {
      startDate: thirtyDaysAgo.toISOString(),
      endDate: today.toISOString(),
    }),
    getProjectStats(companyId),
    getQuoteStats(companyId, {
      startDate: thirtyDaysAgo.toISOString(),
      endDate: today.toISOString(),
    }),
    getRecentActivity(companyId, 10),
  ])

  return {
    period: '30 days',
    revenue,
    jobs,
    projects,
    quotes,
    recentActivity,
  }
}

/**
 * Get recent activity
 */
async function getRecentActivity(companyId: string, limit = 10) {
  const [invoices, jobs, quotes] = await Promise.all([
    db
      .select({ id: invoice.id, number: invoice.number, total: invoice.total, status: invoice.status, createdAt: invoice.createdAt })
      .from(invoice)
      .where(eq(invoice.companyId, companyId))
      .orderBy(desc(invoice.createdAt))
      .limit(5),
    db
      .select({ id: job.id, number: job.number, title: job.title, status: job.status, createdAt: job.createdAt })
      .from(job)
      .where(eq(job.companyId, companyId))
      .orderBy(desc(job.createdAt))
      .limit(5),
    db
      .select({ id: quote.id, number: quote.number, total: quote.total, status: quote.status, createdAt: quote.createdAt })
      .from(quote)
      .where(eq(quote.companyId, companyId))
      .orderBy(desc(quote.createdAt))
      .limit(5),
  ])

  const activity = [
    ...invoices.map((i) => ({ type: 'invoice' as const, ...i })),
    ...jobs.map((j) => ({ type: 'job' as const, ...j })),
    ...quotes.map((q) => ({ type: 'quote' as const, ...q })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)

  return activity
}

// ============================================
// HELPERS
// ============================================

function buildDateConditions(startDate?: string, endDate?: string) {
  return {
    gte: startDate ? new Date(startDate) : undefined,
    lte: endDate ? new Date(endDate) : undefined,
  }
}

export default {
  getRevenueOverview,
  getRevenueByMonth,
  getRevenueByCustomer,
  getJobStats,
  getJobsByType,
  getJobsByAssignee,
  getProjectStats,
  getProjectProfitability,
  getTeamProductivity,
  getQuoteStats,
  getDashboardSummary,
}
