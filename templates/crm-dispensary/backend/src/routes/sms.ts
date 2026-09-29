import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, requireRole, normalizeRole, ROLE_HIERARCHY } from '../middleware/permissions.ts'
import { db } from '../../db/index.ts'
import { contact } from '../../db/schema.ts'
import { and, eq } from 'drizzle-orm'
import sms from '../services/sms.ts'

const app = new Hono()

// ============================================
// WEBHOOKS (No auth - called by Twilio)
// ============================================

// Incoming SMS webhook
app.post('/webhook/incoming', async (c) => {
  try {
    const body = await c.req.json()
    await sms.handleIncomingSMS(body)
    // Twilio expects TwiML response
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
      'Content-Type': 'text/xml',
    })
  } catch (error) {
    console.error('SMS webhook error:', error)
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
      'Content-Type': 'text/xml',
    })
  }
})

// Message status webhook
app.post('/webhook/status', async (c) => {
  try {
    const body = await c.req.json()
    await sms.handleStatusUpdate(body)
    return c.body(null, 200)
  } catch (error) {
    console.error('SMS status webhook error:', error)
    return c.body(null, 200)
  }
})

// Apply auth to remaining routes
app.use('*', authenticate)

// ============================================
// CONVERSATIONS
// ============================================

// Get conversations
app.get('/conversations', async (c) => {
  const user = c.get('user') as any
  const status = c.req.query('status')
  const unreadOnly = c.req.query('unreadOnly')
  const searchQuery = c.req.query('search')
  const page = c.req.query('page')
  const limit = c.req.query('limit')
  const data = await sms.getConversations(user.companyId, {
    status,
    unreadOnly: unreadOnly === 'true',
    search: searchQuery,
    page: parseInt(page!) || 1,
    limit: parseInt(limit!) || 50,
  })
  return c.json(data)
})

// Get unread count
app.get('/unread-count', async (c) => {
  const user = c.get('user') as any
  const count = await sms.getUnreadCount(user.companyId)
  return c.json({ count })
})

// Get single conversation
app.get('/conversations/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const conversation = await sms.getConversation(id, user.companyId)
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404)
  return c.json(conversation)
})

// Archive conversation
app.post('/conversations/:id/archive', requireRole('budtender'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await sms.archiveConversation(id, user.companyId)
  return c.json({ success: true })
})

// Link conversation to contact
app.post('/conversations/:id/link', requireRole('budtender'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const contactId = body?.contactId
  if (!contactId || typeof contactId !== 'string') {
    return c.json({ error: 'contactId is required' }, 400)
  }
  try {
    await sms.linkToContact(id, user.companyId, contactId)
  } catch (e: any) {
    if (/not found/i.test(e?.message || '')) return c.json({ error: 'Contact not found' }, 404)
    throw e
  }
  return c.json({ success: true })
})

// ============================================
// SEND MESSAGES
// ============================================

// Send SMS
// Texting a customer is budtender work. Texting ANY number is not.
//
// T45 M22: a budtender could send a message to any phone number at all, with any contactId
// attached to it, and the only thing stopping them was an empty messaging wallet. The shop's
// number is the shop's reputation and its A2P registration; a till operator sending to arbitrary
// numbers from it is the shape of a problem that ends with the number blocked.
//
// So: a budtender may text one of this shop's own contacts, and the number is read off that
// contact rather than typed. A free-typed number is manager and up.
app.post('/send', requireRole('budtender'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({} as any))
  const { contactId, toPhone, message, jobId, templateId } = body

  if (!message) {
    return c.json({ error: 'Message is required' }, 400)
  }

  if (!contactId && !toPhone) {
    return c.json({ error: 'contactId or toPhone is required' }, 400)
  }

  const role = normalizeRole(user?.role)
  const isManagerUp = ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf('manager')

  let resolvedPhone: string | undefined = toPhone
  if (contactId) {
    const [known] = await db.select({ id: contact.id, phone: contact.phone })
      .from(contact)
      .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId)))
      .limit(1)
    // A contactId that is not this shop's customer is either a mistake or someone reaching for
    // another tenant's record. Either way it is not a message this shop sends.
    if (!known) return c.json({ error: 'That customer is not on this shop\'s books' }, 404)
    if (!isManagerUp) {
      // The number comes off the record, not off the request — otherwise "contactId plus any
      // number" is the same free-typing with a customer id stapled to it.
      if (!known.phone) return c.json({ error: 'That customer has no phone number on file' }, 400)
      resolvedPhone = known.phone
    }
  } else if (!isManagerUp) {
    return c.json({
      error: 'Choose the customer to text. Sending to a number that is not on the books is a manager job.',
      code: 'contact_required',
    }, 403)
  }

  const result = await sms.sendSMS(user.companyId, {
    contactId,
    toPhone: resolvedPhone,
    message,
    userId: user.userId,
    jobId,
    templateId,
  })

  return c.json(result)
})

