/**
 * Two-Way SMS Service
 *
 * Customer communication via SMS:
 * - Send/receive text messages
 * - Conversation threads
 * - Templates
 * - Auto-responders
 * - Job status updates
 */

import { db } from '../../db/index.ts'
import { smsConversation, smsMessage, smsTemplate, contact, company, job, user } from '../../db/schema.ts'
import { eq, and, or, ilike, desc, asc, count, sum, sql, gt } from 'drizzle-orm'
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
    userId,
    jobId,
    templateId,
  }: {
    contactId?: string
    toPhone?: string
    message: string
    userId?: string
    jobId?: string
    templateId?: string
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

  // Get or create conversation
  let [conversation] = await db
    .select()
    .from(smsConversation)
    .where(and(eq(smsConversation.companyId, companyId), eq(smsConversation.phoneNumber, formattedPhone)))

  if (!conversation) {
    ;[conversation] = await db
      .insert(smsConversation)
      .values({
        companyId,
        phoneNumber: formattedPhone,
        contactId: contactId || null,
        status: 'active',
      })
      .returning()
  }

  // Send via Twilio
  let twilioResponse: any
  let status = 'sent'
  let errorMessage: string | null = null

  try {
    twilioResponse = await twilioClient.messages.create({
      body: message,
      to: formattedPhone,
      from: TWILIO_PHONE,
      statusCallback: `${process.env.API_BASE_URL}/api/sms/webhook/status`,
    })
  } catch (error: any) {
    status = 'failed'
    errorMessage = error.message
    console.error('Twilio send error:', error)
  }

  // Save message
  const [smsMsg] = await db
    .insert(smsMessage)
    .values({
      conversationId: conversation.id,
      direction: 'outbound',
      body: message,
      status,
      errorMessage,
      twilioSid: twilioResponse?.sid,
      sentById: userId || null,
    })
    .returning()

  // Update conversation
  await db
    .update(smsConversation)
    .set({ lastMessageAt: new Date() })
    .where(eq(smsConversation.id, conversation.id))

  return smsMsg
}

/**
 * Handle incoming SMS (Twilio webhook)
 */
export async function handleIncomingSMS(data: {
  From: string
  Body: string
  MessageSid: string
  To: string
}) {
  const { From, Body, MessageSid, To } = data

  // Find company by Twilio number
  const [comp] = await db
    .select()
    .from(company)
    .where(eq(company.twilioPhoneNumber, To))

  if (!comp) {
    console.error('No company found for Twilio number:', To)
    return
  }

  const formattedPhone = formatPhoneNumber(From)

  // Find or create conversation
  let [conversation] = await db
    .select()
    .from(smsConversation)
    .where(and(eq(smsConversation.companyId, comp.id), eq(smsConversation.phoneNumber, formattedPhone)))

  // Try to find contact by phone
  const [contactRow] = await db
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.companyId, comp.id),
        or(
          eq(contact.phone, formattedPhone),
          eq(contact.phone, From),
          ilike(contact.phone, `%${formattedPhone.slice(-10)}%`)
        )
      )
    )
    .limit(1)

  if (!conversation) {
    ;[conversation] = await db
      .insert(smsConversation)
      .values({
        companyId: comp.id,
        phoneNumber: formattedPhone,
        contactId: contactRow?.id || null,
        status: 'active',
      })
      .returning()
  }

  // Save incoming message
  const [msg] = await db
    .insert(smsMessage)
    .values({
      conversationId: conversation.id,
      direction: 'inbound',
      body: Body,
      status: 'received',
      twilioSid: MessageSid,
    })
    .returning()

  // Update conversation
  await db
    .update(smsConversation)
    .set({
      lastMessageAt: new Date(),
      unreadCount: sql`${smsConversation.unreadCount} + 1`,
      contactId: contactRow?.id || conversation.contactId,
    })
    .where(eq(smsConversation.id, conversation.id))

  // Check for auto-responders
  await processAutoResponders(comp.id, conversation, Body)

  return msg
}

/**
 * Handle message status update (Twilio webhook)
 */
export async function handleStatusUpdate(data: {
  MessageSid: string
  MessageStatus: string
  ErrorCode?: string
  ErrorMessage?: string
}) {
  const { MessageSid, MessageStatus, ErrorMessage } = data

  await db
    .update(smsMessage)
    .set({ status: MessageStatus, errorMessage: ErrorMessage || null })
    .where(eq(smsMessage.twilioSid, MessageSid))
}

// ============================================
// CONVERSATIONS
// ============================================

/**
 * Get conversations
 */
export async function getConversations(
  companyId: string,
  {
    status = 'active',
    unreadOnly = false,
    search,
    page = 1,
    limit = 50,
  }: { status?: string; unreadOnly?: boolean; search?: string; page?: number; limit?: number } = {}
) {
  const conditions: any[] = [eq(smsConversation.companyId, companyId)]
  if (status) conditions.push(eq(smsConversation.status, status))
  if (unreadOnly) conditions.push(gt(smsConversation.unreadCount, 0))

  // Search is more complex with join; skip for simple implementation
  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db
      .select({
        conversation: smsConversation,
        contact: { id: contact.id, name: contact.name, email: contact.email },
      })
      .from(smsConversation)
      .leftJoin(contact, eq(smsConversation.contactId, contact.id))
      .where(where)
      .orderBy(desc(smsConversation.lastMessageAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() }).from(smsConversation).where(where),
  ])

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Get conversation with messages
 */
