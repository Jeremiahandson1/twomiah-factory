// Google review requests — ONE implementation for every CRM (vendored into each template as ../shared).
// Settings live in company.settings; requests in review_request. Sends by SMS (Twilio, metered) and/or
// email (the template's sendRaw), schedules after job completion or a visit (salon), follows up, tracks the
// click through a public redirect, and runs an hourly processor.
//
// Before: the crm-family carried the full service; fieldservice/landscaping carried a 306-line cut whose
// routes still called scheduleReviewRequest / sendFollowUp / markReviewCompleted / processScheduledRequests
// (→ 500) and mounted the public click-tracking route BEHIND authenticate (customers' links → 401).
import { Hono } from 'hono'
import { eq, and, lte, gte, isNull, count, sql } from 'drizzle-orm'
import { twilioClient, twilioConfigFor, twilioSender, type TwilioConfig } from './twilio'

export interface ReviewsTables { reviewRequest: any; company: any; contact: any; job?: any }
export interface ReviewsServiceDeps {
  db: any
  tables: ReviewsTables
  /** The template's email service: sendRaw({ to, subject, html }). */
  sendRaw: (msg: { to: string; subject: string; html: string }) => Promise<any>
  /**
   * Records a send for the usage counter. sendRaw deliberately does not record — that is the campaign
   * path and marketing.ts writes its own rows — so a review request kept none at all, and three of them
   * went out while Settings › Integrations still read the same figure as a week ago. (Salon T30 L1)
   */
  recordEmail?: (entry: { to: string; subject: string; status: 'sent' | 'failed'; errorMessage?: string }) => void | Promise<void>
  usage?: { reportSmsUsage: (segments: number, twilioSid?: string) => void }
  twilio?: TwilioConfig
  /** Public API origin for the tracking link; default API_BASE_URL || FRONTEND_URL. */
  apiBaseUrl?: string
  /** Brand colour for the email button; default the template's {{PRIMARY_COLOR}} token. */
  primaryColor?: string
  options?: {
    /**
     * Fill in what each request was ABOUT, for the list's subject column. The built-in answer is the
     * JOB the request came from; a vertical with no jobs (a salon raises them from visits) has an empty
     * column unless it says otherwise. Given the page's rows, returns them with `job` set. (T30 L2)
     */
    subjectFor?: (rows: any[]) => Promise<any[]>
  }
}

const DEFAULT_SMS_TEMPLATE = 'Hi {firstName}, thanks for choosing {companyName}! We\'d love your feedback — could you leave us a quick Google review? {trackingUrl}'
const FOLLOW_UP_SMS_TEMPLATE = 'Hi {firstName}, just a friendly reminder from {companyName} — we\'d really appreciate a quick Google review if you have a moment! {trackingUrl}'

export const generateGoogleReviewLink = (placeId: string) => `https://search.google.com/local/writereview?placeid=${placeId}`

