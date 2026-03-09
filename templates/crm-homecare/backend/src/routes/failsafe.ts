import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// In-memory failsafe issue store (will be replaced with DB table when needed)
// Failsafe issues are system-detected problems (missed visits, compliance gaps, etc.)

// GET /api/failsafe/issues
app.get('/issues', async (c) => {
  const status = c.req.query('status')
  // Stub: return empty list until failsafe detection is wired up
  return c.json({ issues: [], total: 0 })
})

// PUT /api/failsafe/issues/:id/resolve
app.put('/issues/:id/resolve', async (c) => {
  const id = c.req.param('id')
  const { resolution, notes } = await c.req.json()
  return c.json({ id, status: 'resolved', resolution, notes, resolvedAt: new Date().toISOString() })
})

export default app
