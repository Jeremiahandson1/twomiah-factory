import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import tasks from '../services/tasks.ts';

const app = new Hono();
app.use('*', authenticate);

// Get tasks
app.get('/', async (c) => {
  const user = c.get('user') as any;
  const assignedToId = c.req.query('assignedToId');
  const projectId = c.req.query('projectId');
  const jobId = c.req.query('jobId');
  const contactId = c.req.query('contactId');
  const status = c.req.query('status');
  const priority = c.req.query('priority');
  const dueBefore = c.req.query('dueBefore');
  const dueAfter = c.req.query('dueAfter');
  const search = c.req.query('search');
  const page = c.req.query('page');
  const limit = c.req.query('limit');
  const sortBy = c.req.query('sortBy');
  const sortOrder = c.req.query('sortOrder');
  const mine = c.req.query('mine');

  const filters = {
    assignedToId: mine === 'true' ? user.userId : assignedToId,
    projectId,
    jobId,
    contactId,
    status,
    priority,
    dueBefore,
    dueAfter,
    search,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 50,
    sortBy,
    sortOrder,
  };

  const result = await tasks.getTasks(user.companyId, filters);
  return c.json(result);
});

// Get my upcoming tasks
app.get('/upcoming', async (c) => {
  const user = c.get('user') as any;
  const days = c.req.query('days') || '7';
  const result = await tasks.getUpcomingTasks(
    user.companyId,
    user.userId,
    { days: parseInt(days) }
  );
  return c.json(result);
});

// Get my overdue tasks
app.get('/overdue', async (c) => {
  const user = c.get('user') as any;
  const result = await tasks.getOverdueTasks(user.companyId, user.userId);
  return c.json(result);
});

// Get my task stats
app.get('/stats', async (c) => {
  const user = c.get('user') as any;
  const result = await tasks.getTaskStats(user.companyId, user.userId);
  return c.json(result);
});

// Get single task
app.get('/:id', async (c) => {
  const user = c.get('user') as any;
  const task = await tasks.getTask(c.req.param('id'), user.companyId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  return c.json(task);
});

// Create task
app.post('/', async (c) => {
  const user = c.get('user') as any;
  const {
    title, description, dueDate, priority,
    assignedToId, projectId, jobId, contactId, checklist,
  } = await c.req.json();

  if (!title?.trim()) {
    return c.json({ error: 'Title is required' }, 400);
  }

  const task = await tasks.createTask({
    companyId: user.companyId,
    createdById: user.userId,
    title: title.trim(),
    description,
    dueDate,
    priority,
    assignedToId: assignedToId || user.userId,
    projectId,
    jobId,
    contactId,
    checklist,
  });

  return c.json(task, 201);
});

// Update task
app.put('/:id', async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const task = await tasks.updateTask(c.req.param('id'), user.companyId, body);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  return c.json(task);
});

// Toggle task complete
app.post('/:id/toggle', async (c) => {
  const user = c.get('user') as any;
  const task = await tasks.toggleTaskComplete(c.req.param('id'), user.companyId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  return c.json(task);
});

// Toggle checklist item
app.post('/:id/checklist/:itemId/toggle', async (c) => {
  const user = c.get('user') as any;
  const task = await tasks.toggleChecklistItem(
    c.req.param('id'),
    user.companyId,
    c.req.param('itemId')
  );
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  return c.json(task);
});

// Delete task
app.delete('/:id', async (c) => {
  const user = c.get('user') as any;
  const deleted = await tasks.deleteTask(c.req.param('id'), user.companyId);
  if (!deleted) {
    return c.json({ error: 'Task not found' }, 404);
  }
  return c.body(null, 204);
});

export default app;
