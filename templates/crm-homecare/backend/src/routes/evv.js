import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { status, startDate, endDate, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (status) where.sandataStatus = status;
    if (startDate || endDate) {
      where.serviceDate = {};
      if (startDate) where.serviceDate.gte = new Date(startDate);
      if (endDate) where.serviceDate.lte = new Date(endDate);
    }
    const [visits, total] = await Promise.all([
      prisma.evvVisit.findMany({
        where, skip, take: parseInt(limit), orderBy: { serviceDate: 'desc' },
        include: {
          timeEntry: { select: { startTime: true, endTime: true, durationMinutes: true } },
          client: { select: { firstName: true, lastName: true, mcoMemberId: true } },
        },
      }),
      prisma.evvVisit.count({ where }),
    ]);
    res.json({ visits, total });
  } catch (err) { next(err); }
});

router.post('/create-from-entry/:timeEntryId', async (req, res, next) => {
  try {
    const entry = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: req.params.timeEntryId },
      include: { client: true },
    });
    const visit = await prisma.evvVisit.create({
      data: {
        timeEntryId: entry.id,
        clientId: entry.clientId,
        caregiverId: entry.caregiverId,
        serviceDate: new Date(entry.startTime.toISOString().split('T')[0]),
        actualStart: entry.startTime,
        actualEnd: entry.endTime,
        gpsInLat: entry.clockInLocation?.lat,
        gpsInLng: entry.clockInLocation?.lng,
        gpsOutLat: entry.clockOutLocation?.lat,
        gpsOutLng: entry.clockOutLocation?.lng,
        ...req.body,
      },
    });
    res.status(201).json(visit);
  } catch (err) { next(err); }
});

router.patch('/:id/verify', async (req, res, next) => {
  try {
    const visit = await prisma.evvVisit.update({ where: { id: req.params.id }, data: { isVerified: true, sandataStatus: 'accepted' } });
    res.json(visit);
  } catch (err) { next(err); }
});

export default router;
