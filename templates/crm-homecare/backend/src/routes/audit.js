import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { tableName, userId, page = 1, limit = 100 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (tableName) where.tableName = tableName;
    if (userId) where.userId = userId;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, skip, take: parseInt(limit), orderBy: { timestamp: 'desc' } }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ logs, total });
  } catch (err) { next(err); }
});

export default router;
