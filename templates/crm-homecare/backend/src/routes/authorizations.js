import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { clientId, status, payerId } = req.query;
    const where = {};
    if (clientId) where.clientId = clientId;
    if (status) where.status = status;
    if (payerId) where.payerId = payerId;
    const auths = await prisma.authorization.findMany({
      where, orderBy: { endDate: 'asc' },
      include: { client: { select: { firstName: true, lastName: true } }, payer: { select: { name: true } } },
    });
    res.json(auths);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const auth = await prisma.authorization.create({ data: { ...req.body, createdById: req.user.userId } });
    res.status(201).json(auth);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const auth = await prisma.authorization.update({ where: { id: req.params.id }, data: req.body });
    res.json(auth);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.authorization.update({ where: { id: req.params.id }, data: { status: 'cancelled' } });
    res.json({ message: 'Cancelled' });
  } catch (err) { next(err); }
});

export default router;
