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
}
