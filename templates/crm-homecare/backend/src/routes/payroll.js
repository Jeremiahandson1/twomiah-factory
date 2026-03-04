import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

// GET payroll summary for a pay period
router.get('/summary', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

    const entries = await prisma.timeEntry.findMany({
      where: {
        startTime: { gte: new Date(startDate), lte: new Date(endDate) },
        isComplete: true,
      },
      include: { caregiver: { select: { id: true, firstName: true, lastName: true, defaultPayRate: true } } },
    });

    // Group by caregiver
    const byCaregiver = {};
    entries.forEach(e => {
      const id = e.caregiverId;
      if (!byCaregiver[id]) {
        byCaregiver[id] = { caregiver: e.caregiver, totalMinutes: 0, totalPay: 0, entryCount: 0 };
      }
      byCaregiver[id].totalMinutes += e.billableMinutes || e.durationMinutes || 0;
      byCaregiver[id].entryCount++;
    });

    Object.values(byCaregiver).forEach(c => {
      const hours = c.totalMinutes / 60;
      c.totalHours = Number(hours.toFixed(2));
      c.totalPay = Number((hours * Number(c.caregiver.defaultPayRate || 15)).toFixed(2));
    });

    res.json({ payPeriodStart: startDate, payPeriodEnd: endDate, caregivers: Object.values(byCaregiver) });
  } catch (err) { next(err); }
});

// GET /payroll/gusto/sync-log
router.get('/gusto/sync-log', async (req, res, next) => {
  try {
    const logs = await prisma.gustoSyncLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    res.json(logs);
  } catch (err) { next(err); }
});

// POST /payroll/gusto/sync
router.post('/gusto/sync', async (req, res, next) => {
  try {
    const log = await prisma.gustoSyncLog.create({
      data: {
        syncType: 'export',
        status: 'success',
        payPeriodStart: req.body.startDate ? new Date(req.body.startDate) : undefined,
        payPeriodEnd: req.body.endDate ? new Date(req.body.endDate) : undefined,
        recordsExported: req.body.recordCount || 0,
        createdById: req.user.userId,
      },
    });
    res.json(log);
  } catch (err) { next(err); }
});

// GET /payroll/expenses
router.get('/expenses', async (req, res, next) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: req.query.status ? { status: req.query.status } : {},
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    res.json(expenses);
  } catch (err) { next(err); }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const expense = await prisma.expense.create({
      data: { ...req.body, userId: req.user.role === 'caregiver' ? req.user.userId : req.body.userId },
    });
    res.status(201).json(expense);
  } catch (err) { next(err); }
});

router.patch('/expenses/:id/status', async (req, res, next) => {
  try {
    const expense = await prisma.expense.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    res.json(expense);
  } catch (err) { next(err); }
});

export default router;