export async function getConversation(conversationId: string, companyId: string) {
  const [conversation] = await db
    .select()
    .from(smsConversation)
    .where(and(eq(smsConversation.id, conversationId), eq(smsConversation.companyId, companyId)))

  if (!conversation) return null

  // Get contact
  let contactRow = null
  if (conversation.contactId) {
    ;[contactRow] = await db.select().from(contact).where(eq(contact.id, conversation.contactId))
  }

  // Get messages
  const messages = await db
    .select({
      message: smsMessage,
      sentBy: { firstName: user.firstName, lastName: user.lastName },
    })
    .from(smsMessage)
    .leftJoin(user, eq(smsMessage.sentById, user.id))
    .where(eq(smsMessage.conversationId, conversationId))
    .orderBy(asc(smsMessage.createdAt))
    .limit(100)

  // Mark as read
  await db
    .update(smsConversation)
    .set({ unreadCount: 0 })
    .where(eq(smsConversation.id, conversationId))

  return { ...conversation, contact: contactRow, messages }
}

/**
 * Archive conversation
 */
export async function archiveConversation(conversationId: string, companyId: string) {
  return db
    .update(smsConversation)
    .set({ status: 'archived' })
    .where(and(eq(smsConversation.id, conversationId), eq(smsConversation.companyId, companyId)))
}

/**
 * Link conversation to contact
 */
export async function linkToContact(conversationId: string, companyId: string, contactId: string) {
  return db
    .update(smsConversation)
    .set({ contactId })
    .where(and(eq(smsConversation.id, conversationId), eq(smsConversation.companyId, companyId)))
}

// ============================================
// TEMPLATES
// ============================================

/**
 * Create SMS template
 */
export async function createTemplate(companyId: string, data: { name: string; message: string; category?: string }) {
  const [row] = await db
    .insert(smsTemplate)
    .values({
      companyId,
      name: data.name,
      body: data.message,
      category: data.category || null,
      active: true,
    })
    .returning()
  return row
}

/**
 * Get templates
 */
export async function getTemplates(companyId: string, { category }: { category?: string } = {}) {
  const conditions: any[] = [eq(smsTemplate.companyId, companyId), eq(smsTemplate.active, true)]
  if (category) conditions.push(eq(smsTemplate.category, category))

  return db.select().from(smsTemplate).where(and(...conditions)).orderBy(asc(smsTemplate.name))
}

/**
 * Update template
 */
export async function updateTemplate(templateId: string, companyId: string, data: any) {
  const updateData: any = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.message !== undefined) updateData.body = data.message
  if (data.category !== undefined) updateData.category = data.category

  return db
    .update(smsTemplate)
    .set(updateData)
    .where(and(eq(smsTemplate.id, templateId), eq(smsTemplate.companyId, companyId)))
}

/**
 * Delete template (soft delete)
 */
export async function deleteTemplate(templateId: string, companyId: string) {
  return db
    .update(smsTemplate)
    .set({ active: false })
    .where(and(eq(smsTemplate.id, templateId), eq(smsTemplate.companyId, companyId)))
}

/**
 * Apply template variables
 */
export function applyTemplateVariables(template: string, variables: Record<string, string>): string {
  let message = template

  const replacements: Record<string, string> = {
    '{{customer_name}}': variables.customerName || '',
    '{{first_name}}': variables.firstName || '',
    '{{company_name}}': variables.companyName || '',
    '{{job_title}}': variables.jobTitle || '',
    '{{job_date}}': variables.jobDate || '',
    '{{job_time}}': variables.jobTime || '',
    '{{tech_name}}': variables.techName || '',
    '{{amount}}': variables.amount || '',
    '{{link}}': variables.link || '',
  }

  for (const [key, value] of Object.entries(replacements)) {
    message = message.replace(new RegExp(key, 'g'), value)
  }

  return message
}

// ============================================
// AUTO-RESPONDERS
// ============================================

/**
 * Process auto-responders for incoming message
 * NOTE: sms_auto_responder table is not in the Drizzle schema; uses raw SQL.
 */
