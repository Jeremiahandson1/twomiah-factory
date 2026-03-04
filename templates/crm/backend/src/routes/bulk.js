import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import bulk from '../services/bulk.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Contacts bulk operations
router.post('/contacts/update', requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const { ids, updates } = req.body;
    if (!ids?.length) {
      return res.status(400).json({ error: 'No IDs provided' });
    }

    // Only allow safe updates
    const allowedFields = ['type', 'status', 'source'];
    const safeUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        safeUpdates[field] = updates[field];
      }
    }

    const count = await bulk.bulkUpdateContacts(req.user.companyId, ids, safeUpdates);

    audit.log({
      action: 'BULK_UPDATE',
      entity: 'contacts',
      metadata: { count, updates: safeUpdates },
      req,
    });

    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

router.post('/contacts/delete', requirePermission('contacts:delete'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) {
      return res.status(400).json({ error: 'No IDs provided' });
    }

    const count = await bulk.bulkDeleteContacts(req.user.companyId, ids);

    audit.log({
      action: 'BULK_DELETE',
      entity: 'contacts',
      metadata: { count },
      req,
    });

    res.json({ deleted: count });
  } catch (error) {
    next(error);
  }
});

// Projects bulk operations
router.post('/projects/update', requirePermission('projects:update'), async (req, res, next) => {
  try {
    const { ids, updates } = req.body;
    if (!ids?.length) {
      return res.status(400).json({ error: 'No IDs provided' });
    }

    const allowedFields = ['status', 'managerId'];
    const safeUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        safeUpdates[field] = updates[field];
      }
    }

    const count = await bulk.bulkUpdateProjects(req.user.companyId, ids, safeUpdates);

    audit.log({
      action: 'BULK_UPDATE',
      entity: 'projects',
      metadata: { count, updates: safeUpdates },
      req,
    });

    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

router.post('/projects/delete', requirePermission('projects:delete'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) {
      return res.status(400).json({ error: 'No IDs provided' });
    }

    const count = await bulk.bulkDeleteProjects(req.user.companyId, ids);

    audit.log({
      action: 'BULK_DELETE',
      entity: 'projects',
      metadata: { count },
      req,
    });

    res.json({ deleted: count });
  } catch (error) {
    next(error);
  }
});

router.post('/projects/archive', requirePermission('projects:update'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const count = await bulk.bulkArchiveProjects(req.user.companyId, ids);
    res.json({ archived: count });
  } catch (error) {
    next(error);
  }
});

// Jobs bulk operations
router.post('/jobs/update', requirePermission('jobs:update'), async (req, res, next) => {
  try {
    const { ids, updates } = req.body;
    if (!ids?.length) {
      return res.status(400).json({ error: 'No IDs provided' });
    }

    const allowedFields = ['status', 'priority', 'type', 'assignedToId'];
    const safeUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        safeUpdates[field] = updates[field];
      }
    }

    const count = await bulk.bulkUpdateJobs(req.user.companyId, ids, safeUpdates);

    audit.log({
      action: 'BULK_UPDATE',
      entity: 'jobs',
      metadata: { count, updates: safeUpdates },
      req,
    });

    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/delete', requirePermission('jobs:delete'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const count = await bulk.bulkDeleteJobs(req.user.companyId, ids);

    audit.log({
      action: 'BULK_DELETE',
      entity: 'jobs',
      metadata: { count },
      req,
    });

    res.json({ deleted: count });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/assign', requirePermission('jobs:update'), async (req, res, next) => {
  try {
    const { ids, assignedToId } = req.body;
    const count = await bulk.bulkAssignJobs(req.user.companyId, ids, assignedToId);
    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/reschedule', requirePermission('jobs:update'), async (req, res, next) => {
  try {
    const { ids, scheduledDate } = req.body;
    const count = await bulk.bulkRescheduleJobs(req.user.companyId, ids, scheduledDate);
    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/status', requirePermission('jobs:update'), async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    const count = await bulk.bulkUpdateJobStatus(req.user.companyId, ids, status);
    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

// Invoices bulk operations
router.post('/invoices/delete', requirePermission('invoices:delete'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const count = await bulk.bulkDeleteInvoices(req.user.companyId, ids);

    audit.log({
      action: 'BULK_DELETE',
      entity: 'invoices',
      metadata: { count },
      req,
    });

    res.json({ deleted: count });
  } catch (error) {
    next(error);
  }
});

router.post('/invoices/mark-paid', requirePermission('invoices:update'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const count = await bulk.bulkMarkInvoicesPaid(req.user.companyId, ids);
    res.json({ updated: count });
  } catch (error) {
    next(error);
  }
});

// Quotes bulk operations
router.post('/quotes/delete', requirePermission('quotes:delete'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const count = await bulk.bulkDeleteQuotes(req.user.companyId, ids);
    res.json({ deleted: count });
  } catch (error) {
    next(error);
  }
});

// Time entries bulk operations
router.post('/time/approve', requirePermission('time:update'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const count = await bulk.bulkApproveTimeEntries(req.user.companyId, ids, req.user.userId);
    res.json({ approved: count });
  } catch (error) {
    next(error);
  }
});

router.post('/time/delete', requirePermission('time:delete'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    const count = await bulk.bulkDeleteTimeEntries(req.user.companyId, ids);
    res.json({ deleted: count });
  } catch (error) {
    next(error);
  }
});

export default router;
