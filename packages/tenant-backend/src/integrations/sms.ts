// Two-way SMS — ONE implementation for every CRM (vendored into each template as ../shared).
// Sending (with the tenant's usage wallet gate + metering), conversations, templates, auto-responders,
// bulk sends, job status texts, and the Twilio webhooks with REAL signature validation and form-body parsing.
//
// Before: four service versions (crm lacked the wallet metering and the per-contact conversation filter;
// fieldservice/landscaping lacked the Twilio signature check entirely, crm's was a stub that returned true),
// and every version parsed Twilio's form-encoded webhook with c.req.json() → the text was dropped with a 200.
import { Hono } from 'hono'
import { eq, and, or, ilike, desc, asc, count, sum, sql, gt } from 'drizzle-orm'
import { formatPhoneE164, parseTwilioBody, verifyTwilioRequest, twilioClient, twilioConfigFromEnv, twilioConfigFor, companyTwilioNumbers, twilioSender, TWIML_EMPTY, type TwilioConfig } from './twilio'

export interface SmsTables { smsConversation: any; smsMessage: any; smsTemplate: any; contact: any; company: any; job: any; user: any }
export interface SmsUsage { reportSmsUsage: (segments: number, twilioSid?: string) => void; walletSufficient: () => Promise<boolean> }
export interface SmsServiceDeps {
  db: any
  tables: SmsTables
  /** Wallet gate + metering (shared integrations/messagingUsage). Optional: without it sends are ungated/unmetered. */
  usage?: SmsUsage
  /** Twilio credentials; default = TWILIO_* env. */
  twilio?: TwilioConfig
  /** Public API origin for status callbacks; default API_BASE_URL. */
  apiBaseUrl?: string
  /** Where the customer-facing review link in the "completed" text points; default CUSTOMER_PORTAL_URL. */
  portalUrl?: string
}

