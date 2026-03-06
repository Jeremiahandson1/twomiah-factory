import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /status
app.get('/status', (c) => {
  return c.json({ configured: !!process.env.STRIPE_SECRET_KEY })
})

export default app
