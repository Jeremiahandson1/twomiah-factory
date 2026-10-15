import { Hono } from 'hono'
import { eq, and, or, inArray, count } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { pushSubscriptions, notifications, expoPushTokens } from '../../db/schema.ts'
import { isExpoToken } from '../services/visitNotify.ts'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /unread-count — the bell. Counts status = 'new', the same rows the
// Notifications page shows under "New"; counting is_read instead let the two
// drift apart and left a badge on rows already handled from the page.
app.get('/unread-count', async (c) => {
  const user = c.get('user') as any
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.userId), eq(notifications.status, 'new')))
    return c.json({ count: Number(value) || 0 })
  } catch {
    return c.json({ count: 0 })
  }
})

// POST /mark-read — { ids: [...] } or { ids: 'all' }. Sets is_read AND moves the
// row to handled, so the bell and the page can never disagree.
app.post('/mark-read', async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json().catch(() => ({} as any))
  const patch = { isRead: true, status: 'handled', handledAt: new Date(), handledById: user.userId }
  if (ids === 'all') {
    await db.update(notifications).set(patch)
      .where(and(eq(notifications.userId, user.userId), or(eq(notifications.isRead, false), eq(notifications.status, 'new'))))
  } else if (Array.isArray(ids) && ids.length > 0) {
    await db.update(notifications).set(patch)
      .where(and(eq(notifications.userId, user.userId), inArray(notifications.id, ids.map(String))))
  } else {
    return c.json({ error: "ids must be a list of notification ids or 'all'" }, 400)
  }
  return c.json({ success: true })
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

// POST /expo-token { token, platform? } — the caregiver app's Expo push token for this device. A
// token belongs to one person: signing in on a phone someone else used moves it to the caller.
// DELETE /expo-token { token } — signed out on this device.
app.post('/expo-token', async (c) => {
  const user = c.get('user') as any
  const { token, platform } = await c.req.json().catch(() => ({} as any))
  if (!isExpoToken(token)) return c.json({ error: 'token must be an Expo push token (ExponentPushToken[…])' }, 400)
  const plat = typeof platform === 'string' && ['ios', 'android', 'web'].includes(platform) ? platform : null
  const [row] = await db.insert(expoPushTokens).values({ userId: user.userId, token, platform: plat })
    .onConflictDoUpdate({ target: expoPushTokens.token, set: { userId: user.userId, platform: plat, lastSeenAt: new Date() } })
    .returning()
  return c.json({ success: true, id: row.id }, 201)
})
app.delete('/expo-token', async (c) => {
  const user = c.get('user') as any
  const { token } = await c.req.json().catch(() => ({} as any))
  if (!token) return c.json({ error: 'token is required' }, 400)
  const r = await db.delete(expoPushTokens).where(and(eq(expoPushTokens.token, String(token)), eq(expoPushTokens.userId, user.userId))).returning({ id: expoPushTokens.id })
  return c.json({ success: true, removed: r.length })
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
