import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (status) where.status = status;
    const [claims, total] = await Promise.all([
      prisma.claim.findMany({
        where, skip, take: parseInt(limit), orderBy: { createdAt: 'desc' },
        include: { ediBatch: { select: { batchNumber: true } }, evvVisit: { select: { serviceDate: true } } },
      }),
      prisma.claim.count({ where }),
    ]);
    res.json({ claims, total });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const claim = await prisma.claim.create({ data: req.body });
    res.status(201).json(claim);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const claim = await prisma.claim.update({ where: { id: req.params.id }, data: req.body });
    res.json(claim);
  } catch (err) { next(err); }
});

export default router;
