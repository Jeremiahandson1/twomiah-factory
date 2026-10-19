// Home care's staff notifications: the inbox (/api/notifications), the delivery preferences
// (/api/notification-settings) and the bell, web push and the caregiver app's push tokens (/api/push). Moved from
// templates/crm-homecare/backend/src/routes/{notifications,notificationSettings,push}.ts.
//
// A person's inbox moves new → handled → archived. is_read and status always move together: the bell counts
// status = 'new', so a row that is read but still 'new' (or handled but unread) is a phantom badge.
//
// Changes from the template:
//   · permissions: a person's own inbox, preferences and devices were open to every signed-in person — they are
//     care-portal:read (the area's permission a caregiver holds), each still narrowed to the person's own rows; the
//     office's summary was requireAdmin and is care-portal:update, sending was requireAdmin and is care-portal:create;
//   · scoped to the company: every row carries it; a notification is sent only to a person of the sender's company
//     (the template relied on the foreign key, which any company's person passes);
//   · the clinical audit row for a send carries the company (core.careAudit);
//   · saving preferences invalidates the ONE send-side gate the app uses (core.prefs), so a change applies to the next
//     send;
//   · replies: the inbox is a { data, pagination } list (RULEBOOK §3); PATCH /mark-read and DELETE /:id answer
//     { success, message } (the template's { message } is not one of the four shapes); POST /unsubscribe likewise.
import { Hono, type Context } from 'hono'
import { and, desc, eq, inArray, or, count } from 'drizzle-orm'
import { notifications, notificationPreferences, pushSubscriptions, expoPushTokens, user } from '../../../db/schema/index.ts'
import { fail, list, one, done } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import { notificationSummary } from '../../../data/homecarePortals.ts'
import { isExpoToken } from '../core/visitNotify.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

const STATUSES = ['new', 'handled', 'archived'] as const
type Status = typeof STATUSES[number]
const isStatus = (s: unknown): s is Status => (STATUSES as readonly unknown[]).includes(s)

function statusPatch(status: Status, userId: string) {
  if (status === 'handled') return { status, isRead: true, handledAt: new Date(), handledById: userId }
  if (status === 'archived') return { status, isRead: true }
  return { status, isRead: false, handledAt: null, handledById: null }
}

// Every switch a person can flip. Each is a boolean; anything else in the body for that key leaves the stored value as
// it is (the source CRM's COALESCE rule).
const SWITCHES = [
  'emailEnabled', 'smsEnabled', 'pushEnabled',
  'scheduleAlerts', 'shiftReminderAlerts', 'absenceAlerts', 'payrollAlerts', 'paymentAlerts',
  'billingAlerts', 'lowAuthAlerts', 'expiringCertAlerts', 'messageAlerts',
  'ratingAlerts', 'dailyDigest', 'quietHoursSkipEmergency',
] as const

const DEFAULTS = {
  emailEnabled: true, smsEnabled: true, pushEnabled: true,
  scheduleAlerts: true, shiftReminderAlerts: true, absenceAlerts: true, payrollAlerts: true,
  paymentAlerts: true, billingAlerts: true, lowAuthAlerts: true, expiringCertAlerts: true,
  messageAlerts: true, ratingAlerts: true, dailyDigest: true,
  quietHoursStart: null, quietHoursEnd: null, quietHoursSkipEmergency: true,
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/

/** The preferences: saving them, and the defaults a person who never saved any has. */
export function createNotificationSettings(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  /**
   * Save a person's preferences. Quiet hours, when sent, are SET rather than merged: sending them empty clears the
   * window (that is how a person turns quiet hours off). A half-set window or a time that is not HH:MM is refused
   * rather than stored as something it is not.
   */
  async function upsertPreferences(me: { userId: string; companyId: string }, body: any): Promise<{ row: any } | { error: string }> {
    const b = body && typeof body === 'object' ? body : {}
    const patch: Record<string, unknown> = {}
    for (const k of SWITCHES) if (typeof b[k] === 'boolean') patch[k] = b[k]
    // A caller that does not mention quiet hours at all (the older /notifications/preferences screen) leaves them
    // alone; the settings screen always sends both keys.
    if ('quietHoursStart' in b || 'quietHoursEnd' in b) {
      const start = b.quietHoursStart === undefined || b.quietHoursStart === '' ? null : b.quietHoursStart
      const end = b.quietHoursEnd === undefined || b.quietHoursEnd === '' ? null : b.quietHoursEnd
      for (const [label, v] of [['Quiet hours start', start], ['Quiet hours end', end]] as const) {
        if (v !== null && (typeof v !== 'string' || !HHMM.test(v))) return { error: `${label} must be a time like 21:00` }
      }
      if ((start === null) !== (end === null)) return { error: 'Set both a start and an end for quiet hours, or neither' }
      patch.quietHoursStart = start
      patch.quietHoursEnd = end
    }
    const [existing] = await db.select({ id: notificationPreferences.id }).from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, me.userId), eq(notificationPreferences.companyId, me.companyId))).limit(1)
    let row
    if (existing) {
      ;[row] = await db.update(notificationPreferences).set({ ...patch, updatedAt: new Date() } as any)
        .where(and(eq(notificationPreferences.id, existing.id), eq(notificationPreferences.companyId, me.companyId))).returning()
    } else {
      ;[row] = await db.insert(notificationPreferences).values({ ...patch, companyId: me.companyId, userId: me.userId } as any).returning()
    }
    // The send-side gate caches for a minute; a saved change applies to the very next send.
    core.prefs.invalidate(me.userId)
    return { row }
  }
  return { upsertPreferences, DEFAULTS }
}

