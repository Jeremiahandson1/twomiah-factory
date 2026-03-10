/**
 * Google Reviews Automation Service
 *
 * Automate review requests after job completion:
 * - Send review requests via SMS/email
 * - Track review request status
 * - Generate direct Google review links
 * - Scheduled processing with follow-ups
 */

import { db } from '../../db/index.ts'
import { reviewRequest, company, job, contact } from '../../db/schema.ts'
import { eq, and, lte, isNull, count, sql } from 'drizzle-orm'
import email from './email.ts'

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
 * Get company's review settings from company.settings JSON
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
    googleReviewUrl: settings.googleReviewUrl || null,
    reviewRequestDelay: settings.reviewRequestDelay || 24,
    reviewFollowUpDelay: settings.reviewFollowUpDelay || 5,
    reviewRequestEnabled: settings.reviewRequestEnabled ?? false,
    reviewSmsEnabled: settings.reviewSmsEnabled ?? true,
    reviewEmailEnabled: settings.reviewEmailEnabled ?? true,
    reviewChannel: settings.reviewChannel || 'both',
    reviewSmsTemplate: settings.reviewSmsTemplate || 'Hi {firstName}, thanks for choosing {companyName}! We\'d love your feedback — could you leave us a quick Google review? {trackingUrl}',
    reviewEmailTemplate: settings.reviewEmailTemplate || '',
    reviewMinimumJobValue: settings.reviewMinimumJobValue || 0,
    reviewLink: settings.googlePlaceId
      ? generateGoogleReviewLink(settings.googlePlaceId)
      : settings.googleReviewUrl || null,
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
 * Schedule a review request (creates pending record for later processing)
 */
export async function scheduleReviewRequest(jobId: string) {
  const [jobRow] = await db.select().from(job).where(eq(job.id, jobId))
  if (!jobRow) return null
  if (!jobRow.contactId) return null

  const settings = await getReviewSettings(jobRow.companyId)
  if (!settings.reviewRequestEnabled) return null

  // Check if already requested for this job
  const [existing] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(and(eq(reviewRequest.jobId, jobId), eq(reviewRequest.companyId, jobRow.companyId)))
    .limit(1)

  if (existing) return null

  const reviewLink = settings.googlePlaceId
    ? generateGoogleReviewLink(settings.googlePlaceId)
    : settings.googleReviewUrl || null

  const [request] = await db
    .insert(reviewRequest)
    .values({
      companyId: jobRow.companyId,
      jobId,
      contactId: jobRow.contactId,
      channel: settings.reviewChannel || 'both',
      status: 'pending',
      reviewLink,
    })
    .returning()

  console.log('[Reviews] Scheduled review request for job', jobId)
  return request
}

/**
 * Send review request immediately for a job
 */
