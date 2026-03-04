import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/dashboard/stats
router.get('/stats', async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      activeClients,
      activeCaregiversCount,
      openShifts,
      openNoshows,
      incompleteOnboarding,
      invoicesOutstanding,
      authsExpiringSoon,
      shiftsToday,
    ] = await Promise.all([
      prisma.client.count({ where: { isActive: true } }),
      prisma.user.count({ where: { role: 'caregiver', isActive: true } }),
      prisma.openShift.count({ where: { status: 'open', date: { gte: today } } }),
      prisma.noshowAlert.count({ where: { status: 'open' } }),
      prisma.clientOnboarding.count({ where: { allCompleted: false } }),
      prisma.invoice.aggregate({ where: { paymentStatus: { in: ['pending', 'overdue'] } }, _sum: { total: true } }),
      prisma.authorization.count({
        where: {
          status: 'active',
          endDate: { lte: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) },
        }
      }),
      prisma.timeEntry.count({ where: { startTime: { gte: today, lt: tomorrow }, isComplete: false } }),
    ]);

    // Caregivers currently on shift
    const caregiversClockedIn = await prisma.timeEntry.findMany({
      where: { startTime: { gte: today }, endTime: null, isComplete: false },
      select: { caregiverId: true },
      distinct: ['caregiverId'],
    });

    res.json({
      activeClients,
      activeCaregiversCount,
      caregiversClockedIn: caregiversClockedIn.length,
      openShifts,
      openNoshows,
      incompleteOnboarding,
      outstandingRevenue: Number(invoicesOutstanding._sum.total || 0),
      authsExpiringSoon,
      shiftsToday,
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/recent-activity
router.get('/recent-activity', async (req, res, next) => {
  try {
    const [recentClients, recentTimeEntries, recentInvoices, pendingAbsences] = await Promise.all([
      prisma.client.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, firstName: true, lastName: true, serviceType: true, createdAt: true } }),
      prisma.timeEntry.findMany({ orderBy: { startTime: 'desc' }, take: 8, select: { id: true, startTime: true, endTime: true, isComplete: true, caregiver: { select: { firstName: true, lastName: true } }, client: { select: { firstName: true, lastName: true } } } }),
      prisma.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, invoiceNumber: true, total: true, paymentStatus: true, createdAt: true, client: { select: { firstName: true, lastName: true } } } }),
      prisma.absence.findMany({ orderBy: { createdAt: 'desc' }, take: 5, where: { coverageNeeded: true, coverageAssignedTo: null }, select: { id: true, date: true, type: true, caregiver: { select: { firstName: true, lastName: true } } } }),
    ]);

    res.json({ recentClients, recentTimeEntries, recentInvoices, pendingAbsences });
  } catch (err) { next(err); }
});

// GET /api/dashboard/alerts
router.get('/alerts', async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [noshowAlerts, expiringAuths, expiringCerts] = await Promise.all([
      prisma.noshowAlert.findMany({
        where: { status: 'open' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { caregiver: { select: { firstName: true, lastName: true } }, client: { select: { firstName: true, lastName: true } } },
      }),
      prisma.authorization.findMany({
        where: {
          status: 'active',
          endDate: { lte: new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000) },
        },
        include: { client: { select: { firstName: true, lastName: true } } },
        orderBy: { endDate: 'asc' },
        take: 10,
      }),
      prisma.user.findMany({
        where: {
          role: 'caregiver',
          isActive: true,
          certificationsExpiry: { hasSome: [] },
        },
        select: { id: true, firstName: true, lastName: true, certifications: true, certificationsExpiry: true },
        take: 10,
      }),
    ]);

    res.json({ noshowAlerts, expiringAuths, expiringCerts });
  } catch (err) { next(err); }
});

export default router;
