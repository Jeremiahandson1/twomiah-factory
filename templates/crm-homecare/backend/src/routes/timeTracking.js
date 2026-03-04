import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/time-tracking
router.get('/', async (req, res, next) => {
  try {
    const { caregiverId, clientId, startDate, endDate, isComplete, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (req.user.role === 'caregiver') where.caregiverId = req.user.userId;
    else if (caregiverId) where.caregiverId = caregiverId;
    if (clientId) where.clientId = clientId;
    if (isComplete !== undefined) where.isComplete = isComplete === 'true';
    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime.gte = new Date(startDate);
      if (endDate) where.startTime.lte = new Date(new Date(endDate).setHours(23, 59, 59));
    }

    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { startTime: 'desc' },
        include: {
          caregiver: { select: { firstName: true, lastName: true } },
          client: { select: { firstName: true, lastName: true, address: true, city: true } },
          evvVisit: { select: { id: true, sandataStatus: true, isVerified: true } },
        },
      }),
      prisma.timeEntry.count({ where }),
    ]);

    res.json({ entries, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /api/time-tracking/active - caregivers currently clocked in
router.get('/active', requireAdmin, async (req, res, next) => {
  try {
    const active = await prisma.timeEntry.findMany({
      where: { endTime: null, isComplete: false },
      include: {
        caregiver: { select: { id: true, firstName: true, lastName: true, phone: true } },
        client: { select: { id: true, firstName: true, lastName: true, address: true, city: true } },
        gpsPoints: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
    });
    res.json(active);
  } catch (err) { next(err); }
});

// POST /api/time-tracking/clock-in
router.post('/clock-in', async (req, res, next) => {
  try {
    const { clientId, scheduleId, clockInLocation, notes } = req.body;
    const caregiverId = req.user.role === 'caregiver' ? req.user.userId : req.body.caregiverId;

    // Check not already clocked in
    const existing = await prisma.timeEntry.findFirst({
      where: { caregiverId, endTime: null, isComplete: false },
    });
    if (existing) return res.status(400).json({ error: 'Already clocked in. Clock out first.' });

    const entry = await prisma.timeEntry.create({
      data: { caregiverId, clientId, scheduleId, startTime: new Date(), clockInLocation, notes },
      include: {
        caregiver: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
      },
    });
    res.status(201).json(entry);
  } catch (err) { next(err); }
});

// POST /api/time-tracking/clock-out
router.post('/clock-out', async (req, res, next) => {
  try {
    const { timeEntryId, clockOutLocation, notes } = req.body;
    const caregiverId = req.user.role === 'caregiver' ? req.user.userId : req.body.caregiverId;

    const entry = await prisma.timeEntry.findFirst({
      where: { id: timeEntryId, caregiverId, endTime: null },
    });
    if (!entry) return res.status(404).json({ error: 'Active time entry not found' });

    const endTime = new Date();
    const durationMinutes = Math.round((endTime - entry.startTime) / 60000);

    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        endTime,
        durationMinutes,
        billableMinutes: durationMinutes,
        clockOutLocation,
        notes: notes || entry.notes,
        isComplete: true,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/time-tracking/gps
router.post('/gps', async (req, res, next) => {
  try {
    const { timeEntryId, latitude, longitude, accuracy, speed, heading } = req.body;
    const point = await prisma.gpsTracking.create({
      data: {
        caregiverId: req.user.userId,
        timeEntryId,
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
      },
    });
    res.status(201).json(point);
  } catch (err) { next(err); }
});

// PUT /api/time-tracking/:id - admin edit
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { startTime, endTime, notes, billableMinutes } = req.body;
    const data = {};
    if (startTime) data.startTime = new Date(startTime);
    if (endTime) {
      data.endTime = new Date(endTime);
      data.isComplete = true;
      if (startTime) data.durationMinutes = Math.round((new Date(endTime) - new Date(startTime)) / 60000);
    }
    if (notes !== undefined) data.notes = notes;
    if (billableMinutes !== undefined) data.billableMinutes = billableMinutes;

    const updated = await prisma.timeEntry.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/time-tracking/:id/gps
router.get('/:id/gps', requireAdmin, async (req, res, next) => {
  try {
    const points = await prisma.gpsTracking.findMany({
      where: { timeEntryId: req.params.id },
      orderBy: { timestamp: 'asc' },
    });
    res.json(points);
  } catch (err) { next(err); }
});

// GET /api/time-tracking/geofence/:clientId
router.get('/geofence/:clientId', async (req, res, next) => {
  try {
    const settings = await prisma.geofenceSettings.findUnique({ where: { clientId: req.params.clientId } });
    const client = await prisma.client.findUnique({ where: { id: req.params.clientId }, select: { latitude: true, longitude: true, address: true } });
    res.json({ settings, client });
  } catch (err) { next(err); }
});

router.post('/geofence/:clientId', requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.geofenceSettings.upsert({
      where: { clientId: req.params.clientId },
      create: { ...req.body, clientId: req.params.clientId },
      update: req.body,
    });
    res.json(settings);
  } catch (err) { next(err); }
});

export default router;
