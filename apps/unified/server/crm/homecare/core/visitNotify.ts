// Telling people about a visit: in-app notifications, client-portal notifications, texts and web/Expo push, plus the
// clinical audit row. Shared by the visits routes and the two background jobs. Moved from
// templates/crm-homecare/backend/src/services/visitNotify.ts.
//
// Every sender is best-effort — a failed notification never fails the request that caused it. SMS, web push and Expo
// are swappable (the _set* seams, now on the instance) so tests never reach Twilio or a push service.
//
// Changes: every row written carries the company (notifyUser, notifyAdmins, notifyClient, recordAudit take its id
// first); notifyAdmins reaches the company's own office; agencyShortName is core/agencyProfile.ts's; usage is
// reported through the shared messaging-usage module (packages/tenant-backend, the template's own copy); logs go
// through the app's logger.
import { and, eq, inArray } from 'drizzle-orm'
import { notifications, clientNotifications, user, auditLogs, pushSubscriptions } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { NotificationPrefs } from './notificationPrefs.ts'

export const OFFICE_ROLES = ['admin', 'owner']

/** Stored phones are mixed ('7155550100', '(715) 555-0100'); Twilio wants E.164. */
export function toE164(phone: unknown): string | null {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

// Phones are reached through the shared sender (core/phonePush.ts), which every vertical uses.
import { EXPO_PUSH_URL, isExpoToken, type ExpoTransport } from '../../../core/phonePush.ts'
export { EXPO_PUSH_URL, isExpoToken }

type SmsResult = { status: 'sent' | 'logged' | 'failed'; sid: string | null; error: string | null }


export function createVisitNotify(d: CrmDeps, prefs: NotificationPrefs) {
  const log = (what: string, e: any) => d.logger.error(`[visits] ${what}`, { error: e?.message })

  async function notifyUser(companyId: string, userId: string | null | undefined, type: string, title: string, message: string) {
    if (!userId) return
    try { await d.db.insert(notifications).values({ companyId, userId, type, title, message }) } catch (e: any) { log('notify user', e) }
  }

  /** Every active admin/owner of the company gets the same in-app notification. Returns their ids and phones. */
  async function notifyAdmins(companyId: string, type: string, title: string, message: string): Promise<{ id: string; phone: string | null }[]> {
    try {
      const admins: { id: string; phone: string | null }[] = await d.db.select({ id: user.id, phone: user.phone }).from(user)
        .where(and(eq(user.companyId, companyId), inArray(user.role, OFFICE_ROLES), eq(user.isActive, true)))
      for (const a of admins) await notifyUser(companyId, a.id, type, title, message)
      return admins
    } catch (e: any) {
      log('notify admins', e)
      return []
    }
  }

  async function notifyClient(companyId: string, clientId: string | null | undefined, type: string, title: string, message: string) {
    if (!clientId) return
    try { await d.db.insert(clientNotifications).values({ companyId, clientId, type, title, message }) } catch (e: any) { log('notify client', e) }
  }

  // ── SMS ────────────────────────────────────────────────────────────────────────────────
  // Through the business's one texting service (sendSMS): its own registered sender, a STOP honoured, the messaging
  // wallet checked and metered, the text kept in Messages. This called Twilio directly from the platform's shared
  // number, around all of that (2026-10-21).
  let sendSmsImpl = async (to: string, body: string, companyId: string): Promise<SmsResult> => {
    const r: any = await d.services.sms.sendSMS(companyId, { toPhone: to, message: body })
    if (!r) return { status: 'logged', sid: null, error: 'opted out of texts' }
    if (r.refused) return { status: 'logged', sid: null, error: r.errorMessage || 'Texting is not set up' }
    if (r.status === 'failed') return { status: 'failed', sid: r.twilioSid ?? null, error: r.errorMessage || 'failed' }
    return { status: 'sent', sid: r.twilioSid ?? null, error: null }
  }

  /** Send one text. true only when it actually went out. */
  async function sendText({ companyId, phone, body }: { companyId: string; phone: unknown; body: string }): Promise<boolean> {
    const to = toE164(phone)
    if (!to) return false
    try {
      const r = await sendSmsImpl(to, body, companyId)
      return r.status === 'sent'
    } catch (e: any) {
      log('SMS failed', e)
      return false
    }
  }

  // ── Web push ───────────────────────────────────────────────────────────────────────────
  let sendPushImpl = async (userId: string, payload: Record<string, unknown>): Promise<number> => {
    const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY
    if (!pub || !priv) return 0
    // Loaded at the first push, as the template did.
    const webpush: any = (await import('web-push')).default
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', pub, priv)
    const subs = await d.db.select({ subscription: pushSubscriptions.subscription }).from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.isActive, true)))
    let sent = 0
    for (const s of subs) {
      try { await webpush.sendNotification(s.subscription, JSON.stringify(payload)); sent++ } catch { /* expired subscription */ }
    }
    return sent
  }

  // ── Expo push (the caregiver app): the shared sender, core/phonePush.ts ──────────────────
  const sendExpoPush = (userId: string, payload: Record<string, unknown>): Promise<number> =>
    d.phonePush.send(null, [userId], {
      title: String(payload.title ?? ''),
      body: String(payload.body ?? payload.message ?? ''),
      data: (payload.data && typeof payload.data === 'object' ? payload.data : {}) as Record<string, unknown>,
    })

  /** Web push and Expo push to one person. Returns how many devices it reached; never throws. */
  async function sendPush(userId: string | null | undefined, payload: Record<string, unknown>): Promise<number> {
    if (!userId) return 0
    let n = 0
    try { n += await sendPushImpl(userId, payload) } catch (e: any) { log('push failed', e) }
    try { n += await sendExpoPush(userId, payload) } catch (e: any) { log('expo push failed', e) }
    return n
  }

  // ── Clinical audit trail (audit_logs) ──────────────────────────────────────────────────
  async function recordAudit(companyId: string, userId: string | null | undefined, action: string, tableName: string,
    recordId: string | null | undefined, oldData: unknown, newData: unknown, reasonCode?: string | null) {
    try {
      await d.db.insert(auditLogs).values({
        companyId, userId: userId || 'system', action, tableName, recordId: recordId || null,
        oldData: (oldData ?? null) as any, newData: (newData ?? null) as any, reasonCode: reasonCode || null,
      })
    } catch (e: any) { log('audit', e) }
  }

  // ── The one door for background caregiver / office alerts ──────────────────────────────
  // Shift reminders (push) and over-visit-length texts (SMS) both go through here, so the person's notification
  // preferences (the channel switch, the shift-reminder switch, quiet hours — an urgent over-visit text still goes out
  // during quiet hours unless the person turned that off) are applied in exactly one place.
  async function sendCaregiverAlert(a: {
    companyId: string
    userId: string | null | undefined
    alertType: 'shift_reminder' | 'overtime_alert'
    channel: 'push' | 'sms'
    phone?: unknown
    body: string
    payload?: Record<string, unknown>
    urgent?: boolean
  }): Promise<boolean> {
    if (a.userId) {
      const eventType = a.alertType === 'shift_reminder' ? 'shift_reminder' : null
      if (!(await prefs.shouldNotify(a.userId, a.channel, eventType, { urgent: !!a.urgent }))) return false
    }
    if (a.channel === 'sms') return sendText({ companyId: a.companyId, phone: a.phone, body: a.body })
    return (await sendPush(a.userId, a.payload || { title: a.body })) > 0
  }

  return {
    notifyUser, notifyAdmins, notifyClient, sendText, sendExpoPush, sendPush, recordAudit, sendCaregiverAlert,
    toE164, isExpoToken, OFFICE_ROLES, EXPO_PUSH_URL,
    /** Test hooks. */
    _setSmsSender(fn: typeof sendSmsImpl) { sendSmsImpl = fn },
    _setPushSender(fn: typeof sendPushImpl) { sendPushImpl = fn },
    _setExpoTransport(fn: ExpoTransport) { d.phonePush.setTransport(fn) },
  }
}

export type VisitNotify = ReturnType<typeof createVisitNotify>
