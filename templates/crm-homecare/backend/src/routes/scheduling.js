import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// ── SCHEDULES ─────────────────────────────────────────────────────

router.get('/schedules', async (req, res, next) => {
  try {
    const { clientId, caregiverId, startDate, endDate } = req.query;
    const where = {};
    if (clientId) where.clientId = clientId;
    if (caregiverId) where.caregiverId = caregiverId;
    if (startDate || endDate) {
      where.effectiveDate = {};
      if (startDate) where.effectiveDate.gte = new Date(startDate);
      if (endDate) where.effectiveDate.lte = new Date(endDate);
    }
    const schedules = await prisma.schedule.findMany({ where, orderBy: { effectiveDate: 'asc' } });
    res.json(schedules);
  } catch (err) { next(err); }
});

router.post('/schedules', requireAdmin, async (req, res, next) => {
  try {
    const schedule = await prisma.schedule.create({ data: req.body });
    res.status(201).json(schedule);
  } catch (err) { next(err); }
});

router.put('/schedules/:id', requireAdmin, async (req, res, next) => {
  try {
    const schedule = await prisma.schedule.update({ where: { id: req.params.id }, data: req.body });
    res.json(schedule);
  } catch (err) { next(err); }
});

router.delete('/schedules/:id', requireAdmin, async (req, res, next) => {
  try {
    await prisma.schedule.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

// ── CAREGIVER SCHEDULES (availability calendar) ───────────────────

router.get('/caregiver-schedules', async (req, res, next) => {
  try {
    const { caregiverId, startDate, endDate } = req.query;
    const where = {};
    if (caregiverId) where.caregiverId = caregiverId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    const schedules = await prisma.caregiverSchedule.findMany({ where, orderBy: { date: 'asc' }, include: { caregiver: { select: { firstName: true, lastName: true } } } });
    res.json(schedules);
  } catch (err) { next(err); }
});

router.post('/caregiver-schedules', requireAdmin, async (req, res, next) => {
  try {
    const schedule = await prisma.caregiverSchedule.create({ data: req.body });
    res.status(201).json(schedule);
  } catch (err) { next(err); }
});

// ── TIME OFF ──────────────────────────────────────────────────────

router.get('/time-off', async (req, res, next) => {
  try {
    const { caregiverId, status } = req.query;
    const where = {};
    if (caregiverId) where.caregiverId = caregiverId;
    if (status) where.status = status;
    const timeOff = await prisma.caregiverTimeOff.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: { caregiver: { select: { firstName: true, lastName: true } } },
    });
    res.json(timeOff);
  } catch (err) { next(err); }
});

router.post('/time-off', async (req, res, next) => {
  try {
    const caregiverId = req.user.role === 'caregiver' ? req.user.userId : req.body.caregiverId;
    const timeOff = await prisma.caregiverTimeOff.create({ data: { ...req.body, caregiverId } });
    res.status(201).json(timeOff);
  } catch (err) { next(err); }
});

router.patch('/time-off/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const updated = await prisma.caregiverTimeOff.update({
      where: { id: req.params.id },
      data: { status: 'approved', approvedById: req.user.userId },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.patch('/time-off/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    const updated = await prisma.caregiverTimeOff.update({ where: { id: req.params.id }, data: { status: 'rejected' } });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── OPEN SHIFTS ───────────────────────────────────────────────────

router.get('/open-shifts', async (req, res, next) => {
  try {
    const { status = 'open' } = req.query;
    const shifts = await prisma.openShift.findMany({
      where: { status },
      orderBy: { date: 'asc' },
      include: { notifications: true },
    });
    res.json(shifts);
  } catch (err) { next(err); }
});

router.post('/open-shifts', requireAdmin, async (req, res, next) => {
  try {
    const shift = await prisma.openShift.create({ data: { ...req.body, createdById: req.user.userId } });
    res.status(201).json(shift);
  } catch (err) { next(err); }
});

router.patch('/open-shifts/:id', requireAdmin, async (req, res, next) => {
  try {
    const shift = await prisma.openShift.update({ where: { id: req.params.id }, data: req.body });
    res.json(shift);
  } catch (err) { next(err); }
});

// ── ABSENCES ──────────────────────────────────────────────────────

router.get('/absences', async (req, res, next) => {
  try {
    const { startDate, endDate, caregiverId } = req.query;
    const where = {};
    if (caregiverId) where.caregiverId = caregiverId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    const absences = await prisma.absence.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        caregiver: { select: { firstName: true, lastName: true } },
        coverageAssigned: { select: { firstName: true, lastName: true } },
      },
    });
    res.json(absences);
  } catch (err) { next(err); }
});

router.post('/absences', requireAdmin, async (req, res, next) => {
  try {
    const absence = await prisma.absence.create({
      data: { ...req.body, reportedById: req.user.userId },
    });

    // Auto-create open shift if coverage needed
    if (absence.coverageNeeded) {
      await prisma.openShift.create({
        data: {
          clientId: absence.clientId,
          date: absence.date,
          autoCreated: true,
          sourceAbsenceId: absence.id,
          createdById: req.user.userId,
        },
      });
    }

    res.status(201).json(absence);
  } catch (err) { next(err); }
});

// ── NO-SHOW ALERTS ────────────────────────────────────────────────

router.get('/noshow-alerts', requireAdmin, async (req, res, next) => {
  try {
    const alerts = await prisma.noshowAlert.findMany({
      where: { status: 'open' },
      orderBy: { alertedAt: 'desc' },
      include: {
        caregiver: { select: { firstName: true, lastName: true, phone: true } },
        client: { select: { firstName: true, lastName: true, address: true } },
      },
    });
    res.json(alerts);
  } catch (err) { next(err); }
});

router.patch('/noshow-alerts/:id/resolve', requireAdmin, async (req, res, next) => {
  try {
    const alert = await prisma.noshowAlert.update({
      where: { id: req.params.id },
      data: { status: req.body.status || 'resolved', resolvedAt: new Date(), resolvedById: req.user.userId, resolutionNote: req.body.resolutionNote },
    });
    res.json(alert);
  } catch (err) { next(err); }
});

router.get('/noshow-config', requireAdmin, async (req, res, next) => {
  try {
    let config = await prisma.noshowAlertConfig.findFirst();
    if (!config) config = await prisma.noshowAlertConfig.create({ data: {} });
    res.json(config);
  } catch (err) { next(err); }
});

router.put('/noshow-config', requireAdmin, async (req, res, next) => {
  try {
    let config = await prisma.noshowAlertConfig.findFirst();
    if (config) {
      config = await prisma.noshowAlertConfig.update({ where: { id: config.id }, data: req.body });
    } else {
      config = await prisma.noshowAlertConfig.create({ data: req.body });
    }
    res.json(config);
  } catch (err) { next(err); }
});

export default router;
