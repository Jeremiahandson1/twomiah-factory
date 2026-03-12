import { db } from '../../db/index.ts'
import { smsMessage, contact, company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

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
  const msg = await client.messages.create({
    body,
    from: comp.twilioPhoneNumber,
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

  return msg
}

export async function sendAutoSms(companyId: string, contactId: string, jobId: string, template: string, vars: Record<string, string>) {
  let body = template
  for (const [k, v] of Object.entries(vars)) {
    body = body.replace(`[${k}]`, v)
  }
  return sendSms(companyId, contactId, body, jobId)
}
