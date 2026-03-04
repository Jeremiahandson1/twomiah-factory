import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import reviews from '../services/reviews.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Get review settings
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await reviews.getReviewSettings(req.user.companyId);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

// Update review settings
router.put('/settings', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const settings = await reviews.updateReviewSettings(req.user.companyId, req.body);
    
    audit.log({
      action: 'REVIEW_SETTINGS_UPDATED',
      entity: 'company',
      entityId: req.user.companyId,
      req,
    });

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

// Get review stats
router.get('/stats', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await reviews.getReviewStats(req.user.companyId, { startDate, endDate });
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get review requests
router.get('/requests', async (req, res, next) => {
  try {
    const { status, limit, page } = req.query;
    const requests = await reviews.getReviewRequests(req.user.companyId, {
      status,
      limit: parseInt(limit) || 50,
      page: parseInt(page) || 1,
    });
    res.json(requests);
  } catch (error) {
    next(error);
  }
});

// Send review request for a job
router.post('/request/:jobId', async (req, res, next) => {
  try {
    const { channel = 'both' } = req.body;
    
    const result = await reviews.sendReviewRequest(req.params.jobId, { channel });
    
    audit.log({
      action: 'REVIEW_REQUEST_SENT',
      entity: 'job',
      entityId: req.params.jobId,
      metadata: { channel },
      req,
    });

    res.json(result);
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('not configured')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Schedule review request for a job
router.post('/schedule/:jobId', async (req, res, next) => {
  try {
    const request = await reviews.scheduleReviewRequest(req.params.jobId);
    
    if (!request) {
      return res.status(400).json({ error: 'Could not schedule review request' });
    }

    res.json(request);
  } catch (error) {
    next(error);
  }
});

// Send follow-up
router.post('/follow-up/:requestId', async (req, res, next) => {
  try {
    const result = await reviews.sendFollowUp(req.params.requestId);
    
    if (!result) {
      return res.status(400).json({ error: 'Could not send follow-up' });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Track click (public endpoint with request ID)
router.get('/track/:requestId/click', async (req, res, next) => {
  try {
    await reviews.markReviewCompleted(req.params.requestId, { clicked: true });
    
    // Get the review link and redirect
    const request = await prisma.reviewRequest.findUnique({
      where: { id: req.params.requestId },
    });
    
    if (request?.reviewLink) {
      res.redirect(request.reviewLink);
    } else {
      res.status(404).send('Link not found');
    }
  } catch (error) {
    next(error);
  }
});

// Process scheduled requests (called by cron job)
router.post('/process-scheduled', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const results = await reviews.processScheduledRequests();
    res.json({ processed: results.length, results });
  } catch (error) {
    next(error);
  }
});

// Generate review link preview
router.get('/preview-link', async (req, res, next) => {
  try {
    const { placeId } = req.query;
    
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }

    const link = reviews.generateGoogleReviewLink(placeId);
    res.json({ link });
  } catch (error) {
    next(error);
  }
});

export default router;
