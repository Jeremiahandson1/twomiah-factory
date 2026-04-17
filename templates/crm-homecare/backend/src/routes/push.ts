import { Hono } from 'hono'
import { eq, and, count } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { pushSubscriptions, notifications } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /unread-count — count of unread notifications for the current user
app.get('/unread-count', async (c) => {
  const user = c.get('user') as any
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.userId), eq(notifications.isRead, false)))
    return c.json({ count: Number(value) || 0 })
  } catch {
    return c.json({ count: 0 })
  }
})

// POST /subscribe
app.post('/subscribe', async (c) => {
  const user = c.get('user') as any
  const { subscription } = await c.req.json()

  // Try to find existing subscription for this user with this subscription data
  const [existing] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.userId))
    .limit(1)

  let sub
  if (existing) {
    ;[sub] = await db
      .update(pushSubscriptions)
      .set({ subscription, isActive: true, updatedAt: new Date() })
      .where(eq(pushSubscriptions.id, existing.id))
      .returning()
  } else {
    ;[sub] = await db
      .insert(pushSubscriptions)
      .values({ userId: user.userId, subscription })
      .returning()
  }

  return c.json(sub)
})

// POST /unsubscribe
app.post('/unsubscribe', async (c) => {
  const user = c.get('user') as any
  await db
    .update(pushSubscriptions)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(pushSubscriptions.userId, user.userId))
  return c.json({ message: 'Unsubscribed' })
})

// GET /vapid-key
app.get('/vapid-key', (c) => {
  return c.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' })
})

export default app
