import { db } from '../../db/index.ts'
import { reportSmsUsage, walletSufficient } from './messagingUsage'
import { smsMessage, contact, company } from '../../db/schema.ts'
import { eq, and, isNull, sql } from 'drizzle-orm'

/**
 * Texts that arrived from this contact's number before it belonged to a contact (contact_id null) are filed under the
 * contact — matched on the last ten digits of mobile or phone, the rule the inbound webhook matches on. Only unlinked
 * inbound rows, only on a match, so it writes once per stray text.
 */
export async function linkUnknownTexts(companyId: string, c: { id: string; mobilePhone?: string | null; phone?: string | null }) {
  const tails = [c.mobilePhone, c.phone].map((p) => String(p || '').replace(/\D/g, '').slice(-10)).filter((d) => d.length >= 7)
  if (!tails.length) return
  const digitsOf = sql`regexp_replace(${smsMessage.fromNumber}, '\\D', '', 'g')`
  for (const tail of Array.from(new Set(tails))) {
    await db.update(smsMessage).set({ contactId: c.id })
      .where(and(eq(smsMessage.companyId, companyId), isNull(smsMessage.contactId), eq(smsMessage.direction, 'inbound'), sql`${digitsOf} like ${'%' + tail}`))
  }
}

export async function sendSms(companyId: string, contactId: string, body: string, jobId?: string) {
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  if (!comp?.twilioAccountSid || !comp?.twilioAuthToken || !comp?.twilioPhoneNumber) {
    throw new Error('Twilio not configured')
  }
  const [c] = await db.select().from(contact).where(eq(contact.id, contactId)).limit(1)
  if (!c?.mobilePhone) throw new Error('Contact has no mobile phone')
  if (c.optedOutSms) throw new Error('Contact has opted out of SMS')

  const twilio = (await import('twilio')).default
  const client = twilio(comp.twilioAccountSid, comp.twilioAuthToken)
  if (!(await walletSufficient())) throw new Error('Messaging paused: usage wallet is empty — top up to resume.')
  const msg = await client.messages.create({
    body,
    ...(process.env.TWILIO_MESSAGING_SERVICE_SID ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID } : { from: comp.twilioPhoneNumber }),
    to: c.mobilePhone,
  })

  await db.insert(smsMessage).values({
    companyId,
    contactId,
    jobId: jobId || null,
    direction: 'outbound',
    body,
    fromNumber: comp.twilioPhoneNumber,
    toNumber: c.mobilePhone,
    twilioSid: msg.sid,
  })

  reportSmsUsage(Number(msg.numSegments) || 1, msg.sid)
  return msg
}

export async function sendAutoSms(companyId: string, contactId: string, jobId: string, template: string, vars: Record<string, string>) {
  let body = template
  for (const [k, v] of Object.entries(vars)) {
    body = body.replace(`[${k}]`, v)
  }
  return sendSms(companyId, contactId, body, jobId)
}
