/**
 * Notification preferences — the single gate every send path asks:
 * does THIS person want THIS kind of alert on THIS channel right now?
 *
 *   channel:   'email' | 'sms' | 'push'
 *   eventType: 'schedule' | 'shift_reminder' | 'absence' | 'payroll' | 'payment'
 *              | 'billing' | 'low_auth' | 'expiring_cert' | 'message'
 *
 * Rules (same as the source CRM):
 *   - no preferences row            → allow (silence is consent)
 *   - channel switched off          → block
 *   - that alert type switched off  → block
 *   - inside quiet hours            → block, unless the send is urgent AND the person
 *                                     left "still send urgent alerts" on
 *   - otherwise                     → allow
 *
 * Quiet hours are a wall-clock window ("21:00" to "07:00") in the agency's time zone
 * (agencies.settings.timezone), falling back to the server clock when none is set.
 * A window whose start is after its end wraps midnight.
 *
 *   import { shouldNotify } from '../services/notificationPrefs.ts'
 *   if (await shouldNotify(caregiverId, 'sms', 'shift_reminder')) await sendSms(...)
 */
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencies, notificationPreferences, notifications, users } from '../../db/schema.ts'

export type Channel = 'email' | 'sms' | 'push'

export const EVENT_COLUMN: Record<string, keyof typeof notificationPreferences.$inferSelect> = {
  schedule: 'scheduleAlerts',
  shift_reminder: 'shiftReminderAlerts',
  absence: 'absenceAlerts',
  payroll: 'payrollAlerts',
  payment: 'paymentAlerts',
  billing: 'billingAlerts',
  low_auth: 'lowAuthAlerts',
  expiring_cert: 'expiringCertAlerts',
  message: 'messageAlerts',
}

export const CHANNEL_COLUMN: Record<Channel, keyof typeof notificationPreferences.$inferSelect> = {
  email: 'emailEnabled',
  sms: 'smsEnabled',
  push: 'pushEnabled',
}

// A burst of sends (a reminder run) should not read the same row a hundred times.
const CACHE_MS = 60_000
const cache = new Map<string, { row: any; ts: number }>()

export async function getPrefs(userId: string): Promise<any | null> {
  if (!userId) return null
  const hit = cache.get(userId)
  if (hit && hit.ts > Date.now() - CACHE_MS) return hit.row
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1)
  cache.set(userId, { row: row || null, ts: Date.now() })
  return row || null
}

/** Call after a person saves their preferences, so the change applies to the next send. */
export function invalidate(userId?: string) {
  if (userId) cache.delete(userId)
  else cache.clear()
}

const toMinutes = (t: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''))
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Minutes past midnight of `now` on the wall clock of `timeZone` (server clock when absent). */
export function minutesOfDay(now: Date, timeZone?: string | null): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
      const h = Number(parts.find((p) => p.type === 'hour')?.value)
      const m = Number(parts.find((p) => p.type === 'minute')?.value)
      if (Number.isFinite(h) && Number.isFinite(m)) return (h % 24) * 60 + m
    } catch { /* unknown zone name: fall back to the server clock */ }
  }
  return now.getHours() * 60 + now.getMinutes()
}

export function inQuietHours(
  prefs: { quietHoursStart?: unknown; quietHoursEnd?: unknown } | null | undefined,
  now: Date = new Date(),
  timeZone?: string | null,
): boolean {
  if (!prefs) return false
  const start = toMinutes(prefs.quietHoursStart)
  const end = toMinutes(prefs.quietHoursEnd)
  if (start === null || end === null) return false
  const cur = minutesOfDay(now, timeZone)
  return start <= end
    ? cur >= start && cur < end
    : cur >= start || cur < end // e.g. 21:00 → 07:00
}

let agencyZone: { zone: string | null; ts: number } | null = null
async function agencyTimeZone(): Promise<string | null> {
  if (agencyZone && agencyZone.ts > Date.now() - CACHE_MS) return agencyZone.zone
  let zone: string | null = null
  try {
    const [agency] = await db.select({ settings: agencies.settings }).from(agencies).limit(1)
    const tz = (agency?.settings as any)?.timezone
    zone = typeof tz === 'string' && tz ? tz : null
  } catch { zone = null }
  agencyZone = { zone, ts: Date.now() }
  return zone
}

export async function shouldNotify(
  userId: string,
  channel: Channel,
  eventType?: string | null,
  opts: { urgent?: boolean; now?: Date; timeZone?: string | null } = {},
): Promise<boolean> {
  const channelCol = CHANNEL_COLUMN[channel]
  if (!channelCol) return false // unknown channel
  let prefs: any
  try {
    prefs = await getPrefs(userId)
  } catch {
    return true // a preferences read failing must not swallow the alert
  }
  if (!prefs) return true

  if (prefs[channelCol] === false) return false

  if (eventType) {
    const col = EVENT_COLUMN[eventType]
    if (col && prefs[col] === false) return false
  }

  const zone = opts.timeZone !== undefined ? opts.timeZone : await agencyTimeZone()
  if (inQuietHours(prefs, opts.now || new Date(), zone)) {
    const allowUrgent = prefs.quietHoursSkipEmergency !== false
    if (!(opts.urgent && allowUrgent)) return false
  }
  return true
}

/**
 * Put a notification in front of every active administrator (the bell + the
 * Notifications page). status defaults to 'new', which is what the bell counts.
 */
export async function notifyAdmins(type: string, title: string, message: string): Promise<number> {
  try {
    const admins = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users)
    const targets = admins.filter((u) => u.isActive && (u.role === 'admin' || u.role === 'owner'))
    if (!targets.length) return 0
    await db.insert(notifications).values(targets.map((u) => ({ userId: u.id, type, title, message, status: 'new' })))
    return targets.length
  } catch {
    return 0 // a notification failing must never fail the action that raised it
  }
}
