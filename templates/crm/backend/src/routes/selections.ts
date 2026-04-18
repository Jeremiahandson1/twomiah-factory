import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import selections from '../services/selections.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// CATEGORIES
// ============================================

app.get('/categories', async (c) => {
  const user = c.get('user') as any
  let categories = await selections.getCategories(user.companyId)
  // Auto-seed default categories on first access if none exist
  if (categories.length === 0) {
    await selections.seedDefaultCategories(user.companyId)
    categories = await selections.getCategories(user.companyId)
  }
  return c.json(categories)
})

app.post('/categories', requirePermission('selections:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const category = await selections.createCategory(user.companyId, body)
  return c.json(category, 201)
})

app.post('/categories/seed', requirePermission('selections:create'), async (c) => {
  const user = c.get('user') as any
  await selections.seedDefaultCategories(user.companyId)
  return c.json({ success: true })
})

// ============================================
// OPTIONS (Product Library)
// ============================================

app.get('/options', async (c) => {
  const user = c.get('user') as any
  const categoryId = c.req.query('categoryId')
  const searchQuery = c.req.query('search')
  const active = c.req.query('active')
  const options = await selections.getOptions(user.companyId, {
    categoryId,
    search: searchQuery,
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(options)
})

app.post('/options', requirePermission('selections:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const option = await selections.createOption(user.companyId, body)
  return c.json(option, 201)
})

// ============================================
// PROJECT SELECTIONS
// ============================================

// Get selections for a project
app.get('/project/:projectId', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const data = await selections.getProjectSelections(projectId, user.companyId)
  return c.json(data)
})

// Get summary for a project
app.get('/project/:projectId/summary', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const summary = await selections.getSelectionsSummary(projectId, user.companyId)
  return c.json(summary)
})

// Create selection requirement
app.post('/project/:projectId', requirePermission('selections:create'), async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const body = await c.req.json()
  const selection = await selections.createProjectSelection(user.companyId, {
    ...body,
    projectId,
  })
  return c.json(selection, 201)
})

// Make selection (internal)
app.post('/:id/select', requirePermission('selections:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const selection = await selections.makeSelection(id, user.companyId, {
    ...body,
    selectedBy: user.userId,
  })
  return c.json(selection)
})

// Approve selection
app.post('/:id/approve', requirePermission('selections:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const result = await selections.approveSelection(id, user.companyId, {
    approvedBy: user.userId,
    createChangeOrder: body.createChangeOrder !== false,
  })
  return c.json(result)
})

// Mark ordered
app.post('/:id/ordered', requirePermission('selections:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const selection = await selections.markOrdered(id, user.companyId, {
    orderedBy: user.userId,
    ...body,
  })
  return c.json(selection)
})

// Mark received
app.post('/:id/received', requirePermission('selections:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const selection = await selections.markReceived(id, user.companyId, {
    receivedBy: user.userId,
    ...body,
  })
  return c.json(selection)
})

// ============================================
// REPORTS
// ============================================

app.get('/due-soon', async (c) => {
  const user = c.get('user') as any
  const days = c.req.query('days')
  const data = await selections.getSelectionsDueSoon(user.companyId, {
    days: parseInt(days!) || 7,
  })
  return c.json(data)
})

app.get('/overdue', async (c) => {
  const user = c.get('user') as any
  const data = await selections.getOverdueSelections(user.companyId)
  return c.json(data)
})

export default app
