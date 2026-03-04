import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.post('/subscribe', async (req, res, next) => {
  try {
    const sub = await prisma.pushSubscription.upsert({
      where: { userId_subscription: { userId: req.user.userId, subscription: req.body.subscription } },
      create: { userId: req.user.userId, subscription: req.body.subscription },
      update: { isActive: true, updatedAt: new Date() },
    });
    res.json(sub);
  } catch (err) { next(err); }
});

router.post('/unsubscribe', async (req, res, next) => {
  try {
    await prisma.pushSubscription.updateMany({
      where: { userId: req.user.userId },
      data: { isActive: false },
    });
    res.json({ message: 'Unsubscribed' });
  } catch (err) { next(err); }
});

router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

export default router;
