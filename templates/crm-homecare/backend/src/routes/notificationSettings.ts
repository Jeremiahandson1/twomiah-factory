import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/notification-settings
app.get('/', async (c) => c.json({ email_notifications: true, sms_notifications: true, push_notifications: true }))

// PUT /api/notification-settings
app.put('/', async (c) => {
  const body = await c.req.json()
  return c.json(body)
})

export default app
