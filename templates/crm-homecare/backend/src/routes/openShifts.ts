import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/open-shifts
app.get('/', async (c) => c.json([]))

// GET /api/open-shifts/available
app.get('/available', async (c) => c.json([]))

// GET /api/open-shifts/:id/claims
app.get('/:id/claims', async (c) => c.json([]))

// POST /api/open-shifts
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, status: 'open', created_at: new Date().toISOString() }, 201)
})

// POST /api/open-shifts/:id/claim
app.post('/:id/claim', async (c) => c.json({ success: true }))

// POST /api/open-shifts/:id/broadcast
app.post('/:id/broadcast', async (c) => c.json({ success: true, notified: 0 }))

// PUT /api/open-shifts/:id/approve
app.put('/:id/approve', async (c) => c.json({ id: c.req.param('id'), status: 'approved' }))

// PUT /api/open-shifts/:id/reject
app.put('/:id/reject', async (c) => c.json({ id: c.req.param('id'), status: 'rejected' }))

export default app
