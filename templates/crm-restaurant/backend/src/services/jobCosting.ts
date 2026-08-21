/**
 * Job Costing Service
 *
 * Estimate vs Actual profitability analysis:
 * - Labor costs (time entries)
 * - Material costs (inventory usage)
 * - Subcontractor costs
 * - Compare to quote/estimate
 */

import { db } from '../../db/index.ts'
import {
  job,
  contact,
  project,
  quote,
  quoteLineItem,
  invoice,
  timeEntry,
  inventoryUsage,
  inventoryItem,
  expense,
  user,
} from '../../db/schema.ts'
import { eq, and, gte, lte, desc, sql, sum, count } from 'drizzle-orm'

/**
 * Get detailed job cost breakdown
 */
export async function getJobCostAnalysis(jobId: string, companyId: string) {
  const [jobRow] = await db.select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.companyId, companyId)))

  if (!jobRow) throw new Error('Job not found')

  // Get related contact and project
  let contactRow = null
  let projectRow = null
  let quoteRow = null

  if (jobRow.contactId) {
    const [c] = await db.select({ id: contact.id, name: contact.name })
      .from(contact).where(eq(contact.id, jobRow.contactId))
    contactRow = c || null
  }
  if (jobRow.projectId) {
    const [p] = await db.select({ id: project.id, name: project.name, number: project.number })
      .from(project).where(eq(project.id, jobRow.projectId))
    projectRow = p || null
  }
  if (jobRow.quoteId) {
    const [q] = await db.select()
      .from(quote).where(eq(quote.id, jobRow.quoteId))
    quoteRow = q || null
  }

  // Get quote items if quote exists
  let quoteItems: any[] = []
  if (quoteRow) {
    quoteItems = await db.select()
      .from(quoteLineItem)
      .where(eq(quoteLineItem.quoteId, quoteRow.id))
  }

  // Get invoices for this job
  const invoices = await db.select({
    id: invoice.id,
    number: invoice.number,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    status: invoice.status,
  }).from(invoice)
    .where(and(eq(invoice.companyId, companyId), eq(invoice.projectId, jobRow.projectId!)))

  // Get labor costs
  const timeEntries = await db.select()
    .from(timeEntry)
    .leftJoin(user, eq(timeEntry.userId, user.id))
    .where(and(eq(timeEntry.jobId, jobId), eq(timeEntry.companyId, companyId)))

  const laborCosts = timeEntries.reduce((sum, entry) => {
    const hours = Number(entry.time_entry.hours || 0)
    const rate = Number(entry.time_entry.hourlyRate || entry.user?.hourlyRate || 0)
    return sum + (hours * rate)
  }, 0)

  const laborHours = timeEntries.reduce((sum, entry) => sum + Number(entry.time_entry.hours || 0), 0)

  // Get material costs (inventory usage)
  const materialUsage = await db.select()
    .from(inventoryUsage)
    .leftJoin(inventoryItem, eq(inventoryUsage.itemId, inventoryItem.id))
    .where(and(eq(inventoryUsage.jobId, jobId), eq(inventoryUsage.companyId, companyId)))

  const materialCosts = materialUsage.reduce((sum, usage) => {
    return sum + (Number(usage.inventory_usage.quantity) * Number(usage.inventory_usage.unitCost || usage.inventory_item?.unitCost || 0))
  }, 0)

  // Get expense costs
  const expenses = await db.select()
    .from(expense)
    .where(and(eq(expense.jobId, jobId), eq(expense.companyId, companyId)))

  const expenseCosts = expenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0)
  const subcontractorCosts = expenses
    .filter(e => e.category === 'subcontractor')
    .reduce((sum, exp) => sum + Number(exp.amount || 0), 0)

  // Calculate totals
  const totalCost = laborCosts + materialCosts + expenseCosts

  // Get estimated values from quote
  const estimatedRevenue = Number(quoteRow?.total || jobRow.estimatedValue || 0)
  const estimatedLaborHours = Number(jobRow.estimatedHours || 0)

  // Parse quote items for estimated costs if available
  let estimatedLaborCost = 0
  let estimatedMaterialCost = 0

  for (const item of quoteItems) {
    if (item.type === 'labor') {
      estimatedLaborCost += Number(item.total || 0)
    } else if (item.type === 'material' || item.type === 'part') {
      estimatedMaterialCost += Number(item.total || 0)
    }
  }

  const estimatedCost = estimatedLaborCost + estimatedMaterialCost

  // Calculate revenue
  const invoicedAmount = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
  const collectedAmount = invoices.reduce((sum, inv) => sum + Number(inv.amountPaid || 0), 0)

  // Profit calculations
  const grossProfit = invoicedAmount - totalCost
  const grossMargin = invoicedAmount > 0 ? (grossProfit / invoicedAmount) * 100 : 0

  const estimatedProfit = estimatedRevenue - estimatedCost
  const estimatedMargin = estimatedRevenue > 0 ? (estimatedProfit / estimatedRevenue) * 100 : 0

  // Variance
  const costVariance = totalCost - estimatedCost
  const laborVariance = laborCosts - estimatedLaborCost
  const materialVariance = materialCosts - estimatedMaterialCost
  const hoursVariance = laborHours - estimatedLaborHours

  return {
    job: {
      id: jobRow.id,
      number: jobRow.number,
      title: jobRow.title,
      status: jobRow.status,
      contact: contactRow,
      project: projectRow,
    },

    // Estimated (from quote)
    estimated: {
      revenue: estimatedRevenue,
      laborCost: estimatedLaborCost,
      materialCost: estimatedMaterialCost,
      totalCost: estimatedCost,
      profit: estimatedProfit,
      margin: Math.round(estimatedMargin * 10) / 10,
      laborHours: estimatedLaborHours,
    },

    // Actual
    actual: {
      revenue: invoicedAmount,
      collected: collectedAmount,
      laborCost: Math.round(laborCosts * 100) / 100,
      materialCost: Math.round(materialCosts * 100) / 100,
      expenseCost: Math.round(expenseCosts * 100) / 100,
      subcontractorCost: Math.round(subcontractorCosts * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      profit: Math.round(grossProfit * 100) / 100,
      margin: Math.round(grossMargin * 10) / 10,
      laborHours: Math.round(laborHours * 10) / 10,
    },

    // Variance (positive = over budget)
    variance: {
      cost: Math.round(costVariance * 100) / 100,
      labor: Math.round(laborVariance * 100) / 100,
      material: Math.round(materialVariance * 100) / 100,
      hours: Math.round(hoursVariance * 10) / 10,
      costPercent: estimatedCost > 0 ? Math.round((costVariance / estimatedCost) * 1000) / 10 : 0,
    },

    // Detail breakdowns
    laborDetail: timeEntries.map(e => ({
      id: e.time_entry.id,
      date: e.time_entry.date,
      user: e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Unknown',
      hours: Number(e.time_entry.hours),
      rate: Number(e.time_entry.hourlyRate || e.user?.hourlyRate || 0),
      cost: Number(e.time_entry.hours) * Number(e.time_entry.hourlyRate || e.user?.hourlyRate || 0),
      description: e.time_entry.description,
    })),

    materialDetail: materialUsage.map(u => ({
      id: u.inventory_usage.id,
      date: u.inventory_usage.createdAt,
      item: u.inventory_item?.name || 'Unknown',
      sku: u.inventory_item?.sku,
      quantity: Number(u.inventory_usage.quantity),
      unitCost: Number(u.inventory_usage.unitCost || u.inventory_item?.unitCost || 0),
      cost: Number(u.inventory_usage.quantity) * Number(u.inventory_usage.unitCost || u.inventory_item?.unitCost || 0),
    })),

    expenseDetail: expenses.map(e => ({
      id: e.id,
      date: e.date,
      category: e.category,
      vendor: e.vendor,
      description: e.description,
      amount: Number(e.amount),
    })),

    invoices,
  }
}

