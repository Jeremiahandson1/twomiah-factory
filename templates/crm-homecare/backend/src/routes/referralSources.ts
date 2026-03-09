import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/referral-sources
app.get('/', async (c) => c.json([]))

// POST /api/referral-sources
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, status: 'active', created_at: new Date().toISOString() }, 201)
})

// PUT /api/referral-sources/:id
app.put('/:id', async (c) => {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), ...body })
})

export default app
