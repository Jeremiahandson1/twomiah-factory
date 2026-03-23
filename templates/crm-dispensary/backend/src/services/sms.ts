/**
 * SMS Service
 *
 * Simple SMS for dispensaries:
 * - Send order confirmations
 * - Send promotional messages
 * - Bulk SMS to opted-in loyalty members
 * Uses Twilio for delivery.
 */

import { db } from '../../db/index.ts'
import { contact, company } from '../../db/schema.ts'
import { eq, and, or, ilike, sql } from 'drizzle-orm'
import twilio from 'twilio'

// Initialize Twilio client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER

// ============================================
// SENDING MESSAGES
// ============================================

/**
 * Send SMS to a contact
 */
export async function sendSMS(
  companyId: string,
  {
    contactId,
    toPhone,
    message,
  }: {
    contactId?: string
    toPhone?: string
    message: string
  }
) {
  // Get contact phone if not provided
  if (!toPhone && contactId) {
    const [contactRow] = await db.select().from(contact).where(eq(contact.id, contactId))
    if (!contactRow?.phone) throw new Error('Contact has no phone number')
    toPhone = contactRow.phone
  }

  if (!toPhone) throw new Error('Phone number required')

  const formattedPhone = formatPhoneNumber(toPhone)

  // Send via Twilio
  let twilioResponse: any
  let status = 'sent'
  let errorMessage: string | null = null

  try {
    twilioResponse = await twilioClient.messages.create({
      body: message,
      to: formattedPhone,
      from: TWILIO_PHONE,
    })
  } catch (error: any) {
    status = 'failed'
    errorMessage = error.message
    console.error('Twilio send error:', error)
  }

  return {
    status,
    errorMessage,
    twilioSid: twilioResponse?.sid,
    to: formattedPhone,
  }
}

/**
 * Send order confirmation SMS
 */
export async function sendOrderConfirmation(
  companyId: string,
  {
    contactId,
    orderNumber,
    total,
    type,
  }: {
    contactId: string
    orderNumber: string | number
    total: string
    type: string // walk_in|pickup|delivery
  }
) {
  const [companyRow] = await db.select().from(company).where(eq(company.id, companyId))
  const companyName = companyRow?.name || 'Our dispensary'

  let message: string
  switch (type) {
    case 'pickup':
      message = `Thanks for your order at ${companyName}! Order #${orderNumber} ($${total}) is being prepared. We'll text you when it's ready for pickup.`
      break
    case 'delivery':
      message = `Thanks for your order at ${companyName}! Order #${orderNumber} ($${total}) is being prepared for delivery. We'll text you when it's on the way.`
      break
    default:
      message = `Thanks for shopping at ${companyName}! Your order #${orderNumber} totaled $${total}. See you next time!`
  }

  return sendSMS(companyId, { contactId, message })
}

/**
 * Send order status update SMS
 */
export async function sendOrderStatusUpdate(
  companyId: string,
  {
    contactId,
    orderNumber,
    status,
  }: {
    contactId: string
    orderNumber: string | number
    status: string
  }
) {
  const [companyRow] = await db.select().from(company).where(eq(company.id, companyId))
  const companyName = companyRow?.name || 'Our dispensary'

  const templates: Record<string, string> = {
    ready: `Your order #${orderNumber} at ${companyName} is ready for pickup!`,
    out_for_delivery: `Your order #${orderNumber} from ${companyName} is out for delivery!`,
    completed: `Your order #${orderNumber} from ${companyName} has been delivered. Enjoy!`,
    cancelled: `Your order #${orderNumber} at ${companyName} has been cancelled. Please contact us with questions.`,
  }

  const message = templates[status]
  if (!message) return null

  return sendSMS(companyId, { contactId, message })
}

// ============================================
// BULK SMS
// ============================================

/**
 * Send bulk SMS to multiple contacts
 */