/** /api/notifications — my inbox, and the office's sends and totals. */
export function createNotificationRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const mine = perm('care-portal:read')
  const settings = createNotificationSettings(core, d)
  const audit = (me: AppEnv['Variables']['user'], recordId: string, newData: unknown) => core.careAudit.writeCareAudit(me, 'CREATE', 'notifications', recordId, newData)

  /** The ids among these that are people of this company. */
  const peopleOf = async (companyId: string, ids: string[]) => new Set(
    (await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids)))).map((r: any) => r.id),
  )

  // GET / — my notifications, optionally one status, newest first (at most 100).
  app.get('/', mine, async (c) => {
    const me = c.get('user')
    const status = c.req.query('status')
    const conditions = [eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId)]
    if (isStatus(status)) conditions.push(eq(notifications.status, status))
    const rows = await db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt)).limit(100)
    return list(c, rows, { page: 1, limit: 100, total: rows.length })
  })

  // GET /summary — the office's totals.
  app.get('/summary', perm('care-portal:update'), async (c) => one(c, await notificationSummary(db, c.get('user').companyId)))

  // POST /send — the office writes to one person.
  app.post('/send', perm('care-portal:create'), async (c) => {
    const me = c.get('user')
    const { recipientId, notificationType, subject, message } = await c.req.json().catch(() => ({} as any))
    if (!recipientId || !subject || !message) return fail(c, 400, 'recipientId, subject, and message are required')
    if (!(await peopleOf(me.companyId, [String(recipientId)])).size) return fail(c, 404, 'Recipient not found')
    const [row] = await db.insert(notifications).values({
      companyId: me.companyId,
      userId: String(recipientId),
      type: notificationType || 'general',
      title: String(subject),
      message: String(message),
    }).returning()
    await audit(me, row.id, row)
    return one(c, row, 201)
  })

  // POST /send-bulk — the same note to several people (one row each, as many as named).
  app.post('/send-bulk', perm('care-portal:create'), async (c) => {
    const me = c.get('user')
    const { recipientIds, notificationType, subject, message } = await c.req.json().catch(() => ({} as any))
    if (!Array.isArray(recipientIds) || !recipientIds.length || !subject || !message) return fail(c, 400, 'recipientIds, subject, and message are required')
    const ids = recipientIds.map(String)
    const known = await peopleOf(me.companyId, ids)
    if (ids.some((id) => !known.has(id))) return fail(c, 404, 'One or more recipients not found')
    const sent = await db.insert(notifications).values(ids.map((id) => ({
      companyId: me.companyId,
      userId: id,
      type: notificationType || 'general',
      title: String(subject),
      message: String(message),
    }))).returning()
    await audit(me, 'bulk', { count: sent.length })
    return one(c, { sent: sent.length, notifications: sent }, 201)
  })

  // PATCH /mark-read — these (or all) are read, which is also handled.
  app.patch('/mark-read', mine, async (c) => {
    const me = c.get('user')
    const { ids } = await c.req.json().catch(() => ({} as any))
    const patch = statusPatch('handled', me.userId)
    const own = and(eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId))
    if (Array.isArray(ids) && ids.length) {
      await db.update(notifications).set(patch).where(and(own, inArray(notifications.id, ids.map(String))))
    } else {
      await db.update(notifications).set(patch).where(and(own, or(eq(notifications.status, 'new'), eq(notifications.isRead, false))))
    }
    return done(c, 'Marked as read')
  })

  // POST /bulk-status — several of mine at once.
  app.post('/bulk-status', mine, async (c) => {
    const me = c.get('user')
    const { ids, status } = await c.req.json().catch(() => ({} as any))
    if (!Array.isArray(ids) || !ids.length || !isStatus(status)) return fail(c, 400, 'ids and valid status required')
    const rows = await db.update(notifications).set(statusPatch(status, me.userId))
      .where(and(eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId), inArray(notifications.id, ids.map(String))))
      .returning({ id: notifications.id })
    return one(c, { updated: rows.length })
  })

  // GET /preferences — the same row as /api/notification-settings (made, with the defaults, on first read).
  app.get('/preferences', mine, async (c) => {
    const me = c.get('user')
    let [prefs] = await db.select().from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, me.userId), eq(notificationPreferences.companyId, me.companyId))).limit(1)
    if (!prefs) [prefs] = await db.insert(notificationPreferences).values({ companyId: me.companyId, userId: me.userId }).returning()
    return one(c, prefs)
  })

  // PUT /preferences — the same rules as PUT /api/notification-settings.
  app.put('/preferences', mine, async (c) => {
    const result = await settings.upsertPreferences(c.get('user'), await c.req.json().catch(() => ({})))
    if ('error' in result) return fail(c, 400, result.error)
    return one(c, result.row)
  })

  // PATCH /:id/read
  app.patch('/:id/read', mine, async (c) => {
    const me = c.get('user')
    const [row] = await db.update(notifications).set({ isRead: true })
      .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId))).returning()
    if (!row) return fail(c, 404, 'Notification not found')
    return one(c, row)
  })

  // PATCH /:id/status — handled / archived / back to new.
  app.patch('/:id/status', mine, async (c) => {
    const me = c.get('user')
    const { status } = await c.req.json().catch(() => ({} as any))
    if (!isStatus(status)) return fail(c, 400, 'Status must be new, handled, or archived')
    const [row] = await db.update(notifications).set(statusPatch(status, me.userId))
      .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId))).returning()
    if (!row) return fail(c, 404, 'Notification not found')
    return one(c, row)
  })

  // DELETE /:id
  app.delete('/:id', mine, async (c) => {
    const me = c.get('user')
    const rows = await db.delete(notifications)
      .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId)))
      .returning({ id: notifications.id })
    if (!rows.length) return fail(c, 404, 'Notification not found')
    return done(c, 'Notification deleted')
  })

  return app
}

