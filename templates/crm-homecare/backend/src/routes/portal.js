import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

const router = Router();

// Portal uses its own lightweight auth (token-based, no password)
const portalAuth = async (req, res, next) => {
  const token = req.headers['x-portal-token'];
  if (!token) return res.status(401).json({ error: 'Portal token required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.portalClientId = decoded.clientId;
    next();
  } catch { res.status(401).json({ error: 'Invalid portal token' }); }
};

// Generate portal access link (admin only)
router.post('/generate-link', async (req, res, next) => {
  try {
    const { clientId } = req.body;
    const token = jwt.sign({ clientId, type: 'portal' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, url: `${process.env.FRONTEND_URL}/portal?token=${token}` });
  } catch (err) { next(err); }
});

// Portal endpoints (family-facing)
router.get('/schedule', portalAuth, async (req, res, next) => {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { clientId: req.portalClientId, isActive: true },
      orderBy: { effectiveDate: 'asc' },
    });
    res.json(schedules);
  } catch (err) { next(err); }
});

router.get('/visits', portalAuth, async (req, res, next) => {
  try {
    const visits = await prisma.timeEntry.findMany({
      where: { clientId: req.portalClientId, isComplete: true },
      orderBy: { startTime: 'desc' },
      take: 30,
      include: { caregiver: { select: { firstName: true, lastName: true } } },
    });
    res.json(visits);
  } catch (err) { next(err); }
});

router.get('/invoices', portalAuth, async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { clientId: req.portalClientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { lineItems: true },
    });
    res.json(invoices);
  } catch (err) { next(err); }
});

router.get('/caregivers', portalAuth, async (req, res, next) => {
  try {
    const assignments = await prisma.clientAssignment.findMany({
      where: { clientId: req.portalClientId, status: 'active' },
      include: { caregiver: { select: { firstName: true, lastName: true, phone: true, certifications: true } } },
    });
    res.json(assignments.map(a => a.caregiver));
  } catch (err) { next(err); }
});

export default router;
