import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import warranties from '../services/warranties.js';

const router = Router();
router.use(authenticate);

// ============================================
// TEMPLATES
// ============================================

router.get('/templates', async (req, res, next) => {
  try {
    const templates = await warranties.getWarrantyTemplates(req.user.companyId);
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

router.post('/templates', requirePermission('warranties:create'), async (req, res, next) => {
  try {
    const template = await warranties.createWarrantyTemplate(req.user.companyId, req.body);
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

router.post('/templates/seed', requirePermission('warranties:create'), async (req, res, next) => {
  try {
    await warranties.seedDefaultTemplates(req.user.companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// WARRANTIES
// ============================================

// Get active warranties
router.get('/', async (req, res, next) => {
  try {
    const { expiringSoon, contactId, page, limit } = req.query;
    const data = await warranties.getActiveWarranties(req.user.companyId, {
      expiringSoon: expiringSoon === 'true',
      contactId,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get stats
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await warranties.getWarrantyStats(req.user.companyId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get expiring warranties
router.get('/expiring', async (req, res, next) => {
  try {
    const { days } = req.query;
    const data = await warranties.getExpiringWarranties(req.user.companyId, {
      days: parseInt(days) || 30,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get warranties for a project
router.get('/project/:projectId', async (req, res, next) => {
  try {
    const data = await warranties.getProjectWarranties(req.params.projectId, req.user.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Create warranty
router.post('/', requirePermission('warranties:create'), async (req, res, next) => {
  try {
    const warranty = await warranties.createProjectWarranty(req.user.companyId, req.body);
    res.status(201).json(warranty);
  } catch (error) {
    next(error);
  }
});

// Create warranties from templates
router.post('/from-templates', requirePermission('warranties:create'), async (req, res, next) => {
  try {
    const { projectId, contactId, startDate, templateIds } = req.body;
    const created = await warranties.createWarrantiesFromTemplates(
      req.user.companyId,
      projectId,
      contactId,
      startDate,
      templateIds
    );
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

// ============================================
// CLAIMS
// ============================================

// Get all claims
router.get('/claims', async (req, res, next) => {
  try {
    const { warrantyId, projectId, status, priority, page, limit } = req.query;
    const data = await warranties.getClaims(req.user.companyId, {
      warrantyId,
      projectId,
      status,
      priority,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get single claim
router.get('/claims/:id', async (req, res, next) => {
  try {
    const claim = await warranties.getClaim(req.params.id, req.user.companyId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    res.json(claim);
  } catch (error) {
    next(error);
  }
});

// Create claim
router.post('/claims', async (req, res, next) => {
  try {
    const claim = await warranties.createClaim(req.user.companyId, {
      ...req.body,
      reportedBy: req.user.userId,
    });
    res.status(201).json(claim);
  } catch (error) {
    if (error.message.includes('expired') || error.message.includes('voided')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Update claim status
router.put('/claims/:id/status', requirePermission('warranties:update'), async (req, res, next) => {
  try {
    const claim = await warranties.updateClaimStatus(req.params.id, req.user.companyId, {
      ...req.body,
      userId: req.user.userId,
    });
    res.json(claim);
  } catch (error) {
    next(error);
  }
});

// Schedule warranty work
router.post('/claims/:id/schedule', requirePermission('warranties:update'), async (req, res, next) => {
  try {
    const job = await warranties.scheduleWarrantyWork(req.params.id, req.user.companyId, req.body);
    res.status(201).json(job);
  } catch (error) {
    next(error);
  }
});

// Deny claim
router.post('/claims/:id/deny', requirePermission('warranties:update'), async (req, res, next) => {
  try {
    const claim = await warranties.denyClaim(req.params.id, req.user.companyId, {
      reason: req.body.reason,
      userId: req.user.userId,
    });
    res.json(claim);
  } catch (error) {
    next(error);
  }
});

// ============================================
// REPORTS
// ============================================

router.get('/reports/by-category', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await warranties.getClaimsByCategory(req.user.companyId, {
      startDate,
      endDate,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
