import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/prospects
app.get('/', async (c) => c.json([]))

// POST /api/prospects
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, status: 'new', created_at: new Date().toISOString() }, 201)
})

// POST /api/prospects/:id/convert
app.post('/:id/convert', async (c) => c.json({ success: true, client_id: null }))

export default app
