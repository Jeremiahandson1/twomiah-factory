import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/gusto/config
app.get('/config', async (c) => c.json({ enabled: false, connected: false }))

// GET /api/gusto/preview
app.get('/preview', async (c) => c.json({ employees: [], total: 0 }))

// POST /api/gusto/export-csv
app.post('/export-csv', async (c) => c.json({ csv: '', rows: 0 }))

// POST /api/gusto/export
app.post('/export', async (c) => c.json({ success: false, message: 'Gusto integration not configured' }))

export default app
