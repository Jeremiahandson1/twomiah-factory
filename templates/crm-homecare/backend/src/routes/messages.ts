import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/messages/inbox
app.get('/inbox', async (c) => c.json([]))

// GET /api/messages/users
app.get('/users', async (c) => c.json([]))

// GET /api/messages/unread-count
app.get('/unread-count', async (c) => c.json({ count: 0 }))

// GET /api/messages/thread/:id
app.get('/thread/:id', async (c) => c.json({ messages: [] }))

// POST /api/messages/thread/:id/reply
app.post('/thread/:id/reply', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, created_at: new Date().toISOString() }, 201)
})

// POST /api/messages/send
app.post('/send', async (c) => {
  const body = await c.req.json()
  return c.json({ id: 1, ...body, created_at: new Date().toISOString() }, 201)
})

export default app
