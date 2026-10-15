import { Hono } from 'hono'
import { eq, and, or, inArray, desc, count, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { notifications, notificationPreferences, auditLogs } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { upsertPreferences } from './notificationSettings.ts'

const app = new Hono()
app.use('*', authenticate)

// A person's inbox moves new → handled → archived. is_read and status always move
// together: the bell counts status = 'new', so a row that is read but still 'new'
// (or handled but unread) is a phantom badge.
const STATUSES = ['new', 'handled', 'archived'] as const
type Status = typeof STATUSES[number]

function statusPatch(status: Status, userId: string) {
  if (status === 'handled') return { status, isRead: true, handledAt: new Date(), handledById: userId }
  if (status === 'archived') return { status, isRead: true }
  return { status, isRead: false, handledAt: null, handledById: null }
}

const auditWrite = async (userId: string, action: string, recordId: string, newData: unknown) => {
  try {
    await db.insert(auditLogs).values({ userId, action, tableName: 'notifications', recordId, newData: newData as any } as any)
  } catch { /* the send happened; a missing audit row must not undo it */ }
}

// GET /  — my notifications, optionally one status
app.get('/', async (c) => {
  const user = c.get('user') as any
  const status = c.req.query('status')
  const conditions = [eq(notifications.userId, user.userId)]
  if (status && (STATUSES as readonly string[]).includes(status)) conditions.push(eq(notifications.status, status))
  const result = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(100)
  return c.json(result)
})

// GET /summary — office-wide totals
app.get('/summary', requireAdmin, async (c) => {
  const [row] = await db.select({
    totalNotifications: count(),
    unreadCount: sql<number>`count(*) filter (where ${notifications.isRead} = false)`,
    uniqueRecipients: sql<number>`count(distinct ${notifications.userId})`,
  }).from(notifications)
  return c.json({
    totalNotifications: Number(row?.totalNotifications || 0),
    unreadCount: Number(row?.unreadCount || 0),
    uniqueRecipients: Number(row?.uniqueRecipients || 0),
  })
})

// POST /send — an administrator writes to one person
app.post('/send', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const { recipientId, notificationType, subject, message } = body || {}
  if (!recipientId || !subject || !message) {
    return c.json({ error: 'recipientId, subject, and message are required' }, 400)
  }
  try {
    const [row] = await db.insert(notifications).values({
      userId: String(recipientId),
      type: notificationType || 'general',
      title: String(subject),
      message: String(message),
    }).returning()
    await auditWrite(user.userId, 'CREATE', row.id, row)
    return c.json(row, 201)
  } catch (err: any) {
    if (err?.code === '23503' || /foreign key/i.test(String(err?.message))) return c.json({ error: 'Recipient not found' }, 404)
    throw err
  }
})

// POST /send-bulk — the same note to several people
app.post('/send-bulk', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const { recipientIds, notificationType, subject, message } = body || {}
  if (!Array.isArray(recipientIds) || !recipientIds.length || !subject || !message) {
    return c.json({ error: 'recipientIds, subject, and message are required' }, 400)
  }
  try {
    const sent = await db.insert(notifications).values(recipientIds.map((id: unknown) => ({
      userId: String(id),
      type: notificationType || 'general',
      title: String(subject),
      message: String(message),
    }))).returning()
    await auditWrite(user.userId, 'CREATE', 'bulk', { count: sent.length })
    return c.json({ sent: sent.length, notifications: sent }, 201)
  } catch (err: any) {
    if (err?.code === '23503' || /foreign key/i.test(String(err?.message))) return c.json({ error: 'One or more recipients not found' }, 404)
    throw err
  }
})

// PATCH /mark-read — the bell: these (or all) are read, which is also handled
app.patch('/mark-read', async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json().catch(() => ({} as any))
  const patch = statusPatch('handled', user.userId)
  if (Array.isArray(ids) && ids.length) {
    await db.update(notifications).set(patch)
      .where(and(inArray(notifications.id, ids.map(String)), eq(notifications.userId, user.userId)))
  } else {
    await db.update(notifications).set(patch)
      .where(and(eq(notifications.userId, user.userId), or(eq(notifications.status, 'new'), eq(notifications.isRead, false))))
  }
  return c.json({ message: 'Marked as read' })
})

// POST /bulk-status — several of mine at once
app.post('/bulk-status', async (c) => {
  const user = c.get('user') as any
  const { ids, status } = await c.req.json().catch(() => ({} as any))
  if (!Array.isArray(ids) || !ids.length || !(STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: 'ids and valid status required' }, 400)
  }
  const rows = await db.update(notifications).set(statusPatch(status, user.userId))
    .where(and(inArray(notifications.id, ids.map(String)), eq(notifications.userId, user.userId)))
    .returning({ id: notifications.id })
  return c.json({ updated: rows.length })
})

// PATCH /:id/read
app.patch('/:id/read', async (c) => {
  const user = c.get('user') as any
  const [row] = await db.update(notifications).set({ isRead: true })
    .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.userId, user.userId)))
    .returning()
  if (!row) return c.json({ error: 'Notification not found' }, 404)
  return c.json(row)
})

// PATCH /:id/status — handled / archived / back to new
app.patch('/:id/status', async (c) => {
  const user = c.get('user') as any
  const { status } = await c.req.json().catch(() => ({} as any))
  if (!(STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: 'Status must be new, handled, or archived' }, 400)
  }
  const [row] = await db.update(notifications).set(statusPatch(status, user.userId))
    .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.userId, user.userId)))
    .returning()
  if (!row) return c.json({ error: 'Notification not found' }, 404)
  return c.json(row)
})

// DELETE /:id
app.delete('/:id', async (c) => {
  const user = c.get('user') as any
  const rows = await db.delete(notifications)
    .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.userId, user.userId)))
    .returning({ id: notifications.id })
  if (!rows.length) return c.json({ error: 'Notification not found' }, 404)
  return c.json({ message: 'Notification deleted' })
})

// GET /preferences — same row as /api/notification-settings
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

// PUT /preferences — same rules as PUT /api/notification-settings
app.put('/preferences', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const result = await upsertPreferences(user.userId, body)
  if ('error' in result) return c.json({ error: result.error }, 400)
  return c.json(result.row)
})

export default app
