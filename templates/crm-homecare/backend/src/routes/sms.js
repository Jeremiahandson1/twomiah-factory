import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.post('/send', async (req, res, next) => {
  try {
    const { to, body } = req.body;
    if (!process.env.TWILIO_ACCOUNT_SID) {
      return res.status(503).json({ error: 'SMS not configured. Add Twilio credentials to enable SMS.' });
    }
    // Dynamic import to avoid crash if twilio not configured
    const twilio = await import('twilio');
    const client = twilio.default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const message = await client.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, to, body });
    res.json({ sid: message.sid, status: message.status });
  } catch (err) { next(err); }
});

export default router;
