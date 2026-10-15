// Telling people about a visit: in-app notifications, client-portal notifications, texts and web
// push, plus the clinical audit row. Shared by the visits routes and the two background jobs.
//
// Every sender is best-effort — a failed notification never fails the request that caused it.
// SMS and push are swappable so tests never reach Twilio or a push service.
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { notifications, clientNotifications, users, auditLogs, pushSubscriptions, agencies } from '../../db/schema.ts'
import { reportSmsUsage } from './messagingUsage.ts'

export const OFFICE_ROLES = ['admin', 'owner']

export async function notifyUser(userId: string | null | undefined, type: string, title: string, message: string) {
  if (!userId) return
  try { await db.insert(notifications).values({ userId, type, title, message }) } catch (e: any) {
    console.error('[visits] notify user:', e?.message)
  }
}

/** Every active admin/owner gets the same in-app notification. Returns their ids. */
export async function notifyAdmins(type: string, title: string, message: string): Promise<{ id: string; phone: string | null }[]> {
  try {
    const admins = await db.select({ id: users.id, phone: users.phone }).from(users)
      .where(and(inArray(users.role, OFFICE_ROLES), eq(users.isActive, true)))
    for (const a of admins) await notifyUser(a.id, type, title, message)
    return admins
  } catch (e: any) {
    console.error('[visits] notify admins:', e?.message)
    return []
  }
}

export async function notifyClient(clientId: string | null | undefined, type: string, title: string, message: string) {
  if (!clientId) return
  try { await db.insert(clientNotifications).values({ clientId, type, title, message }) } catch (e: any) {
    console.error('[visits] notify client:', e?.message)
  }
}

/** Short prefix for a text, from the agency record (never a hard-coded business name). */
export async function agencyShortName(): Promise<string> {
  try {
    const [a] = await db.select({ name: agencies.name }).from(agencies).limit(1)
    return a?.name || ''
  } catch { return '' }
}

// ── SMS ──────────────────────────────────────────────────────────────────────────────────
type SmsResult = { status: 'sent' | 'logged' | 'failed'; sid: string | null; error: string | null }
let sendSmsImpl = async (to: string, body: string): Promise<SmsResult> => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !(process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)) {
    return { status: 'logged', sid: null, error: 'Twilio not configured' }
  }
  const twilio = await import('twilio')
  const client = (twilio.default as any)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  const m = await client.messages.create({
    ...(process.env.TWILIO_MESSAGING_SERVICE_SID ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID } : { from: process.env.TWILIO_PHONE_NUMBER }),
    to, body,
  })
  reportSmsUsage(Number(m.numSegments) || 1, m.sid)
  return { status: 'sent', sid: m.sid, error: null }
}
/** Test hook. */
export function _setSmsSender(fn: typeof sendSmsImpl) { sendSmsImpl = fn }

/** Stored phones are mixed ('7155550100', '(715) 555-0100'); Twilio wants E.164. */
export function toE164(phone: unknown): string | null {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

/** Send one text. true only when it actually went out. */
export async function sendText({ phone, body }: { phone: unknown; body: string }): Promise<boolean> {
  const to = toE164(phone)
  if (!to) return false
  try {
    const r = await sendSmsImpl(to, body)
    return r.status === 'sent'
  } catch (e: any) {
    console.error('[visits] SMS failed:', e?.message)
    return false
  }
}

// ── Web push ─────────────────────────────────────────────────────────────────────────────
let sendPushImpl = async (userId: string, payload: Record<string, unknown>): Promise<number> => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return 0
  const webpush: any = (await import('web-push')).default
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', pub, priv)
  const subs = await db.select({ subscription: pushSubscriptions.subscription }).from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.isActive, true)))
  let sent = 0
  for (const s of subs) {
    try { await webpush.sendNotification(s.subscription, JSON.stringify(payload)); sent++ } catch { /* expired subscription */ }
  }
  return sent
}
/** Test hook. */
export function _setPushSender(fn: typeof sendPushImpl) { sendPushImpl = fn }

export async function sendPush(userId: string | null | undefined, payload: Record<string, unknown>): Promise<number> {
  if (!userId) return 0
  try { return await sendPushImpl(userId, payload) } catch (e: any) {
    console.error('[visits] push failed:', e?.message)
    return 0
  }
}

// ── Clinical audit trail (audit_logs) ────────────────────────────────────────────────────
export async function recordAudit(userId: string | null | undefined, action: string, tableName: string,
  recordId: string | null | undefined, oldData: unknown, newData: unknown, reasonCode?: string | null) {
  try {
    await db.insert(auditLogs).values({
      userId: userId || 'system', action, tableName, recordId: recordId || null,
      oldData: (oldData ?? null) as any, newData: (newData ?? null) as any, reasonCode: reasonCode || null,
    })
  } catch (e: any) {
    console.error('[visits] audit:', e?.message)
  }
}
