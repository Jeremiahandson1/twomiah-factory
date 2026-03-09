import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/prospect-appointments
app.get('/', async (c) => c.json([]))

// POST /api/prospect-appointments
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, status: 'scheduled', created_at: new Date().toISOString() }, 201)
})

// DELETE /api/prospect-appointments/:id
app.delete('/:id', async (c) => c.json({ success: true }))

export default app
