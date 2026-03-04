import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import equipment from '../services/equipment.js';

const router = Router();
router.use(authenticate);

// ============================================
// EQUIPMENT TYPES
// ============================================

router.get('/types', async (req, res, next) => {
  try {
    const { category, active } = req.query;
    const types = await equipment.getEquipmentTypes(req.user.companyId, {
      category,
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(types);
  } catch (error) {
    next(error);
  }
});

router.post('/types', requirePermission('equipment:create'), async (req, res, next) => {
  try {
    const type = await equipment.createEquipmentType(req.user.companyId, req.body);
    res.status(201).json(type);
  } catch (error) {
    next(error);
  }
});

// ============================================
// EQUIPMENT
// ============================================

// Get equipment list
router.get('/', async (req, res, next) => {
  try {
    const { 
      contactId, propertyId, category, status,
      needsMaintenance, warrantyExpiring, search,
      page, limit 
    } = req.query;

    const data = await equipment.getEquipment(req.user.companyId, {
      contactId,
      propertyId,
      category,
      status,
      needsMaintenance: needsMaintenance === 'true',
      warrantyExpiring: warrantyExpiring === 'true',
      search,
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
    const stats = await equipment.getEquipmentStats(req.user.companyId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get maintenance due
router.get('/maintenance-due', async (req, res, next) => {
  try {
    const { days } = req.query;
    const data = await equipment.getMaintenanceDue(req.user.companyId, {
      days: parseInt(days) || 30,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get expiring warranties
router.get('/warranty-expiring', async (req, res, next) => {
  try {
    const { days } = req.query;
    const data = await equipment.getWarrantyExpiring(req.user.companyId, {
      days: parseInt(days) || 60,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get aging equipment
router.get('/aging', async (req, res, next) => {
  try {
    const { minAge } = req.query;
    const data = await equipment.getAgingEquipment(req.user.companyId, {
      minAgeYears: parseInt(minAge) || 10,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get single equipment
router.get('/:id', async (req, res, next) => {
  try {
    const item = await equipment.getEquipmentDetails(req.params.id, req.user.companyId);
    if (!item) return res.status(404).json({ error: 'Equipment not found' });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Create equipment
router.post('/', requirePermission('equipment:create'), async (req, res, next) => {
  try {
    const item = await equipment.createEquipment(req.user.companyId, req.body);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// Update equipment
router.put('/:id', requirePermission('equipment:update'), async (req, res, next) => {
  try {
    await equipment.updateEquipment(req.params.id, req.user.companyId, req.body);
    const item = await equipment.getEquipmentDetails(req.params.id, req.user.companyId);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Mark needs repair
router.post('/:id/needs-repair', requirePermission('equipment:update'), async (req, res, next) => {
  try {
    await equipment.markNeedsRepair(req.params.id, req.user.companyId, req.body.notes);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Mark replaced
router.post('/:id/replaced', requirePermission('equipment:update'), async (req, res, next) => {
  try {
    await equipment.markReplaced(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// SERVICE HISTORY
// ============================================

// Get service history
router.get('/:id/history', async (req, res, next) => {
  try {
    const history = await equipment.getServiceHistory(req.params.id, req.user.companyId);
    res.json(history);
  } catch (error) {
    next(error);
  }
});

// Add service record
router.post('/:id/history', requirePermission('equipment:update'), async (req, res, next) => {
  try {
    const record = await equipment.addServiceRecord(req.params.id, req.user.companyId, {
      ...req.body,
      technicianId: req.body.technicianId || req.user.userId,
    });
    res.status(201).json(record);
  } catch (error) {
    next(error);
  }
});

export default router;
