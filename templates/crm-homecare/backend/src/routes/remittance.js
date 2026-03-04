import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const batches = await prisma.remittanceBatch.findMany({
      orderBy: { createdAt: 'desc' },
      include: { payer: { select: { name: true } }, lineItems: true },
    });
    res.json(batches);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { lineItems, ...data } = req.body;
    const batch = await prisma.remittanceBatch.create({
      data: { ...data, createdById: req.user.userId, lineItems: lineItems ? { create: lineItems } : undefined },
      include: { lineItems: true },
    });
    res.status(201).json(batch);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const batch = await prisma.remittanceBatch.update({ where: { id: req.params.id }, data: req.body });
    res.json(batch);
  } catch (err) { next(err); }
});

export default router;
