// Notification preferences — the single gate every home-care send path asks: does THIS person want THIS kind of alert
// on THIS channel right now? Moved from templates/crm-homecare/backend/src/services/notificationPrefs.ts.
//
//   channel:   'email' | 'sms' | 'push'
//   eventType: 'schedule' | 'shift_reminder' | 'absence' | 'payroll' | 'payment' | 'billing' | 'low_auth'
//              | 'expiring_cert' | 'message'
//
// Rules:
//   - no preferences row            → allow (silence is consent)
//   - channel switched off          → block
//   - that alert type switched off  → block
//   - inside quiet hours            → block, unless the send is urgent AND the person left "still send urgent alerts" on
//   - otherwise                     → allow
//
// Quiet hours are a wall-clock window ("21:00" to "07:00") in the agency's time zone (core/agencyTime.ts). A window
// whose start is after its end wraps midnight.
//
// Changes: the agency is the person's company — shouldNotify reads the zone of the company the preferences row (or
// the person) belongs to; notifyAdmins takes the company and notifies its office only (the template notified every
// admin in its one-agency database).
import { and, eq, inArray } from 'drizzle-orm'
import { notificationPreferences, notifications, user } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'

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

// A burst of sends (a reminder run) should not read the same row a hundred times.
const CACHE_MS = 60_000

export function createNotificationPrefs(d: CrmDeps, time: AgencyTime) {
  const cache = new Map<string, { row: any; ts: number }>()

  async function getPrefs(userId: string): Promise<any | null> {
    if (!userId) return null
    const hit = cache.get(userId)
    if (hit && hit.ts > Date.now() - CACHE_MS) return hit.row
    const [row] = await d.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1)
    cache.set(userId, { row: row || null, ts: Date.now() })
    return row || null
  }

  /** Call after a person saves their preferences, so the change applies to the next send. */
  function invalidate(userId?: string) {
    if (userId) cache.delete(userId)
    else cache.clear()
  }

  async function shouldNotify(
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

    const zone = opts.timeZone !== undefined ? opts.timeZone : await time.timezone(prefs.companyId)
    if (inQuietHours(prefs, opts.now || new Date(), zone)) {
      const allowUrgent = prefs.quietHoursSkipEmergency !== false
      if (!(opts.urgent && allowUrgent)) return false
    }
    return true
  }

  /**
   * Put a notification in front of every active administrator of the company (the bell + the Notifications page).
   * status defaults to 'new', which is what the bell counts. Returns how many were notified.
   */
  async function notifyAdmins(companyId: string, type: string, title: string, message: string): Promise<number> {
    try {
      const targets = await d.db.select({ id: user.id }).from(user)
        .where(and(eq(user.companyId, companyId), eq(user.isActive, true), inArray(user.role, ['admin', 'owner'])))
      if (!targets.length) return 0
      await d.db.insert(notifications).values(targets.map((u: { id: string }) => ({ companyId, userId: u.id, type, title, message, status: 'new' })))
      return targets.length
    } catch {
      return 0 // a notification failing must never fail the action that raised it
    }
  }

  return { getPrefs, invalidate, shouldNotify, notifyAdmins, inQuietHours, minutesOfDay }
}

export type NotificationPrefs = ReturnType<typeof createNotificationPrefs>
