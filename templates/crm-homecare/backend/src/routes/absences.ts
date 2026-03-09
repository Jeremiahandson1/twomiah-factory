import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/absences
app.get('/', async (c) => c.json([]))

// GET /api/absences/my
app.get('/my', async (c) => c.json([]))

// POST /api/absences
app.post('/', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, created_at: new Date().toISOString() }, 201)
})

// DELETE /api/absences/:id
app.delete('/:id', async (c) => c.json({ success: true }))

export default app
