import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import push from '../services/push.ts'

const app = new Hono()

// Get VAPID public key (no auth required)
app.get('/vapid-public-key', async (c) => {
  const key = push.getVapidPublicKey()

  if (!key) {
    return c.json({ error: 'Push notifications not configured' }, 503)
  }

  return c.json({ key })
})

// All other routes require authentication
app.use('*', authenticate)

// Subscribe to push notifications
app.post('/subscribe', async (c) => {
  const { subscription } = await c.req.json()

  if (!subscription?.endpoint || !subscription?.keys) {
    return c.json({ error: 'Invalid subscription object' }, 400)
  }

  const user = c.get('user') as any
  const saved = await push.saveSubscription(user.userId, {
    ...subscription,
    userAgent: c.req.header('user-agent'),
  })

  return c.json({ success: true, id: saved.id })
})

// Unsubscribe from push notifications
app.post('/unsubscribe', async (c) => {
  const { endpoint } = await c.req.json()

  if (!endpoint) {
    return c.json({ error: 'Endpoint is required' }, 400)
  }

  const user = c.get('user') as any
  await push.removeSubscription(user.userId, endpoint)
  return c.json({ success: true })
})

// Get user's subscriptions
app.get('/subscriptions', async (c) => {
  const user = c.get('user') as any
  const subscriptions = await push.getUserSubscriptions(user.userId)
  return c.json(subscriptions.map((s: any) => ({
    id: s.id,
    endpoint: s.endpoint,
    createdAt: s.createdAt,
    userAgent: s.userAgent,
  })))
})

// Send test notification to self
app.post('/test', async (c) => {
  const user = c.get('user') as any
  const result = await push.sendToUser(user.userId, {
    title: 'Test Notification',
    body: 'Push notifications are working!',
    url: '/',
  })

  return c.json(result)
})

// Admin: Send notification to user
app.post('/send', requireRole('admin'), async (c) => {
  const { userId, userIds, title, body, url } = await c.req.json()

  if (!title || !body) {
    return c.json({ error: 'title and body are required' }, 400)
  }

  let result

  if (userIds?.length) {
    result = await push.sendToUsers(userIds, { title, body, url })
  } else if (userId) {
    result = await push.sendToUser(userId, { title, body, url })
  } else {
    return c.json({ error: 'userId or userIds is required' }, 400)
  }

  return c.json(result)
})

// Admin: Send notification to all company users
app.post('/broadcast', requireRole('admin'), async (c) => {
  const { title, body, url } = await c.req.json()
  const user = c.get('user') as any

  if (!title || !body) {
    return c.json({ error: 'title and body are required' }, 400)
  }

  const result = await push.sendToCompany(user.companyId, { title, body, url })
  return c.json(result)
})

export default app
