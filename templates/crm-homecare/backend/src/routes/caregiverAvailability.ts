import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/caregiver-availability/:id
app.get('/:id', async (c) => c.json({ status: 'available', max_hours_per_week: 40 }))

// PUT /api/caregiver-availability/:id
app.put('/:id', async (c) => {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), ...body })
})

export default app
