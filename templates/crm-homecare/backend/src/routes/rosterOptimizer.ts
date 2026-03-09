import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/roster-optimizer/roster
app.get('/roster', async (c) => c.json({ assignments: [], metrics: {} }))

// POST /api/roster-optimizer/run
app.post('/run', async (c) => c.json({ optimized: [], score: 0, improvements: [] }))

// POST /api/roster-optimizer/apply
app.post('/apply', async (c) => c.json({ success: true, applied: 0 }))

export default app
