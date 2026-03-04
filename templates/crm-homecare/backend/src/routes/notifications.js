import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notifications);
  } catch (err) { next(err); }
});

router.patch('/mark-read', async (req, res, next) => {
  try {
    const { ids } = req.body;
    const where = ids?.length ? { id: { in: ids }, userId: req.user.userId } : { userId: req.user.userId };
    await prisma.notification.updateMany({ where, data: { isRead: true } });
    res.json({ message: 'Marked as read' });
  } catch (err) { next(err); }
});

router.get('/preferences', async (req, res, next) => {
  try {
    let prefs = await prisma.notificationPreference.findUnique({ where: { userId: req.user.userId } });
    if (!prefs) prefs = await prisma.notificationPreference.create({ data: { userId: req.user.userId } });
    res.json(prefs);
  } catch (err) { next(err); }
});

router.put('/preferences', async (req, res, next) => {
  try {
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId: req.user.userId },
      create: { ...req.body, userId: req.user.userId },
      update: req.body,
    });
    res.json(prefs);
  } catch (err) { next(err); }
});

export default router;
