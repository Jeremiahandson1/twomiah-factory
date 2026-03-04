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

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// REVENUE REPORTS
// ============================================

/**
 * Get revenue overview
 */
export async function getRevenueOverview(companyId, { startDate, endDate }) {
  const dateFilter = buildDateFilter(startDate, endDate);

  // Total invoiced
  const invoiced = await prisma.invoice.aggregate({
    where: { companyId, ...dateFilter('createdAt') },
    _sum: { total: true },
    _count: true,
  });

  // Total collected
  const collected = await prisma.payment.aggregate({
    where: { 
      invoice: { companyId },
      ...dateFilter('paidAt'),
    },
    _sum: { amount: true },
  });

  // Outstanding balance
  const outstanding = await prisma.invoice.aggregate({
    where: { 
      companyId, 
      status: { in: ['sent', 'partial', 'overdue'] },
    },
    _sum: { balance: true },
  });

  // Overdue
  const overdue = await prisma.invoice.aggregate({
    where: {
      companyId,
      status: { in: ['sent', 'partial'] },
      dueDate: { lt: new Date() },
    },
    _sum: { balance: true },
    _count: true,
  });

  return {
    invoiced: Number(invoiced._sum.total || 0),
    invoiceCount: invoiced._count,
    collected: Number(collected._sum.amount || 0),
    outstanding: Number(outstanding._sum.balance || 0),
    overdue: Number(overdue._sum.balance || 0),
    overdueCount: overdue._count,
    collectionRate: invoiced._sum.total 
      ? Math.round((Number(collected._sum.amount || 0) / Number(invoiced._sum.total)) * 100)
      : 0,
  };
}

/**
 * Get revenue by month
 */
export async function getRevenueByMonth(companyId, { months = 12 }) {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months + 1);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      createdAt: { gte: startDate },
    },
    select: {
      total: true,
      createdAt: true,
    },
  });

  const payments = await prisma.payment.findMany({
    where: {
      invoice: { companyId },
      paidAt: { gte: startDate },
    },
    select: {
      amount: true,
      paidAt: true,
    },
  });

  // Group by month
  const monthlyData = {};
  
  for (let i = 0; i < months; i++) {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyData[key] = { month: key, invoiced: 0, collected: 0 };
  }

  invoices.forEach(inv => {
    const key = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (monthlyData[key]) {
      monthlyData[key].invoiced += Number(inv.total);
    }
  });

  payments.forEach(pay => {
    const key = `${pay.paidAt.getFullYear()}-${String(pay.paidAt.getMonth() + 1).padStart(2, '0')}`;
    if (monthlyData[key]) {
      monthlyData[key].collected += Number(pay.amount);
    }
  });

  return Object.values(monthlyData);
}

/**
 * Get revenue by customer
 */
export async function getRevenueByCustomer(companyId, { startDate, endDate, limit = 10 }) {
  const dateFilter = buildDateFilter(startDate, endDate);

  const results = await prisma.invoice.groupBy({
    by: ['contactId'],
    where: { 
      companyId, 
      contactId: { not: null },
      ...dateFilter('createdAt'),
    },
    _sum: { total: true },
    _count: true,
    orderBy: { _sum: { total: 'desc' } },
    take: limit,
  });

  // Get contact details
  const contactIds = results.map(r => r.contactId).filter(Boolean);
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true, name: true, company: true },
  });
  const contactMap = new Map(contacts.map(c => [c.id, c]));

  return results.map(r => ({
    contact: contactMap.get(r.contactId),
    total: Number(r._sum.total || 0),
    invoiceCount: r._count,
  }));
}

// ============================================
// JOB REPORTS
// ============================================

/**
 * Get job statistics
 */