export function createReviewsService(deps: ReviewsServiceDeps) {
  const { db, tables: t } = deps
  const report = deps.usage?.reportSmsUsage || (() => {})
  /** The company's own Twilio account (Settings → Integrations) or the platform's. */
  const cfgFor = (companyRow: any): TwilioConfig => deps.twilio || twilioConfigFor(companyRow)
  const apiBase = () => deps.apiBaseUrl || process.env.API_BASE_URL || process.env.FRONTEND_URL || ''
  const trackingUrl = (requestId: string) => `${apiBase()}/api/reviews/track/${requestId}/click`
  const firstName = (name: any) => String(name || '').split(' ')[0] || 'there'

  async function getReviewSettings(companyId: string) {
    const [comp] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, companyId))
    const s = (comp?.settings as any) || {}
    return {
      googlePlaceId: s.googlePlaceId || null,
      googleBusinessName: s.googleBusinessName || null,
      googleReviewUrl: s.googleReviewUrl || null,
      reviewRequestDelay: s.reviewRequestDelay ?? 24,
      reviewFollowUpDelay: s.reviewFollowUpDelay ?? 5,
      reviewRequestEnabled: s.reviewRequestEnabled ?? false,
      reviewSmsEnabled: s.reviewSmsEnabled ?? true,
      reviewEmailEnabled: s.reviewEmailEnabled ?? true,
      reviewChannel: s.reviewChannel || 'both',
      reviewSmsTemplate: s.reviewSmsTemplate || DEFAULT_SMS_TEMPLATE,
      reviewEmailTemplate: s.reviewEmailTemplate || '',
      reviewMinimumJobValue: s.reviewMinimumJobValue || 0,
      reviewLink: s.googlePlaceId ? generateGoogleReviewLink(s.googlePlaceId) : s.googleReviewUrl || null,
    }
  }
  const REVIEW_SETTING_KEYS = ['googlePlaceId', 'googleBusinessName', 'googleReviewUrl', 'reviewRequestDelay', 'reviewFollowUpDelay', 'reviewRequestEnabled', 'reviewSmsEnabled', 'reviewEmailEnabled', 'reviewChannel', 'reviewSmsTemplate', 'reviewEmailTemplate', 'reviewMinimumJobValue']
  /** Merges only the review keys into company.settings — the old code merged the whole body into the company's settings JSON. */
  async function updateReviewSettings(companyId: string, newSettings: any) {
    const [comp] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, companyId))
    const existing = (comp?.settings as any) || {}
    const patch: Record<string, unknown> = {}
    for (const k of REVIEW_SETTING_KEYS) if (newSettings && newSettings[k] !== undefined) patch[k] = newSettings[k]
    if (patch.reviewChannel !== undefined && !['sms', 'email', 'both'].includes(String(patch.reviewChannel))) throw new Error('reviewChannel must be sms, email or both')
    // This is the address the client is sent to. "not a url" saved, and was copied into every request's
    // reviewLink — so the one thing a review request exists to do would fail, silently, for everyone who
    // received one. (Salon T28 L3)
    if (patch.googleReviewUrl !== undefined && patch.googleReviewUrl !== null && String(patch.googleReviewUrl).trim() !== '') {
      const raw = String(patch.googleReviewUrl).trim()
      let ok = false
      try { const u = new URL(raw); ok = u.protocol === 'http:' || u.protocol === 'https:' } catch { ok = false }
      if (!ok) throw new Error('Review link must be a full web address starting with https://')
      patch.googleReviewUrl = raw
    }
    for (const k of ['reviewRequestDelay', 'reviewFollowUpDelay', 'reviewMinimumJobValue']) if (patch[k] !== undefined) { const n = Number(patch[k]); if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a number ≥ 0`); patch[k] = n }
    await db.update(t.company).set({ settings: { ...existing, ...patch } }).where(eq(t.company.id, companyId))
    return getReviewSettings(companyId)
  }

  const linkFor = (s: Awaited<ReturnType<typeof getReviewSettings>>) => s.googlePlaceId ? generateGoogleReviewLink(s.googlePlaceId) : s.googleReviewUrl || null

  /** Job completion → pending request (sent by the processor after the configured delay). */
  async function scheduleReviewRequest(jobId: string) {
    if (!t.job) return null
    const [jobRow] = await db.select().from(t.job).where(eq(t.job.id, jobId))
    if (!jobRow || !jobRow.contactId) return null
    const settings = await getReviewSettings(jobRow.companyId)
    if (!settings.reviewRequestEnabled) return null
    const [existing] = await db.select({ id: t.reviewRequest.id }).from(t.reviewRequest).where(and(eq(t.reviewRequest.jobId, jobId), eq(t.reviewRequest.companyId, jobRow.companyId))).limit(1)
    if (existing) return null
    const [request] = await db.insert(t.reviewRequest).values({ companyId: jobRow.companyId, jobId, contactId: jobRow.contactId, channel: settings.reviewChannel || 'both', status: 'pending', reviewLink: linkFor(settings) }).returning()
    sendNowIfImmediate(request.id, settings.reviewRequestDelay)
    console.log('[Reviews] Scheduled review request for job', jobId)
    return request
  }
  /**
   * Send a just-created request straight away when the salon asked for no delay.
   *
   * Deliberately fire-and-forget: the row is already written, so nothing is lost if the send fails (it is
   * recorded as failed and the sweeper leaves it alone), and finishing a visit must not block on an email
   * or fail because one bounced. Without this, "delay 0" meant "within the hour, if the service has been
   * up that long". (Salon T29 H1)
   */
  function sendNowIfImmediate(requestId: string, delayHours: number) {
    if (Number(delayHours || 0) > 0) return
    sendFollowUp(requestId).catch((e: any) => console.error('[Reviews] Immediate send failed', requestId, e?.message || e))
  }

  /** Visit completion (appointments / service records) → one pending request per client per 30 days. (SALON-H2) */
  async function scheduleReviewRequestForVisit({ companyId, contactId }: { companyId: string; contactId: string }) {
    const settings = await getReviewSettings(companyId)
    if (!settings.reviewRequestEnabled) return null
    const since = new Date(Date.now() - 30 * 86400000)
    const recent = await db.select({ id: t.reviewRequest.id }).from(t.reviewRequest)
      .where(and(eq(t.reviewRequest.companyId, companyId), eq(t.reviewRequest.contactId, contactId), gte(t.reviewRequest.createdAt, since))).limit(1)
    if (recent.length) return null
    const [request] = await db.insert(t.reviewRequest).values({ companyId, contactId, jobId: null, channel: settings.reviewChannel || 'both', status: 'pending', reviewLink: linkFor(settings) }).returning()
    sendNowIfImmediate(request.id, settings.reviewRequestDelay)
    console.log('[Reviews] Scheduled review request for visit — contact', contactId)
    return request
  }

  async function sendReviewSms(companyRow: any, phoneNumber: string, { contactName, companyName, reviewLink, template }: { contactName: string; companyName: string; reviewLink: string; template: string }) {
    const conf = cfgFor(companyRow)
    const client = await twilioClient(conf)
    const message = template.split('{firstName}').join(contactName).split('{companyName}').join(companyName).split('{trackingUrl}').join(reviewLink)
    const result = await client.messages.create({ body: message, ...twilioSender(conf), to: phoneNumber })
    report(Number(result.numSegments) || 1, result.sid)
    return { messageId: result.sid, status: result.status }
  }
  async function sendReviewEmail(emailAddress: string, { contactName, companyName, jobTitle, reviewLink }: { contactName: string; companyName: string; jobTitle: string; reviewLink: string }) {
    const jobLine = jobTitle ? `<p>We hope you're satisfied with the work we did on <strong>${jobTitle}</strong>.</p>` : ''
    const color = deps.primaryColor || '{{PRIMARY_COLOR}}'
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Thank you, ${contactName}!</h2>
      ${jobLine}
      <p>Your feedback helps us improve and helps other customers find quality service. Would you take a moment to share your experience?</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${reviewLink}" style="display: inline-block; padding: 15px 30px; background: ${color}; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Leave a Review</a>
      </div>
      <p style="color: #666; font-size: 14px;">It only takes a minute and means the world to our team.</p>
      <p>Thanks again for choosing ${companyName}!</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #999; font-size: 12px;">If you have any concerns about your service, please reply to this email and we'll make it right.</p>
    </div>`
    const subject = `How was your experience with ${companyName}?`
    try {
      const out = await deps.sendRaw({ to: emailAddress, subject, html })
      void deps.recordEmail?.({ to: emailAddress, subject, status: 'sent' })
      return out
    } catch (err: any) {
      void deps.recordEmail?.({ to: emailAddress, subject, status: 'failed', errorMessage: err?.message })
      throw err
    }
  }

  /** Send now for a job (owner button). Throws with a client-actionable message when setup is missing. */
  async function sendReviewRequest(jobId: string, { channel = 'both' }: { channel?: string } = {}) {
    if (!t.job) throw new Error('Job not found')
    const [jobRow] = await db.select().from(t.job).where(eq(t.job.id, jobId))
    if (!jobRow) throw new Error('Job not found')
    if (!jobRow.contactId) throw new Error('Job has no contact')
    const [contactRow] = await db.select().from(t.contact).where(eq(t.contact.id, jobRow.contactId))
    if (!contactRow) throw new Error('Contact not found')
    const [companyRow] = await db.select().from(t.company).where(eq(t.company.id, jobRow.companyId))
    const settings = await getReviewSettings(jobRow.companyId)
    const reviewLink = linkFor(settings)
    if (!reviewLink) throw new Error('Google review URL not configured')
    let [request] = await db.select().from(t.reviewRequest).where(and(eq(t.reviewRequest.jobId, jobId), eq(t.reviewRequest.companyId, jobRow.companyId))).limit(1)
    if (!request) [request] = await db.insert(t.reviewRequest).values({ companyId: jobRow.companyId, jobId, contactId: jobRow.contactId, channel, status: 'pending', reviewLink }).returning()
    const url = trackingUrl(request.id)
    const results: { sms: any; email: any } = { sms: null, email: null }
    const phone = contactRow.mobile || contactRow.phone
    if ((channel === 'sms' || channel === 'both') && phone) {
      try { results.sms = await sendReviewSms(companyRow, phone, { contactName: firstName(contactRow.name), companyName: companyRow?.name || '', reviewLink: url, template: settings.reviewSmsTemplate || DEFAULT_SMS_TEMPLATE }) }
      catch (error: any) { console.error('[Reviews] SMS send error:', error?.message); results.sms = { error: error?.message } }
    }
    if ((channel === 'email' || channel === 'both') && contactRow.email) {
      try { results.email = await sendReviewEmail(contactRow.email, { contactName: contactRow.name || 'Valued Customer', companyName: companyRow?.name || '', jobTitle: jobRow.title || '', reviewLink: url }) }
      catch (error: any) { console.error('[Reviews] Email send error:', error?.message); results.email = { error: error?.message } }
    }
    const delivered = (results.sms && !results.sms.error) || (results.email && !results.email.error)
    await db.update(t.reviewRequest).set({ status: delivered ? 'sent' : 'failed', sentAt: delivered ? new Date() : null, channel, reviewLink }).where(eq(t.reviewRequest.id, request.id))
    return { requestId: request.id, reviewLink, results }
  }

  /** Every few minutes: pending requests past the delay → send; sent-but-unclicked past the follow-up delay → follow up. */
  async function processScheduledRequests() {
    const companies = await db.select().from(t.company)
    const results: any[] = []
    for (const comp of companies) {
      try {
        const settings = await getReviewSettings(comp.id)
        // Skipping is correct — switching review requests off must not fire a backlog at real customers —
        // but it used to be invisible. Requests sat at "pending" for a fortnight with nothing anywhere
        // saying why, so the answer goes in the results the admin endpoint returns. (Salon T28 H3)
        if (!settings.reviewRequestEnabled) { results.push({ companyId: comp.id, action: 'skipped', reason: 'review requests are switched off for this company' }); continue }
        if (!linkFor(settings)) { results.push({ companyId: comp.id, action: 'skipped', reason: 'no Google review link is set in Settings › Reviews' }); continue }
        const cutoff = new Date(Date.now() - Number(settings.reviewRequestDelay || 0) * 3600000)
        const pending = await db.select({ request: t.reviewRequest, contact: { id: t.contact.id, name: t.contact.name, phone: t.contact.phone, mobile: t.contact.mobile, email: t.contact.email } })
          .from(t.reviewRequest).leftJoin(t.contact, eq(t.reviewRequest.contactId, t.contact.id))
          .where(and(eq(t.reviewRequest.companyId, comp.id), eq(t.reviewRequest.status, 'pending'), lte(t.reviewRequest.createdAt, cutoff))).limit(50)
        for (const { request, contact: ct } of pending) {
          try {
            const url = trackingUrl(request.id)
            const channel = request.channel || settings.reviewChannel || 'both'
            let sent = false
            const phone = ct?.mobile || ct?.phone
            if ((channel === 'sms' || channel === 'both') && phone) {
              try { await sendReviewSms(comp, phone, { contactName: firstName(ct?.name), companyName: comp.name || '', reviewLink: url, template: settings.reviewSmsTemplate || DEFAULT_SMS_TEMPLATE }); sent = true }
              catch (e: any) { console.error('[Reviews] SMS failed', request.id, e?.message) }
            }
            if ((channel === 'email' || channel === 'both') && ct?.email) {
              try { await sendReviewEmail(ct.email, { contactName: ct.name || 'Valued Customer', companyName: comp.name || '', jobTitle: '', reviewLink: url }); sent = true }
              catch (e: any) { console.error('[Reviews] Email failed', request.id, e?.message) }
            }
            await db.update(t.reviewRequest).set(sent ? { status: 'sent', sentAt: new Date() } : { status: 'failed' }).where(eq(t.reviewRequest.id, request.id))
            results.push({ id: request.id, action: sent ? 'sent' : 'failed', ...(sent ? {} : { reason: 'no contact method or send failed' }) })
          } catch (err: any) {
            console.error('[Reviews] Failed to process request', request.id, err?.message)
            await db.update(t.reviewRequest).set({ status: 'failed' }).where(eq(t.reviewRequest.id, request.id))
            results.push({ id: request.id, action: 'failed', reason: err?.message })
          }
        }
        const followUpDays = Number(settings.reviewFollowUpDelay || 0)
        if (followUpDays > 0) {
          const followUpCutoff = new Date(Date.now() - followUpDays * 86400000)
          const needFollowUp = await db.select({ id: t.reviewRequest.id }).from(t.reviewRequest)
            .where(and(eq(t.reviewRequest.companyId, comp.id), eq(t.reviewRequest.status, 'sent'), isNull(t.reviewRequest.clickedAt), isNull(t.reviewRequest.followUpSentAt), lte(t.reviewRequest.sentAt, followUpCutoff))).limit(50)
          for (const { id } of needFollowUp) {
            try { await sendFollowUp(id); results.push({ id, action: 'follow_up' }) } catch (err: any) { console.error('[Reviews] Failed to send follow-up', id, err?.message) }
          }
        }
      } catch (err: any) { console.error('[Reviews] Error processing company', comp.id, err?.message) }
    }
    if (results.length) console.log(`[Reviews] Processed ${results.length} review requests`)
    return results
  }

  /**
   * Send this request now. A request still waiting gets the original message and becomes "sent"; one
   * already sent gets the reminder wording and is stamped as followed up.
   *
   * Returns null when there is nothing to act on, and THROWS a sentence the caller can act on when it
   * could not send. It used to stamp the record and answer {status:'follow_up_sent'} whatever happened —
   * both sends sit in try/catch that only logs, so no phone, no email, unconfigured Twilio or a failing
   * mail transport all reported success while nothing left the building. (Salon T28 H3)
   */
  async function sendFollowUp(requestId: string) {
    const [request] = await db.select().from(t.reviewRequest).where(eq(t.reviewRequest.id, requestId)).limit(1)
    if (!request || request.followUpSentAt || request.clickedAt) return null
    const [ct] = await db.select().from(t.contact).where(eq(t.contact.id, request.contactId)).limit(1)
    const [comp] = await db.select().from(t.company).where(eq(t.company.id, request.companyId)).limit(1)
    if (!ct || !comp) return null

    const settings = await getReviewSettings(request.companyId)
    // No link means the message would ask the client to review nothing.
    if (!(request.reviewLink || linkFor(settings))) throw new Error('Add your Google review link under Settings › Reviews first — the message would have nowhere to send the client.')

    // Nothing was ever sent, so there is nothing to follow UP on: send the request itself.
    const firstSend = request.status === 'pending'
    const channel = request.channel || settings.reviewChannel || 'both'
    const url = trackingUrl(request.id)
    const phone = ct.mobile || ct.phone
    const failures: string[] = []
    let sent = false

    if ((channel === 'sms' || channel === 'both') && phone) {
      try {
        await sendReviewSms(comp, phone, { contactName: firstName(ct.name), companyName: comp.name || '', reviewLink: url, template: firstSend ? (settings.reviewSmsTemplate || DEFAULT_SMS_TEMPLATE) : FOLLOW_UP_SMS_TEMPLATE })
        sent = true
      } catch (e: any) { console.error('[Reviews] SMS failed:', e?.message); failures.push('text message: ' + (e?.message || 'failed')) }
    }
    if ((channel === 'email' || channel === 'both') && ct.email) {
      try {
        await sendReviewEmail(ct.email, { contactName: ct.name || 'Valued Customer', companyName: comp.name || '', jobTitle: '', reviewLink: url })
        sent = true
      } catch (e: any) { console.error('[Reviews] Email failed:', e?.message); failures.push('email: ' + (e?.message || 'failed')) }
    }

    if (!sent) {
      const missing = channel === 'sms' ? 'a mobile number' : channel === 'email' ? 'an email address' : 'a mobile number or an email address'
      throw new Error(failures.length ? `Nothing was sent — ${failures.join('; ')}` : `Nothing was sent — ${ct.name || 'this client'} has no ${missing} on file.`)
    }

    await db.update(t.reviewRequest)
      .set(firstSend ? { status: 'sent', sentAt: new Date() } : { followUpSentAt: new Date() })
      .where(eq(t.reviewRequest.id, requestId))
    return { id: requestId, status: firstSend ? 'sent' : 'follow_up_sent' }
  }

  async function markReviewCompleted(requestId: string, { clicked }: { clicked?: boolean } = {}) {
    if (!clicked) return
    // first click wins; status only moves forward
    await db.update(t.reviewRequest).set({ clickedAt: sql`coalesce(${t.reviewRequest.clickedAt}, now())`, status: sql`case when ${t.reviewRequest.status} = 'completed' then 'completed' else 'clicked' end` }).where(eq(t.reviewRequest.id, requestId))
  }

  async function getReviewStats(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string } = {}) {
    const conditions: any[] = [eq(t.reviewRequest.companyId, companyId)]
    const sd = startDate ? new Date(startDate) : null, ed = endDate ? new Date(endDate) : null
    if (sd && !isNaN(sd.getTime())) conditions.push(gte(t.reviewRequest.createdAt, sd))
    if (ed && !isNaN(ed.getTime())) conditions.push(lte(t.reviewRequest.createdAt, ed))
    const where = and(...conditions)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const [rows] = await db.select({
      total: count(),
      sent: sql<number>`count(*) filter (where ${t.reviewRequest.status} = 'sent')`,
      clicked: sql<number>`count(*) filter (where ${t.reviewRequest.status} = 'clicked')`,
      completed: sql<number>`count(*) filter (where ${t.reviewRequest.status} = 'completed')`,
      pending: sql<number>`count(*) filter (where ${t.reviewRequest.status} = 'pending')`,
      failed: sql<number>`count(*) filter (where ${t.reviewRequest.status} = 'failed')`,
      thisMonth: sql<number>`count(*) filter (where ${t.reviewRequest.createdAt} >= ${monthStart})`,
    }).from(t.reviewRequest).where(where)
    const n = (v: any) => Number(v || 0)
    const clickedOrCompleted = n(rows.clicked) + n(rows.completed)
    const totalSent = n(rows.sent) + clickedOrCompleted
    return {
      total: n(rows.total), sent: n(rows.sent), clicked: n(rows.clicked), completed: n(rows.completed), pending: n(rows.pending), failed: n(rows.failed), thisMonth: n(rows.thisMonth),
      clickRate: totalSent > 0 ? ((clickedOrCompleted / totalSent) * 100).toFixed(1) : '0',
      conversionRate: n(rows.total) > 0 ? ((n(rows.completed) / n(rows.total)) * 100).toFixed(1) : '0',
    }
  }

  async function getReviewRequests(companyId: string, { status, limit = 50, page = 1 }: { status?: string; limit?: number; page?: number } = {}) {
    const conditions: any[] = [eq(t.reviewRequest.companyId, companyId)]
    if (status) conditions.push(eq(t.reviewRequest.status, status))
    const where = and(...conditions)
    const lim = Math.min(200, Math.max(1, limit)), pg = Math.max(1, page)
    const base = db.select({
      reviewRequest: t.reviewRequest,
      contact: { id: t.contact.id, name: t.contact.name, email: t.contact.email, phone: t.contact.phone },
      ...(t.job ? { job: { id: t.job.id, title: t.job.title } } : {}),
    }).from(t.reviewRequest).leftJoin(t.contact, eq(t.reviewRequest.contactId, t.contact.id))
    const q = t.job ? base.leftJoin(t.job, eq(t.reviewRequest.jobId, t.job.id)) : base
    const [data, [{ value: total }]] = await Promise.all([
      q.where(where).orderBy(sql`${t.reviewRequest.createdAt} DESC`).offset((pg - 1) * lim).limit(lim),
      db.select({ value: count() }).from(t.reviewRequest).where(where),
    ])
    let rows = data.map((d: any) => ({ ...d.reviewRequest, contact: d.contact, job: d.job || null }))
    // What the request was ABOUT, in this vertical's terms. The list renders job.title, and a salon
    // request has no job — it comes from a visit — so the column was blank on every row. A vertical that
    // has something better to say supplies it here; one call for the page, not one per row. (T30 L2)
    if (deps.options?.subjectFor) {
      try { rows = await deps.options.subjectFor(rows) } catch (e: any) { console.error('[Reviews] subjectFor failed:', e?.message) }
    }
    return { data: rows, pagination: { page: pg, limit: lim, total: Number(total), pages: Math.ceil(Number(total) / lim) } }
  }

  // Every five minutes, not every hour. Two indexed queries per company: hourly bought nothing and cost
  // the feature — a restart (and every deploy is one) put the clock back to zero, so on a tenant that is
  // deployed more often than hourly the tick could never arrive. (Salon T29 H1)
  const PROCESS_EVERY_MS = 5 * 60 * 1000
  let processor: any = null
  function startReviewProcessor() {
    if (processor) return
    console.log('[Reviews] Starting review processor (every 5 minutes)')
    processor = setInterval(() => { processScheduledRequests().catch((err: any) => console.error('[Reviews] Processor error:', err?.message)) }, PROCESS_EVERY_MS)
    setTimeout(() => { processScheduledRequests().catch((err: any) => console.error('[Reviews] Initial run error:', err?.message)) }, 30_000)
  }

  return {
    generateGoogleReviewLink, getReviewSettings, updateReviewSettings, scheduleReviewRequest, scheduleReviewRequestForVisit, sendReviewRequest,
    processScheduledRequests, sendFollowUp, markReviewCompleted, getReviewStats, getReviewRequests, startReviewProcessor,
  }
}
export type ReviewsService = ReturnType<typeof createReviewsService>

export interface ReviewsRoutesDeps {
  service: ReviewsService
  db: any
  tables: { reviewRequest: any }
  authenticate: any
  /**
   * Asking a customer for a public review is marketing done in the company's name, so the three
   * routes that do it are marketing:create — manager and above, the same three roles
   * requireRole('manager') names, with the difference that an owner can hand review-chasing to one
   * person without promoting them. Settings and the scheduled sweep keep their admin rank, which is
   * what the server asks of company configuration everywhere else. (T30 debt)
   */
  requirePermission: (permission: string) => any
  requireRole: (...roles: string[]) => any
  audit?: { log: (input: any) => any }
  /**
   * The template's enabled-feature gate, applied to the AUTHENTICATED endpoints only. This family cannot be
   * gated at the mount — the customer's review link is public — so it gates itself, exactly as call tracking
   * and the AI receptionist do. Optional: the two templates outside the shared gate (roof, store) pass nothing.
   */
  requireEnabledFeature?: (feature: string | string[]) => any
  /** Feature this module is sold under; every vertical that offers it gates /crm/reviews on the same id. */
  feature?: string
}

export function createReviewsRoutes(deps: ReviewsRoutesDeps) {
  const { service: reviews, db, tables: t, authenticate, requireRole, requirePermission } = deps
  const audit = deps.audit || { log: () => {} }
  const app = new Hono()

  // ── Public: the link in the customer's text/email. Registered BEFORE authenticate.
  app.get('/track/:requestId/click', async (c) => {
    const requestId = c.req.param('requestId')
    const [request] = await db.select().from(t.reviewRequest).where(eq(t.reviewRequest.id, requestId)).limit(1)
    if (!request) return c.text('Review link not found', 404)
    await reviews.markReviewCompleted(requestId, { clicked: true })
    if (request.reviewLink) return c.redirect(request.reviewLink)
    const settings = await reviews.getReviewSettings(request.companyId)
    if (settings.reviewLink) return c.redirect(settings.reviewLink)
    return c.text('Review link not found', 404)
  })

  app.use('*', authenticate)
  // Switched off means switched off at the API, not just hidden in the menu: every vertical that offers this
  // module gates /crm/reviews on the same feature, but the routes answered with settings, stats and the request
  // list regardless. The gate sits AFTER authenticate and after the public tracking link above, so a customer
  // clicking through still lands on the review page. (Contractor T29 N1)
  if (deps.requireEnabledFeature) app.use('*', deps.requireEnabledFeature(deps.feature || 'google_reviews'))
  const user = (c: any) => c.get('user') as any

  app.get('/settings', async (c) => c.json(await reviews.getReviewSettings(user(c).companyId)))
  app.put('/settings', requireRole('admin', 'owner'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const settings = await reviews.updateReviewSettings(user(c).companyId, body)
      audit.log({ action: 'REVIEW_SETTINGS_UPDATED', entity: 'company', entityId: user(c).companyId, req: c.req })
      return c.json(settings)
    } catch (e: any) { return c.json({ error: e?.message || 'Invalid settings' }, 400) }
  })
  app.get('/stats', async (c) => c.json(await reviews.getReviewStats(user(c).companyId, { startDate: c.req.query('startDate'), endDate: c.req.query('endDate') })))
  const list = async (c: any) => c.json(await reviews.getReviewRequests(user(c).companyId, { status: c.req.query('status') || undefined, limit: parseInt(c.req.query('limit') || '50') || 50, page: parseInt(c.req.query('page') || '1') || 1 }))
  app.get('/', list)
  app.get('/requests', list)

  app.post('/request/:jobId', requirePermission('marketing:create'), async (c) => {
    const jobId = c.req.param('jobId')
    const { channel = 'both' } = await c.req.json().catch(() => ({}))
    if (!['sms', 'email', 'both'].includes(channel)) return c.json({ error: 'channel must be sms, email or both' }, 400)
    let result
    try { result = await reviews.sendReviewRequest(jobId, { channel }) }
    catch (e: any) {
      const msg = e?.message || 'Failed to send review request'
      // Missing Google link / unconfigured SMS are setup problems the caller can act on — 400 (404 for a missing job).
      return c.json({ error: msg }, /not found/i.test(msg) ? 404 : 400)
    }
    audit.log({ action: 'REVIEW_REQUEST_SENT', entity: 'job', entityId: jobId, metadata: { channel }, req: c.req })
    return c.json(result)
  })
  app.post('/schedule/:jobId', requirePermission('marketing:create'), async (c) => {
    const request = await reviews.scheduleReviewRequest(c.req.param('jobId'))
    return request ? c.json(request) : c.json({ error: 'Could not schedule review request — review requests are off, the job has no contact, or one is already scheduled.' }, 400)
  })
  app.post('/follow-up/:requestId', requirePermission('marketing:create'), async (c) => {
    // A thrown error here is a setup or contact-details problem the caller can fix, so it is answered
    // rather than swallowed — this endpoint used to return success no matter what. (Salon T28 H3)
    let result
    try { result = await reviews.sendFollowUp(c.req.param('requestId')) }
    catch (e: any) { return c.json({ error: e?.message || 'Could not send the review request' }, 400) }
    return result ? c.json(result) : c.json({ error: 'Nothing to send — the request was already followed up, already clicked, or does not exist.' }, 400)
  })
  app.post('/process-scheduled', requireRole('admin', 'owner'), async (c) => {
    const results = await reviews.processScheduledRequests()
    return c.json({ processed: results.length, results })
  })
  app.get('/preview-link', async (c) => {
    const placeId = c.req.query('placeId')
    return placeId ? c.json({ link: generateGoogleReviewLink(placeId) }) : c.json({ error: 'placeId is required' }, 400)
  })

  return app
}
