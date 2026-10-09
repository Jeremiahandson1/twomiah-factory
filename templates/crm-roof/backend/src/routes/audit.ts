import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Behind reports:read — the permission the sidebar's Audit Log link already asks for (shellConfig.ts). This was
// limited to admin and up by rank, so a manager, who holds reports:read, was offered a page that answered 403. (T59)
app.get('/', requirePermission('reports:read'), async (c) => {
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
app.get('/:entity/:entityId', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const entity = c.req.param('entity')
  const entityId = c.req.param('entityId')
  const history = await audit.getHistory(user.companyId, entity, entityId)
  return c.json(history)
})

// Get available filter options
app.get('/filters', requirePermission('reports:read'), async (c) => {
  const currentUser = c.get('user') as any
  // What THIS company's log holds, not the static vocabulary. (T51 follow-up)
  return c.json(await audit.filterOptions(currentUser.companyId))
})

export default app
