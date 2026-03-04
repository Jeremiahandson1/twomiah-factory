import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

// Company-level efficiency analysis
router.get('/company', async (req, res, next) => {
  try {
    const activeClients = await prisma.client.findMany({
      where: { isActive: true },
      include: { assignments: { where: { status: 'active' }, include: { caregiver: { select: { id: true, firstName: true, lastName: true } } } } },
    });

    const understaffed = activeClients.filter(c => c.assignments.length === 0)
      .map(c => ({ clientId: c.id, name: `${c.firstName} ${c.lastName}`, issue: 'No active caregiver assigned' }));

    const caregiverHours = await prisma.timeEntry.groupBy({
      by: ['caregiverId'],
      where: { startTime: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, isComplete: true },
      _sum: { durationMinutes: true },
    });

    const overscheduled = caregiverHours
      .filter(c => (c._sum.durationMinutes || 0) > 40 * 60)
      .map(c => ({ caregiverId: c.caregiverId, weeklyMinutes: c._sum.durationMinutes, issue: 'Over 40 hours this week' }));

    res.json({ understaffedClients: understaffed, overscheduledCaregivers: overscheduled });
  } catch (err) { next(err); }
});

// Route optimizer - find optimal caregiver order for multi-client days
router.get('/routes', async (req, res, next) => {
  try {
    const { caregiverId, date } = req.query;
    const dateObj = date ? new Date(date) : new Date();
    const nextDay = new Date(dateObj); nextDay.setDate(dateObj.getDate() + 1);

    const assignments = await prisma.clientAssignment.findMany({
      where: { caregiverId, status: 'active' },
      include: { client: { select: { firstName: true, lastName: true, address: true, city: true, latitude: true, longitude: true } } },
    });

    res.json({ caregiverId, date: dateObj.toISOString().split('T')[0], stops: assignments.map(a => a.client) });
  } catch (err) { next(err); }
});

export default router;
