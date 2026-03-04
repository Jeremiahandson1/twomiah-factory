import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// TODO: Convert from raw SQL to Prisma queries
// Original CVHC reports.js has full implementation

router.get('/summary', authenticate, async (req, res) => {
  res.json({ message: 'Reports coming soon', data: {} });
});

router.get('/hours', authenticate, async (req, res) => {
  res.json({ data: [] });
});

router.get('/billing', authenticate, requireAdmin, async (req, res) => {
  res.json({ data: [] });
});

router.get('/payroll', authenticate, requireAdmin, async (req, res) => {
  res.json({ data: [] });
});

export default router;