/** /api/notification-settings — mine, or the defaults if I have never saved any; and saving them. */
export function createNotificationSettingsRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const mine = d.permissions.requirePermission('care-portal:read')
  const settings = createNotificationSettings(core, d)

  app.get('/', mine, async (c) => {
    const me = c.get('user')
    const [prefs] = await db.select().from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, me.userId), eq(notificationPreferences.companyId, me.companyId))).limit(1)
    if (!prefs) return one(c, { userId: me.userId, ...settings.DEFAULTS })
    return one(c, prefs)
  })

  app.put('/', mine, async (c) => {
    const result = await settings.upsertPreferences(c.get('user'), await c.req.json().catch(() => ({})))
    if ('error' in result) return fail(c, 400, result.error)
    return one(c, result.row)
  })

  return app
}

/** /api/push — the bell's count and mark-read, web push subscriptions, the caregiver app's Expo tokens. */
export function createPushRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const mine = d.permissions.requirePermission('care-portal:read')

  // GET /unread-count — the bell. Counts status = 'new', the same rows the Notifications page shows under "New";
  // counting is_read instead let the two drift apart and left a badge on rows already handled from the page.
  app.get('/unread-count', mine, async (c) => {
    const me = c.get('user')
    try {
      const [{ value }] = await db.select({ value: count() }).from(notifications)
        .where(and(eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId), eq(notifications.status, 'new')))
      return one(c, { count: Number(value) || 0 })
    } catch {
      return one(c, { count: 0 })
    }
  })

  // POST /mark-read — { ids: [...] } or { ids: 'all' }. Sets is_read AND moves the row to handled, so the bell and
  // the page can never disagree.
  app.post('/mark-read', mine, async (c: Context<AppEnv>) => {
    const me = c.get('user')
    const { ids } = await c.req.json().catch(() => ({} as any))
    const patch = { isRead: true, status: 'handled', handledAt: new Date(), handledById: me.userId }
    const own = and(eq(notifications.companyId, me.companyId), eq(notifications.userId, me.userId))
    if (ids === 'all') {
      await db.update(notifications).set(patch).where(and(own, or(eq(notifications.isRead, false), eq(notifications.status, 'new'))))
    } else if (Array.isArray(ids) && ids.length > 0) {
      await db.update(notifications).set(patch).where(and(own, inArray(notifications.id, ids.map(String))))
    } else {
      return fail(c, 400, "ids must be a list of notification ids or 'all'")
    }
    return done(c)
  })

  // POST /subscribe — this browser's web push subscription (one per person, replaced).
  app.post('/subscribe', mine, async (c) => {
    const me = c.get('user')
    const { subscription } = await c.req.json().catch(() => ({} as any))
    if (!subscription || typeof subscription !== 'object') return fail(c, 400, 'subscription is required')
    const [existing] = await db.select().from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, me.userId), eq(pushSubscriptions.companyId, me.companyId))).limit(1)
    let sub
    if (existing) {
      ;[sub] = await db.update(pushSubscriptions).set({ subscription, isActive: true, updatedAt: new Date() })
        .where(and(eq(pushSubscriptions.id, existing.id), eq(pushSubscriptions.companyId, me.companyId))).returning()
    } else {
      ;[sub] = await db.insert(pushSubscriptions).values({ companyId: me.companyId, userId: me.userId, subscription }).returning()
    }
    return one(c, sub)
  })

  // POST /expo-token { token, platform? } — the caregiver app's Expo push token for this device. A token belongs to
  // one person: signing in on a phone someone else used moves it to the caller.
  app.post('/expo-token', mine, async (c) => {
    const me = c.get('user')
    const { token, platform } = await c.req.json().catch(() => ({} as any))
    if (!isExpoToken(token)) return fail(c, 400, 'token must be an Expo push token (ExponentPushToken[…])')
    const plat = typeof platform === 'string' && ['ios', 'android', 'web'].includes(platform) ? platform : null
    const [row] = await db.insert(expoPushTokens).values({ companyId: me.companyId, userId: me.userId, token, platform: plat })
      .onConflictDoUpdate({ target: expoPushTokens.token, set: { companyId: me.companyId, userId: me.userId, platform: plat, lastSeenAt: new Date() } })
      .returning()
    return one(c, { success: true, id: row.id }, 201)
  })

  // DELETE /expo-token { token } — signed out on this device.
  app.delete('/expo-token', mine, async (c) => {
    const me = c.get('user')
    const { token } = await c.req.json().catch(() => ({} as any))
    if (!token) return fail(c, 400, 'token is required')
    const r = await db.delete(expoPushTokens)
      .where(and(eq(expoPushTokens.token, String(token)), eq(expoPushTokens.userId, me.userId), eq(expoPushTokens.companyId, me.companyId)))
      .returning({ id: expoPushTokens.id })
    return one(c, { success: true, removed: r.length })
  })

  // POST /unsubscribe — this person's web push is off.
  app.post('/unsubscribe', mine, async (c) => {
    const me = c.get('user')
    await db.update(pushSubscriptions).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(pushSubscriptions.userId, me.userId), eq(pushSubscriptions.companyId, me.companyId)))
    return done(c, 'Unsubscribed')
  })

  // GET /vapid-key — the public key a browser subscribes with.
  app.get('/vapid-key', mine, (c) => one(c, { publicKey: process.env.VAPID_PUBLIC_KEY || '' }))

  return app
}
