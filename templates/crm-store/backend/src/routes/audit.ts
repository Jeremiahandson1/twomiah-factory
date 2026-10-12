import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

// The audit log is the owner's: audit:read is owner and admin across the fleet (owner's decision, 10/09), and a shop
// has no admin seat. The paths and the reply shape are the fleet's, so the shared AuditLogPage reads them unchanged.
const app = new Hono()
app.use('*', authenticate, requirePermission('audit:read'))

app.get('/', async (c) => {
  const q = c.req.query()
  return c.json(await audit.query({
    entity: q.entity, entityId: q.entityId, action: q.action, userId: q.userId,
    startDate: q.startDate, endDate: q.endDate,
    page: q.page ? parseInt(q.page, 10) : 1, limit: q.limit ? parseInt(q.limit, 10) : 50,
  }))
})

app.get('/filters', async (c) => c.json(await audit.filterOptions()))

app.get('/:entity/:entityId', async (c) => c.json(await audit.getHistory(c.req.param('entity'), c.req.param('entityId'))))

export default app
