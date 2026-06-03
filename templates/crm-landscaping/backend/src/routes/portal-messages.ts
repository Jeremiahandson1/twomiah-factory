import { Hono } from 'hono'
import { eq, and, or, desc, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { message } from '../../db/schema.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()

// Client portal routes - authenticated via portal token
// These are called from the customer-facing portal

/**
 * List messages for the portal contact
 */
app.get('/messages', async (c) => {
  const portal = c.get('portal') as any

  if (!portal?.contact?.id) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const contactId = portal.contact.id
  const companyId = portal.companyId

  const messages = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.companyId, companyId),
        eq(message.contactId, contactId)
      )
    )
    .orderBy(desc(message.createdAt))

  return c.json(messages)
})

/**
 * Send a new message from portal contact to the company
 */
app.post('/messages', async (c) => {
  const portal = c.get('portal') as any

  if (!portal?.contact?.id) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const contactId = portal.contact.id
  const companyId = portal.companyId
  const body = await c.req.json()

  if (!body.body || !body.body.trim()) {
    return c.json({ error: 'Message body is required' }, 400)
  }

  const [newMessage] = await db
    .insert(message)
    .values({
      companyId,
      contactId,
      type: 'portal',
      direction: 'inbound',
      subject: body.subject || null,
      body: body.body.trim(),
      status: 'sent',
      sentAt: new Date(),
    })
    .returning()

  return c.json(newMessage)
})

/**
 * Get single message detail
 */
app.get('/messages/:messageId', async (c) => {
  const portal = c.get('portal') as any

  if (!portal?.contact?.id) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const contactId = portal.contact.id
  const companyId = portal.companyId
  const messageId = c.req.param('messageId')

  const [foundMessage] = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.id, messageId),
        eq(message.companyId, companyId),
        eq(message.contactId, contactId)
      )
    )
    .limit(1)

  if (!foundMessage) {
    return c.json({ error: 'Message not found' }, 404)
  }

  return c.json(foundMessage)
})

/**
 * Mark message as read
 */
app.post('/messages/:messageId/read', async (c) => {
  const portal = c.get('portal') as any

  if (!portal?.contact?.id) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const contactId = portal.contact.id
  const companyId = portal.companyId
  const messageId = c.req.param('messageId')

  const [foundMessage] = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.id, messageId),
        eq(message.companyId, companyId),
        eq(message.contactId, contactId)
      )
    )
    .limit(1)

  if (!foundMessage) {
    return c.json({ error: 'Message not found' }, 404)
  }

  await db
    .update(message)
    .set({ status: 'read', updatedAt: new Date() })
    .where(eq(message.id, messageId))

  return c.json({ success: true })
})

export default app
