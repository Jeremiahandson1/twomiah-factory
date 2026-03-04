import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/status', (req, res) => {
  res.json({ configured: !!process.env.STRIPE_SECRET_KEY });
});

export default router;