export async function getJobStats(companyId, { startDate, endDate }) {
  const dateFilter = buildDateFilter(startDate, endDate);

  const [total, byStatus, avgDuration] = await Promise.all([
    prisma.job.count({ where: { companyId, ...dateFilter('createdAt') } }),
    
    prisma.job.groupBy({
      by: ['status'],
      where: { companyId, ...dateFilter('createdAt') },
      _count: true,
    }),

    prisma.job.aggregate({
      where: { 
        companyId, 
        status: 'completed',
        completedAt: { not: null },
        ...dateFilter('completedAt'),
      },
      _avg: {
        // We'd need to calculate this differently
      },
    }),
  ]);

  const statusCounts = {};
  byStatus.forEach(s => {
    statusCounts[s.status] = s._count;
  });

  // Calculate completion rate
  const completed = statusCounts['completed'] || 0;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    byStatus: statusCounts,
    completed,
    completionRate,
    scheduled: statusCounts['scheduled'] || 0,
    inProgress: statusCounts['in_progress'] || 0,
    cancelled: statusCounts['cancelled'] || 0,
  };
}

/**
 * Get jobs by type/category
 */
export async function getJobsByType(companyId, { startDate, endDate }) {
  const dateFilter = buildDateFilter(startDate, endDate);

  const results = await prisma.job.groupBy({
    by: ['type'],
    where: { 
      companyId, 
      type: { not: null },
      ...dateFilter('createdAt'),
    },
    _count: true,
  });

  return results.map(r => ({
    type: r.type || 'Uncategorized',
    count: r._count,
  }));
}

/**
 * Get jobs by assignee
 */
export async function getJobsByAssignee(companyId, { startDate, endDate }) {
  const dateFilter = buildDateFilter(startDate, endDate);

  const results = await prisma.job.groupBy({
    by: ['assignedToId'],
    where: { 
      companyId, 
      assignedToId: { not: null },
      ...dateFilter('createdAt'),
    },
    _count: true,
  });

  const userIds = results.map(r => r.assignedToId).filter(Boolean);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const userMap = new Map(users.map(u => [u.id, u]));

  return results.map(r => ({
    user: userMap.get(r.assignedToId),
    count: r._count,
  }));
}

// ============================================
// PROJECT REPORTS
// ============================================

/**
 * Get project statistics
 */
export async function getProjectStats(companyId) {
  const [total, byStatus, totalValue] = await Promise.all([
    prisma.project.count({ where: { companyId } }),
    
    prisma.project.groupBy({
      by: ['status'],
      where: { companyId },
      _count: true,
    }),

    prisma.project.aggregate({
      where: { companyId },
      _sum: { value: true },
    }),
  ]);

  const statusCounts = {};
  byStatus.forEach(s => {
    statusCounts[s.status] = s._count;
  });

  return {
    total,
    active: statusCounts['active'] || 0,
    completed: statusCounts['completed'] || 0,
    onHold: statusCounts['on_hold'] || 0,
    totalValue: Number(totalValue._sum.value || 0),
  };
}

/**
 * Get project profitability
 */
export async function getProjectProfitability(companyId, { limit = 10 }) {
  const projects = await prisma.project.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      number: true,
      value: true,
      status: true,
      invoices: {
        select: { total: true, amountPaid: true },
      },
      _count: {
        select: { jobs: true },
      },
    },
    orderBy: { value: 'desc' },
    take: limit,
  });

  return projects.map(p => {
    const invoiced = p.invoices.reduce((sum, i) => sum + Number(i.total), 0);
    const collected = p.invoices.reduce((sum, i) => sum + Number(i.amountPaid), 0);
    
    return {
      id: p.id,
      name: p.name,
      number: p.number,
      status: p.status,
      value: Number(p.value || 0),
      invoiced,
      collected,
      jobCount: p._count.jobs,
      collectionRate: invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0,
    };
  });
}

// ============================================
// TEAM REPORTS
// ============================================

/**
 * Get team productivity
 */
