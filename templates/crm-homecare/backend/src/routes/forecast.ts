import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/forecast/revenue
app.get('/revenue', async (c) => c.json([]))

// GET /api/forecast/caregiver-utilization
app.get('/caregiver-utilization', async (c) => c.json([]))

export default app