export async function sendReviewRequest(jobId: string, { channel = 'both' }: { channel?: string } = {}) {
  const [jobRow] = await db.select().from(job).where(eq(job.id, jobId))
  if (!jobRow) throw new Error('Job not found')
  if (!jobRow.contactId) throw new Error('Job has no contact')

  const [contactRow] = await db.select().from(contact).where(eq(contact.id, jobRow.contactId))
  if (!contactRow) throw new Error('Contact not found')

  const [companyRow] = await db.select().from(company).where(eq(company.id, jobRow.companyId))
  const settings = await getReviewSettings(jobRow.companyId)

  const reviewLink = settings.googlePlaceId
    ? generateGoogleReviewLink(settings.googlePlaceId)
    : settings.googleReviewUrl

  if (!reviewLink) throw new Error('Google review URL not configured')

  // Create or find review request record
  let [request] = await db
    .select()
    .from(reviewRequest)
    .where(and(eq(reviewRequest.jobId, jobId), eq(reviewRequest.companyId, jobRow.companyId)))
    .limit(1)

  if (!request) {
    ;[request] = await db
      .insert(reviewRequest)
      .values({
        companyId: jobRow.companyId,
        jobId,
        contactId: jobRow.contactId,
        channel,
        status: 'pending',
        reviewLink,
      })
      .returning()
  }

  const trackingUrl = `${process.env.API_BASE_URL || process.env.FRONTEND_URL || ''}/api/reviews/track/${request.id}/click`
  const results: { sms: any; email: any } = { sms: null, email: null }

  // Send SMS
  if ((channel === 'sms' || channel === 'both') && contactRow.phone) {
    try {
      const template = settings.reviewSmsTemplate ||
        'Hi {firstName}, thanks for choosing {companyName}! We\'d love your feedback — could you leave us a quick Google review? {trackingUrl}'
      results.sms = await sendReviewSms(contactRow.phone, {
        contactName: contactRow.name?.split(' ')[0] || 'there',
        companyName: companyRow?.name || '',
        reviewLink: trackingUrl,
        template,
      })
    } catch (error: any) {
      console.error('SMS send error:', error)
      results.sms = { error: error.message }
    }
  }

  // Send Email
  if ((channel === 'email' || channel === 'both') && contactRow.email) {
    try {
      results.email = await sendReviewEmail(contactRow.email, {
        contactName: contactRow.name || 'Valued Customer',
        companyName: companyRow?.name || '',
        jobTitle: jobRow.title,
        reviewLink: trackingUrl,
      })
    } catch (error: any) {
      console.error('Email send error:', error)
      results.email = { error: error.message }
    }
  }

  // Update status to sent
  await db
    .update(reviewRequest)
    .set({ status: 'sent', sentAt: new Date(), channel, reviewLink })
    .where(eq(reviewRequest.id, request.id))

  return { requestId: request.id, reviewLink, results }
}

/**
 * Process scheduled (pending) review requests that are past the delay window
 */
export async function processScheduledRequests() {
  const companies = await db.select().from(company)
  const results: any[] = []

  for (const comp of companies) {
    try {
      const settings = await getReviewSettings(comp.id)
      if (!settings.reviewRequestEnabled) continue

      const reviewLink = settings.googlePlaceId
        ? generateGoogleReviewLink(settings.googlePlaceId)
        : settings.googleReviewUrl
      if (!reviewLink) continue

      const delayHours = settings.reviewRequestDelay || 24
      const cutoff = new Date(Date.now() - delayHours * 60 * 60 * 1000)

      // Find pending requests older than the delay
      const pending = await db
        .select({ request: reviewRequest, contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email } })
        .from(reviewRequest)
        .leftJoin(contact, eq(reviewRequest.contactId, contact.id))
        .where(and(
          eq(reviewRequest.companyId, comp.id),
          eq(reviewRequest.status, 'pending'),
          lte(reviewRequest.createdAt, cutoff),
        ))
        .limit(50)

      for (const { request, contact: ct } of pending) {
        try {
          const trackingUrl = `${process.env.API_BASE_URL || process.env.FRONTEND_URL || ''}/api/reviews/track/${request.id}/click`
          const channel = request.channel || settings.reviewChannel || 'both'
          let sent = false

          // SMS
          if ((channel === 'sms' || channel === 'both') && ct?.phone) {
            const template = settings.reviewSmsTemplate ||
              'Hi {firstName}, thanks for choosing {companyName}! We\'d love your feedback — could you leave us a quick Google review? {trackingUrl}'
            await sendReviewSms(ct.phone, {
              contactName: ct.name?.split(' ')[0] || 'there',
              companyName: comp.name || '',
              reviewLink: trackingUrl,
              template,
            })
            sent = true
          }

          // Email
          if ((channel === 'email' || channel === 'both') && ct?.email) {
            await sendReviewEmail(ct.email, {
              contactName: ct.name || 'Valued Customer',
              companyName: comp.name || '',
              jobTitle: '',
              reviewLink: trackingUrl,
            })
            sent = true
          }

          if (sent) {
            await db
              .update(reviewRequest)
              .set({ status: 'sent', sentAt: new Date() })
              .where(eq(reviewRequest.id, request.id))
            results.push({ id: request.id, action: 'sent' })
          } else {
            await db
              .update(reviewRequest)
              .set({ status: 'failed' })
              .where(eq(reviewRequest.id, request.id))
            results.push({ id: request.id, action: 'failed', reason: 'no contact method' })
          }
        } catch (err: any) {
          console.error('[Reviews] Failed to process request', request.id, err.message)
          await db
            .update(reviewRequest)
            .set({ status: 'failed' })
            .where(eq(reviewRequest.id, request.id))
          results.push({ id: request.id, action: 'failed', reason: err.message })
        }
      }

      // Follow-ups: sent requests with no click after followUpDelay days
      const followUpDays = settings.reviewFollowUpDelay || 5
      if (followUpDays > 0) {
        const followUpCutoff = new Date(Date.now() - followUpDays * 24 * 60 * 60 * 1000)

        const needFollowUp = await db
          .select({ request: reviewRequest, contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email } })
          .from(reviewRequest)
          .leftJoin(contact, eq(reviewRequest.contactId, contact.id))
          .where(and(
            eq(reviewRequest.companyId, comp.id),
            eq(reviewRequest.status, 'sent'),
            isNull(reviewRequest.clickedAt),
            isNull(reviewRequest.followUpSentAt),
            lte(reviewRequest.sentAt, followUpCutoff),
          ))
          .limit(50)

        for (const { request, contact: ct } of needFollowUp) {
          try {
            await sendFollowUp(request.id)
            results.push({ id: request.id, action: 'follow_up' })
          } catch (err: any) {
            console.error('[Reviews] Failed to send follow-up', request.id, err.message)
          }
        }
      }
    } catch (err: any) {
      console.error('[Reviews] Error processing company', comp.id, err.message)
    }
  }

  if (results.length > 0) {
    console.log(`[Reviews] Processed ${results.length} review requests`)
  }
  return results
}

