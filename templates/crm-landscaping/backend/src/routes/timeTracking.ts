import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { requirePermission } from '../middleware/permissions.ts';
import timeTracking from '../services/timeTracking.ts';
import audit from '../services/audit.ts';

const app = new Hono();
app.use('*', authenticate);

// Helper function
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

// Get time entries
app.get('/', requirePermission('time:read'), async (c) => {
  const user = c.get('user') as any;
  const userId = c.req.query('userId');
  const jobId = c.req.query('jobId');
  const projectId = c.req.query('projectId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const status = c.req.query('status');
  const approved = c.req.query('approved');
  const page = c.req.query('page');
  const limit = c.req.query('limit');

  // Regular users can only see their own entries unless they have elevated permissions
  const canViewAll = user.role === 'owner' || user.role === 'admin' || user.role === 'manager';
  const filterUserId = canViewAll ? userId : user.userId;

  const result = await timeTracking.getEntries({
    companyId: user.companyId,
    userId: filterUserId,
    jobId,
    projectId,
    startDate,
    endDate,
    status,
    approved: approved === 'true' ? true : approved === 'false' ? false : undefined,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 50,
  });

  return c.json(result);
});

// Get current active entry
app.get('/active', async (c) => {
  const user = c.get('user') as any;
  const entry = await timeTracking.getActiveEntry(user.userId, user.companyId);
  return c.json(entry);
});

// Get weekly timesheet
app.get('/weekly', async (c) => {
  const user = c.get('user') as any;
  const userId = c.req.query('userId');
  const weekStart = c.req.query('weekStart');

  // Can only view own timesheet unless manager+
  const canViewAll = user.role === 'owner' || user.role === 'admin' || user.role === 'manager';
  const targetUserId = canViewAll && userId ? userId : user.userId;

  // Default to current week
  const start = weekStart || getWeekStart(new Date());

  const timesheet = await timeTracking.getWeeklyTimesheet(
    targetUserId,
    user.companyId,
    start
  );

  return c.json(timesheet);
});

// Get summary by user
app.get('/summary/users', requirePermission('time:read'), async (c) => {
  const user = c.get('user') as any;
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400);
  }

  const summary = await timeTracking.getUserSummary(user.companyId, { startDate, endDate });
  return c.json(summary);
});

// Get summary by project
app.get('/summary/projects', requirePermission('time:read'), async (c) => {
  const user = c.get('user') as any;
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400);
  }

  const summary = await timeTracking.getProjectSummary(user.companyId, { startDate, endDate });
  return c.json(summary);
});

// Clock in
app.post('/clock-in', async (c) => {
  const user = c.get('user') as any;
  const { jobId, projectId, notes } = await c.req.json();

  const entry = await timeTracking.clockIn({
    userId: user.userId,
    companyId: user.companyId,
    jobId,
    projectId,
    notes,
  });

  return c.json(entry, 201);
});

// Clock out
app.post('/clock-out', async (c) => {
  const user = c.get('user') as any;
  const { notes, breakMinutes } = await c.req.json();

  // Find active entry for user
  const activeEntry = await timeTracking.getActiveEntry(user.userId, user.companyId);

  if (!activeEntry) {
    return c.json({ error: 'No active time entry to clock out' }, 400);
  }

  const entry = await timeTracking.clockOut(activeEntry.id, { notes, breakMinutes });

  return c.json(entry);
});

// Create manual entry
app.post('/', requirePermission('time:create'), async (c) => {
  const user = c.get('user') as any;
  const { jobId, projectId, date, startTime, endTime, breakMinutes, notes, hourlyRate, userId } = await c.req.json();

  if (!date || !startTime || !endTime) {
    return c.json({ error: 'date, startTime, and endTime are required' }, 400);
  }

  // Admin/manager can create for others
  const canCreateForOthers = user.role === 'owner' || user.role === 'admin' || user.role === 'manager';
  const targetUserId = canCreateForOthers && userId ? userId : user.userId;

  const entry = await timeTracking.createManualEntry({
    userId: targetUserId,
    companyId: user.companyId,
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
    req: c.req,
  });

  return c.json(entry, 201);
});

// Update entry
app.put('/:id', requirePermission('time:update'), async (c) => {
  const user = c.get('user') as any;
  const { jobId, projectId, notes, breakMinutes, hourlyRate, billable, approved } = await c.req.json();

  // Only managers can approve
  const canApprove = user.role === 'owner' || user.role === 'admin' || user.role === 'manager';

  const updateData: any = { jobId, projectId, notes, breakMinutes, hourlyRate, billable };

  if (canApprove && approved !== undefined) {
    updateData.approved = approved;
    updateData.approvedById = approved ? user.userId : null;
  }

  const entry = await timeTracking.updateEntry(c.req.param('id'), user.companyId, updateData);

  if (!entry) {
    return c.json({ error: 'Time entry not found' }, 404);
  }

  return c.json(entry);
});

// Delete entry
app.delete('/:id', requirePermission('time:delete'), async (c) => {
  const user = c.get('user') as any;
  const deleted = await timeTracking.deleteEntry(c.req.param('id'), user.companyId);

  if (!deleted) {
    return c.json({ error: 'Time entry not found' }, 404);
  }

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'time_entry',
    entityId: c.req.param('id'),
    req: c.req,
  });

  return c.body(null, 204);
});

// Bulk approve
app.post('/approve', requirePermission('time:update'), async (c) => {
  const user = c.get('user') as any;
  const { entryIds } = await c.req.json();

  if (!entryIds || !Array.isArray(entryIds) || entryIds.length === 0) {
    return c.json({ error: 'entryIds array is required' }, 400);
  }

  // Only managers can approve
  const canApprove = user.role === 'owner' || user.role === 'admin' || user.role === 'manager';
  if (!canApprove) {
    return c.json({ error: 'Not authorized to approve time entries' }, 403);
  }

  const count = await timeTracking.approveEntries(entryIds, user.companyId, user.userId);

  return c.json({ approved: count });
});

export default app;
