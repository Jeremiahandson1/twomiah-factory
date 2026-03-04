import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import push from '../services/push.js';

const router = Router();

// Get VAPID public key (no auth required)
router.get('/vapid-public-key', (req, res) => {
  const key = push.getVapidPublicKey();
  
  if (!key) {
    return res.status(503).json({ error: 'Push notifications not configured' });
  }

  res.json({ key });
});

// All other routes require authentication
router.use(authenticate);

// Subscribe to push notifications
router.post('/subscribe', async (req, res, next) => {
  try {
    const { subscription } = req.body;

    if (!subscription?.endpoint || !subscription?.keys) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    const saved = await push.saveSubscription(req.user.userId, {
      ...subscription,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, id: saved.id });
  } catch (error) {
    next(error);
  }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is required' });
    }

    await push.removeSubscription(req.user.userId, endpoint);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get user's subscriptions
router.get('/subscriptions', async (req, res, next) => {
  try {
    const subscriptions = await push.getUserSubscriptions(req.user.userId);
    res.json(subscriptions.map(s => ({
      id: s.id,
      endpoint: s.endpoint,
      createdAt: s.createdAt,
      userAgent: s.userAgent,
    })));
  } catch (error) {
    next(error);
  }
});

// Send test notification to self
router.post('/test', async (req, res, next) => {
  try {
    const result = await push.sendToUser(req.user.userId, {
      title: 'Test Notification',
      body: 'Push notifications are working!',
      url: '/',
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Admin: Send notification to user
router.post('/send', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const { userId, userIds, title, body, url } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    let result;

    if (userIds?.length) {
      result = await push.sendToUsers(userIds, { title, body, url });
    } else if (userId) {
      result = await push.sendToUser(userId, { title, body, url });
    } else {
      return res.status(400).json({ error: 'userId or userIds is required' });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Admin: Send notification to all company users
router.post('/broadcast', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const { title, body, url } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const result = await push.sendToCompany(req.user.companyId, { title, body, url });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
