import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const payers = await prisma.referralSource.findMany({
      where: { isActive: true },
      orderBy: [{ isActivePayer: 'desc' }, { name: 'asc' }],
    });
    res.json(payers);
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const payer = await prisma.referralSource.create({ data: req.body });
    res.status(201).json(payer);
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const payer = await prisma.referralSource.update({ where: { id: req.params.id }, data: req.body });
    res.json(payer);
  } catch (err) { next(err); }
});

export default router;