export function createSmsService(deps: SmsServiceDeps) {
  const { db, tables: t } = deps
  const usage: SmsUsage = deps.usage || { reportSmsUsage: () => {}, walletSufficient: async () => true }
  /** The account this company texts from: its own (Settings → Integrations) or the platform's (env). */
  const cfgFor = async (companyId: string): Promise<TwilioConfig> => {
    if (deps.twilio) return deps.twilio
    const [row] = await db.select().from(t.company).where(eq(t.company.id, companyId)).limit(1)
    return twilioConfigFor(row)
  }
  /** The company a Twilio number belongs to (column or Settings → Integrations value). */
  async function findCompanyByTwilioNumber(number: string | undefined) {
    if (!number) return null
    const e164 = formatPhoneE164(number)
    const [row] = await db.select().from(t.company).where(or(
      eq(t.company.twilioPhoneNumber, number), eq(t.company.twilioPhoneNumber, e164),
      sql`${t.company.integrations}->>'twilioPhoneNumber' in (${number}, ${e164})`,
    )).limit(1)
    return row || null
  }
  /** Which auth token must have signed a webhook for these params (the receiving company's own, else the platform's). */
  async function webhookAuthToken(params: Record<string, string>): Promise<string | undefined> {
    const ours = [params.To, params.From].filter(Boolean)
    for (const n of ours) { const row = await findCompanyByTwilioNumber(n); if (row) { const c = twilioConfigFor(row); if (c.authToken) return c.authToken } }
    return (deps.twilio || twilioConfigFromEnv()).authToken
  }

  async function sendSMS(companyId: string, { contactId, toPhone, message, userId, jobId }: { contactId?: string; toPhone?: string; message: string; userId?: string; jobId?: string; templateId?: string }) {
    const cfg = async () => cfgFor(companyId)
    if (!toPhone && contactId) {
      const [contactRow] = await db.select().from(t.contact).where(eq(t.contact.id, contactId))
      if (!contactRow?.phone && !contactRow?.mobile) throw new Error('Contact has no phone number')
      if ((contactRow as any).optedOutSms) return null as any
      toPhone = contactRow.mobile || contactRow.phone
    }
    if (!toPhone) throw new Error('Phone number required')
    const formattedPhone = formatPhoneE164(toPhone)

    let [conversation] = await db.select().from(t.smsConversation)
      .where(and(eq(t.smsConversation.companyId, companyId), eq(t.smsConversation.phoneNumber, formattedPhone)))
    if (!conversation) {
      ;[conversation] = await db.insert(t.smsConversation).values({ companyId, phoneNumber: formattedPhone, contactId: contactId || null, status: 'active' }).returning()
    }

    let twilioResponse: any
    let status = 'sent'
    let errorMessage: string | null = null
    try {
      if (!(await usage.walletSufficient())) throw new Error('Messaging paused: usage wallet is empty — top up to resume.')
      const conf = await cfg()
      const client = await twilioClient(conf)
      twilioResponse = await client.messages.create({
        body: message,
        to: formattedPhone,
        ...twilioSender(conf),
        statusCallback: `${deps.apiBaseUrl || process.env.API_BASE_URL || ''}/api/sms/webhook/status`,
      })
    } catch (error: any) {
      status = 'failed'
      errorMessage = error?.message || 'Send failed'
      console.error('Twilio send error:', errorMessage)
    }
    if (twilioResponse) usage.reportSmsUsage(Number(twilioResponse.numSegments) || 1, twilioResponse.sid)

    const [smsMsg] = await db.insert(t.smsMessage).values({
      conversationId: conversation.id, direction: 'outbound', body: message, status, errorMessage,
      twilioSid: twilioResponse?.sid, sentById: userId || null,
    }).returning()
    await db.update(t.smsConversation).set({ lastMessageAt: new Date() }).where(eq(t.smsConversation.id, conversation.id))
    return smsMsg
  }

  /** Twilio inbound webhook. Finds the company by the number texted, threads the message, runs auto-responders. */
  async function handleIncomingSMS(data: { From: string; Body: string; MessageSid: string; To: string }) {
    const { From, Body, MessageSid, To } = data
    if (!From || !To) return null
    const comp = await findCompanyByTwilioNumber(To)
    if (!comp) { console.error('No company found for Twilio number:', To); return null }
    const formattedPhone = formatPhoneE164(From)

    let [conversation] = await db.select().from(t.smsConversation)
      .where(and(eq(t.smsConversation.companyId, comp.id), eq(t.smsConversation.phoneNumber, formattedPhone)))
    const [contactRow] = await db.select().from(t.contact)
      .where(and(eq(t.contact.companyId, comp.id), or(eq(t.contact.phone, formattedPhone), eq(t.contact.phone, From), ilike(t.contact.phone, `%${formattedPhone.slice(-10)}%`), ilike(t.contact.mobile, `%${formattedPhone.slice(-10)}%`))))
      .limit(1)
    if (!conversation) {
      ;[conversation] = await db.insert(t.smsConversation).values({ companyId: comp.id, phoneNumber: formattedPhone, contactId: contactRow?.id || null, status: 'active' }).returning()
    }
    // Twilio retries a webhook it did not get a 200 for — the same SID must not thread twice.
    if (MessageSid) {
      const [dupe] = await db.select({ id: t.smsMessage.id }).from(t.smsMessage).where(eq(t.smsMessage.twilioSid, MessageSid)).limit(1)
      if (dupe) return dupe
    }
    const [msg] = await db.insert(t.smsMessage).values({ conversationId: conversation.id, direction: 'inbound', body: Body || '', status: 'received', twilioSid: MessageSid || null }).returning()
    await db.update(t.smsConversation).set({
      lastMessageAt: new Date(), unreadCount: sql`${t.smsConversation.unreadCount} + 1`, status: 'active',
      contactId: contactRow?.id || conversation.contactId,
    }).where(eq(t.smsConversation.id, conversation.id))
    await processAutoResponders(comp.id, conversation, Body || '')
    return msg
  }

  async function handleStatusUpdate(data: { MessageSid: string; MessageStatus: string; ErrorCode?: string; ErrorMessage?: string }) {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = data
    if (!MessageSid || !MessageStatus) return
    const patch: Record<string, any> = { status: MessageStatus, errorMessage: ErrorMessage || null, errorCode: ErrorCode || null }
    if (MessageStatus === 'delivered') patch.deliveredAt = new Date()
    if (MessageStatus === 'sent') patch.sentAt = new Date()
    await db.update(t.smsMessage).set(patch).where(eq(t.smsMessage.twilioSid, MessageSid))
  }

  async function getConversations(companyId: string, { status = 'active', unreadOnly = false, contactId, page = 1, limit = 50 }: { status?: string; unreadOnly?: boolean; search?: string; contactId?: string; page?: number; limit?: number } = {}) {
    const conditions: any[] = [eq(t.smsConversation.companyId, companyId)]
    if (status) conditions.push(eq(t.smsConversation.status, status))
    if (unreadOnly) conditions.push(gt(t.smsConversation.unreadCount, 0))
    // Scope to one contact when asked — the contact Messages panel used to show the company's first conversation for EVERY contact.
    if (contactId) conditions.push(eq(t.smsConversation.contactId, contactId))
    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select({ conversation: t.smsConversation, contact: { id: t.contact.id, name: t.contact.name, email: t.contact.email } })
        .from(t.smsConversation).leftJoin(t.contact, eq(t.smsConversation.contactId, t.contact.id))
        .where(where).orderBy(desc(t.smsConversation.lastMessageAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.smsConversation).where(where),
    ])
    return { data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } }
  }

  async function getConversation(conversationId: string, companyId: string) {
    const [conversation] = await db.select().from(t.smsConversation)
      .where(and(eq(t.smsConversation.id, conversationId), eq(t.smsConversation.companyId, companyId)))
    if (!conversation) return null
    let contactRow = null
    if (conversation.contactId) [contactRow] = await db.select().from(t.contact).where(eq(t.contact.id, conversation.contactId))
    const messages = await db.select({ message: t.smsMessage, sentBy: { firstName: t.user.firstName, lastName: t.user.lastName } })
      .from(t.smsMessage).leftJoin(t.user, eq(t.smsMessage.sentById, t.user.id))
      .where(eq(t.smsMessage.conversationId, conversationId)).orderBy(asc(t.smsMessage.createdAt)).limit(100)
    await db.update(t.smsConversation).set({ unreadCount: 0 }).where(eq(t.smsConversation.id, conversationId))
    // Flat rows: every inbox renders message.direction / message.body directly. (SALON-C3)
    return { ...conversation, contact: contactRow, messages: messages.map((r: any) => ({ ...r.message, sentBy: r.sentBy })) }
  }

  const archiveConversation = (conversationId: string, companyId: string) =>
    db.update(t.smsConversation).set({ status: 'archived' }).where(and(eq(t.smsConversation.id, conversationId), eq(t.smsConversation.companyId, companyId)))
  const linkToContact = (conversationId: string, companyId: string, contactId: string) =>
    db.update(t.smsConversation).set({ contactId }).where(and(eq(t.smsConversation.id, conversationId), eq(t.smsConversation.companyId, companyId)))

  async function createTemplate(companyId: string, data: { name: string; message: string; category?: string }) {
    const [row] = await db.insert(t.smsTemplate).values({ companyId, name: data.name, body: data.message, category: data.category || null, active: true }).returning()
    return row
  }
  function getTemplates(companyId: string, { category }: { category?: string } = {}) {
    const conditions: any[] = [eq(t.smsTemplate.companyId, companyId), eq(t.smsTemplate.active, true)]
    if (category) conditions.push(eq(t.smsTemplate.category, category))
    return db.select().from(t.smsTemplate).where(and(...conditions)).orderBy(asc(t.smsTemplate.name))
  }
  function updateTemplate(templateId: string, companyId: string, data: any) {
    const updateData: any = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.message !== undefined) updateData.body = data.message
    if (data.category !== undefined) updateData.category = data.category
    return db.update(t.smsTemplate).set(updateData).where(and(eq(t.smsTemplate.id, templateId), eq(t.smsTemplate.companyId, companyId)))
  }
  const deleteTemplate = (templateId: string, companyId: string) =>
    db.update(t.smsTemplate).set({ active: false }).where(and(eq(t.smsTemplate.id, templateId), eq(t.smsTemplate.companyId, companyId)))

  function applyTemplateVariables(template: string, variables: Record<string, string>): string {
    const replacements: Record<string, string> = {
      '{{customer_name}}': variables.customerName || '', '{{first_name}}': variables.firstName || '', '{{company_name}}': variables.companyName || '',
      '{{job_title}}': variables.jobTitle || '', '{{job_date}}': variables.jobDate || '', '{{job_time}}': variables.jobTime || '',
      '{{tech_name}}': variables.techName || '', '{{amount}}': variables.amount || '', '{{link}}': variables.link || '',
    }
    let message = template
    for (const [key, value] of Object.entries(replacements)) message = message.split(key).join(value)
    return message
  }

  // Auto-responders live in sms_auto_responder, a raw-SQL table (not in the Drizzle schema) — kept as it was.
  async function processAutoResponders(companyId: string, conversation: any, message: string) {
    let responders: any[] = []
    try { responders = (await db.execute(sql`SELECT * FROM sms_auto_responder WHERE company_id = ${companyId} AND active = true`)) as any[] } catch { return }
    const rows = Array.isArray(responders) ? responders : ((responders as any).rows || [])
    for (const responder of rows) {
      let shouldRespond = false
      switch (responder.trigger) {
        case 'keyword': {
          const keywords = responder.keywords || []
          const lower = message.toLowerCase()
          shouldRespond = keywords.some((kw: string) => lower.includes(String(kw).toLowerCase()))
          break
        }
        case 'new_conversation': {
          const [msgCount] = await db.select({ value: count() }).from(t.smsMessage).where(eq(t.smsMessage.conversationId, conversation.id))
          shouldRespond = Number(msgCount.value) <= 1
          break
        }
        case 'after_hours': shouldRespond = isAfterHours(); break
      }
      if (responder.after_hours_only && !isAfterHours()) shouldRespond = false
      if (shouldRespond) {
        setTimeout(() => { sendSMS(companyId, { toPhone: conversation.phoneNumber, message: responder.message }).catch(() => {}) }, 2000)
        break
      }
    }
  }
  async function createAutoResponder(companyId: string, data: any) {
    const res = (await db.execute(sql`
      INSERT INTO sms_auto_responder (company_id, name, trigger, keywords, message, after_hours_only, active)
      VALUES (${companyId}, ${data.name}, ${data.trigger}, ${JSON.stringify(data.keywords || [])}, ${data.message}, ${data.afterHoursOnly || false}, true)
      RETURNING *`)) as any
    const rows = Array.isArray(res) ? res : (res.rows || [])
    return rows[0]
  }
  async function getAutoResponders(companyId: string) {
    const res = (await db.execute(sql`SELECT * FROM sms_auto_responder WHERE company_id = ${companyId} ORDER BY name ASC`)) as any
    return Array.isArray(res) ? res : (res.rows || [])
  }
  function isAfterHours(): boolean {
    const now = new Date(), hour = now.getHours(), day = now.getDay()
    return day === 0 || day === 6 || hour < 8 || hour >= 18
  }

  async function sendBulkSMS(companyId: string, { contactIds, message, templateId, userId }: { contactIds: string[]; message: string; templateId?: string; userId?: string }) {
    const results = { sent: 0, failed: 0, errors: [] as any[] }
    for (const contactId of contactIds) {
      try {
        // sendSMS never throws for a carrier/wallet failure — it returns the row with status "failed". Only a real send counts. (SALON-C4)
        const row: any = await sendSMS(companyId, { contactId, message, templateId, userId })
        if (!row) { results.failed++; results.errors.push({ contactId, error: 'Opted out or no phone' }) }
        else if (row.status === 'failed') { results.failed++; results.errors.push({ contactId, error: row.errorMessage || 'Send failed' }) }
        else results.sent++
      } catch (error: any) { results.failed++; results.errors.push({ contactId, error: error.message }) }
      await new Promise((r) => setTimeout(r, 100))
    }
    return results
  }

  async function sendJobUpdate(companyId: string, jobId: string, updateType: string) {
    const [jobRow] = await db.select().from(t.job).where(and(eq(t.job.id, jobId), eq(t.job.companyId, companyId)))
    if (!jobRow?.contactId) return null
    const [contactRow] = await db.select().from(t.contact).where(eq(t.contact.id, jobRow.contactId))
    if (!contactRow || (!contactRow.phone && !contactRow.mobile)) return null
    if ((contactRow as any).optedOutSms) return null
    const [companyRow] = await db.select().from(t.company).where(eq(t.company.id, companyId))
    let techName = 'Your technician'
    if (jobRow.assignedToId) {
      const [assignedUser] = await db.select({ firstName: t.user.firstName }).from(t.user).where(eq(t.user.id, jobRow.assignedToId))
      if (assignedUser) techName = assignedUser.firstName
    }
    const templates: Record<string, string> = {
      scheduled: `Hi {{first_name}}, your appointment with {{company_name}} is confirmed for {{job_date}} at {{job_time}}. Reply CONFIRM to confirm or RESCHEDULE to change.`,
      on_way: `Good news! {{tech_name}} from {{company_name}} is on the way and should arrive in approximately 15-20 minutes.`,
      on_my_way: `Good news! {{tech_name}} from {{company_name}} is on the way and should arrive in approximately 15-20 minutes.`,
      started: `{{tech_name}} has arrived and started work on your {{job_title}}. We'll notify you when complete.`,
      on_site: `{{tech_name}} has arrived and started work on your {{job_title}}. We'll notify you when complete.`,
      completed: `Your service is complete! Thank you for choosing {{company_name}}. We'd love your feedback: {{link}}`,
      reminder: `Reminder: Your appointment with {{company_name}} is tomorrow at {{job_time}}. Reply CONFIRM or RESCHEDULE.`,
    }
    const template = templates[updateType]
    if (!template) return null
    const msg = applyTemplateVariables(template, {
      firstName: String(contactRow.name || '').split(' ')[0] || 'there',
      companyName: companyRow?.name || '',
      jobTitle: jobRow.title || '',
      jobDate: jobRow.scheduledDate ? new Date(jobRow.scheduledDate).toLocaleDateString() : '',
      jobTime: jobRow.scheduledDate ? new Date(jobRow.scheduledDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
      techName,
      link: `${deps.portalUrl || process.env.CUSTOMER_PORTAL_URL || ''}/review/${jobRow.id}`,
    })
    return sendSMS(companyId, { contactId: contactRow.id, message: msg, jobId })
  }

  async function getUnreadCount(companyId: string): Promise<number> {
    const [result] = await db.select({ total: sum(t.smsConversation.unreadCount) }).from(t.smsConversation)
      .where(and(eq(t.smsConversation.companyId, companyId), eq(t.smsConversation.status, 'active')))
    return Number(result?.total || 0)
  }

  return {
    sendSMS, handleIncomingSMS, handleStatusUpdate, getConversations, getConversation, archiveConversation, linkToContact,
    createTemplate, getTemplates, updateTemplate, deleteTemplate, applyTemplateVariables, createAutoResponder, getAutoResponders,
    sendBulkSMS, sendJobUpdate, getUnreadCount, findCompanyByTwilioNumber, webhookAuthToken, twilioConfigFor: cfgFor,
  }
}
export type SmsService = ReturnType<typeof createSmsService>

