import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/communication-log/follow-ups/pending
app.get('/follow-ups/pending', async (c) => c.json([]))

// GET /api/communication-log/:entityType/:entityId
app.get('/:entityType/:entityId', async (c) => c.json([]))

// POST /api/communication-log
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, created_at: new Date().toISOString() }, 201)
})

// PUT /api/communication-log/:id
app.put('/:id', async (c) => {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), ...body })
})

// DELETE /api/communication-log/:id
app.delete('/:id', async (c) => c.json({ success: true }))

export default app
