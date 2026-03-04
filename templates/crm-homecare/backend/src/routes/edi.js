import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/batches', async (req, res, next) => {
  try {
    const batches = await prisma.ediBatch.findMany({
      orderBy: { createdAt: 'desc' },
      include: { payer: { select: { name: true } }, _count: { select: { claims: true } } },
    });
    res.json(batches);
  } catch (err) { next(err); }
});

router.post('/batches', async (req, res, next) => {
  try {
    const count = await prisma.ediBatch.count();
    const batch = await prisma.ediBatch.create({
      data: { ...req.body, batchNumber: `EDI-${String(count + 1).padStart(5, '0')}`, createdById: req.user.userId },
    });
    res.status(201).json(batch);
  } catch (err) { next(err); }
});

router.patch('/batches/:id/submit', async (req, res, next) => {
  try {
    const batch = await prisma.ediBatch.update({
      where: { id: req.params.id },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    res.json(batch);
  } catch (err) { next(err); }
});

export default router;
