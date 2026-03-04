import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import scheduling from '../services/scheduling.js';

const router = Router();
router.use(authenticate);

// ============================================
// TASKS
// ============================================

// Get Gantt data for project
router.get('/project/:projectId/gantt', async (req, res, next) => {
  try {
    const data = await scheduling.getGanttData(req.params.projectId, req.user.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get tasks (hierarchical)
router.get('/project/:projectId/tasks', async (req, res, next) => {
  try {
    const tasks = await scheduling.getProjectTasks(req.params.projectId, req.user.companyId);
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// Create task
router.post('/project/:projectId/tasks', requirePermission('projects:update'), async (req, res, next) => {
  try {
    const task = await scheduling.createTask(req.user.companyId, {
      ...req.body,
      projectId: req.params.projectId,
    });
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
});

// Update task
router.put('/tasks/:id', requirePermission('projects:update'), async (req, res, next) => {
  try {
    const task = await scheduling.updateTask(req.params.id, req.user.companyId, req.body);
    res.json(task);
  } catch (error) {
    next(error);
  }
});

// ============================================
// DEPENDENCIES
// ============================================

// Add dependency
router.post('/project/:projectId/dependencies', requirePermission('projects:update'), async (req, res, next) => {
  try {
    const dependency = await scheduling.addDependency(req.user.companyId, {
      ...req.body,
      projectId: req.params.projectId,
    });
    res.status(201).json(dependency);
  } catch (error) {
    if (error.message.includes('circular')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Remove dependency
router.delete('/dependencies/:id', requirePermission('projects:update'), async (req, res, next) => {
  try {
    await scheduling.removeDependency(req.params.id, req.user.companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CRITICAL PATH
// ============================================

router.get('/project/:projectId/critical-path', async (req, res, next) => {
  try {
    const tasks = await scheduling.getCriticalPath(req.params.projectId, req.user.companyId);
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// ============================================
// BASELINE
// ============================================

// Set baseline
router.post('/project/:projectId/baseline', requirePermission('projects:update'), async (req, res, next) => {
  try {
    const result = await scheduling.setBaseline(req.params.projectId, req.user.companyId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get variance from baseline
router.get('/project/:projectId/variance', async (req, res, next) => {
  try {
    const data = await scheduling.getScheduleVariance(req.params.projectId, req.user.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Recalculate schedule
router.post('/project/:projectId/recalculate', requirePermission('projects:update'), async (req, res, next) => {
  try {
    await scheduling.recalculateSchedule(req.params.projectId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
