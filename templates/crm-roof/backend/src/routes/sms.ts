import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { smsMessage, contact, company } from '../../db/schema.ts'
import { eq, and, desc, or, like } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { sendSms, linkUnknownTexts } from '../services/sms.ts'
import { withoutPortalCredential, parseTwilioBody, verifyTwilioRequest, refuseUnverifiedWebhook } from '../shared/index.ts'

const app = new Hono()

// Send SMS (authenticated)
app.post('/send', authenticate, requirePermission('sms:create'), async (c) => {
  const currentUser = c.get('user') as any

  const sendSchema = z.object({
    contactId: z.string().min(1),
    message: z.string().min(1),
    jobId: z.string().optional(),
  })
  const data = sendSchema.parse(await c.req.json())

  // Verify contact belongs to company
  const [contactRow] = await db.select().from(contact)
    .where(and(eq(contact.id, data.contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!contactRow) return c.json({ error: 'Contact not found' }, 404)

  try {
    const msg = await sendSms(currentUser.companyId, data.contactId, data.message, data.jobId)
    return c.json({ success: true, sid: msg?.sid })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Twilio inbound webhook (no session — called by Twilio, so it proves it IS Twilio)
//
// index.ts exempts this path from authentication because it "verifies itself" — it did not: any caller
// could write a message into any customer's thread. X-Twilio-Signature is now checked against the auth
// token of the account that owns the number (the company's own columns, which services/sms.ts sends
// with; the platform's TWILIO_AUTH_TOKEN otherwise) before anything is written. (10/15)
app.post('/webhook', async (c) => {
  const body = await parseTwilioBody(c)
  const from = body.From
  const messageBody = body.Body
  const twilioSid = body.MessageSid
  const to = body.To

  // Find company by Twilio phone number — its account signed this request
  const [comp] = to ? await db.select().from(company).where(eq(company.twilioPhoneNumber, to)).limit(1) : []
  const v = verifyTwilioRequest(c, body, comp?.twilioAuthToken || undefined)
  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio inbound SMS webhook', v.reason)

  if (!from || !messageBody) {
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, { 'Content-Type': 'text/xml' })
  }

  if (!comp) {
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, { 'Content-Type': 'text/xml' })
  }

  // Lookup contact by fromNumber (strip formatting, match last 10 digits)
  const digits = from.replace(/\D/g, '').slice(-10)
  const [contactRow] = await db.select().from(contact)
    .where(
      and(
        eq(contact.companyId, comp.id),
        or(
          eq(contact.mobilePhone, from),
          like(contact.mobilePhone, `%${digits}%`),
          eq(contact.phone, from),
          like(contact.phone, `%${digits}%`),
        ),
      )
    )
    .limit(1)

  // Store message
  await db.insert(smsMessage).values({
    companyId: comp.id,
    // A number in no contact: kept unlinked (null), as every other CRM keeps an unknown sender's thread — 'unknown' is
    // not a contact id, the foreign key refused it, and the text was lost behind a 500. linkUnknownTexts files it
    // under the contact the first time a contact with this number is opened.
    contactId: contactRow?.id || null,
    direction: 'inbound',
    body: messageBody,
    fromNumber: from,
    toNumber: to,
    twilioSid,
  })

  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, { 'Content-Type': 'text/xml' })
})

// Get SMS conversation for a contact
app.get('/conversation/:contactId', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')

  // Verify contact belongs to company
  const [contactRow] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!contactRow) return c.json({ error: 'Contact not found' }, 404)
  await linkUnknownTexts(currentUser.companyId, contactRow)

  const messages = await db.select().from(smsMessage)
    .where(and(eq(smsMessage.contactId, contactId), eq(smsMessage.companyId, currentUser.companyId)))
    .orderBy(desc(smsMessage.createdAt))
    .limit(100)

  // The homeowner's record beside the thread — without the portal credential on it. (T42)
  return c.json({ contact: withoutPortalCredential(contactRow), messages })
})

// Opt-out contact from SMS
app.post('/opt-out/:contactId', authenticate, requirePermission('sms:create'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [contactRow] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!contactRow) return c.json({ error: 'Contact not found' }, 404)

  await db.update(contact).set({ optedOutSms: true, updatedAt: new Date() })
    .where(eq(contact.id, contactId))

  return c.json({ message: 'Contact opted out of SMS' })
})

export default app
