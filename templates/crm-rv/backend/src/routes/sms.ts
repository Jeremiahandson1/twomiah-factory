import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { message, contact as contactTable, company as companyTable } from '../../db/schema.ts'
import { eq, and, desc, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { sendAndLog, recordInbound } from '../services/sms.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'

/**
 * Two-way SMS — unified inbox. Conversations are grouped by contact (or by
 * phone number for inbound texts we couldn't match to a contact). Outbound
 * sends and inbound webhook events all land in the `message` table.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /sms/conversations — one row per contact/number with the latest message + unread count
app.get('/conversations', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const rows = await db.select().from(message)
    .where(eq(message.companyId, user.companyId))
    .orderBy(desc(message.createdAt))
    .limit(1000)

  type Convo = { contactId: string | null; number: string | null; lastMessage: any; unread: number }
  const byKey = new Map<string, Convo>()
  for (const m of rows) {
    const number = m.direction === 'inbound' ? m.fromNumber : m.toNumber
    const key = m.contactId || `num:${number || 'unknown'}`
    if (!byKey.has(key)) byKey.set(key, { contactId: m.contactId, number, lastMessage: m, unread: 0 })
    if (m.direction === 'inbound' && !m.readAt) byKey.get(key)!.unread++
  }

  // Attach contact names.
  const contactIds = [...byKey.values()].map(v => v.contactId).filter(Boolean) as string[]
  const names = new Map<string, { name: string; phone: string | null; mobile: string | null }>()
  if (contactIds.length) {
    const cs = await db.select({ id: contactTable.id, name: contactTable.name, phone: contactTable.phone, mobile: contactTable.mobile })
      .from(contactTable).where(eq(contactTable.companyId, user.companyId))
    for (const cc of cs) names.set(cc.id, { name: cc.name, phone: cc.phone, mobile: cc.mobile })
  }

  const conversations = [...byKey.values()].map(v => ({
    contactId: v.contactId,
    contactName: v.contactId ? (names.get(v.contactId)?.name || 'Unknown') : (v.number || 'Unknown'),
    number: v.number,
    unread: v.unread,
    lastMessage: { body: v.lastMessage.body, direction: v.lastMessage.direction, createdAt: v.lastMessage.createdAt, status: v.lastMessage.status },
  })).sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime())

  return c.json({ conversations })
})

// GET /sms/conversations/:contactId — full thread; marks inbound as read
app.get('/conversations/:contactId', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')

  const messages = await db.select().from(message)
    .where(and(eq(message.companyId, user.companyId), eq(message.contactId, contactId)))
    .orderBy(asc(message.createdAt))

  // Mark inbound as read.
  await db.update(message)
    .set({ readAt: new Date() })
    .where(and(eq(message.companyId, user.companyId), eq(message.contactId, contactId), eq(message.direction, 'inbound')))

  const [contact] = await db.select().from(contactTable).where(eq(contactTable.id, contactId)).limit(1)
  return c.json({ contact: contact || null, messages })
})

// POST /sms/send — send a text to a contact or raw number
app.post('/send', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const { contactId, to, body, mediaUrls } = await c.req.json()
  if (!body || typeof body !== 'string') return c.json({ error: 'Message body is required' }, 400)

  let recipient = to
  if (contactId) {
    const [ct] = await db.select().from(contactTable).where(and(eq(contactTable.id, contactId), eq(contactTable.companyId, user.companyId))).limit(1)
    if (!ct) return c.json({ error: 'Contact not found' }, 404)
    recipient = recipient || ct.mobile || ct.phone
  }
  if (!recipient) return c.json({ error: 'No phone number for recipient' }, 400)

  const row = await sendAndLog({
    companyId: user.companyId,
    to: recipient,
    body,
    contactId: contactId || null,
    userId: user.id,
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
    source: 'manual',
  })

  emitToCompany(user.companyId, EVENTS.REFRESH, { entity: 'message' })
  if (row.status === 'failed') return c.json({ message: row, warning: row.errorMessage }, 502)
  return c.json({ message: row }, 201)
})

// POST /sms/conversations/:contactId/read — mark a thread read
app.post('/conversations/:contactId/read', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')
  await db.update(message).set({ readAt: new Date() })
    .where(and(eq(message.companyId, user.companyId), eq(message.contactId, contactId), eq(message.direction, 'inbound')))
  return c.json({ success: true })
})

export default app

// ─── Inbound webhook (Twilio → us). Mounted WITHOUT auth in index.ts. ─────────
export const smsWebhook = new Hono()

smsWebhook.post('/sms', async (c) => {
  // Twilio posts application/x-www-form-urlencoded.
  const form = await c.req.parseBody()
  const from = String(form.From || '')
  const to = String(form.To || '')
  const body = String(form.Body || '')
  const sid = String(form.MessageSid || form.SmsSid || '')
  const numMedia = parseInt(String(form.NumMedia || '0')) || 0
  const mediaUrls: string[] = []
  for (let i = 0; i < numMedia; i++) {
    const u = form[`MediaUrl${i}`]
    if (u) mediaUrls.push(String(u))
  }

  // Single company per tenant DB; match by the receiving number, else first company.
  let company = (await db.select().from(companyTable).where(eq(companyTable.twilioPhoneNumber, to)).limit(1))[0]
  if (!company) company = (await db.select().from(companyTable).limit(1))[0]
  if (!company) return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' })

  try {
    await recordInbound({ companyId: company.id, from, to, body, twilioSid: sid, mediaUrls })
    emitToCompany(company.id, EVENTS.REFRESH, { entity: 'message' })
  } catch {
    // Swallow — never 500 a webhook or Twilio will retry-storm.
  }

  // Empty TwiML = accept, no auto-reply.
  return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' })
})
