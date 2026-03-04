import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Only admin+ can view audit logs
router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { entity, entityId, action, userId, startDate, endDate, page = '1', limit = '50' } = req.query;
    
    const result = await audit.query({
      companyId: req.user.companyId,
      entity,
      entityId,
      action,
      userId,
      startDate,
      endDate,
      page: parseInt(page),
      limit: parseInt(limit),
    });
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get history for specific entity
router.get('/:entity/:entityId', requireRole('admin'), async (req, res, next) => {
  try {
    const { entity, entityId } = req.params;
    const history = await audit.getHistory(req.user.companyId, entity, entityId);
    res.json(history);
  } catch (error) {
    next(error);
  }
});

// Get available filter options
router.get('/filters', requireRole('admin'), async (req, res, next) => {
  try {
    res.json({
      actions: Object.values(audit.ACTIONS),
      entities: Object.values(audit.ENTITIES),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
