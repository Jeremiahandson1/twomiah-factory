import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Only admin+ can view audit logs
app.get('/', requireRole('admin'), async (c) => {
  const user = c.get('user') as any
  const { entity, entityId, action, userId, startDate, endDate, page = '1', limit = '50' } = c.req.query() as any

  const result = await audit.query({
    companyId: user.companyId,
    entity,
    entityId,
    action,
    userId,
    startDate,
    endDate,
    page: parseInt(page),
    limit: parseInt(limit),
  })

  return c.json(result)
})

// Get history for specific entity
app.get('/:entity/:entityId', requireRole('admin'), async (c) => {
  const user = c.get('user') as any
  const entity = c.req.param('entity')
  const entityId = c.req.param('entityId')
  const history = await audit.getHistory(user.companyId, entity, entityId)
  return c.json(history)
})

// Get available filter options
app.get('/filters', requireRole('admin'), async (c) => {
  return c.json({
    actions: Object.values(audit.ACTIONS),
    entities: Object.values(audit.ENTITIES),
  })
})

export default app
