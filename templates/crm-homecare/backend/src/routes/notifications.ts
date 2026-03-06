import { Hono } from 'hono'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { notifications, notificationPreferences } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /
app.get('/', async (c) => {
  const user = c.get('user') as any
  const result = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50)
  return c.json(result)
})

// PATCH /mark-read
app.patch('/mark-read', async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()

  if (ids?.length) {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(inArray(notifications.id, ids), eq(notifications.userId, user.userId)))
  } else {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, user.userId))
  }

  return c.json({ message: 'Marked as read' })
})

// GET /preferences
app.get('/preferences', async (c) => {
  const user = c.get('user') as any
  let [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.userId))
    .limit(1)

  if (!prefs) {
    ;[prefs] = await db.insert(notificationPreferences).values({ userId: user.userId }).returning()
  }

  return c.json(prefs)
})

// PUT /preferences
app.put('/preferences', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  // Check if preferences exist
  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.userId))
    .limit(1)

  let prefs
  if (existing) {
    ;[prefs] = await db
      .update(notificationPreferences)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(notificationPreferences.userId, user.userId))
      .returning()
  } else {
    ;[prefs] = await db
      .insert(notificationPreferences)
      .values({ ...body, userId: user.userId })
      .returning()
  }

  return c.json(prefs)
})

export default app
