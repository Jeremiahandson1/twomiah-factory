import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import marketing from '../services/marketing.js';

const router = Router();
router.use(authenticate);

// ============================================
// TEMPLATES
// ============================================

router.get('/templates', async (req, res, next) => {
  try {
    const { category, active } = req.query;
    const templates = await marketing.getTemplates(req.user.companyId, {
      category,
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(templates);
  } catch (error) { next(error); }
});

router.post('/templates', requirePermission('marketing:create'), async (req, res, next) => {
  try {
    const template = await marketing.createTemplate(req.user.companyId, req.body);
    res.status(201).json(template);
  } catch (error) { next(error); }
});

router.put('/templates/:id', requirePermission('marketing:update'), async (req, res, next) => {
  try {
    await marketing.updateTemplate(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.post('/templates/:id/duplicate', requirePermission('marketing:create'), async (req, res, next) => {
  try {
    const template = await marketing.duplicateTemplate(req.params.id, req.user.companyId);
    res.status(201).json(template);
  } catch (error) { next(error); }
});

// ============================================
// CAMPAIGNS
// ============================================

router.get('/campaigns', async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const data = await marketing.getCampaigns(req.user.companyId, {
      status,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(data);
  } catch (error) { next(error); }
});

router.get('/campaigns/:id', async (req, res, next) => {
  try {
    const campaign = await marketing.getCampaign(req.params.id, req.user.companyId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (error) { next(error); }
});

router.post('/campaigns', requirePermission('marketing:create'), async (req, res, next) => {
  try {
    const campaign = await marketing.createCampaign(req.user.companyId, req.body);
    res.status(201).json(campaign);
  } catch (error) { next(error); }
});

router.put('/campaigns/:id', requirePermission('marketing:update'), async (req, res, next) => {
  try {
    const campaign = await marketing.updateCampaign(req.params.id, req.user.companyId, req.body);
    res.json(campaign);
  } catch (error) { next(error); }
});

router.post('/campaigns/:id/send', requirePermission('marketing:update'), async (req, res, next) => {
  try {
    const result = await marketing.sendCampaign(req.params.id, req.user.companyId);
    res.json(result);
  } catch (error) { next(error); }
});

router.post('/campaigns/:id/schedule', requirePermission('marketing:update'), async (req, res, next) => {
  try {
    const { scheduledFor } = req.body;
    await marketing.scheduleCampaign(req.params.id, req.user.companyId, scheduledFor);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ============================================
// DRIP SEQUENCES
// ============================================

router.get('/sequences', async (req, res, next) => {
  try {
    const sequences = await marketing.getSequences(req.user.companyId);
    res.json(sequences);
  } catch (error) { next(error); }
});

router.post('/sequences', requirePermission('marketing:create'), async (req, res, next) => {
  try {
    const sequence = await marketing.createSequence(req.user.companyId, req.body);
    res.status(201).json(sequence);
  } catch (error) { next(error); }
});

router.post('/sequences/:id/enroll', requirePermission('marketing:update'), async (req, res, next) => {
  try {
    const { contactId } = req.body;
    const enrollment = await marketing.enrollInSequence(req.params.id, contactId, req.user.companyId);
    res.status(201).json(enrollment);
  } catch (error) { next(error); }
});

// ============================================
// TRACKING (No auth - called by email pixels/links)
// ============================================

router.get('/track/open/:recipientId', async (req, res) => {
  try {
    await marketing.trackOpen(req.params.recipientId);
  } catch (error) {
    console.error('Track open error:', error);
  }
  // Return 1x1 transparent pixel
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set('Content-Type', 'image/gif');
  res.send(pixel);
});

router.get('/track/click/:recipientId', async (req, res) => {
  const { url } = req.query;
  try {
    await marketing.trackClick(req.params.recipientId, url);
  } catch (error) {
    console.error('Track click error:', error);
  }
  res.redirect(url || '/');
});

router.get('/unsubscribe/:recipientId/:contactId', async (req, res) => {
  try {
    await marketing.handleUnsubscribe(req.params.recipientId, req.params.contactId);
    res.send('<html><body><h1>You have been unsubscribed</h1><p>You will no longer receive marketing emails from us.</p></body></html>');
  } catch (error) {
    res.send('<html><body><h1>Error</h1><p>Could not process unsubscribe request.</p></body></html>');
  }
});

// ============================================
// STATS
// ============================================

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await marketing.getMarketingStats(req.user.companyId);
    res.json(stats);
  } catch (error) { next(error); }
});

export default router;
