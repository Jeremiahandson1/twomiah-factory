/**
 * Google Reviews Automation Service
 *
 * Automate review requests after job completion:
 * - Send review requests via SMS/email
 * - Track review request status
 * - Generate direct Google review links
 * - Monitor review responses
 * - Intelligent timing and follow-ups
 */

import { db } from '../../db/index.ts'
import { reviewRequest, company, job, contact } from '../../db/schema.ts'
import { eq, and, lte, count, sql } from 'drizzle-orm'
import email from './email.js'

// Twilio for SMS (optional)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER

let twilioClient: any = null
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  try {
    const twilio = await import('twilio')
    twilioClient = (twilio as any).default(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  } catch (e) {
    console.log('Twilio not available')
  }
}

/**
 * Generate Google review link for a business
 */
export function generateGoogleReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${placeId}`
}

/**
 * Get company's Google review settings
 */
export async function getReviewSettings(companyId: string) {
  const [comp] = await db
    .select({ settings: company.settings })
    .from(company)
    .where(eq(company.id, companyId))

  const settings = (comp?.settings as any) || {}

  return {
    googlePlaceId: settings.googlePlaceId || null,
    googleBusinessName: settings.googleBusinessName || null,
    reviewRequestDelay: settings.reviewRequestDelay || 2,
    reviewFollowUpDelay: settings.reviewFollowUpDelay || 3,
    reviewRequestEnabled: settings.reviewRequestEnabled ?? true,
    reviewSmsEnabled: settings.reviewSmsEnabled ?? true,
    reviewEmailEnabled: settings.reviewEmailEnabled ?? true,
    reviewMinimumJobValue: settings.reviewMinimumJobValue || 0,
    reviewLink: settings.googlePlaceId
      ? generateGoogleReviewLink(settings.googlePlaceId)
      : null,
  }
}

/**
 * Update review settings
 */
export async function updateReviewSettings(companyId: string, newSettings: any) {
  const [comp] = await db
    .select({ settings: company.settings })
    .from(company)
    .where(eq(company.id, companyId))

  const existing = (comp?.settings as any) || {}
  const merged = { ...existing, ...newSettings }

  const [updated] = await db
    .update(company)
    .set({ settings: merged })
    .where(eq(company.id, companyId))
    .returning()

  return updated
}

/**
 * Send review request for a job
 */
export async function sendReviewRequest(jobId: string, { channel = 'both' }: { channel?: string } = {}) {
  const [jobRow] = await db
    .select()
    .from(job)
    .where(eq(job.id, jobId))

  if (!jobRow) throw new Error('Job not found')
  if (!jobRow.contactId) throw new Error('Job has no contact')

  const [contactRow] = await db
    .select()
    .from(contact)
    .where(eq(contact.id, jobRow.contactId))

  if (!contactRow) throw new Error('Contact not found')

  const [companyRow] = await db
    .select()
    .from(company)
    .where(eq(company.id, jobRow.companyId))

  const settings = await getReviewSettings(jobRow.companyId)

  if (!settings.googlePlaceId) {
    throw new Error('Google Place ID not configured')
  }

  // Check if already requested
  const [existing] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(and(eq(reviewRequest.contactId, jobRow.contactId), eq(reviewRequest.companyId, jobRow.companyId)))
    .limit(1)

  if (existing) {
    throw new Error('Review already requested for this contact')
  }

  const reviewLink = generateGoogleReviewLink(settings.googlePlaceId)
  const results: { sms: any; email: any } = { sms: null, email: null }

  // Create review request record
  const [request] = await db
    .insert(reviewRequest)
    .values({
      companyId: jobRow.companyId,
      contactId: jobRow.contactId,
      status: 'sent',
      sentAt: new Date(),
    })
    .returning()

  // Send SMS
  if ((channel === 'sms' || channel === 'both') && settings.reviewSmsEnabled && contactRow.phone) {
    try {
      results.sms = await sendReviewSms(contactRow.phone, {
        contactName: contactRow.name?.split(' ')[0] || 'there',
        companyName: companyRow?.name || '',
        reviewLink,
        shortLink: reviewLink,
      })
    } catch (error: any) {
      console.error('SMS send error:', error)
      results.sms = { error: error.message }
    }
  }

  // Send Email
  if ((channel === 'email' || channel === 'both') && settings.reviewEmailEnabled && contactRow.email) {
    try {
      results.email = await sendReviewEmail(contactRow.email, {
        contactName: contactRow.name || 'Valued Customer',
        companyName: companyRow?.name || '',
        jobTitle: jobRow.title,
        reviewLink,
      })
    } catch (error: any) {
      console.error('Email send error:', error)
      results.email = { error: error.message }
    }
  }

  return {
    requestId: request.id,
    reviewLink,
    results,
  }
}

/**
 * Send review request SMS
 */
async function sendReviewSms(
  phoneNumber: string,
  { contactName, companyName, reviewLink, shortLink }: { contactName: string; companyName: string; reviewLink: string; shortLink: string }
) {
  if (!twilioClient) {
    throw new Error('SMS not configured')
  }

  const message =
    `Hi ${contactName}! Thanks for choosing ${companyName}. ` +
    `We'd love to hear about your experience. ` +
    `Leave us a quick review: ${shortLink || reviewLink}`

  const result = await twilioClient.messages.create({
    body: message,
    from: TWILIO_PHONE_NUMBER,
    to: phoneNumber,
  })

  return { messageId: result.sid, status: result.status }
}

