import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { smsTemplates, users, clients } from '../../db/schema.ts'
import { eq, asc, and, inArray } from 'drizzle-orm'
import { reportSmsUsage } from '../services/messagingUsage'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /messages — outbound SMS is sent via Twilio and not persisted to a table,
// so there is no history to list yet. Return an empty set (the screen 404'd
// before, which read as a broken module rather than "no messages").
app.get('/messages', async (c) => {
  return c.json({ messages: [] })
})

// GET /templates — reusable SMS templates
app.get('/templates', async (c) => {
  const rows = await db.select().from(smsTemplates).where(eq(smsTemplates.isActive, true)).orderBy(asc(smsTemplates.name))
  return c.json(rows)
})

// POST /templates — create a template
app.post('/templates', async (c) => {
  const body = await c.req.json()
  if (!body.name || !body.body) return c.json({ error: 'name and body are required' }, 400)
  const [row] = await db.insert(smsTemplates).values({
    name: body.name, body: body.body, category: body.category || null,
  }).returning()
  return c.json(row, 201)
})

// Edit was missing — the pencil control 404'd (create + delete worked). (M-15)
app.put('/templates/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const patch: Record<string, any> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.body !== undefined) patch.body = body.body
  if (body.category !== undefined) patch.category = body.category || null
  const [row] = await db.update(smsTemplates).set(patch).where(eq(smsTemplates.id, id)).returning()
  if (!row) return c.json({ error: 'Template not found' }, 404)
  return c.json(row)
})

// POST /send
app.post('/send', async (c) => {
  const { to, body } = await c.req.json()
  if (!process.env.TWILIO_ACCOUNT_SID) {
    return c.json({ error: 'SMS not configured. Add Twilio credentials to enable SMS.' }, 503)
  }
  // Dynamic import to avoid crash if twilio not configured
  const twilio = await import('twilio')
  const client = (twilio.default as any)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  const message = await client.messages.create({ ...(process.env.TWILIO_MESSAGING_SERVICE_SID ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID } : { from: process.env.TWILIO_PHONE_NUMBER }), to, body })
  reportSmsUsage(Number(message.numSegments) || 1, message.sid)
  return c.json({ sid: message.sid, status: message.status })
})

// POST /send-bulk — { recipientType: 'caregiver' | 'client', recipientIds, body }. The SMS screen's Bulk Message
// posted here and the route did not exist (404; the pop-up itself never opened until E2E Run 3, 10/16). Each text
// goes through the shared sender (visitNotify.sendText: E.164, usage reporting); a caregiver who switched SMS off,
// or is in quiet hours, is skipped by the one preference gate every other send path uses.
app.post('/send-bulk', async (c) => {
  const b = await c.req.json().catch(() => ({} as any))
  const type = b?.recipientType
  const ids: string[] = Array.isArray(b?.recipientIds) ? [...new Set(b.recipientIds.map(String))] as string[] : []
  const text = typeof b?.body === 'string' ? b.body.trim() : ''
  if (type !== 'caregiver' && type !== 'client') return c.json({ error: "recipientType must be 'caregiver' or 'client'" }, 400)
  if (!ids.length || !text) return c.json({ error: 'Select recipients and enter a message' }, 400)
  if (ids.length > 500) return c.json({ error: 'At most 500 recipients per send' }, 400)
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !(process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)) {
    return c.json({ error: 'SMS not configured. Add Twilio credentials to enable SMS.' }, 503)
  }
  const { sendText } = await import('../services/visitNotify.ts')
  const { shouldNotify } = await import('../services/notificationPrefs.ts')
  const people = type === 'caregiver'
    ? await db.select({ id: users.id, phone: users.phone }).from(users).where(and(inArray(users.id, ids), eq(users.role, 'caregiver')))
    : await db.select({ id: clients.id, phone: clients.phone }).from(clients).where(inArray(clients.id, ids))
  let sent = 0, skipped = 0, failed = 0
  for (const p of people) {
    if (type === 'caregiver' && !(await shouldNotify(p.id, 'sms', 'message'))) { skipped++; continue }
    if (!p.phone) { skipped++; continue }
    if (await sendText({ phone: p.phone, body: text })) sent++
    else failed++
  }
  const unknown = ids.length - people.length
  return c.json({ sent, skipped, failed, unknown })
})

export default app
