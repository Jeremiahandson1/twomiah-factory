import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import exportService from '../services/export.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Get available export types
router.get('/types', (req, res) => {
  res.json({
    types: exportService.getExportTypes(),
  });
});

// Get fields for a type
router.get('/fields/:type', (req, res) => {
  const fields = exportService.getExportFields(req.params.type);
  if (!fields) {
    return res.status(404).json({ error: 'Unknown export type' });
  }
  res.json({ fields });
});

// Export to CSV
router.get('/:type/csv', requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const { type } = req.params;
    const { status, startDate, endDate, contactId, projectId, limit } = req.query;

    const result = await exportService.exportToCSV(type, req.user.companyId, {
      status,
      startDate,
      endDate,
      contactId,
      projectId,
      limit: limit ? parseInt(limit) : undefined,
    });

    // Log export
    audit.log({
      action: audit.ACTIONS.EXPORT,
      entity: type,
      entityName: `${result.count} records`,
      metadata: { format: 'csv', filters: req.query },
      req,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  } catch (error) {
    if (error.message.includes('Unknown entity')) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

// Export to Excel
router.get('/:type/excel', requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const { type } = req.params;
    const { status, startDate, endDate, contactId, projectId, limit } = req.query;

    const result = await exportService.exportToExcel(type, req.user.companyId, {
      status,
      startDate,
      endDate,
      contactId,
      projectId,
      limit: limit ? parseInt(limit) : undefined,
    });

    // Log export
    audit.log({
      action: audit.ACTIONS.EXPORT,
      entity: type,
      entityName: `${result.count} records`,
      metadata: { format: 'excel', filters: req.query },
      req,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  } catch (error) {
    if (error.message.includes('Unknown entity')) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

export default router;
