// Scheduled texts: write a text now, send it later — at a day and time on the COMPANY's clock (a reminder for the
// morning, a follow-up after the weekend), cancelable until it goes. The CRM's timed work (crm/services.ts startJobs)
// sends what is due every minute, through the same sender as every text, so the contact's opt-out, a missing phone and
// the usage wallet decide exactly as they do for a text sent by hand.
//
//   GET    /api/sms-scheduled                   texts waiting to go (?conversationId= / ?contactId=)   sms:send
//   POST   /api/sms-scheduled                   { conversationId | contactId | toPhone, message, media?, sendAt: 'YYYY-MM-DDTHH:mm' }
//   POST   /api/sms-scheduled/:id/cancel        before it goes                                          sms:send
//
// A due text is CLAIMED before it is sent ('scheduled' → 'sending', in one guarded update), so two passes running
// together — or a cancel landing at the same instant — can never send it twice or send a cancelled one.
import { Hono } from 'hono'
import { and, asc, eq, lte } from 'drizzle-orm'
import { companyTimeZone, zonedWallTimeToUtc, formatWhen, MAX_TEXT_PICTURES } from '@twomiah/tenant-backend'
import { scheduledText, smsConversation, contact } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { Logger } from '../../core/logger.ts'
import { isCompanyFile } from './smsMedia.ts'

/** How far ahead a text may be set: a year. */
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000
const MAX_TEXT = 1600

interface Sender { sendSMS: (companyId: string, msg: { contactId?: string; toPhone?: string; message: string; userId?: string; media?: string[] }) => Promise<any> }

/** Send what is due. `now` is the clock (a test pins it). */
export function createScheduledTextRunner(deps: { db: any; sms: Sender; logger: Logger }) {
  const { db, logger } = deps
  async function runOnce(now: Date = new Date()) {
    const due = await db.select({ id: scheduledText.id }).from(scheduledText)
      .where(and(eq(scheduledText.status, 'scheduled'), lte(scheduledText.sendAt, now))).orderBy(asc(scheduledText.sendAt), asc(scheduledText.id)).limit(200)
    const out = { sent: 0, failed: 0, skipped: 0 }
    for (const { id } of due) {
      // Claimed or nothing: a pass beside this one, or a cancel, got there first.
      const [row] = await db.update(scheduledText).set({ status: 'sending', updatedAt: new Date() })
        .where(and(eq(scheduledText.id, id), eq(scheduledText.status, 'scheduled'))).returning()
      if (!row) continue
      let status = 'sent', error: string | null = null, messageId: string | null = null
      try {
        const r: any = await deps.sms.sendSMS(row.companyId, {
          ...(row.contactId ? { contactId: row.contactId } : { toPhone: row.toPhone }),
          message: row.body, userId: row.createdById || undefined, media: Array.isArray(row.media) ? row.media : undefined,
        })
        if (r === null) { status = 'skipped'; error = 'Not sent: the contact has opted out of texts or has no phone number.' }
        else if (r?.refused) { status = 'failed'; error = r.errorMessage || 'Texting is paused on this account.' }
        else if (r?.status === 'failed') { status = 'failed'; error = r.errorMessage || 'The text could not be sent.'; messageId = r.id ?? null }
        else messageId = r?.id ?? null
      } catch (e: any) { status = 'failed'; error = e?.message || 'The text could not be sent.' }
      await db.update(scheduledText).set({ status, error, messageId, sentAt: status === 'sent' ? new Date() : null, updatedAt: new Date() }).where(eq(scheduledText.id, row.id))
      if (status === 'sent') out.sent++; else if (status === 'skipped') out.skipped++; else out.failed++
    }
    if (out.sent || out.failed || out.skipped) logger.info('[scheduled texts] pass', out as any)
    return out
  }
  return {
    runOnce,
    /** Every minute, from a minute after boot. Not in tests. */
    start() {
      const tick = () => runOnce().catch((e) => logger.error('[scheduled texts] pass failed', { error: e?.message }))
      setTimeout(tick, 60_000)
      setInterval(tick, 60_000)
    },
  }
}

