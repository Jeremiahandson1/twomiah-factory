import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const agency = await prisma.agency.findFirst();
    res.json(agency || {});
  } catch (err) { next(err); }
});

router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.agency.findFirst();
    let agency;
    if (existing) {
      agency = await prisma.agency.update({ where: { id: existing.id }, data: req.body });
    } else {
      const slug = (req.body.name || 'agency').toLowerCase().replace(/[^a-z0-9]/g, '-');
      agency = await prisma.agency.create({ data: { ...req.body, slug } });
    }
    res.json(agency);
  } catch (err) { next(err); }
});

// User management (all staff)
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, lastLogin: true },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    });
    res.json(users);
  } catch (err) { next(err); }
});

export default router;
