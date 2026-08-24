import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { smsTemplates } from '../../db/schema.ts'
import { eq, asc } from 'drizzle-orm'
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

export default app
