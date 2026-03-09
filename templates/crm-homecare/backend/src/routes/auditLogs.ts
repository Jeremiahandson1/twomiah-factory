import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/audit-logs
app.get('/', async (c) => c.json([]))

// POST /api/audit-logs/export
app.post('/export', async (c) => c.json({ data: [], format: 'json' }))

// POST /api/audit-logs/compliance-report
app.post('/compliance-report', async (c) => c.json({ report: [], generated_at: new Date().toISOString() }))

export default app
