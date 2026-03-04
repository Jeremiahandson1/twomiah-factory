import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const codes = await prisma.serviceCode.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
    res.json(codes);
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const code = await prisma.serviceCode.create({ data: req.body });
    res.status(201).json(code);
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const code = await prisma.serviceCode.update({ where: { id: req.params.id }, data: req.body });
    res.json(code);
  } catch (err) { next(err); }
});

export default router;
