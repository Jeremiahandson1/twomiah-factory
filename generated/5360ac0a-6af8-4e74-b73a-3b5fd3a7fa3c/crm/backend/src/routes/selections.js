import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import selections from '../services/selections.js';

const router = Router();
router.use(authenticate);

// ============================================
// CATEGORIES
// ============================================

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await selections.getCategories(req.user.companyId);
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

router.post('/categories', requirePermission('selections:create'), async (req, res, next) => {
  try {
    const category = await selections.createCategory(req.user.companyId, req.body);
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

router.post('/categories/seed', requirePermission('selections:create'), async (req, res, next) => {
  try {
    await selections.seedDefaultCategories(req.user.companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// OPTIONS (Product Library)
// ============================================

router.get('/options', async (req, res, next) => {
  try {
    const { categoryId, search, active } = req.query;
    const options = await selections.getOptions(req.user.companyId, {
      categoryId,
      search,
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post('/options', requirePermission('selections:create'), async (req, res, next) => {
  try {
    const option = await selections.createOption(req.user.companyId, req.body);
    res.status(201).json(option);
  } catch (error) {
    next(error);
  }
});

// ============================================
// PROJECT SELECTIONS
// ============================================

// Get selections for a project
router.get('/project/:projectId', async (req, res, next) => {
  try {
    const data = await selections.getProjectSelections(req.params.projectId, req.user.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get summary for a project
router.get('/project/:projectId/summary', async (req, res, next) => {
  try {
    const summary = await selections.getSelectionsSummary(req.params.projectId, req.user.companyId);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

// Create selection requirement
router.post('/project/:projectId', requirePermission('selections:create'), async (req, res, next) => {
  try {
    const selection = await selections.createProjectSelection(req.user.companyId, {
      ...req.body,
      projectId: req.params.projectId,
    });
    res.status(201).json(selection);
  } catch (error) {
    next(error);
  }
});

// Make selection (internal)
router.post('/:id/select', requirePermission('selections:update'), async (req, res, next) => {
  try {
    const selection = await selections.makeSelection(req.params.id, req.user.companyId, {
      ...req.body,
      selectedBy: req.user.userId,
    });
    res.json(selection);
  } catch (error) {
    next(error);
  }
});

// Approve selection
router.post('/:id/approve', requirePermission('selections:update'), async (req, res, next) => {
  try {
    const result = await selections.approveSelection(req.params.id, req.user.companyId, {
      approvedBy: req.user.userId,
      createChangeOrder: req.body.createChangeOrder !== false,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Mark ordered
router.post('/:id/ordered', requirePermission('selections:update'), async (req, res, next) => {
  try {
    const selection = await selections.markOrdered(req.params.id, req.user.companyId, {
      orderedBy: req.user.userId,
      ...req.body,
    });
    res.json(selection);
  } catch (error) {
    next(error);
  }
});

// Mark received
router.post('/:id/received', requirePermission('selections:update'), async (req, res, next) => {
  try {
    const selection = await selections.markReceived(req.params.id, req.user.companyId, {
      receivedBy: req.user.userId,
      ...req.body,
    });
    res.json(selection);
  } catch (error) {
    next(error);
  }
});

// ============================================
// REPORTS
// ============================================

router.get('/due-soon', async (req, res, next) => {
  try {
    const { days } = req.query;
    const data = await selections.getSelectionsDueSoon(req.user.companyId, {
      days: parseInt(days) || 7,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/overdue', async (req, res, next) => {
  try {
    const data = await selections.getOverdueSelections(req.user.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
