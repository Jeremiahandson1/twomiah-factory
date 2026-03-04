import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import agreements from '../services/agreements.js';

const router = Router();
router.use(authenticate);

// ============================================
// PLANS (Templates)
// ============================================

// Get all plans
router.get('/plans', async (req, res, next) => {
  try {
    const { active } = req.query;
    const plans = await agreements.getPlans(req.user.companyId, {
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

// Create plan
router.post('/plans', requirePermission('agreements:create'), async (req, res, next) => {
  try {
    const plan = await agreements.createPlan(req.user.companyId, req.body);
    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

// Update plan
router.put('/plans/:id', requirePermission('agreements:update'), async (req, res, next) => {
  try {
    await agreements.updatePlan(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CUSTOMER AGREEMENTS
// ============================================

// Get all agreements
router.get('/', async (req, res, next) => {
  try {
    const { status, contactId, expiringSoon, page, limit } = req.query;
    const data = await agreements.getAgreements(req.user.companyId, {
      status,
      contactId,
      expiringSoon: expiringSoon === 'true',
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get single agreement
router.get('/:id', async (req, res, next) => {
  try {
    const agreement = await agreements.getAgreement(req.params.id, req.user.companyId);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found' });
    res.json(agreement);
  } catch (error) {
    next(error);
  }
});

// Create agreement
router.post('/', requirePermission('agreements:create'), async (req, res, next) => {
  try {
    const agreement = await agreements.createAgreement(req.user.companyId, req.body);
    res.status(201).json(agreement);
  } catch (error) {
    next(error);
  }
});

// Update agreement
router.put('/:id', requirePermission('agreements:update'), async (req, res, next) => {
  try {
    await agreements.updateAgreement(req.params.id, req.user.companyId, req.body);
    const agreement = await agreements.getAgreement(req.params.id, req.user.companyId);
    res.json(agreement);
  } catch (error) {
    next(error);
  }
});

// Cancel agreement
router.post('/:id/cancel', requirePermission('agreements:update'), async (req, res, next) => {
  try {
    const { reason } = req.body;
    await agreements.cancelAgreement(req.params.id, req.user.companyId, reason);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Renew agreement
router.post('/:id/renew', requirePermission('agreements:update'), async (req, res, next) => {
  try {
    const agreement = await agreements.renewAgreement(req.params.id, req.user.companyId);
    res.json(agreement);
  } catch (error) {
    next(error);
  }
});

// ============================================
// VISITS
// ============================================

// Get upcoming visits
router.get('/visits/upcoming', async (req, res, next) => {
  try {
    const { days } = req.query;
    const visits = await agreements.getUpcomingVisits(req.user.companyId, {
      days: parseInt(days) || 30,
    });
    res.json(visits);
  } catch (error) {
    next(error);
  }
});

// Schedule visit
router.post('/:id/visits', requirePermission('agreements:update'), async (req, res, next) => {
  try {
    const visit = await agreements.scheduleVisit(req.params.id, req.user.companyId, req.body);
    res.status(201).json(visit);
  } catch (error) {
    if (error.message === 'No visits remaining on this agreement') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Complete visit
router.post('/visits/:visitId/complete', requirePermission('agreements:update'), async (req, res, next) => {
  try {
    const visit = await agreements.completeVisit(req.params.visitId, req.user.companyId, req.body);
    res.json(visit);
  } catch (error) {
    next(error);
  }
});

// ============================================
// BILLING
// ============================================

// Get agreements due for billing
router.get('/billing/due', async (req, res, next) => {
  try {
    const due = await agreements.getAgreementsDueForBilling(req.user.companyId);
    res.json(due);
  } catch (error) {
    next(error);
  }
});

// Process billing for an agreement
router.post('/:id/bill', requirePermission('invoices:create'), async (req, res, next) => {
  try {
    const invoice = await agreements.processAgreementBilling(req.params.id, req.user.companyId);
    res.json(invoice);
  } catch (error) {
    next(error);
  }
});

// ============================================
// REPORTS
// ============================================

// Get stats
router.get('/reports/stats', async (req, res, next) => {
  try {
    const stats = await agreements.getAgreementStats(req.user.companyId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get expiring agreements
router.get('/reports/expiring', async (req, res, next) => {
  try {
    const { days } = req.query;
    const expiring = await agreements.getExpiringAgreements(req.user.companyId, parseInt(days) || 60);
    res.json(expiring);
  } catch (error) {
    next(error);
  }
});

export default router;
