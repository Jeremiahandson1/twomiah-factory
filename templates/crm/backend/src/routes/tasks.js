import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import tasks from '../services/tasks.js';

const router = Router();
router.use(authenticate);

// Get tasks
router.get('/', async (req, res, next) => {
  try {
    const { 
      assignedToId, projectId, jobId, contactId, 
      status, priority, dueBefore, dueAfter,
      search, page, limit, sortBy, sortOrder,
      mine,
    } = req.query;

    const filters = {
      assignedToId: mine === 'true' ? req.user.userId : assignedToId,
      projectId,
      jobId,
      contactId,
      status,
      priority,
      dueBefore,
      dueAfter,
      search,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      sortBy,
      sortOrder,
    };

    const result = await tasks.getTasks(req.user.companyId, filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get my upcoming tasks
router.get('/upcoming', async (req, res, next) => {
  try {
    const { days = '7' } = req.query;
    const result = await tasks.getUpcomingTasks(
      req.user.companyId, 
      req.user.userId, 
      { days: parseInt(days) }
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get my overdue tasks
router.get('/overdue', async (req, res, next) => {
  try {
    const result = await tasks.getOverdueTasks(req.user.companyId, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get my task stats
router.get('/stats', async (req, res, next) => {
  try {
    const result = await tasks.getTaskStats(req.user.companyId, req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get single task
router.get('/:id', async (req, res, next) => {
  try {
    const task = await tasks.getTask(req.params.id, req.user.companyId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

// Create task
router.post('/', async (req, res, next) => {
  try {
    const {
      title, description, dueDate, priority,
      assignedToId, projectId, jobId, contactId, checklist,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const task = await tasks.createTask({
      companyId: req.user.companyId,
      createdById: req.user.userId,
      title: title.trim(),
      description,
      dueDate,
      priority,
      assignedToId: assignedToId || req.user.userId, // Default to self
      projectId,
      jobId,
      contactId,
      checklist,
    });

    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
});

// Update task
router.put('/:id', async (req, res, next) => {
  try {
    const task = await tasks.updateTask(req.params.id, req.user.companyId, req.body);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

// Toggle task complete
router.post('/:id/toggle', async (req, res, next) => {
  try {
    const task = await tasks.toggleTaskComplete(req.params.id, req.user.companyId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

// Toggle checklist item
router.post('/:id/checklist/:itemId/toggle', async (req, res, next) => {
  try {
    const task = await tasks.toggleChecklistItem(
      req.params.id, 
      req.user.companyId, 
      req.params.itemId
    );
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

// Delete task
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await tasks.deleteTask(req.params.id, req.user.companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
