import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/no-show/alerts
app.get('/alerts', async (c) => c.json([]))

// GET /api/no-show/stats
app.get('/stats', async (c) => c.json({ total: 0, resolved: 0, pending: 0 }))

// GET /api/no-show/config
app.get('/config', async (c) => c.json({ enabled: false, threshold_minutes: 15, auto_alert: true }))

// POST /api/no-show/run-check
app.post('/run-check', async (c) => c.json({ checked: 0, alerts_created: 0 }))

// PUT /api/no-show/alerts/:id/resolve
app.put('/alerts/:id/resolve', async (c) => {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), status: 'resolved', ...body })
})

// PUT /api/no-show/config
app.put('/config', async (c) => {
  const body = await c.req.json()
  return c.json(body)
})

export default app