async function processAutoResponders(companyId: string, conversation: any, message: string) {
  const responders = (await db.execute(sql`
    SELECT * FROM sms_auto_responder WHERE company_id = ${companyId} AND active = true
  `)) as any[]

  for (const responder of responders) {
    let shouldRespond = false

    switch (responder.trigger) {
      case 'keyword': {
        const keywords = responder.keywords || []
        const lowerMessage = message.toLowerCase()
        shouldRespond = keywords.some((kw: string) => lowerMessage.includes(kw.toLowerCase()))
        break
      }
      case 'new_conversation': {
        const [msgCount] = await db
          .select({ value: count() })
          .from(smsMessage)
          .where(eq(smsMessage.conversationId, conversation.id))
        shouldRespond = msgCount.value <= 1
        break
      }
      case 'after_hours':
        shouldRespond = isAfterHours()
        break
    }

    if (responder.after_hours_only && !isAfterHours()) {
      shouldRespond = false
    }

    if (shouldRespond) {
      setTimeout(async () => {
        await sendSMS(companyId, {
          toPhone: conversation.phoneNumber,
          message: responder.message,
        })
      }, 2000)
      break
    }
  }
}

/**
 * Create auto-responder
 */
export async function createAutoResponder(companyId: string, data: any) {
  const [row] = (await db.execute(sql`
    INSERT INTO sms_auto_responder (company_id, name, trigger, keywords, message, after_hours_only, active)
    VALUES (${companyId}, ${data.name}, ${data.trigger}, ${JSON.stringify(data.keywords || [])}, ${data.message}, ${data.afterHoursOnly || false}, true)
    RETURNING *
  `)) as any[]
  return row
}

/**
 * Get auto-responders
 */
export async function getAutoResponders(companyId: string) {
  return (await db.execute(sql`
    SELECT * FROM sms_auto_responder WHERE company_id = ${companyId} ORDER BY name ASC
  `)) as any[]
}

/**
 * Check if current time is after business hours
 */
function isAfterHours(): boolean {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay()

  if (day === 0 || day === 6) return true
  if (hour < 8 || hour >= 18) return true
  return false
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
    templateId,
    userId,
  }: { contactIds: string[]; message: string; templateId?: string; userId?: string }
) {
  const results = { sent: 0, failed: 0, errors: [] as any[] }

  for (const contactId of contactIds) {
    try {
      await sendSMS(companyId, { contactId, message, templateId, userId })
      results.sent++
    } catch (error: any) {
      results.failed++
      results.errors.push({ contactId, error: error.message })
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return results
}

// ============================================
// JOB NOTIFICATIONS
// ============================================

/**
 * Send job status update
 */
export async function sendJobUpdate(companyId: string, jobId: string, updateType: string) {
  const [jobRow] = await db
    .select()
    .from(job)
    .where(eq(job.id, jobId))

  if (!jobRow?.contactId) return null

  const [contactRow] = await db.select().from(contact).where(eq(contact.id, jobRow.contactId))
  if (!contactRow?.phone) return null

  const [companyRow] = await db.select().from(company).where(eq(company.id, companyId))

  // Get assigned user
  let techName = 'Your technician'
  if (jobRow.assignedToId) {
    const [assignedUser] = await db
      .select({ firstName: user.firstName })
      .from(user)
      .where(eq(user.id, jobRow.assignedToId))
    if (assignedUser) techName = assignedUser.firstName
  }

  const templates: Record<string, string> = {
    scheduled: `Hi {{first_name}}, your appointment with {{company_name}} is confirmed for {{job_date}} at {{job_time}}. Reply CONFIRM to confirm or RESCHEDULE to change.`,
    on_way: `Good news! {{tech_name}} from {{company_name}} is on the way and should arrive in approximately 15-20 minutes.`,
    started: `{{tech_name}} has arrived and started work on your {{job_title}}. We'll notify you when complete.`,
    completed: `Your service is complete! Thank you for choosing {{company_name}}. We'd love your feedback: {{link}}`,
    reminder: `Reminder: Your appointment with {{company_name}} is tomorrow at {{job_time}}. Reply CONFIRM or RESCHEDULE.`,
  }

  const template = templates[updateType]
  if (!template) return null

  const msg = applyTemplateVariables(template, {
    firstName: contactRow.name?.split(' ')[0] || 'there',
    companyName: companyRow?.name || '',
    jobTitle: jobRow.title,
    jobDate: jobRow.scheduledDate ? new Date(jobRow.scheduledDate).toLocaleDateString() : '',
    jobTime: jobRow.scheduledDate
      ? new Date(jobRow.scheduledDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '',
    techName,
    link: `${process.env.CUSTOMER_PORTAL_URL}/review/${jobRow.id}`,
  })

  return sendSMS(companyId, { contactId: contactRow.id, message: msg, jobId })
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

/**
 * Get unread count for company
 */
export async function getUnreadCount(companyId: string): Promise<number> {
  const [result] = await db
    .select({ total: sum(smsConversation.unreadCount) })
    .from(smsConversation)
    .where(and(eq(smsConversation.companyId, companyId), eq(smsConversation.status, 'active')))

  return Number(result.total || 0)
}

export default {
  sendSMS,
  handleIncomingSMS,
  handleStatusUpdate,
  getConversations,
  getConversation,
  archiveConversation,
  linkToContact,
  createTemplate,
  getTemplates,
  updateTemplate,
  deleteTemplate,
  applyTemplateVariables,
  createAutoResponder,
  getAutoResponders,
  sendBulkSMS,
  sendJobUpdate,
  getUnreadCount,
}
