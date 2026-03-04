import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import timeTracking from '../services/timeTracking.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Get time entries
router.get('/', requirePermission('time:read'), async (req, res, next) => {
  try {
    const { userId, jobId, projectId, startDate, endDate, status, approved, page, limit } = req.query;

    // Regular users can only see their own entries unless they have elevated permissions
    const canViewAll = req.user.role === 'owner' || req.user.role === 'admin' || req.user.role === 'manager';
    const filterUserId = canViewAll ? userId : req.user.userId;

    const result = await timeTracking.getEntries({
      companyId: req.user.companyId,
      userId: filterUserId,
      jobId,
      projectId,
      startDate,
      endDate,
      status,
      approved: approved === 'true' ? true : approved === 'false' ? false : undefined,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get current active entry
router.get('/active', async (req, res, next) => {
  try {
    const entry = await timeTracking.getActiveEntry(req.user.userId, req.user.companyId);
    res.json(entry);
  } catch (error) {
    next(error);
  }
});

// Get weekly timesheet
router.get('/weekly', async (req, res, next) => {
  try {
    const { userId, weekStart } = req.query;

    // Can only view own timesheet unless manager+
    const canViewAll = req.user.role === 'owner' || req.user.role === 'admin' || req.user.role === 'manager';
    const targetUserId = canViewAll && userId ? userId : req.user.userId;

    // Default to current week
    const start = weekStart || getWeekStart(new Date());

    const timesheet = await timeTracking.getWeeklyTimesheet(
      targetUserId,
      req.user.companyId,
      start
    );

    res.json(timesheet);
  } catch (error) {
    next(error);
  }
});

// Get summary by user
router.get('/summary/users', requirePermission('time:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const summary = await timeTracking.getUserSummary(req.user.companyId, { startDate, endDate });
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

// Get summary by project
router.get('/summary/projects', requirePermission('time:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const summary = await timeTracking.getProjectSummary(req.user.companyId, { startDate, endDate });
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

// Clock in
router.post('/clock-in', async (req, res, next) => {
  try {
    const { jobId, projectId, notes } = req.body;

    const entry = await timeTracking.clockIn({
      userId: req.user.userId,
      companyId: req.user.companyId,
      jobId,
      projectId,
      notes,
    });

    res.status(201).json(entry);
  } catch (error) {
    if (error.message.includes('Already clocked in')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Clock out
router.post('/clock-out', async (req, res, next) => {
  try {
    const { notes, breakMinutes } = req.body;

    // Find active entry for user
    const activeEntry = await timeTracking.getActiveEntry(req.user.userId, req.user.companyId);
    
    if (!activeEntry) {
      return res.status(400).json({ error: 'No active time entry to clock out' });
    }

    const entry = await timeTracking.clockOut(activeEntry.id, { notes, breakMinutes });

    res.json(entry);
  } catch (error) {
    next(error);
  }
});

// Create manual entry
router.post('/', requirePermission('time:create'), async (req, res, next) => {
  try {
    const { jobId, projectId, date, startTime, endTime, breakMinutes, notes, hourlyRate, userId } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'date, startTime, and endTime are required' });
    }

    // Admin/manager can create for others
    const canCreateForOthers = req.user.role === 'owner' || req.user.role === 'admin' || req.user.role === 'manager';
    const targetUserId = canCreateForOthers && userId ? userId : req.user.userId;

    const entry = await timeTracking.createManualEntry({
      userId: targetUserId,
      companyId: req.user.companyId,
      jobId,
      projectId,
      date,
      startTime,
      endTime,
      breakMinutes: breakMinutes || 0,
      notes,
      hourlyRate,
    });

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'time_entry',
      entityId: entry.id,
      req,
    });

    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
});

// Update entry
router.put('/:id', requirePermission('time:update'), async (req, res, next) => {
  try {
    const { jobId, projectId, notes, breakMinutes, hourlyRate, billable, approved } = req.body;

    // Only managers can approve
    const canApprove = req.user.role === 'owner' || req.user.role === 'admin' || req.user.role === 'manager';
    
    const updateData = { jobId, projectId, notes, breakMinutes, hourlyRate, billable };
    
    if (canApprove && approved !== undefined) {
      updateData.approved = approved;
      updateData.approvedById = approved ? req.user.userId : null;
    }

    const entry = await timeTracking.updateEntry(req.params.id, req.user.companyId, updateData);

    if (!entry) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    res.json(entry);
  } catch (error) {
    next(error);
  }
});

// Delete entry
router.delete('/:id', requirePermission('time:delete'), async (req, res, next) => {
  try {
    const deleted = await timeTracking.deleteEntry(req.params.id, req.user.companyId);

    if (!deleted) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    audit.log({
      action: audit.ACTIONS.DELETE,
      entity: 'time_entry',
      entityId: req.params.id,
      req,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Bulk approve
router.post('/approve', requirePermission('time:update'), async (req, res, next) => {
  try {
    const { entryIds } = req.body;

    if (!entryIds || !Array.isArray(entryIds) || entryIds.length === 0) {
      return res.status(400).json({ error: 'entryIds array is required' });
    }

    // Only managers can approve
    const canApprove = req.user.role === 'owner' || req.user.role === 'admin' || req.user.role === 'manager';
    if (!canApprove) {
      return res.status(403).json({ error: 'Not authorized to approve time entries' });
    }

    const count = await timeTracking.approveEntries(entryIds, req.user.companyId, req.user.userId);

    res.json({ approved: count });
  } catch (error) {
    next(error);
  }
});

// Helper function
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

export default router;
