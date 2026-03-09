import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/shift-swaps
app.get('/', async (c) => c.json([]))

// PUT /api/shift-swaps/:id/approve
app.put('/:id/approve', async (c) => c.json({ id: c.req.param('id'), status: 'approved' }))

// PUT /api/shift-swaps/:id/reject
app.put('/:id/reject', async (c) => c.json({ id: c.req.param('id'), status: 'rejected' }))

export default app