// Reply to conversation
app.post('/conversations/:id/reply', requireRole('budtender'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { message } = await c.req.json()

  if (!message) {
    return c.json({ error: 'Message is required' }, 400)
  }

  // Get conversation to find phone
  const conversation = await sms.getConversation(id, user.companyId)
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404)
  }

  const result = await sms.sendSMS(user.companyId, {
    toPhone: conversation.phone,
    contactId: conversation.contactId,
    message,
    userId: user.userId,
  })

  return c.json(result)
})

// Send bulk SMS
app.post('/bulk', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const { contactIds, message, templateId } = await c.req.json()

  if (!contactIds?.length) {
    return c.json({ error: 'contactIds array is required' }, 400)
  }

  if (!message) {
    return c.json({ error: 'Message is required' }, 400)
  }

  const results = await sms.sendBulkSMS(user.companyId, {
    contactIds,
    message,
    templateId,
    userId: user.userId,
  })

  return c.json(results)
})

// Send job update
app.post('/job-update/:jobId', requireRole('budtender'), async (c) => {
  const user = c.get('user') as any
  const jobId = c.req.param('jobId')
  const { updateType } = await c.req.json()

  if (!['scheduled', 'on_way', 'started', 'completed', 'reminder'].includes(updateType)) {
    return c.json({ error: 'Invalid updateType' }, 400)
  }

  const result = await sms.sendJobUpdate(user.companyId, jobId, updateType)
  return c.json(result || { sent: false, reason: 'No phone number' })
})

// ============================================
// TEMPLATES
// ============================================

// Get templates
app.get('/templates', async (c) => {
  const user = c.get('user') as any
  const category = c.req.query('category')
  const templates = await sms.getTemplates(user.companyId, { category })
  return c.json(templates)
})

// Create template
app.post('/templates', requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  if (!body?.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }
  if (!body?.body || typeof body.body !== 'string') {
    return c.json({ error: 'body is required' }, 400)
  }
  const template = await sms.createTemplate(user.companyId, body)
  return c.json(template, 201)
})

// Update template
app.put('/templates/:id', requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await sms.updateTemplate(id, user.companyId, body)
  return c.json({ success: true })
})

// Delete template
app.delete('/templates/:id', requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await sms.deleteTemplate(id, user.companyId)
  return c.json({ success: true })
})

// ============================================
// AUTO-RESPONDERS
// ============================================

// Get auto-responders
app.get('/auto-responders', async (c) => {
  const user = c.get('user') as any
  const responders = await sms.getAutoResponders(user.companyId)
  return c.json(responders)
})

// Create auto-responder
app.post('/auto-responders', requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  if (!body?.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }
  if (!body?.triggerType || !['any', 'keyword', 'exact'].includes(body.triggerType)) {
    return c.json({ error: 'triggerType must be one of: any, keyword, exact' }, 400)
  }
  if (!body?.responseMessage || typeof body.responseMessage !== 'string') {
    return c.json({ error: 'responseMessage is required' }, 400)
  }
  if ((body.triggerType === 'keyword' || body.triggerType === 'exact') && !body.triggerKeyword) {
    return c.json({ error: 'triggerKeyword is required for keyword/exact triggers' }, 400)
  }
  const responder = await sms.createAutoResponder(user.companyId, body)
  return c.json(responder, 201)
})

export default app
