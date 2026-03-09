import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/mileage
app.get('/', async (c) => c.json([]))

// POST /api/mileage
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, created_at: new Date().toISOString() }, 201)
})

export default app
