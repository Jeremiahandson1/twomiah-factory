import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/medications/client/:id
app.get('/client/:id', async (c) => c.json([]))

// GET /api/medications/logs/client/:id
app.get('/logs/client/:id', async (c) => c.json([]))

// POST /api/medications
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, status: 'active', created_at: new Date().toISOString() }, 201)
})

// PUT /api/medications/:id
app.put('/:id', async (c) => {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), ...body })
})

// POST /api/medications/:id/discontinue
app.post('/:id/discontinue', async (c) => c.json({ id: c.req.param('id'), status: 'discontinued' }))

// POST /api/medications/log
app.post('/log', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, logged_at: new Date().toISOString() }, 201)
})

export default app
