/**
 * Job Costing Service
 * 
 * Estimate vs Actual profitability analysis:
 * - Labor costs (time entries)
 * - Material costs (inventory usage)
 * - Subcontractor costs
 * - Compare to quote/estimate
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Get detailed job cost breakdown
 */
export async function getJobCostAnalysis(jobId, companyId) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    include: {
      contact: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, number: true } },
      quote: {
        select: {
          id: true,
          number: true,
          subtotal: true,
          total: true,
          items: true,
        },
      },
      invoices: {
        select: {
          id: true,
          number: true,
          total: true,
          amountPaid: true,
          status: true,
        },
      },
    },
  });

  if (!job) throw new Error('Job not found');

  // Get labor costs
  const timeEntries = await prisma.timeEntry.findMany({
    where: { jobId, companyId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, hourlyRate: true } },
    },
  });

  const laborCosts = timeEntries.reduce((sum, entry) => {
    const hours = Number(entry.hours || 0);
    const rate = Number(entry.hourlyRate || entry.user?.hourlyRate || 0);
    return sum + (hours * rate);
  }, 0);

  const laborHours = timeEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);

  // Get material costs (inventory usage)
  const materialUsage = await prisma.inventoryUsage.findMany({
    where: { jobId, companyId },
    include: {
      item: { select: { id: true, name: true, sku: true, unitCost: true } },
    },
  });

  const materialCosts = materialUsage.reduce((sum, usage) => {
    return sum + (Number(usage.quantity) * Number(usage.unitCost || usage.item?.unitCost || 0));
  }, 0);

  // Get expense costs (receipts, subcontractors, etc.)
  const expenses = await prisma.expense.findMany({
    where: { jobId, companyId },
  });

  const expenseCosts = expenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
  const subcontractorCosts = expenses
    .filter(e => e.category === 'subcontractor')
    .reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  // Calculate totals
  const totalCost = laborCosts + materialCosts + expenseCosts;

  // Get estimated values from quote
  const estimatedRevenue = Number(job.quote?.total || job.estimatedValue || 0);
  const estimatedLaborHours = Number(job.estimatedHours || 0);
  
  // Parse quote items for estimated costs if available
  let estimatedLaborCost = 0;
  let estimatedMaterialCost = 0;
  
  if (job.quote?.items) {
    const items = Array.isArray(job.quote.items) ? job.quote.items : [];
    for (const item of items) {
      if (item.type === 'labor') {
        estimatedLaborCost += Number(item.total || 0);
      } else if (item.type === 'material' || item.type === 'part') {
        estimatedMaterialCost += Number(item.total || 0);
      }
    }
  }

  const estimatedCost = estimatedLaborCost + estimatedMaterialCost;

  // Calculate revenue
  const invoicedAmount = job.invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const collectedAmount = job.invoices.reduce((sum, inv) => sum + Number(inv.amountPaid || 0), 0);

  // Profit calculations
  const grossProfit = invoicedAmount - totalCost;
  const grossMargin = invoicedAmount > 0 ? (grossProfit / invoicedAmount) * 100 : 0;

  const estimatedProfit = estimatedRevenue - estimatedCost;
  const estimatedMargin = estimatedRevenue > 0 ? (estimatedProfit / estimatedRevenue) * 100 : 0;

  // Variance
  const costVariance = totalCost - estimatedCost;
  const laborVariance = laborCosts - estimatedLaborCost;
  const materialVariance = materialCosts - estimatedMaterialCost;
  const hoursVariance = laborHours - estimatedLaborHours;

  return {
    job: {
      id: job.id,
      number: job.number,
      title: job.title,
      status: job.status,
      contact: job.contact,
      project: job.project,
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
      id: e.id,
      date: e.date,
      user: e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Unknown',
      hours: Number(e.hours),
      rate: Number(e.hourlyRate || e.user?.hourlyRate || 0),
      cost: Number(e.hours) * Number(e.hourlyRate || e.user?.hourlyRate || 0),
      description: e.description,
    })),

    materialDetail: materialUsage.map(u => ({
      id: u.id,
      date: u.createdAt,
      item: u.item?.name || 'Unknown',
      sku: u.item?.sku,
      quantity: Number(u.quantity),
      unitCost: Number(u.unitCost || u.item?.unitCost || 0),
      cost: Number(u.quantity) * Number(u.unitCost || u.item?.unitCost || 0),
    })),

    expenseDetail: expenses.map(e => ({
      id: e.id,
      date: e.date,
      category: e.category,
      vendor: e.vendor,
      description: e.description,
      amount: Number(e.amount),
    })),

    invoices: job.invoices,
  };
}

/**
 * Get job costing summary for multiple jobs
 */
