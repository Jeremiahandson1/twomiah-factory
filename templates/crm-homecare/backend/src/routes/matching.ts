import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/matching/capabilities
app.get('/capabilities', async (c) => c.json([]))

// POST /api/matching/capabilities
app.post('/capabilities', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body }, 201)
})

// GET /api/matching/caregiver/:id/capabilities
app.get('/caregiver/:id/capabilities', async (c) => c.json([]))

// PUT /api/matching/caregiver/:id/capabilities
app.put('/caregiver/:id/capabilities', async (c) => {
  const body = await c.req.json()
  return c.json({ success: true, ...body })
})

// GET /api/matching/client/:id/needs
app.get('/client/:id/needs', async (c) => c.json([]))

// PUT /api/matching/client/:id/needs
app.put('/client/:id/needs', async (c) => {
  const body = await c.req.json()
  return c.json({ success: true, ...body })
})

// GET /api/matching/client/:id/schedule-prefs
app.get('/client/:id/schedule-prefs', async (c) => c.json({}))

// PUT /api/matching/client/:id/schedule-prefs
app.put('/client/:id/schedule-prefs', async (c) => {
  const body = await c.req.json()
  return c.json({ success: true, ...body })
})

// GET /api/matching/client/:id/restrictions
app.get('/client/:id/restrictions', async (c) => c.json([]))

// POST /api/matching/client/:id/restrictions
app.post('/client/:id/restrictions', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body }, 201)
})

// DELETE /api/matching/restrictions/:id
app.delete('/restrictions/:id', async (c) => c.json({ success: true }))

// POST /api/matching/optimize
app.post('/optimize', async (c) => c.json({ assignments: [], score: 0 }))

// POST /api/matching/apply-schedule
app.post('/apply-schedule', async (c) => c.json({ success: true, applied: 0 }))

export default app
