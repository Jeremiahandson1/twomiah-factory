import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
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
app.post('/conversations/:id/archive', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await sms.archiveConversation(id, user.companyId)
  return c.json({ success: true })
})

// Link conversation to contact
app.post('/conversations/:id/link', async (c) => {
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
app.post('/send', async (c) => {
  const user = c.get('user') as any
  const { contactId, toPhone, message, jobId, templateId } = await c.req.json()

  if (!message) {
    return c.json({ error: 'Message is required' }, 400)
  }

  if (!contactId && !toPhone) {
    return c.json({ error: 'contactId or toPhone is required' }, 400)
  }

  const result = await sms.sendSMS(user.companyId, {
    contactId,
    toPhone,
    message,
    userId: user.userId,
    jobId,
    templateId,
  })

  return c.json(result)
})

// Reply to conversation
app.post('/conversations/:id/reply', async (c) => {
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
app.post('/job-update/:jobId', async (c) => {
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
app.post('/templates', async (c) => {
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
app.put('/templates/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await sms.updateTemplate(id, user.companyId, body)
  return c.json({ success: true })
})

// Delete template
app.delete('/templates/:id', async (c) => {
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
app.post('/auto-responders', async (c) => {
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