export interface SmsRoutesDeps {
  service: SmsService
  authenticate: any
  requirePermission: (permission: string) => any
  requireAdmin: any
  /** Auth token used to validate Twilio webhooks; default TWILIO_AUTH_TOKEN. */
  twilioAuthToken?: string
  tables?: { company?: any }
  db?: any
}

export function createSmsRoutes(deps: SmsRoutesDeps) {
  const { service: sms, authenticate, requirePermission, requireAdmin } = deps
  const app = new Hono()
  const twiml = (c: any, status = 200) => c.text(TWIML_EMPTY, status, { 'Content-Type': 'text/xml' })

  // ── Webhooks (Twilio, no session) — signature-checked, form-encoded
  // The signing token is the receiving company's own Twilio auth token when it configured one, else the platform's.
  const tokenFor = async (params: Record<string, string>) => deps.twilioAuthToken || (await sms.webhookAuthToken(params))
  app.post('/webhook/incoming', async (c) => {
    const params = await parseTwilioBody(c)
    const v = verifyTwilioRequest(c, params, await tokenFor(params))
    if (!v.ok) { console.warn('[sms] rejected inbound webhook:', v.reason); return twiml(c, 403) }
    try { await sms.handleIncomingSMS(params as any) } catch (error: any) { console.error('SMS webhook error:', error?.message) }
    return twiml(c, 200)
  })
  app.post('/webhook/status', async (c) => {
    const params = await parseTwilioBody(c)
    const v = verifyTwilioRequest(c, params, await tokenFor(params))
    if (!v.ok) { console.warn('[sms] rejected status webhook:', v.reason); return c.body(null, 403) }
    try { await sms.handleStatusUpdate(params as any) } catch (error: any) { console.error('SMS status webhook error:', error?.message) }
    return c.body(null, 200)
  })

  app.use('*', authenticate)

  app.get('/conversations', async (c) => {
    const user = (c as any).get('user')
    const q = c.req.query()
    return c.json(await sms.getConversations(user.companyId, {
      status: q.status, unreadOnly: q.unreadOnly === 'true', search: q.search, contactId: q.contactId || undefined,
      page: parseInt(q.page || '1') || 1, limit: Math.min(200, parseInt(q.limit || '50') || 50),
    }))
  })
  app.get('/unread-count', async (c) => c.json({ count: await sms.getUnreadCount(((c as any).get('user')).companyId) }))
  app.get('/conversations/:id', async (c) => {
    const conversation = await sms.getConversation(c.req.param('id'), ((c as any).get('user')).companyId)
    return conversation ? c.json(conversation) : c.json({ error: 'Conversation not found' }, 404)
  })
  app.post('/conversations/:id/archive', async (c) => { await sms.archiveConversation(c.req.param('id'), ((c as any).get('user')).companyId); return c.json({ success: true }) })
  app.post('/conversations/:id/link', async (c) => {
    const { contactId } = await c.req.json().catch(() => ({}))
    if (!contactId) return c.json({ error: 'contactId is required' }, 400)
    await sms.linkToContact(c.req.param('id'), ((c as any).get('user')).companyId, contactId)
    return c.json({ success: true })
  })

  const sendResult = (c: any, result: any) => {
    if (result === null) return c.json({ error: 'That contact has opted out of texts or has no phone number.' }, 400)
    // A wallet/carrier failure is saved as a failed message; tell the caller instead of returning 200. (SALON-C4)
    if (result?.status === 'failed') return c.json({ error: result.errorMessage || 'Text could not be sent', message: result }, 502)
    return c.json(result)
  }
  app.post('/send', async (c) => {
    const user = (c as any).get('user')
    const { contactId, toPhone, message, jobId, templateId } = await c.req.json().catch(() => ({}))
    if (!message) return c.json({ error: 'Message is required' }, 400)
    if (!contactId && !toPhone) return c.json({ error: 'contactId or toPhone is required' }, 400)
    try { return sendResult(c, await sms.sendSMS(user.companyId, { contactId, toPhone, message, userId: user.userId, jobId, templateId })) }
    catch (e: any) { return c.json({ error: e?.message || 'Text could not be sent' }, 400) }
  })
  app.post('/conversations/:id/reply', async (c) => {
    const user = (c as any).get('user')
    const { message } = await c.req.json().catch(() => ({}))
    if (!message) return c.json({ error: 'Message is required' }, 400)
    const conversation = await sms.getConversation(c.req.param('id'), user.companyId)
    if (!conversation) return c.json({ error: 'Conversation not found' }, 404)
    // the thread's number is the destination — replying to an unlinked conversation used to read a field that did not exist
    try { return sendResult(c, await sms.sendSMS(user.companyId, { toPhone: conversation.phoneNumber, contactId: conversation.contactId || undefined, message, userId: user.userId })) }
    catch (e: any) { return c.json({ error: e?.message || 'Text could not be sent' }, 400) }
  })
  app.post('/bulk', requirePermission('contacts:update'), async (c) => {
    const user = (c as any).get('user')
    const { contactIds, message, templateId } = await c.req.json().catch(() => ({}))
    if (!contactIds?.length) return c.json({ error: 'contactIds array is required' }, 400)
    if (!message) return c.json({ error: 'Message is required' }, 400)
    return c.json(await sms.sendBulkSMS(user.companyId, { contactIds, message, templateId, userId: user.userId }))
  })
  app.post('/job-update/:jobId', async (c) => {
    const user = (c as any).get('user')
    const { updateType } = await c.req.json().catch(() => ({}))
    if (!['scheduled', 'on_way', 'on_my_way', 'started', 'on_site', 'completed', 'reminder'].includes(updateType)) return c.json({ error: 'Invalid updateType' }, 400)
    const result = await sms.sendJobUpdate(user.companyId, c.req.param('jobId'), updateType)
    return c.json(result || { sent: false, reason: 'No phone number' })
  })
  /** Settings → Integrations "send a test text" (admin). */
  app.post('/test', requireAdmin, async (c) => {
    const user = (c as any).get('user')
    const { to } = await c.req.json().catch(() => ({}))
    if (!to || String(to).replace(/\D/g, '').length < 7) return c.json({ error: 'Enter a valid phone number' }, 400)
    try { return sendResult(c, await sms.sendSMS(user.companyId, { toPhone: String(to), message: 'Test message from your CRM — texting is set up correctly.', userId: user.userId })) }
    catch (e: any) { return c.json({ error: e?.message || 'Text could not be sent' }, 400) }
  })

  app.get('/templates', async (c) => c.json(await sms.getTemplates(((c as any).get('user')).companyId, { category: c.req.query('category') })))
  app.post('/templates', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    if (!body?.name || !body?.message) return c.json({ error: 'name and message are required' }, 400)
    return c.json(await sms.createTemplate(((c as any).get('user')).companyId, body), 201)
  })
  app.put('/templates/:id', async (c) => { await sms.updateTemplate(c.req.param('id'), ((c as any).get('user')).companyId, await c.req.json().catch(() => ({}))); return c.json({ success: true }) })
  app.delete('/templates/:id', async (c) => { await sms.deleteTemplate(c.req.param('id'), ((c as any).get('user')).companyId); return c.json({ success: true }) })

  app.get('/auto-responders', async (c) => c.json(await sms.getAutoResponders(((c as any).get('user')).companyId)))
  app.post('/auto-responders', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    if (!body?.name || !body?.trigger || !body?.message) return c.json({ error: 'name, trigger and message are required' }, 400)
    return c.json(await sms.createAutoResponder(((c as any).get('user')).companyId, body), 201)
  })

  return app
}