export async function getJobCostingSummary(companyId, { startDate, endDate, status, projectId, limit = 50 } = {}) {
  const where = { companyId };
  
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }
  if (status) where.status = status;
  if (projectId) where.projectId = projectId;

  const jobs = await prisma.job.findMany({
    where,
    include: {
      contact: { select: { name: true } },
      quote: { select: { total: true } },
      invoices: { select: { total: true, amountPaid: true } },
      _count: { select: { timeEntries: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const summaries = await Promise.all(
    jobs.map(async (job) => {
      // Quick cost calculation
      const [laborAgg, expenseAgg] = await Promise.all([
        prisma.timeEntry.aggregate({
          where: { jobId: job.id },
          _sum: { hours: true },
        }),
        prisma.expense.aggregate({
          where: { jobId: job.id },
          _sum: { amount: true },
        }),
      ]);

      const estimatedRevenue = Number(job.quote?.total || job.estimatedValue || 0);
      const invoicedRevenue = job.invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
      const laborHours = Number(laborAgg._sum.hours || 0);
      const expenseCost = Number(expenseAgg._sum.amount || 0);
      
      // Estimate labor cost (use company average rate if not available)
      const laborCost = laborHours * 50; // Default $50/hr - should pull from settings

      const totalCost = laborCost + expenseCost;
      const profit = invoicedRevenue - totalCost;
      const margin = invoicedRevenue > 0 ? (profit / invoicedRevenue) * 100 : 0;

      return {
        id: job.id,
        number: job.number,
        title: job.title,
        status: job.status,
        contact: job.contact?.name,
        estimatedRevenue,
        invoicedRevenue,
        totalCost: Math.round(totalCost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        margin: Math.round(margin * 10) / 10,
        laborHours: Math.round(laborHours * 10) / 10,
        isProfitable: profit > 0,
        variance: Math.round((totalCost - estimatedRevenue * 0.6) * 100) / 100, // Assuming 40% target margin
      };
    })
  );

  // Calculate totals
  const totals = summaries.reduce(
    (acc, job) => ({
      estimatedRevenue: acc.estimatedRevenue + job.estimatedRevenue,
      invoicedRevenue: acc.invoicedRevenue + job.invoicedRevenue,
      totalCost: acc.totalCost + job.totalCost,
      profit: acc.profit + job.profit,
      laborHours: acc.laborHours + job.laborHours,
      profitableCount: acc.profitableCount + (job.isProfitable ? 1 : 0),
    }),
    { estimatedRevenue: 0, invoicedRevenue: 0, totalCost: 0, profit: 0, laborHours: 0, profitableCount: 0 }
  );

  totals.margin = totals.invoicedRevenue > 0 
    ? Math.round((totals.profit / totals.invoicedRevenue) * 1000) / 10 
    : 0;
  totals.profitablePercent = summaries.length > 0 
    ? Math.round((totals.profitableCount / summaries.length) * 100) 
    : 0;

  return {
    jobs: summaries,
    totals,
    count: summaries.length,
  };
}

/**
 * Get profitability by category (service type, tech, etc.)
 */
export async function getProfitabilityByCategory(companyId, { groupBy = 'month', startDate, endDate } = {}) {
  // Get all completed jobs with costs
  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      status: 'completed',
      ...(Object.keys(dateFilter).length ? { completedAt: dateFilter } : {}),
    },
    include: {
      invoices: { select: { total: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Group and calculate
  const groups = {};

  for (const job of jobs) {
    let key;
    
    if (groupBy === 'month') {
      const date = job.completedAt || job.createdAt;
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else if (groupBy === 'technician') {
      key = job.assignedTo 
        ? `${job.assignedTo.firstName} ${job.assignedTo.lastName}`
        : 'Unassigned';
    } else if (groupBy === 'type') {
      key = job.type || 'General';
    }

    if (!groups[key]) {
      groups[key] = {
        key,
        jobCount: 0,
        revenue: 0,
        cost: 0,
      };
    }

    const revenue = job.invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
    
    // Get costs
    const [laborAgg, expenseAgg] = await Promise.all([
      prisma.timeEntry.aggregate({
        where: { jobId: job.id },
        _sum: { hours: true },
      }),
      prisma.expense.aggregate({
        where: { jobId: job.id },
        _sum: { amount: true },
      }),
    ]);

    const cost = (Number(laborAgg._sum.hours || 0) * 50) + Number(expenseAgg._sum.amount || 0);

    groups[key].jobCount++;
    groups[key].revenue += revenue;
    groups[key].cost += cost;
  }

  // Calculate profits and margins
  const results = Object.values(groups).map(g => ({
    ...g,
    profit: Math.round((g.revenue - g.cost) * 100) / 100,
    margin: g.revenue > 0 ? Math.round(((g.revenue - g.cost) / g.revenue) * 1000) / 10 : 0,
    avgJobRevenue: g.jobCount > 0 ? Math.round((g.revenue / g.jobCount) * 100) / 100 : 0,
  }));

  return results.sort((a, b) => {
    if (groupBy === 'month') return a.key.localeCompare(b.key);
    return b.profit - a.profit;
  });
}

export default {
  getJobCostAnalysis,
  getJobCostingSummary,
  getProfitabilityByCategory,
};