export function createScheduledTextRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const shape = (r: any, tz: string) => ({ ...r, sendAtLabel: formatWhen(new Date(r.sendAt), tz) })

  app.get('/', requirePermission('sms:send'), async (c) => {
    const cid = c.get('user').companyId
    const conversationId = c.req.query('conversationId')
    const contactId = c.req.query('contactId')
    const where = [eq(scheduledText.companyId, cid), eq(scheduledText.status, 'scheduled')]
    if (conversationId) where.push(eq(scheduledText.conversationId, conversationId))
    if (contactId) where.push(eq(scheduledText.contactId, contactId))
    const rows = await db.select().from(scheduledText).where(and(...where)).orderBy(asc(scheduledText.sendAt), asc(scheduledText.id)).limit(200)
    const tz = await companyTimeZone(db, cid)
    return listAll(c, rows.map((r: any) => shape(r, tz)))
  })

  app.post('/', requirePermission('sms:send'), async (c) => {
    const user = c.get('user')
    const cid = user.companyId
    const b = await c.req.json().catch(() => ({} as any))
    const message = typeof b?.message === 'string' ? b.message.trim() : ''
    const media: string[] = Array.isArray(b?.media) ? b.media.filter((k: unknown) => typeof k === 'string' && k) : []
    if (!message && !media.length) return fail(c, 400, 'Type the text, or add a picture.', undefined, { message: 'Required' })
    if (message.length > MAX_TEXT) return fail(c, 400, `A text is at most ${MAX_TEXT} characters.`, undefined, { message: 'Too long' })
    if (media.length > MAX_TEXT_PICTURES) return fail(c, 400, `A text can carry at most ${MAX_TEXT_PICTURES} pictures.`)
    if (media.some((k) => !isCompanyFile(cid, k))) return fail(c, 400, 'That picture is not one of this business\'s files.')
    // The day and time are the company's: 9:00 means nine on the business's clock, wherever the person typing is.
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(b?.sendAt || ''))
    if (!m) return fail(c, 400, 'Pick the day and time to send it.', undefined, { sendAt: 'Required' })
    const tz = await companyTimeZone(db, cid)
    const sendAt = zonedWallTimeToUtc(m[1], `${m[2]}:${m[3]}`, tz)
    if (Number.isNaN(sendAt.getTime()) || Number(m[2]) > 23 || Number(m[3]) > 59) return fail(c, 400, 'That is not a time of day.', undefined, { sendAt: 'Invalid' })
    if (sendAt.getTime() <= Date.now()) return fail(c, 400, 'That time has passed — pick a later one, or send it now.', undefined, { sendAt: 'In the past' })
    if (sendAt.getTime() > Date.now() + MAX_AHEAD_MS) return fail(c, 400, 'A text can be set at most a year ahead.', undefined, { sendAt: 'Too far ahead' })
    // Who it goes to: the thread's number, else the contact's, else the number typed.
    let conversationId: string | null = null, contactId: string | null = null, toPhone = ''
    if (b?.conversationId) {
      const [conv] = await db.select().from(smsConversation).where(and(eq(smsConversation.id, String(b.conversationId)), eq(smsConversation.companyId, cid))).limit(1)
      if (!conv) return fail(c, 404, 'Conversation not found')
      conversationId = conv.id; contactId = conv.contactId ?? null; toPhone = conv.phoneNumber
    } else if (b?.contactId) {
      const [ct] = await db.select().from(contact).where(and(eq(contact.id, String(b.contactId)), eq(contact.companyId, cid))).limit(1)
      if (!ct) return fail(c, 404, 'Contact not found')
      if (!ct.mobile && !ct.phone) return fail(c, 400, 'This contact has no phone number.')
      contactId = ct.id; toPhone = ct.mobile || ct.phone
    } else if (typeof b?.toPhone === 'string' && b.toPhone.replace(/\D/g, '').length >= 10) {
      toPhone = b.toPhone
    } else return fail(c, 400, 'Say who it goes to.')
    if (contactId) {
      const [ct] = await db.select({ optedOutSms: contact.optedOutSms }).from(contact).where(eq(contact.id, contactId)).limit(1)
      if (ct?.optedOutSms) return fail(c, 400, 'This contact has opted out of texts.', 'opted_out')
    }
    const [row] = await db.insert(scheduledText).values({
      companyId: cid, contactId, conversationId, toPhone, body: message, media: media.length ? media : null, sendAt, createdById: user.userId,
    }).returning()
    return one(c, shape(row, tz), 201)
  })

  app.post('/:id/cancel', requirePermission('sms:send'), async (c) => {
    const cid = c.get('user').companyId
    // Only while it is still waiting: one that is going, or gone, cannot be called back.
    const [row] = await db.update(scheduledText).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(scheduledText.id, c.req.param('id')), eq(scheduledText.companyId, cid), eq(scheduledText.status, 'scheduled'))).returning()
    if (row) return done(c, 'Scheduled text cancelled.')
    const [had] = await db.select({ status: scheduledText.status }).from(scheduledText).where(and(eq(scheduledText.id, c.req.param('id')), eq(scheduledText.companyId, cid))).limit(1)
    return had ? fail(c, 409, had.status === 'cancelled' ? 'That text was cancelled already.' : 'That text has already gone, so it cannot be cancelled.') : fail(c, 404, 'Scheduled text not found')
  })

  return app
}
