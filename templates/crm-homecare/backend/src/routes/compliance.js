import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

// Compliance dashboard - certifications expiring, background checks, etc.
router.get('/dashboard', async (req, res, next) => {
  try {
    const soon = new Date(); soon.setDate(soon.getDate() + 60);

    const [activeCaregiversCount, caregivers, recentBackgroundChecks, performanceRatings] = await Promise.all([
      prisma.user.count({ where: { role: 'caregiver', isActive: true } }),
      prisma.user.findMany({
        where: { role: 'caregiver', isActive: true },
        select: { id: true, firstName: true, lastName: true, certifications: true, certificationsExpiry: true },
      }),
      prisma.backgroundCheck.findMany({
        where: { expirationDate: { lte: soon } },
        orderBy: { expirationDate: 'asc' }, take: 20,
        include: { caregiver: { select: { firstName: true, lastName: true } } },
      }),
      prisma.performanceRating.groupBy({
        by: ['caregiverId'],
        _avg: { satisfactionScore: true, punctualityScore: true },
        _count: true,
      }),
    ]);

    // Identify caregivers with expiring certs
    const expiringCerts = caregivers.flatMap(c =>
      (c.certificationsExpiry || []).map((exp, i) => ({
        caregiverId: c.id,
        name: `${c.firstName} ${c.lastName}`,
        cert: c.certifications[i],
        expiry: exp,
      })).filter(x => x.expiry && new Date(x.expiry) <= soon)
    );

    res.json({ activeCaregiversCount, expiringCerts, recentBackgroundChecks, performanceRatings });
  } catch (err) { next(err); }
});

// Performance ratings
router.get('/ratings', async (req, res, next) => {
  try {
    const ratings = await prisma.performanceRating.findMany({
      where: req.query.caregiverId ? { caregiverId: req.query.caregiverId } : {},
      orderBy: { ratingDate: 'desc' },
      include: {
        caregiver: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
      },
    });
    res.json(ratings);
  } catch (err) { next(err); }
});

router.post('/ratings', async (req, res, next) => {
  try {
    const rating = await prisma.performanceRating.create({ data: req.body });
    res.status(201).json(rating);
  } catch (err) { next(err); }
});

// Login activity monitor
router.get('/login-activity', async (req, res, next) => {
  try {
    const activity = await prisma.loginActivity.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { firstName: true, lastName: true, role: true } } },
    });
    res.json(activity);
  } catch (err) { next(err); }
});

export default router;
