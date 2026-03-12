import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { smsMessage, contact, company } from '../../db/schema.ts'
import { eq, and, desc, or, like } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { sendSms } from '../services/sms.ts'

const app = new Hono()

// Send SMS (authenticated)
app.post('/send', authenticate, async (c) => {
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

// Twilio inbound webhook (NO auth - called by Twilio)
app.post('/webhook', async (c) => {
  const body = await c.req.parseBody()
  const from = body.From as string
  const messageBody = body.Body as string
  const twilioSid = body.MessageSid as string
  const to = body.To as string

  if (!from || !messageBody) {
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, { 'Content-Type': 'text/xml' })
  }

  // Find company by Twilio phone number
  const [comp] = await db.select().from(company).where(eq(company.twilioPhoneNumber, to)).limit(1)
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
    contactId: contactRow?.id || 'unknown',
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

  const messages = await db.select().from(smsMessage)
    .where(and(eq(smsMessage.contactId, contactId), eq(smsMessage.companyId, currentUser.companyId)))
    .orderBy(desc(smsMessage.createdAt))
    .limit(100)

  return c.json({ contact: contactRow, messages })
})

// Opt-out contact from SMS
app.post('/opt-out/:contactId', authenticate, async (c) => {
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