/**
 * Send follow-up for a review request
 */
export async function sendFollowUp(requestId: string) {
  const [request] = await db.select().from(reviewRequest).where(eq(reviewRequest.id, requestId)).limit(1)
  if (!request) return null
  if (request.followUpSentAt) return null // Already followed up
  if (request.clickedAt) return null // Already clicked

  const [ct] = await db.select().from(contact).where(eq(contact.id, request.contactId)).limit(1)
  if (!ct) return null

  const [comp] = await db.select().from(company).where(eq(company.id, request.companyId)).limit(1)
  if (!comp) return null

  const trackingUrl = `${process.env.API_BASE_URL || process.env.FRONTEND_URL || ''}/api/reviews/track/${request.id}/click`

  // Send follow-up SMS
  if (ct.phone && (request.channel === 'sms' || request.channel === 'both')) {
    try {
      await sendReviewSms(ct.phone, {
        contactName: ct.name?.split(' ')[0] || 'there',
        companyName: comp.name || '',
        reviewLink: trackingUrl,
        template: 'Hi {firstName}, just a friendly reminder from {companyName} — we\'d really appreciate a quick Google review if you have a moment! {trackingUrl}',
      })
    } catch (e: any) {
      console.error('[Reviews] Follow-up SMS failed:', e.message)
    }
  }

  // Send follow-up email
  if (ct.email && (request.channel === 'email' || request.channel === 'both')) {
    try {
      await sendReviewEmail(ct.email, {
        contactName: ct.name || 'Valued Customer',
        companyName: comp.name || '',
        jobTitle: '',
        reviewLink: trackingUrl,
      })
    } catch (e: any) {
      console.error('[Reviews] Follow-up email failed:', e.message)
    }
  }

  await db
    .update(reviewRequest)
    .set({ followUpSentAt: new Date() })
    .where(eq(reviewRequest.id, requestId))

  return { id: requestId, status: 'follow_up_sent' }
}

/**
 * Mark review request as clicked/completed
 */
export async function markReviewCompleted(requestId: string, { clicked }: { clicked?: boolean } = {}) {
  const updates: any = {}
  if (clicked) {
    updates.clickedAt = new Date()
    updates.status = 'clicked'
  }
  await db.update(reviewRequest).set(updates).where(eq(reviewRequest.id, requestId))
}

/**
 * Send review request SMS
 */
