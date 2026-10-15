import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { notificationPreferences } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { invalidate } from '../services/notificationPrefs.ts'

const app = new Hono()
app.use('*', authenticate)

// Every switch a person can flip. Each is a boolean; anything else in the body
// for that key leaves the stored value as it is (the source CRM's COALESCE rule).
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

/**
 * Save a person's preferences. Quiet hours, when sent, are SET rather than merged:
 * sending them empty clears the window (that is how a person turns quiet hours off). A half-set window or a
 * time that is not HH:MM is refused rather than stored as something it is not.
 */
export async function upsertPreferences(userId: string, body: any): Promise<{ row: any } | { error: string }> {
  const b = body && typeof body === 'object' ? body : {}
  const patch: Record<string, unknown> = {}
  for (const k of SWITCHES) if (typeof b[k] === 'boolean') patch[k] = b[k]

  // A caller that does not mention quiet hours at all (the older /notifications/preferences
  // screen) leaves them alone; the settings screen always sends both keys.
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

  const [existing] = await db
    .select({ id: notificationPreferences.id })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1)

  let row
  if (existing) {
    ;[row] = await db
      .update(notificationPreferences)
      .set({ ...patch, updatedAt: new Date() } as any)
      .where(eq(notificationPreferences.userId, userId))
      .returning()
  } else {
    ;[row] = await db
      .insert(notificationPreferences)
      .values({ ...patch, userId } as any)
      .returning()
  }
  // The send-side gate caches for a minute; a saved change applies to the very next send.
  invalidate(userId)
  return { row }
}

// GET /api/notification-settings — mine, or the defaults if I have never saved any
app.get('/', async (c) => {
  const user = c.get('user')

  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.userId))
    .limit(1)

  if (!prefs) return c.json({ userId: user.userId, ...DEFAULTS })
  return c.json(prefs)
})

// PUT /api/notification-settings — save mine
app.put('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const result = await upsertPreferences(user.userId, body)
  if ('error' in result) return c.json({ error: result.error }, 400)
  return c.json(result.row)
})

export default app
