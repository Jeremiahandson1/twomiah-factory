import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/background-checks
app.get('/', async (c) => c.json([]))

// GET /api/background-checks/overview/expiring
app.get('/overview/expiring', async (c) => c.json([]))

// GET /api/background-checks/caregiver/:id
app.get('/caregiver/:id', async (c) => c.json([]))

// POST /api/background-checks
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, status: 'pending', created_at: new Date().toISOString() }, 201)
})

// PUT /api/background-checks/:id
app.put('/:id', async (c) => {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), ...body })
})

export default app