/**
 * Get job costing summary for multiple jobs
 */
export async function getJobCostingSummary(companyId: string, { startDate, endDate, status, projectId, limit: queryLimit = 50 }: { startDate?: string; endDate?: string; status?: string; projectId?: string; limit?: number } = {}) {
  const conditions = [eq(job.companyId, companyId)]

  if (startDate) conditions.push(gte(job.createdAt, new Date(startDate)))
  if (endDate) conditions.push(lte(job.createdAt, new Date(endDate)))
  if (status) conditions.push(eq(job.status, status))
  if (projectId) conditions.push(eq(job.projectId, projectId))

  const jobs = await db.select()
    .from(job)
    .leftJoin(contact, eq(job.contactId, contact.id))
    .leftJoin(quote, eq(job.quoteId, quote.id))
    .where(and(...conditions))
    .orderBy(desc(job.createdAt))
    .limit(queryLimit)

  // Get invoices for these jobs (via project)
  const jobIds = jobs.map(j => j.job.id)

  const summaries = await Promise.all(
    jobs.map(async (row) => {
      const j = row.job

      // Quick cost calculation
      const [laborAgg] = await db.select({ total: sql<string>`COALESCE(SUM(${timeEntry.hours}), 0)` })
        .from(timeEntry)
        .where(eq(timeEntry.jobId, j.id))

      const [expenseAgg] = await db.select({ total: sql<string>`COALESCE(SUM(${expense.amount}), 0)` })
        .from(expense)
        .where(eq(expense.jobId, j.id))

      const estimatedRevenue = Number(row.quote?.total || j.estimatedValue || 0)

      // Get invoiced revenue
      const jobInvoices = j.projectId
        ? await db.select({ total: invoice.total })
            .from(invoice)
            .where(eq(invoice.projectId, j.projectId))
        : []

      const invoicedRevenue = jobInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
      const laborHours = Number(laborAgg?.total || 0)
      const expenseCost = Number(expenseAgg?.total || 0)

      // Estimate labor cost (use company average rate if not available)
      const laborCost = laborHours * 50 // Default $50/hr

      const totalCost = laborCost + expenseCost
      const profit = invoicedRevenue - totalCost
      const margin = invoicedRevenue > 0 ? (profit / invoicedRevenue) * 100 : 0

      return {
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        contact: row.contact?.name,
        estimatedRevenue,
        invoicedRevenue,
        totalCost: Math.round(totalCost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        margin: Math.round(margin * 10) / 10,
        laborHours: Math.round(laborHours * 10) / 10,
        isProfitable: profit > 0,
        variance: Math.round((totalCost - estimatedRevenue * 0.6) * 100) / 100,
      }
    })
  )

  // Calculate totals
  const totals = summaries.reduce(
    (acc, j) => ({
      estimatedRevenue: acc.estimatedRevenue + j.estimatedRevenue,
      invoicedRevenue: acc.invoicedRevenue + j.invoicedRevenue,
      totalCost: acc.totalCost + j.totalCost,
      profit: acc.profit + j.profit,
      laborHours: acc.laborHours + j.laborHours,
      profitableCount: acc.profitableCount + (j.isProfitable ? 1 : 0),
      margin: 0,
      profitablePercent: 0,
    }),
    { estimatedRevenue: 0, invoicedRevenue: 0, totalCost: 0, profit: 0, laborHours: 0, profitableCount: 0, margin: 0, profitablePercent: 0 }
  )

  totals.margin = totals.invoicedRevenue > 0
    ? Math.round((totals.profit / totals.invoicedRevenue) * 1000) / 10
    : 0
  totals.profitablePercent = summaries.length > 0
    ? Math.round((totals.profitableCount / summaries.length) * 100)
    : 0

  return {
    jobs: summaries,
    totals,
    count: summaries.length,
  }
}

/**
 * Get profitability by category (service type, tech, etc.)
 */
export async function getProfitabilityByCategory(companyId: string, { groupBy = 'month', startDate, endDate }: { groupBy?: string; startDate?: string; endDate?: string } = {}) {
  const conditions = [eq(job.companyId, companyId), eq(job.status, 'completed')]

  if (startDate) conditions.push(gte(job.completedAt, new Date(startDate)))
  if (endDate) conditions.push(lte(job.completedAt, new Date(endDate)))

  const jobs = await db.select()
    .from(job)
    .leftJoin(user, eq(job.assignedToId, user.id))
    .where(and(...conditions))

  // Get invoices per job
  const groups: Record<string, { key: string; jobCount: number; revenue: number; cost: number }> = {}

  for (const row of jobs) {
    const j = row.job
    let key: string

    if (groupBy === 'month') {
      const date = j.completedAt || j.createdAt
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    } else if (groupBy === 'technician') {
      key = row.user
        ? `${row.user.firstName} ${row.user.lastName}`
        : 'Unassigned'
    } else if (groupBy === 'type') {
      key = j.type || 'General'
    } else {
      key = 'All'
    }

    if (!groups[key]) {
      groups[key] = { key, jobCount: 0, revenue: 0, cost: 0 }
    }

    // Get invoiced revenue for this job
    const jobInvoices = j.projectId
      ? await db.select({ total: invoice.total }).from(invoice).where(eq(invoice.projectId, j.projectId))
      : []
    const revenue = jobInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)

    // Get costs
    const [laborAgg] = await db.select({ total: sql<string>`COALESCE(SUM(${timeEntry.hours}), 0)` })
      .from(timeEntry)
      .where(eq(timeEntry.jobId, j.id))

    const [expenseAgg] = await db.select({ total: sql<string>`COALESCE(SUM(${expense.amount}), 0)` })
      .from(expense)
      .where(eq(expense.jobId, j.id))

    const cost = (Number(laborAgg?.total || 0) * 50) + Number(expenseAgg?.total || 0)

    groups[key].jobCount++
    groups[key].revenue += revenue
    groups[key].cost += cost
  }

  // Calculate profits and margins
  const results = Object.values(groups).map(g => ({
    ...g,
    profit: Math.round((g.revenue - g.cost) * 100) / 100,
    margin: g.revenue > 0 ? Math.round(((g.revenue - g.cost) / g.revenue) * 1000) / 10 : 0,
    avgJobRevenue: g.jobCount > 0 ? Math.round((g.revenue / g.jobCount) * 100) / 100 : 0,
  }))

  return results.sort((a, b) => {
    if (groupBy === 'month') return a.key.localeCompare(b.key)
    return b.profit - a.profit
  })
}

export default {
  getJobCostAnalysis,
  getJobCostingSummary,
  getProfitabilityByCategory,
}
