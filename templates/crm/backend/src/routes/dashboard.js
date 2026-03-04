import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/stats', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [contacts, projects, jobs, quotes, invoices, todayJobs] = await Promise.all([
      prisma.contact.count({ where: { companyId } }),
      prisma.project.groupBy({ by: ['status'], where: { companyId }, _count: true }),
      prisma.job.groupBy({ by: ['status'], where: { companyId }, _count: true }),
      prisma.quote.findMany({ where: { companyId }, select: { status: true, total: true } }),
      prisma.invoice.findMany({ where: { companyId }, select: { status: true, total: true, amountPaid: true } }),
      prisma.job.count({ where: { companyId, scheduledDate: { gte: today, lt: new Date(today.getTime() + 86400000) } } }),
    ]);

    const quoteStats = { total: quotes.length, pending: 0, approved: 0, totalValue: 0 };
    quotes.forEach(q => { if (['draft', 'sent'].includes(q.status)) quoteStats.pending++; if (q.status === 'approved') quoteStats.approved++; quoteStats.totalValue += Number(q.total); });

    const invoiceStats = { total: invoices.length, outstanding: 0, paid: 0, totalValue: 0, outstandingValue: 0 };
    invoices.forEach(inv => { invoiceStats.totalValue += Number(inv.total); invoiceStats.outstandingValue += Number(inv.amountPaid); if (inv.status === 'paid') invoiceStats.paid++; else invoiceStats.outstanding++; });

    res.json({
      contacts,
      projects: { total: projects.reduce((s, p) => s + p._count, 0), byStatus: Object.fromEntries(projects.map(p => [p.status, p._count])) },
      jobs: { total: jobs.reduce((s, j) => s + j._count, 0), today: todayJobs, byStatus: Object.fromEntries(jobs.map(j => [j.status, j._count])) },
      quotes: quoteStats,
      invoices: invoiceStats,
    });
  } catch (error) { next(error); }
});

router.get('/recent-activity', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const [recentJobs, recentQuotes, recentInvoices] = await Promise.all([
      prisma.job.findMany({ where: { companyId }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, number: true, title: true, status: true, updatedAt: true } }),
      prisma.quote.findMany({ where: { companyId }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, number: true, name: true, status: true, total: true, updatedAt: true } }),
      prisma.invoice.findMany({ where: { companyId }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, number: true, status: true, total: true, amountPaid: true, updatedAt: true } }),
    ]);
    res.json({ recentJobs, recentQuotes, recentInvoices });
  } catch (error) { next(error); }
});

export default router;
