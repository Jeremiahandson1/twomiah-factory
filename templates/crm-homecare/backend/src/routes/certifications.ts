import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/certifications
app.get('/', async (c) => c.json([]))

// GET /api/certifications/caregiver/:id
app.get('/caregiver/:id', async (c) => c.json([]))

// POST /api/certifications
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, created_at: new Date().toISOString() }, 201)
})

// DELETE /api/certifications/:id
app.delete('/:id', async (c) => c.json({ success: true }))

export default app