export async function sendBulkSMS(
  companyId: string,
  {
    contactIds,
    message,
  }: { contactIds: string[]; message: string }
) {
  const results = { sent: 0, failed: 0, errors: [] as any[] }

  for (const contactId of contactIds) {
    try {
      await sendSMS(companyId, { contactId, message })
      results.sent++
    } catch (error: any) {
      results.failed++
      results.errors.push({ contactId, error: error.message })
    }

    // Rate limit between messages
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return results
}

// ============================================
// TEMPLATE HELPERS
// ============================================

/**
 * Apply template variables to a message
 */
export function applyTemplateVariables(template: string, variables: Record<string, string>): string {
  let message = template

  const replacements: Record<string, string> = {
    '{{customer_name}}': variables.customerName || '',
    '{{first_name}}': variables.firstName || '',
    '{{company_name}}': variables.companyName || '',
    '{{order_number}}': variables.orderNumber || '',
    '{{total}}': variables.total || '',
    '{{link}}': variables.link || '',
  }

  for (const [key, value] of Object.entries(replacements)) {
    message = message.replace(new RegExp(key, 'g'), value)
  }

  return message
}

// ============================================
// INCOMING WEBHOOKS
// ============================================

/**
 * Handle incoming SMS from Twilio webhook
 */
export async function handleIncomingSMS(body: any) {
  const from = body.From || body.from
  const to = body.To || body.to
  const messageBody = body.Body || body.body || ''
  const messageSid = body.MessageSid || body.messageSid || body.SmsSid

  if (!from) return

  // Try to match phone number to a contact
  const formattedPhone = formatPhoneNumber(from)
  const matchResult = await db.execute(sql`
    SELECT id, company_id, name FROM contact
    WHERE phone = ${formattedPhone} OR mobile = ${formattedPhone}
    LIMIT 1
  `)
  const matchedContact = matchResult.rows?.[0] as any

  const companyId = matchedContact?.company_id || null

  // Upsert conversation (group by phone number)
  const convResult = await db.execute(sql`
    INSERT INTO sms_conversations (id, company_id, phone, contact_id, contact_name, status, unread, last_message, last_message_at, created_at, updated_at)
    VALUES (
      gen_random_uuid()::text, ${companyId}, ${formattedPhone}, ${matchedContact?.id || null}, ${matchedContact?.name || null},
      'active', true, ${messageBody}, NOW(), NOW(), NOW()
    )
    ON CONFLICT (company_id, phone) DO UPDATE SET
      unread = true,
      last_message = ${messageBody},
      last_message_at = NOW(),
      updated_at = NOW(),
      contact_id = COALESCE(sms_conversations.contact_id, ${matchedContact?.id || null}),
      contact_name = COALESCE(sms_conversations.contact_name, ${matchedContact?.name || null}),
      status = CASE WHEN sms_conversations.status = 'archived' THEN 'active' ELSE sms_conversations.status END
    RETURNING id
  `)
  const conversationId = (convResult.rows?.[0] as any)?.id

  // Store the message
  await db.execute(sql`
    INSERT INTO sms_messages (id, conversation_id, company_id, direction, phone, body, twilio_sid, status, created_at)
    VALUES (gen_random_uuid()::text, ${conversationId}, ${companyId}, 'inbound', ${formattedPhone}, ${messageBody}, ${messageSid}, 'received', NOW())
  `)

  // Check for auto-responders
  if (companyId) {
    const autoResult = await db.execute(sql`
      SELECT * FROM sms_auto_responders
      WHERE company_id = ${companyId} AND enabled = true
      ORDER BY priority ASC
    `)
    const responders = autoResult.rows || []

    for (const responder of responders as any[]) {
      const trigger = responder.trigger_type
      const keyword = (responder.trigger_keyword || '').toLowerCase()
      const msg = messageBody.toLowerCase().trim()

      let shouldFire = false
      if (trigger === 'any') shouldFire = true
      else if (trigger === 'keyword' && keyword && msg.includes(keyword)) shouldFire = true
      else if (trigger === 'exact' && keyword && msg === keyword) shouldFire = true

      if (shouldFire) {
        try {
          await twilioClient.messages.create({
            body: responder.response_message,
            to: formattedPhone,
            from: TWILIO_PHONE,
          })
          // Store auto-reply as outbound
          await db.execute(sql`
            INSERT INTO sms_messages (id, conversation_id, company_id, direction, phone, body, status, created_at)
            VALUES (gen_random_uuid()::text, ${conversationId}, ${companyId}, 'outbound', ${formattedPhone}, ${responder.response_message}, 'sent', NOW())
          `)
        } catch (err) {
          console.error('Auto-responder send error:', err)
        }
        break // Only fire the first matching auto-responder
      }
    }
  }

  return { conversationId, contactId: matchedContact?.id }
}

/**
 * Handle delivery status updates from Twilio
 */
export async function handleStatusUpdate(body: any) {
  const messageSid = body.MessageSid || body.messageSid || body.SmsSid
  const messageStatus = body.MessageStatus || body.messageStatus || body.SmsStatus
  const errorCode = body.ErrorCode || body.errorCode

  if (!messageSid) return

  await db.execute(sql`
    UPDATE sms_messages
    SET status = ${messageStatus}, error_code = ${errorCode || null}, updated_at = NOW()
    WHERE twilio_sid = ${messageSid}
  `)

  return { messageSid, status: messageStatus }
}

// ============================================
// CONVERSATIONS
// ============================================

/**
 * List SMS conversations (grouped by phone number)
 */
export async function getConversations(
  companyId: string,
  params: {
    status?: string
    unreadOnly?: boolean
    search?: string
    page?: number
    limit?: number
  } = {}
) {
  const { status, unreadOnly, search, page = 1, limit = 50 } = params
  const offset = (page - 1) * limit

  let whereClause = sql`WHERE c.company_id = ${companyId}`
  if (status) {
    whereClause = sql`${whereClause} AND c.status = ${status}`
  }
  if (unreadOnly) {
    whereClause = sql`${whereClause} AND c.unread = true`
  }
  if (search) {
    whereClause = sql`${whereClause} AND (c.phone ILIKE ${'%' + search + '%'} OR c.contact_name ILIKE ${'%' + search + '%'})`
  }

  const result = await db.execute(sql`
    SELECT c.*, ct.name as contact_name_live, ct.email as contact_email
    FROM sms_conversations c
    LEFT JOIN contact ct ON ct.id = c.contact_id
    ${whereClause}
    ORDER BY c.last_message_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*) as total FROM sms_conversations c ${whereClause}
  `)
  const total = parseInt((countResult.rows?.[0] as any)?.total || '0')

  return {
    conversations: (result.rows || []).map((row: any) => ({
      id: row.id,
      companyId: row.company_id,
      phone: row.phone,
      contactId: row.contact_id,
      contactName: row.contact_name_live || row.contact_name,
      contactEmail: row.contact_email,
      status: row.status,
      unread: row.unread,
      lastMessage: row.last_message,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
    })),
    total,
    page,
    limit,
  }
}

/**
 * Count unread conversations
 */
export async function getUnreadCount(companyId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM sms_conversations
    WHERE company_id = ${companyId} AND unread = true AND status = 'active'
  `)
  return parseInt((result.rows?.[0] as any)?.count || '0')
}

/**
 * Get all messages in a conversation
 */
export async function getConversation(conversationId: string, companyId: string) {
  // Get conversation metadata
  const convResult = await db.execute(sql`
    SELECT c.*, ct.name as contact_name_live, ct.email as contact_email
    FROM sms_conversations c
    LEFT JOIN contact ct ON ct.id = c.contact_id
    WHERE c.id = ${conversationId} AND c.company_id = ${companyId}
    LIMIT 1
  `)
  const conv = convResult.rows?.[0] as any
  if (!conv) return null

  // Get messages
  const msgResult = await db.execute(sql`
    SELECT * FROM sms_messages
    WHERE conversation_id = ${conversationId} AND company_id = ${companyId}
    ORDER BY created_at ASC
  `)

  // Mark as read
  await db.execute(sql`
    UPDATE sms_conversations SET unread = false, updated_at = NOW()
    WHERE id = ${conversationId} AND company_id = ${companyId}
  `)

  return {
    id: conv.id,
    companyId: conv.company_id,
    phone: conv.phone,
    contactId: conv.contact_id,
    contactName: conv.contact_name_live || conv.contact_name,
    contactEmail: conv.contact_email,
    status: conv.status,
    unread: false,
    lastMessage: conv.last_message,
    lastMessageAt: conv.last_message_at,
    createdAt: conv.created_at,
    messages: (msgResult.rows || []).map((m: any) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      status: m.status,
      errorCode: m.error_code,
      twilioSid: m.twilio_sid,
      createdAt: m.created_at,
    })),
  }
}

/**
 * Archive a conversation
 */
export async function archiveConversation(conversationId: string, companyId: string) {
  await db.execute(sql`
    UPDATE sms_conversations SET status = 'archived', updated_at = NOW()
    WHERE id = ${conversationId} AND company_id = ${companyId}
  `)
}

/**
 * Link a conversation to a contact record
 */
export async function linkToContact(conversationId: string, companyId: string, contactId: string) {
  // Verify contact belongs to company
  const contactResult = await db.execute(sql`
    SELECT id, name FROM contact WHERE id = ${contactId} AND company_id = ${companyId} LIMIT 1
  `)
  const contactRow = contactResult.rows?.[0] as any
  if (!contactRow) throw new Error('Contact not found')

  await db.execute(sql`
    UPDATE sms_conversations
    SET contact_id = ${contactId}, contact_name = ${contactRow.name}, updated_at = NOW()
    WHERE id = ${conversationId} AND company_id = ${companyId}
  `)
}

// ============================================
// TEMPLATES (CRUD)
// ============================================

/**
 * List SMS templates
 */
export async function getTemplates(companyId: string, params: { category?: string } = {}) {
  const { category } = params

  let query
  if (category) {
    query = sql`
      SELECT * FROM sms_templates
      WHERE company_id = ${companyId} AND category = ${category}
      ORDER BY name ASC
    `
  } else {
    query = sql`
      SELECT * FROM sms_templates
      WHERE company_id = ${companyId}
      ORDER BY name ASC
    `
  }

  const result = await db.execute(query)
  return (result.rows || []).map((t: any) => ({
    id: t.id,
    companyId: t.company_id,
    name: t.name,
    category: t.category,
    body: t.body,
    variables: t.variables,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }))
}

/**
 * Create SMS template
 */
export async function createTemplate(
  companyId: string,
  data: { name: string; body: string; category?: string; variables?: string[] }
) {
  const result = await db.execute(sql`
    INSERT INTO sms_templates (id, company_id, name, body, category, variables, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${companyId}, ${data.name}, ${data.body}, ${data.category || 'general'}, ${JSON.stringify(data.variables || [])}, NOW(), NOW())
    RETURNING *
  `)
  const t = result.rows?.[0] as any
  return {
    id: t.id,
    companyId: t.company_id,
    name: t.name,
    category: t.category,
    body: t.body,
    variables: t.variables,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }
}

/**
 * Update SMS template
 */
export async function updateTemplate(
  id: string,
  companyId: string,
  data: { name?: string; body?: string; category?: string; variables?: string[] }
) {
  await db.execute(sql`
    UPDATE sms_templates
    SET
      name = COALESCE(${data.name || null}, name),
      body = COALESCE(${data.body || null}, body),
      category = COALESCE(${data.category || null}, category),
      variables = COALESCE(${data.variables ? JSON.stringify(data.variables) : null}, variables),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId}
  `)
}

/**
 * Delete SMS template
 */
export async function deleteTemplate(id: string, companyId: string) {
  await db.execute(sql`
    DELETE FROM sms_templates WHERE id = ${id} AND company_id = ${companyId}
  `)
}

// ============================================
// AUTO-RESPONDERS
// ============================================

/**
 * List auto-responder rules
 */
export async function getAutoResponders(companyId: string) {
  const result = await db.execute(sql`
    SELECT * FROM sms_auto_responders
    WHERE company_id = ${companyId}
    ORDER BY priority ASC, created_at ASC
  `)
  return (result.rows || []).map((r: any) => ({
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    triggerType: r.trigger_type,
    triggerKeyword: r.trigger_keyword,
    responseMessage: r.response_message,
    enabled: r.enabled,
    priority: r.priority,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

/**
 * Create auto-responder rule
 */
export async function createAutoResponder(
  companyId: string,
  data: {
    name: string
    triggerType: string
    triggerKeyword?: string
    responseMessage: string
    enabled?: boolean
    priority?: number
  }
) {
  const result = await db.execute(sql`
    INSERT INTO sms_auto_responders (id, company_id, name, trigger_type, trigger_keyword, response_message, enabled, priority, created_at, updated_at)
    VALUES (
      gen_random_uuid()::text, ${companyId}, ${data.name}, ${data.triggerType},
      ${data.triggerKeyword || null}, ${data.responseMessage},
      ${data.enabled !== false}, ${data.priority || 0}, NOW(), NOW()
    )
    RETURNING *
  `)
  const r = result.rows?.[0] as any
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    triggerType: r.trigger_type,
    triggerKeyword: r.trigger_keyword,
    responseMessage: r.response_message,
    enabled: r.enabled,
    priority: r.priority,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// ============================================
// JOB/ORDER UPDATES
// ============================================

/**
 * Send a job/order status update SMS
 */
export async function sendJobUpdate(companyId: string, jobId: string, updateType: string) {
  // Get order with contact info
  const orderResult = await db.execute(sql`
    SELECT o.*, c.phone as contact_phone, c.mobile as contact_mobile, c.name as contact_name, c.id as cid
    FROM orders o
    LEFT JOIN contact c ON c.id = COALESCE(o.contact_id, o.customer_id)
    WHERE o.id = ${jobId} AND o.company_id = ${companyId}
    LIMIT 1
  `)
  const order = orderResult.rows?.[0] as any
  if (!order) return null

  const phone = order.contact_phone || order.contact_mobile
  if (!phone) return null

  const [companyRow] = await db.select().from(company).where(eq(company.id, companyId))
  const companyName = companyRow?.name || 'Our dispensary'
  const orderNum = order.order_number || order.number || order.id.slice(0, 8)

  const templates: Record<string, string> = {
    scheduled: `Hi ${order.contact_name || 'there'}! Your order #${orderNum} at ${companyName} has been confirmed and scheduled.`,
    on_way: `Your order #${orderNum} from ${companyName} is on its way! Our driver is heading to you now.`,
    started: `We've started preparing your order #${orderNum} at ${companyName}. We'll let you know when it's ready!`,
    completed: `Your order #${orderNum} from ${companyName} is complete. Thank you for your business!`,
    reminder: `Reminder: You have an upcoming order #${orderNum} at ${companyName}. See you soon!`,
  }

  const message = templates[updateType]
  if (!message) return null

  return sendSMS(companyId, { toPhone: phone, contactId: order.cid, message })
}

// ============================================
// UTILITIES
// ============================================

/**
 * Format phone number to E.164
 */
function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

export default {
  sendSMS,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendBulkSMS,
  applyTemplateVariables,
  handleIncomingSMS,
  handleStatusUpdate,
  getConversations,
  getUnreadCount,
  getConversation,
  archiveConversation,
  linkToContact,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getAutoResponders,
  createAutoResponder,
  sendJobUpdate,
}