/**
 * Send review request email
 */
async function sendReviewEmail(
  emailAddress: string,
  { contactName, companyName, jobTitle, reviewLink }: { contactName: string; companyName: string; jobTitle: string; reviewLink: string }
) {
  const subject = `How was your experience with ${companyName}?`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Thank you, ${contactName}!</h2>
      <p>We hope you're satisfied with the work we did on <strong>${jobTitle}</strong>.</p>
      <p>Your feedback helps us improve and helps other customers find quality service.
         Would you take a moment to share your experience?</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${reviewLink}"
           style="display: inline-block; padding: 15px 30px; background: #f97316;
                  color: white; text-decoration: none; border-radius: 8px;
                  font-weight: bold;">
          Leave a Review
        </a>
      </div>
      <p style="color: #666; font-size: 14px;">
        It only takes a minute and means the world to our team.
      </p>
      <p>Thanks again for choosing ${companyName}!</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">
        If you have any concerns about your service, please reply to this email
        and we'll make it right.
      </p>
    </div>
  `

  return email.sendEmail({ to: emailAddress, subject, html })
}

/**
 * Get review request stats
 */
export async function getReviewStats(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string } = {}) {
  const conditions: any[] = [eq(reviewRequest.companyId, companyId)]
  if (startDate) conditions.push(sql`${reviewRequest.createdAt} >= ${new Date(startDate)}`)
  if (endDate) conditions.push(sql`${reviewRequest.createdAt} <= ${new Date(endDate)}`)

  const [total] = await db.select({ value: count() }).from(reviewRequest).where(and(...conditions))
  const [sent] = await db.select({ value: count() }).from(reviewRequest).where(and(...conditions, eq(reviewRequest.status, 'sent')))
  const [opened] = await db.select({ value: count() }).from(reviewRequest).where(and(...conditions, eq(reviewRequest.status, 'opened')))
  const [submitted] = await db.select({ value: count() }).from(reviewRequest).where(and(...conditions, eq(reviewRequest.status, 'submitted')))

  return {
    total: total.value,
    sent: sent.value,
    opened: opened.value,
    submitted: submitted.value,
    openRate: total.value > 0 ? ((opened.value + submitted.value) / total.value * 100).toFixed(1) : '0',
    conversionRate: total.value > 0 ? (submitted.value / total.value * 100).toFixed(1) : '0',
  }
}

/**
 * Get review requests for a company
 */
export async function getReviewRequests(
  companyId: string,
  { status, limit = 50, page = 1 }: { status?: string; limit?: number; page?: number } = {}
) {
  const conditions: any[] = [eq(reviewRequest.companyId, companyId)]
  if (status) conditions.push(eq(reviewRequest.status, status))

  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db
      .select({
        reviewRequest,
        contact: { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone },
      })
      .from(reviewRequest)
      .leftJoin(contact, eq(reviewRequest.contactId, contact.id))
      .where(where)
      .orderBy(sql`${reviewRequest.createdAt} DESC`)
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() }).from(reviewRequest).where(where),
  ])

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

export default {
  generateGoogleReviewLink,
  getReviewSettings,
  updateReviewSettings,
  sendReviewRequest,
  getReviewStats,
  getReviewRequests,
}
