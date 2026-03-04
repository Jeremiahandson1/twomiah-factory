import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import calltracking from '../services/calltracking.js';

const router = Router();

// ============================================
// WEBHOOKS (No auth - called by providers)
// ============================================

// CallRail webhook
router.post('/webhook/callrail/:companyId', async (req, res) => {
  try {
    await calltracking.handleCallRailWebhook(req.params.companyId, req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('CallRail webhook error:', error);
    res.sendStatus(200); // Always return 200 to prevent retries
  }
});

// Twilio webhook
router.post('/webhook/twilio/:companyId', async (req, res) => {
  try {
    await calltracking.handleTwilioWebhook(req.params.companyId, req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Twilio webhook error:', error);
    res.sendStatus(200);
  }
});

// Generic webhook (CTM, etc.)
router.post('/webhook/:provider/:companyId', async (req, res) => {
  try {
    // Map provider-specific payload to common format
    const data = mapProviderPayload(req.params.provider, req.body);
    await calltracking.logCall(req.params.companyId, data);
    res.sendStatus(200);
  } catch (error) {
    console.error('Call tracking webhook error:', error);
    res.sendStatus(200);
  }
});

function mapProviderPayload(provider, payload) {
  // Add provider-specific mapping here
  return payload;
}

// Apply auth to remaining routes
router.use(authenticate);

// ============================================
// TRACKING NUMBERS
// ============================================

router.get('/numbers', async (req, res, next) => {
  try {
    const { source, active } = req.query;
    const numbers = await calltracking.getTrackingNumbers(req.user.companyId, {
      source,
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(numbers);
  } catch (error) {
    next(error);
  }
});

router.post('/numbers', requirePermission('calltracking:create'), async (req, res, next) => {
  try {
    const number = await calltracking.createTrackingNumber(req.user.companyId, req.body);
    res.status(201).json(number);
  } catch (error) {
    next(error);
  }
});

router.put('/numbers/:id', requirePermission('calltracking:update'), async (req, res, next) => {
  try {
    await calltracking.updateTrackingNumber(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CALLS
// ============================================

router.get('/calls', async (req, res, next) => {
  try {
    const { source, status, startDate, endDate, contactId, firstTimeOnly, page, limit } = req.query;
    const calls = await calltracking.getCalls(req.user.companyId, {
      source,
      status,
      startDate,
      endDate,
      contactId,
      firstTimeOnly: firstTimeOnly === 'true',
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(calls);
  } catch (error) {
    next(error);
  }
});

router.get('/calls/:id', async (req, res, next) => {
  try {
    const call = await calltracking.getCall(req.params.id, req.user.companyId);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  } catch (error) {
    next(error);
  }
});

router.put('/calls/:id', async (req, res, next) => {
  try {
    await calltracking.updateCall(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/calls/:id/lead', async (req, res, next) => {
  try {
    await calltracking.tagCallAsLead(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Manual call logging
router.post('/calls', async (req, res, next) => {
  try {
    const call = await calltracking.logCall(req.user.companyId, req.body);
    res.status(201).json(call);
  } catch (error) {
    next(error);
  }
});

// ============================================
// REPORTS
// ============================================

router.get('/reports/attribution', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const report = await calltracking.getAttributionReport(req.user.companyId, {
      startDate,
      endDate,
    });
    res.json(report);
  } catch (error) {
    next(error);
  }
});

router.get('/reports/volume', async (req, res, next) => {
  try {
    const { startDate, endDate, groupBy } = req.query;
    const report = await calltracking.getCallVolumeReport(req.user.companyId, {
      startDate,
      endDate,
      groupBy,
    });
    res.json(report);
  } catch (error) {
    next(error);
  }
});

export default router;
