import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import scheduling from '../services/scheduling.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// TASKS
// ============================================

// Get Gantt data for project
app.get('/project/:projectId/gantt', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const data = await scheduling.getGanttData(projectId, user.companyId)
  return c.json(data)
})

// Get tasks (hierarchical)
app.get('/project/:projectId/tasks', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const tasks = await scheduling.getProjectTasks(projectId, user.companyId)
  return c.json(tasks)
})

// Create task
app.post('/project/:projectId/tasks', requirePermission('projects:update'), async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const body = await c.req.json()
  const task = await scheduling.createTask(user.companyId, {
    ...body,
    projectId,
  })
  return c.json(task, 201)
})

// Update task
app.put('/tasks/:id', requirePermission('projects:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const task = await scheduling.updateTask(id, user.companyId, body)
  return c.json(task)
})

// ============================================
// DEPENDENCIES
// ============================================

// Add dependency
app.post('/project/:projectId/dependencies', requirePermission('projects:update'), async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const body = await c.req.json()
  const dependency = await scheduling.addDependency(user.companyId, {
    ...body,
    projectId,
  })
  return c.json(dependency, 201)
})

// Remove dependency
app.delete('/dependencies/:id', requirePermission('projects:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await scheduling.removeDependency(id, user.companyId)
  return c.json({ success: true })
})

// ============================================
// CRITICAL PATH
// ============================================

app.get('/project/:projectId/critical-path', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const tasks = await scheduling.getCriticalPath(projectId, user.companyId)
  return c.json(tasks)
})

// ============================================
// BASELINE
// ============================================

// Set baseline
app.post('/project/:projectId/baseline', requirePermission('projects:update'), async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const result = await scheduling.setBaseline(projectId, user.companyId)
  return c.json(result)
})

// Get variance from baseline
app.get('/project/:projectId/variance', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const data = await scheduling.getScheduleVariance(projectId, user.companyId)
  return c.json(data)
})

// Recalculate schedule
app.post('/project/:projectId/recalculate', requirePermission('projects:update'), async (c) => {
  const projectId = c.req.param('projectId')
  await scheduling.recalculateSchedule(projectId)
  return c.json({ success: true })
})

export default app