export async function getTeamProductivity(companyId, { startDate, endDate }) {
  const dateFilter = buildDateFilter(startDate, endDate);

  // Time entries by user
  const timeByUser = await prisma.timeEntry.groupBy({
    by: ['userId'],
    where: { 
      companyId, 
      status: 'completed',
      ...dateFilter('startTime'),
    },
    _sum: { workedMinutes: true },
    _count: true,
  });

  // Jobs completed by user
  const jobsByUser = await prisma.job.groupBy({
    by: ['assignedToId'],
    where: { 
      companyId, 
      status: 'completed',
      assignedToId: { not: null },
      ...dateFilter('completedAt'),
    },
    _count: true,
  });

  // Get user details
  const userIds = [...new Set([
    ...timeByUser.map(t => t.userId),
    ...jobsByUser.map(j => j.assignedToId),
  ])].filter(Boolean);

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true, role: true },
  });

  const userMap = new Map(users.map(u => [u.id, u]));
  const timeMap = new Map(timeByUser.map(t => [t.userId, t]));
  const jobMap = new Map(jobsByUser.map(j => [j.assignedToId, j]));

  return userIds.map(userId => {
    const user = userMap.get(userId);
    const time = timeMap.get(userId);
    const jobs = jobMap.get(userId);

    return {
      user,
      hoursWorked: Math.round((time?._sum.workedMinutes || 0) / 60 * 10) / 10,
      timeEntries: time?._count || 0,
      jobsCompleted: jobs?._count || 0,
    };
  }).sort((a, b) => b.hoursWorked - a.hoursWorked);
}

// ============================================
// QUOTE REPORTS
// ============================================

/**
 * Get quote statistics
 */
export async function getQuoteStats(companyId, { startDate, endDate }) {
  const dateFilter = buildDateFilter(startDate, endDate);

  const [total, byStatus, totalValue] = await Promise.all([
    prisma.quote.count({ where: { companyId, ...dateFilter('createdAt') } }),
    
    prisma.quote.groupBy({
      by: ['status'],
      where: { companyId, ...dateFilter('createdAt') },
      _count: true,
      _sum: { total: true },
    }),

    prisma.quote.aggregate({
      where: { companyId, ...dateFilter('createdAt') },
      _sum: { total: true },
    }),
  ]);

  const statusData = {};
  byStatus.forEach(s => {
    statusData[s.status] = { count: s._count, value: Number(s._sum.total || 0) };
  });

  const approved = statusData['approved'] || { count: 0, value: 0 };
  const conversionRate = total > 0 ? Math.round((approved.count / total) * 100) : 0;

  return {
    total,
    totalValue: Number(totalValue._sum.total || 0),
    approved: approved.count,
    approvedValue: approved.value,
    pending: (statusData['draft']?.count || 0) + (statusData['sent']?.count || 0),
    rejected: statusData['rejected']?.count || 0,
    conversionRate,
  };
}

// ============================================
// DASHBOARD SUMMARY
// ============================================

/**
 * Get complete dashboard data
 */
export async function getDashboardSummary(companyId) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [revenue, jobs, projects, quotes, recentActivity] = await Promise.all([
    getRevenueOverview(companyId, { 
      startDate: thirtyDaysAgo.toISOString(), 
      endDate: today.toISOString() 
    }),
    getJobStats(companyId, { 
      startDate: thirtyDaysAgo.toISOString(), 
      endDate: today.toISOString() 
    }),
    getProjectStats(companyId),
    getQuoteStats(companyId, { 
      startDate: thirtyDaysAgo.toISOString(), 
      endDate: today.toISOString() 
    }),
    getRecentActivity(companyId, 10),
  ]);

  return {
    period: '30 days',
    revenue,
    jobs,
    projects,
    quotes,
    recentActivity,
  };
}

/**
 * Get recent activity
 */
async function getRecentActivity(companyId, limit = 10) {
  // Get recent invoices, jobs, quotes
  const [invoices, jobs, quotes] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId },
      select: { id: true, number: true, total: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.job.findMany({
      where: { companyId },
      select: { id: true, number: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.quote.findMany({
      where: { companyId },
      select: { id: true, number: true, total: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  // Combine and sort
  const activity = [
    ...invoices.map(i => ({ type: 'invoice', ...i })),
    ...jobs.map(j => ({ type: 'job', ...j })),
    ...quotes.map(q => ({ type: 'quote', ...q })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);

  return activity;
}

// ============================================
// HELPERS
// ============================================

function buildDateFilter(startDate, endDate) {
  return (field) => {
    const filter = {};
    if (startDate || endDate) {
      filter[field] = {};
      if (startDate) filter[field].gte = new Date(startDate);
      if (endDate) filter[field].lte = new Date(endDate);
    }
    return filter;
  };
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
};
