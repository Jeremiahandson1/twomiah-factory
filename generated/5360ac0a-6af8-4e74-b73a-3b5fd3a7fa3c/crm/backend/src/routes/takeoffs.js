import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import takeoffs from '../services/takeoffs.js';

const router = Router();
router.use(authenticate);

// ============================================
// ASSEMBLIES
// ============================================

router.get('/assemblies', async (req, res, next) => {
  try {
    const { category, active } = req.query;
    const assemblies = await takeoffs.getAssemblies(req.user.companyId, {
      category,
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(assemblies);
  } catch (error) {
    next(error);
  }
});

router.get('/assemblies/:id', async (req, res, next) => {
  try {
    const assembly = await takeoffs.getAssembly(req.params.id, req.user.companyId);
    if (!assembly) return res.status(404).json({ error: 'Assembly not found' });
    res.json(assembly);
  } catch (error) {
    next(error);
  }
});

router.post('/assemblies', requirePermission('takeoffs:create'), async (req, res, next) => {
  try {
    const assembly = await takeoffs.createAssembly(req.user.companyId, req.body);
    res.status(201).json(assembly);
  } catch (error) {
    next(error);
  }
});

router.put('/assemblies/:id', requirePermission('takeoffs:update'), async (req, res, next) => {
  try {
    await takeoffs.updateAssembly(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/assemblies/seed', requirePermission('takeoffs:create'), async (req, res, next) => {
  try {
    await takeoffs.seedDefaultAssemblies(req.user.companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// TAKEOFF SHEETS
// ============================================

router.get('/project/:projectId', async (req, res, next) => {
  try {
    const sheets = await takeoffs.getProjectTakeoffs(req.params.projectId, req.user.companyId);
    res.json(sheets);
  } catch (error) {
    next(error);
  }
});

router.get('/sheets/:id', async (req, res, next) => {
  try {
    const sheet = await takeoffs.getTakeoffSheet(req.params.id, req.user.companyId);
    if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
    res.json(sheet);
  } catch (error) {
    next(error);
  }
});

router.post('/project/:projectId', requirePermission('takeoffs:create'), async (req, res, next) => {
  try {
    const sheet = await takeoffs.createTakeoffSheet(req.user.companyId, {
      ...req.body,
      projectId: req.params.projectId,
    });
    res.status(201).json(sheet);
  } catch (error) {
    next(error);
  }
});

// ============================================
// TAKEOFF ITEMS
// ============================================

router.post('/sheets/:sheetId/items', requirePermission('takeoffs:create'), async (req, res, next) => {
  try {
    const item = await takeoffs.addTakeoffItem(req.params.sheetId, req.user.companyId, req.body);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

router.put('/items/:id', requirePermission('takeoffs:update'), async (req, res, next) => {
  try {
    const item = await takeoffs.updateTakeoffItem(req.params.id, req.user.companyId, req.body);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

router.delete('/items/:id', requirePermission('takeoffs:delete'), async (req, res, next) => {
  try {
    await takeoffs.deleteTakeoffItem(req.params.id, req.user.companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// TOTALS
// ============================================

router.get('/sheets/:id/totals', async (req, res, next) => {
  try {
    const totals = await takeoffs.getSheetMaterialTotals(req.params.id, req.user.companyId);
    res.json(totals);
  } catch (error) {
    next(error);
  }
});

router.get('/project/:projectId/totals', async (req, res, next) => {
  try {
    const totals = await takeoffs.getProjectMaterialTotals(req.params.projectId, req.user.companyId);
    res.json(totals);
  } catch (error) {
    next(error);
  }
});

// ============================================
// EXPORT
// ============================================

router.post('/sheets/:id/export-po', requirePermission('takeoffs:create'), async (req, res, next) => {
  try {
    const { vendorId } = req.body;
    const po = await takeoffs.exportToPurchaseOrder(req.params.id, req.user.companyId, { vendorId });
    res.status(201).json(po);
  } catch (error) {
    next(error);
  }
});

export default router;
