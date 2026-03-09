import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { notificationPreferences } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/notification-settings — get by current user, or defaults
app.get('/', async (c) => {
  const user = c.get('user')

  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.userId))
    .limit(1)

  if (!prefs) {
    return c.json({
      userId: user.userId,
      emailEnabled: true,
      pushEnabled: true,
      scheduleAlerts: true,
      absenceAlerts: true,
      billingAlerts: true,
      ratingAlerts: true,
      dailyDigest: true,
    })
  }

  return c.json(prefs)
})

// PUT /api/notification-settings — upsert for current user
app.put('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const [existing] = await db
    .select({ id: notificationPreferences.id })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.userId))
    .limit(1)

  const values = {
    emailEnabled: body.emailEnabled,
    pushEnabled: body.pushEnabled,
    scheduleAlerts: body.scheduleAlerts,
    absenceAlerts: body.absenceAlerts,
    billingAlerts: body.billingAlerts,
    ratingAlerts: body.ratingAlerts,
    dailyDigest: body.dailyDigest,
  }

  if (existing) {
    const [updated] = await db
      .update(notificationPreferences)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(notificationPreferences.userId, user.userId))
      .returning()
    return c.json(updated)
  } else {
    const [created] = await db
      .insert(notificationPreferences)
      .values({ ...values, userId: user.userId })
      .returning()
    return c.json(created)
  }
})

export default app
