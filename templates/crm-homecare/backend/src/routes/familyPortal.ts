import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/family-portal/admin/members
app.get('/admin/members', async (c) => c.json([]))

// GET /api/family-portal/admin/messages
app.get('/admin/messages', async (c) => c.json([]))

// POST /api/family-portal/admin/members
app.post('/admin/members', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, status: 'active', created_at: new Date().toISOString() }, 201)
})

// PUT /api/family-portal/admin/members/:id/status
app.put('/admin/members/:id/status', async (c) => {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), ...body })
})

// POST /api/family-portal/admin/members/:id/reset-password
app.post('/admin/members/:id/reset-password', async (c) => c.json({ success: true }))

// POST /api/family-portal/admin/messages/:id/reply
app.post('/admin/messages/:id/reply', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, created_at: new Date().toISOString() }, 201)
})

export default app