async function sendReviewSms(
  phoneNumber: string,
  { contactName, companyName, reviewLink, template }: { contactName: string; companyName: string; reviewLink: string; template: string }
) {
  if (!twilioClient) throw new Error('SMS not configured')

  const message = template
    .replace(/\{firstName\}/g, contactName)
    .replace(/\{companyName\}/g, companyName)
    .replace(/\{trackingUrl\}/g, reviewLink)

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
  const jobLine = jobTitle ? `<p>We hope you're satisfied with the work we did on <strong>${jobTitle}</strong>.</p>` : ''

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Thank you, ${contactName}!</h2>
      ${jobLine}
      <p>Your feedback helps us improve and helps other customers find quality service.
         Would you take a moment to share your experience?</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${reviewLink}"
           style="display: inline-block; padding: 15px 30px; background: {{PRIMARY_COLOR}};
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
 * Get review stats for a company
 */
export async function getReviewStats(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string } = {}) {
  const conditions: any[] = [eq(reviewRequest.companyId, companyId)]
  if (startDate) conditions.push(sql`${reviewRequest.createdAt} >= ${new Date(startDate)}`)
  if (endDate) conditions.push(sql`${reviewRequest.createdAt} <= ${new Date(endDate)}`)

  const where = and(...conditions)

  // This month
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthConditions = [...conditions, sql`${reviewRequest.createdAt} >= ${monthStart}`]

  const [total] = await db.select({ value: count() }).from(reviewRequest).where(where)
  const [sent] = await db.select({ value: count() }).from(reviewRequest).where(and(where, eq(reviewRequest.status, 'sent')))
  const [clicked] = await db.select({ value: count() }).from(reviewRequest).where(and(where, eq(reviewRequest.status, 'clicked')))
  const [completed] = await db.select({ value: count() }).from(reviewRequest).where(and(where, eq(reviewRequest.status, 'completed')))
  const [pending] = await db.select({ value: count() }).from(reviewRequest).where(and(where, eq(reviewRequest.status, 'pending')))
  const [thisMonth] = await db.select({ value: count() }).from(reviewRequest).where(and(...monthConditions))

  const clickedOrCompleted = Number(clicked.value) + Number(completed.value)
  const totalSent = Number(sent.value) + clickedOrCompleted

  return {
    total: Number(total.value),
    sent: Number(sent.value),
    clicked: Number(clicked.value),
    completed: Number(completed.value),
    pending: Number(pending.value),
    thisMonth: Number(thisMonth.value),
    clickRate: totalSent > 0 ? ((clickedOrCompleted / totalSent) * 100).toFixed(1) : '0',
    conversionRate: Number(total.value) > 0 ? ((Number(completed.value) / Number(total.value)) * 100).toFixed(1) : '0',
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
        job: { id: job.id, title: job.title },
      })
      .from(reviewRequest)
      .leftJoin(contact, eq(reviewRequest.contactId, contact.id))
      .leftJoin(job, eq(reviewRequest.jobId, job.id))
      .where(where)
      .orderBy(sql`${reviewRequest.createdAt} DESC`)
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() }).from(reviewRequest).where(where),
  ])

  return {
    data: data.map(d => ({ ...d.reviewRequest, contact: d.contact, job: d.job })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Start the hourly review processor
 */
export function startReviewProcessor() {
  const INTERVAL = 60 * 60 * 1000 // 1 hour
  console.log('[Reviews] Starting review processor (every 1 hour)')
  setInterval(async () => {
    try {
      await processScheduledRequests()
    } catch (err: any) {
      console.error('[Reviews] Processor error:', err.message)
    }
  }, INTERVAL)

  // Also run once after a short delay on startup
  setTimeout(() => {
    processScheduledRequests().catch(err => console.error('[Reviews] Initial run error:', err.message))
  }, 30_000)
}

export default {
  generateGoogleReviewLink,
  getReviewSettings,
  updateReviewSettings,
  scheduleReviewRequest,
  sendReviewRequest,
  processScheduledRequests,
  sendFollowUp,
  markReviewCompleted,
  getReviewStats,
  getReviewRequests,
  startReviewProcessor,
}
