import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/sandata/config
app.get('/config', async (c) => c.json({ enabled: false, api_key: null }))

// GET /api/sandata/status
app.get('/status', async (c) => c.json({ connected: false, last_sync: null }))

// POST /api/sandata/submit
app.post('/submit', async (c) => c.json({ success: false, message: 'Sandata integration not configured' }))

export default app
