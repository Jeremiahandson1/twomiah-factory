import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/blackout-dates
app.get('/', async (c) => c.json([]))

// DELETE /api/blackout-dates/:id
app.delete('/:id', async (c) => c.json({ success: true }))

export default app
