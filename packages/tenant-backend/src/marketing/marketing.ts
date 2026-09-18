// Email marketing — templates, campaigns (audience preview, send, schedule, per-recipient tracking, unsubscribe) and
// drip sequences (manual enrolment, 15-minute worker) — ONE implementation for every CRM that offers email_marketing
// or follow_up_sequences (vendored into each template as ../shared). The template injects its tables + mail sender.
//
// Before: the service (880 lines, raw SQL) and the routes were copied into all seven templates; vet's copy differed by
// an aliasing quirk. No role could touch marketing except the owner: the routes asked for `marketing:*` permissions
// that no role in the matrix had. Every validation failure was a 500 (thrown Error → generic handler); nothing could
// delete a template or a sequence; the campaign list never carried counts the page could read.
//
// Tables used through the injected Drizzle objects: campaign, contact, emailLog. Through raw SQL (identical on all
// seven schemas): email_template, email_recipient, email_click, drip_sequence, sequence_enrollment.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, desc, count, sql, gte, ilike, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

export interface MarketingTables { campaign: any; contact: any; emailLog: any }
export interface MailMessage { to: string; subject: string; html: string; fromName?: string; fromEmail?: string }
export interface MarketingServiceDeps {
  db: any
  tables: MarketingTables
  /** The template's provider-agnostic sender (services/email.ts sendRaw). */
  sendRaw: (m: MailMessage) => Promise<any>
  /** process.env by default: API_BASE_URL / FRONTEND_URL for pixel, click and unsubscribe links. */
  env?: Record<string, string | undefined>
  /**
   * The tenant's Settings › Features switch. When given, the processor does not send a campaign or a
   * drip whose company has switched Email Marketing off since it was scheduled. (T15 M5)
   */
  isFeatureEnabled?: (companyId: string, featureId: string) => Promise<boolean>
  /**
   * Optional: whether a company's drips may send, for a template whose drips are also another product (RV Follow-Up
   * sends drips on email_marketing OR follow_up_sequences, while campaigns need email_marketing). Without it, drips use
   * isFeatureEnabled(companyId, 'email_marketing'). (RV T19 M6)
   */
  sequencesEnabled?: (companyId: string) => Promise<boolean>
}
export interface MarketingRoutesDeps {
  service: MarketingService
  authenticate: any
  requirePermission: (permission: string) => any
  escapeHtml: (v: unknown) => string
  /**
   * requireEnabledFeature('email_marketing') from the template's enabled-feature gate. Applied to every
   * authenticated route; the public tracking / unsubscribe links are exempt. (T15 M5)
   */
  featureGate?: any
  /**
   * Optional extra gate for the email-campaign parts only (/campaigns, /templates, /audience), for a template whose
   * page is also another product: RV opens the module on email_marketing OR follow_up_sequences but campaigns and
   * templates need email_marketing. (RV T19 M6)
   */
  campaignsGate?: any
}

export class MarketingError extends Error { constructor(message: string, public status: number) { super(message) } }
export const SEQUENCE_TRIGGERS = ['manual', 'new_customer', 'quote_sent', 'invoice_paid'] as const
export const AUDIENCE_TYPES = ['all', 'segment', 'contacts'] as const
const rows = (r: any): any[] => (r?.rows ?? (Array.isArray(r) ? r : [])) as any[]
const first = (r: any): any => rows(r)[0] ?? null
const round1 = (n: number) => Math.round(n * 10) / 10

/** Steps are stored as json; tolerate a string column too. */
function parseSteps(raw: any): any[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { const p = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(p) ? p : [] } catch { return [] }
}
function normaliseSteps(steps: any[]): Array<{ stepNumber: number; delayDays: number; delayHours: number; subject: string; body: string; templateId: string | null }> {
  return steps.map((step, i) => {
    const delayDays = Number(step.delayDays ?? 0), delayHours = Number(step.delayHours ?? 0)
    if (!Number.isFinite(delayDays) || delayDays < 0 || !Number.isFinite(delayHours) || delayHours < 0) throw new MarketingError(`Step ${i + 1}: delay must be a number of days/hours ≥ 0`, 400)
    const subject = String(step.subject || '').trim()
    if (!subject) throw new MarketingError(`Step ${i + 1}: subject is required`, 400)
    return { stepNumber: i + 1, delayDays: Math.floor(delayDays), delayHours: Math.floor(delayHours), subject, body: String(step.body || ''), templateId: step.templateId || null }
  })
}
function personalize(content: string, c: any): string {
  if (!content) return content
  const map: Record<string, string> = {
    '{{name}}': c?.name || 'there', '{{firstName}}': c?.firstName || c?.name?.split(' ')[0] || 'there',
    '{{lastName}}': c?.lastName || '', '{{email}}': c?.email || '', '{{company}}': c?.company || '',
  }
  let out = content
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v)
  return out
}
const camelSequence = (s: any) => s ? ({ ...s, companyId: s.company_id ?? s.companyId, createdAt: s.created_at ?? s.createdAt, updatedAt: s.updated_at ?? s.updatedAt, steps: parseSteps(s.steps), enrollmentCount: Number(s.enrollment_count ?? s.enrollmentCount ?? 0), activeEnrollments: Number(s.active_enrollments ?? s.activeEnrollments ?? 0) }) : s

export function createMarketingService(deps: MarketingServiceDeps) {
  const { db, tables: t, sendRaw, isFeatureEnabled, sequencesEnabled } = deps
  const env = deps.env || process.env
  const publicBase = () => String(env.API_BASE_URL || env.FRONTEND_URL || '').replace(/\/$/, '')

  // ─── templates ─────────────────────────────────────────────────────────────
  async function createTemplate(companyId: string, data: { name: string; subject: string; body: string; category?: string }) {
    // The id default lives in Drizzle ($defaultFn), not in the database — a raw INSERT without it is a NOT NULL
    // violation, which is why no template could ever be created (400 "A required field is missing" on 7/7).
    return first(await db.execute(sql`
      INSERT INTO email_template (id, company_id, name, subject, body, type, active)
      VALUES (${createId()}, ${companyId}, ${data.name}, ${data.subject}, ${data.body}, ${data.category || 'general'}, true)
      RETURNING *, type AS category`))
  }
  async function getTemplates(companyId: string, { category, active = true }: { category?: string; active?: boolean | null } = {}) {
    let extra = sql``
    if (category) extra = sql`${extra} AND type = ${category}`
    if (active !== null) extra = sql`${extra} AND active = ${active}`
    return rows(await db.execute(sql`SELECT *, type AS category FROM email_template WHERE company_id = ${companyId} ${extra} ORDER BY name ASC`))
  }
  async function getTemplate(id: string, companyId: string) {
    return first(await db.execute(sql`SELECT *, type AS category FROM email_template WHERE id = ${id} AND company_id = ${companyId}`))
  }
  async function updateTemplate(id: string, companyId: string, data: { name?: string; subject?: string; body?: string; category?: string; active?: boolean }) {
    if (!(await getTemplate(id, companyId))) throw new MarketingError('Template not found', 404)
    const sets: any[] = []
    if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
    if (data.subject !== undefined) sets.push(sql`subject = ${data.subject}`)
    if (data.body !== undefined) sets.push(sql`body = ${data.body}`)
    if (data.category !== undefined) sets.push(sql`type = ${data.category}`)
    if (data.active !== undefined) sets.push(sql`active = ${data.active}`)
    if (!sets.length) return getTemplate(id, companyId)
    return first(await db.execute(sql`UPDATE email_template SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId} RETURNING *, type AS category`))
  }
  async function duplicateTemplate(id: string, companyId: string) {
    const o = await getTemplate(id, companyId)
    if (!o) throw new MarketingError('Template not found', 404)
    return createTemplate(companyId, { name: `${o.name} (Copy)`, subject: o.subject, body: o.body, category: o.type ?? o.category ?? 'general' })
  }
  async function deleteTemplate(id: string, companyId: string) {
    const r = await db.execute(sql`DELETE FROM email_template WHERE id = ${id} AND company_id = ${companyId} RETURNING id`)
    if (!first(r)) throw new MarketingError('Template not found', 404)
  }

  // ─── audience ──────────────────────────────────────────────────────────────
  async function audienceContacts(companyId: string, audienceType: string, filter: any) {
    const conditions: any[] = [eq(t.contact.companyId, companyId), sql`${t.contact.email} IS NOT NULL`, sql`${t.contact.email} <> ''`, eq(t.contact.emailOptOut, false)]
    const parsed = filter ? (typeof filter === 'string' ? JSON.parse(filter) : filter) : null
    if (audienceType === 'segment' && parsed) {
      if (parsed.type) conditions.push(eq(t.contact.type, String(parsed.type)))
      if (parsed.createdAfter && !isNaN(new Date(parsed.createdAfter).getTime())) conditions.push(gte(t.contact.createdAt, new Date(parsed.createdAfter)))
      if (parsed.createdBefore && !isNaN(new Date(parsed.createdBefore).getTime())) conditions.push(sql`${t.contact.createdAt} <= ${new Date(parsed.createdBefore)}`)
      if (parsed.search) { const p = `%${String(parsed.search).replace(/[\\%_]/g, (ch: string) => '\\' + ch)}%`; conditions.push(or(ilike(t.contact.name, p), ilike(t.contact.email, p), ilike(t.contact.company, p))!) }
    }
    if (audienceType === 'contacts') {
      const ids: string[] = Array.isArray(parsed?.contactIds) ? parsed.contactIds.filter((x: any) => typeof x === 'string') : []
      if (!ids.length) return []
      conditions.push(inArray(t.contact.id, ids))
    }
    return db.select({ id: t.contact.id, name: t.contact.name, email: t.contact.email, company: t.contact.company }).from(t.contact).where(and(...conditions))
  }
  async function previewAudience(companyId: string, audienceType: string, filter: any) {
    const list = await audienceContacts(companyId, audienceType || 'all', filter ?? null)
    return { count: list.length, sample: list.slice(0, 10) }
  }

  // ─── campaigns ─────────────────────────────────────────────────────────────
  const ownCampaign = async (id: string, companyId: string) => { const [row] = await db.select().from(t.campaign).where(and(eq(t.campaign.id, id), eq(t.campaign.companyId, companyId))); return row || null }
  async function createCampaign(companyId: string, data: { name: string; subject: string; body?: string; audienceType?: string; audienceFilter?: any; scheduledFor?: string | null }) {
    const [created] = await db.insert(t.campaign).values({
      companyId, name: data.name, type: 'email', subject: data.subject, content: data.body || '', status: 'draft',
      audienceType: data.audienceType || 'all', audienceFilter: data.audienceFilter ?? null,
      scheduledDate: data.scheduledFor ? new Date(data.scheduledFor) : null,
    }).returning()
    return created
  }
  async function getCampaigns(companyId: string, { status, page = 1, limit = 50 }: { status?: string; page?: number; limit?: number } = {}) {
    const conditions: any[] = [eq(t.campaign.companyId, companyId)]
    if (status) conditions.push(eq(t.campaign.status, status))
    const where = and(...conditions)
    const [data, [tot]] = await Promise.all([
      db.select().from(t.campaign).where(where).orderBy(desc(t.campaign.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.campaign).where(where),
    ])
    const total = Number(tot?.value ?? 0)
    return { data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
  }
  async function getCampaign(id: string, companyId: string) {
    const row = await ownCampaign(id, companyId)
    if (!row) return null
    return { ...row, stats: { total: row.recipientCount, sent: row.recipientCount, opened: row.openCount, clicked: row.clickCount, unsubscribed: row.unsubscribeCount } }
  }
  async function updateCampaign(id: string, companyId: string, data: { name?: string; subject?: string; body?: string; audienceType?: string; audienceFilter?: any; scheduledFor?: string | null }) {
    const existing = await ownCampaign(id, companyId)
    if (!existing) throw new MarketingError('Campaign not found', 404)
    if (existing.status === 'sent' || existing.status === 'sending') throw new MarketingError('A campaign that has been sent cannot be edited — duplicate it instead', 409)
    // The form sends `body`; the column is `content` (VET-06).
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (data.name !== undefined) updates.name = data.name
    if (data.subject !== undefined) updates.subject = data.subject
    if (data.body !== undefined) updates.content = data.body
    if (data.audienceType !== undefined) updates.audienceType = data.audienceType
    if (data.audienceFilter !== undefined) updates.audienceFilter = data.audienceFilter
    if (data.scheduledFor !== undefined) updates.scheduledDate = data.scheduledFor ? new Date(data.scheduledFor) : null
    const [updated] = await db.update(t.campaign).set(updates).where(and(eq(t.campaign.id, id), eq(t.campaign.companyId, companyId))).returning()
    return updated
  }
  async function getCampaignRecipients(id: string, companyId: string) {
    if (!(await ownCampaign(id, companyId))) return null
    return rows(await db.execute(sql`
      SELECT er.id, er.email, er.status, er.sent_at, er.opened_at, er.clicked_at, er.open_count, er.click_count, er.unsubscribed_at, c.name AS contact_name
      FROM email_recipient er LEFT JOIN contact c ON er.contact_id = c.id
      WHERE er.campaign_id = ${id} ORDER BY er.created_at DESC`))
  }
  async function sendCampaign(id: string, companyId: string) {
    const row = await ownCampaign(id, companyId)
    if (!row) throw new MarketingError('Campaign not found', 404)
    if (row.status === 'sent' || row.status === 'sending') throw new MarketingError('This campaign has already been sent', 409)
    const contacts = await audienceContacts(companyId, row.audienceType, row.audienceFilter)
    // Delivery truth: an empty audience is not a successful send.
    if (contacts.length === 0) throw new MarketingError('This campaign has no deliverable recipients. Add contacts with email addresses to the selected audience, then send.', 400)
    await db.update(t.campaign).set({ status: 'sending', sentAt: new Date(), recipientCount: contacts.length }).where(eq(t.campaign.id, id))
    let sentCount = 0, firstError: string | null = null
    for (const c of contacts) {
      let recipientId: string | null = null
      try {
        recipientId = first(await db.execute(sql`INSERT INTO email_recipient (id, campaign_id, contact_id, email, status) VALUES (${createId()}, ${id}, ${c.id}, ${c.email}, 'sent') RETURNING id`))?.id ?? null
        await sendRaw({ to: c.email, subject: personalize(row.subject || '', c), html: decorate(personalize(row.content || '', c), recipientId, c.id) })
        await db.execute(sql`UPDATE email_recipient SET sent_at = NOW() WHERE id = ${recipientId}`)
        await db.insert(t.emailLog).values({ companyId, to: c.email, subject: row.subject || '', body: row.content, status: 'sent', contactId: c.id, sentAt: new Date() })
        sentCount++
      } catch (error: any) {
        console.error('[Marketing] Send failed for', c.email, '-', error?.message || error)
        if (!firstError) firstError = String(error?.message || error)
        if (recipientId) await db.execute(sql`UPDATE email_recipient SET status = 'failed' WHERE id = ${recipientId}`).catch(() => {})
        await db.insert(t.emailLog).values({ companyId, to: c.email, subject: row.subject || '', status: 'failed', errorMessage: String(error?.message || error).slice(0, 500), contactId: c.id }).catch(() => {})
      }
    }
    const finalStatus = sentCount === 0 ? 'failed' : 'sent'
    await db.update(t.campaign).set({ status: finalStatus, recipientCount: sentCount, lastError: finalStatus === 'failed' ? (firstError || 'No email could be delivered') : null }).where(eq(t.campaign.id, id))
    return { sent: sentCount, audience: contacts.length, failed: contacts.length - sentCount, status: finalStatus }
  }
  async function scheduleCampaign(id: string, companyId: string, scheduledFor: string) {
    const when = new Date(scheduledFor)
    if (!scheduledFor || isNaN(when.getTime())) throw new MarketingError('Enter a valid date and time', 400)
    if (when.getTime() < Date.now() - 60_000) throw new MarketingError('The scheduled time is in the past', 400)
    const existing = await ownCampaign(id, companyId)
    if (!existing) throw new MarketingError('Campaign not found', 404)
    if (existing.status !== 'draft' && existing.status !== 'scheduled' && existing.status !== 'failed') throw new MarketingError('Only draft campaigns can be scheduled', 409)
    const [updated] = await db.update(t.campaign).set({ status: 'scheduled', scheduledDate: when, updatedAt: new Date() }).where(eq(t.campaign.id, id)).returning()
    return updated
  }
  async function unscheduleCampaign(id: string, companyId: string) {
    const existing = await ownCampaign(id, companyId)
    if (!existing) throw new MarketingError('Campaign not found', 404)
    if (existing.status !== 'scheduled') throw new MarketingError('Campaign is not scheduled', 409)
    const [updated] = await db.update(t.campaign).set({ status: 'draft', scheduledDate: null, updatedAt: new Date() }).where(eq(t.campaign.id, id)).returning()
    return updated
  }
  async function deleteCampaign(id: string, companyId: string) {
    const existing = await ownCampaign(id, companyId)
    if (!existing) throw new MarketingError('Campaign not found', 404)
    if (existing.status === 'sending') throw new MarketingError('Campaign is sending right now', 409)
    await db.execute(sql`DELETE FROM email_click WHERE recipient_id IN (SELECT id FROM email_recipient WHERE campaign_id = ${id})`).catch(() => {})
    await db.execute(sql`DELETE FROM email_recipient WHERE campaign_id = ${id}`).catch(() => {})
    await db.delete(t.campaign).where(and(eq(t.campaign.id, id), eq(t.campaign.companyId, companyId)))
  }
  async function processScheduledCampaigns() {
    const due = await db.select().from(t.campaign).where(and(eq(t.campaign.status, 'scheduled'), sql`${t.campaign.scheduledDate} <= NOW()`))
    let sent = 0
    for (const row of due) {
      // Scheduled before the owner switched Email Marketing off: hold it, say why, send nothing. (T15 M5)
      if (isFeatureEnabled && !(await isFeatureEnabled(row.companyId, 'email_marketing'))) {
        await db.update(t.campaign).set({ status: 'failed', lastError: 'Email Marketing is switched off for this account (Settings › Features)' }).where(eq(t.campaign.id, row.id)).catch(() => {})
        continue
      }
      try { await db.update(t.campaign).set({ status: 'draft' }).where(eq(t.campaign.id, row.id)); sent += (await sendCampaign(row.id, row.companyId)).sent }
      catch (err: any) { console.error('[Marketing] Scheduled campaign failed:', row.id, err.message); await db.update(t.campaign).set({ status: 'failed', lastError: String(err?.message || err) }).where(eq(t.campaign.id, row.id)).catch(() => {}) }
    }
    return { due: due.length, sent }
  }

  // ─── sequences ─────────────────────────────────────────────────────────────
  async function createSequence(companyId: string, data: { name: string; description?: string | null; trigger?: string; active?: boolean; steps: any[] }) {
    const steps = normaliseSteps(data.steps || [])
    if (!steps.length) throw new MarketingError('Add at least one step', 400)
    return camelSequence(first(await db.execute(sql`
      INSERT INTO drip_sequence (id, company_id, name, description, trigger, active, steps)
      VALUES (${createId()}, ${companyId}, ${data.name}, ${data.description || null}, ${data.trigger || 'manual'}, ${data.active === true}, ${JSON.stringify(steps)}::json)
      RETURNING *`)))
  }
  async function getSequence(id: string, companyId: string) {
    return camelSequence(first(await db.execute(sql`SELECT * FROM drip_sequence WHERE id = ${id} AND company_id = ${companyId}`)))
  }
  async function updateSequence(id: string, companyId: string, data: { name?: string; description?: string | null; trigger?: string; active?: boolean; steps?: any[] }) {
    if (!(await getSequence(id, companyId))) throw new MarketingError('Sequence not found', 404)
    const sets: any[] = []
    if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
    if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
    if (data.trigger !== undefined) sets.push(sql`trigger = ${data.trigger}`)
    if (data.active !== undefined) sets.push(sql`active = ${data.active === true}`)
    if (data.steps !== undefined) { const steps = normaliseSteps(data.steps || []); if (!steps.length) throw new MarketingError('Add at least one step', 400); sets.push(sql`steps = ${JSON.stringify(steps)}::json`) }
    if (!sets.length) return getSequence(id, companyId)
    return camelSequence(first(await db.execute(sql`UPDATE drip_sequence SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId} RETURNING *`)))
  }
  async function getSequences(companyId: string) {
    return rows(await db.execute(sql`
      SELECT ds.*, COUNT(dse.id) FILTER (WHERE dse.status = 'active') AS active_enrollments, COUNT(dse.id) AS enrollment_count
      FROM drip_sequence ds LEFT JOIN sequence_enrollment dse ON ds.id = dse.sequence_id
      WHERE ds.company_id = ${companyId} GROUP BY ds.id ORDER BY ds.name ASC`)).map(camelSequence)
  }
  async function deleteSequence(id: string, companyId: string) {
    if (!(await getSequence(id, companyId))) throw new MarketingError('Sequence not found', 404)
    await db.execute(sql`DELETE FROM sequence_enrollment WHERE sequence_id = ${id}`)
    await db.execute(sql`DELETE FROM drip_sequence WHERE id = ${id} AND company_id = ${companyId}`)
  }
  async function enrollInSequence(sequenceId: string, contactId: string, companyId: string) {
    const seq = await getSequence(sequenceId, companyId)
    if (!seq) throw new MarketingError('Sequence not found', 404)
    if (!seq.active) throw new MarketingError('Sequence is paused — resume it before enrolling', 409)
    if (!seq.steps.length) throw new MarketingError('Sequence has no steps', 409)
    const [c] = await db.select().from(t.contact).where(and(eq(t.contact.id, contactId), eq(t.contact.companyId, companyId)))
    if (!c) throw new MarketingError('Contact not found', 404)
    if (c.emailOptOut) throw new MarketingError('Contact has unsubscribed from email', 409)
    if (!c.email) throw new MarketingError('Contact has no email address', 409)
    if (first(await db.execute(sql`SELECT id FROM sequence_enrollment WHERE sequence_id = ${sequenceId} AND contact_id = ${contactId} AND status = 'active'`))) throw new MarketingError('Contact is already enrolled in this sequence', 409)
    return first(await db.execute(sql`INSERT INTO sequence_enrollment (id, sequence_id, contact_id, current_step, status, next_email_at) VALUES (${createId()}, ${sequenceId}, ${contactId}, 1, 'active', NOW()) RETURNING *`))
  }
  async function getEnrollments(sequenceId: string, companyId: string) {
    if (!(await getSequence(sequenceId, companyId))) return null
    return rows(await db.execute(sql`
      SELECT se.id, se.contact_id, se.current_step, se.status, se.next_email_at, se.last_email_at, se.completed_at, c.name AS contact_name, c.email
      FROM sequence_enrollment se JOIN contact c ON se.contact_id = c.id
      WHERE se.sequence_id = ${sequenceId} ORDER BY se.status ASC, se.next_email_at ASC NULLS LAST`))
  }
  async function processDripEmails() {
    const due = rows(await db.execute(sql`
      SELECT se.*, ds.company_id, ds.steps, c.email, c.name AS contact_name, c.email_opt_out
      FROM sequence_enrollment se JOIN drip_sequence ds ON se.sequence_id = ds.id JOIN contact c ON se.contact_id = c.id
      WHERE se.status = 'active' AND ds.active = true AND se.next_email_at <= NOW()`))
    let sent = 0
    for (const e of due) {
      // The company switched Email Marketing off: leave the enrollment where it is, send nothing. (T15 M5)
      if (sequencesEnabled ? !(await sequencesEnabled(e.company_id)) : isFeatureEnabled && !(await isFeatureEnabled(e.company_id, 'email_marketing'))) continue
      if (e.email_opt_out || !e.email) { await db.execute(sql`UPDATE sequence_enrollment SET status = 'unsubscribed' WHERE id = ${e.id}`); continue }
      const steps = parseSteps(e.steps)
      const step = steps.find((s: any) => Number(s.stepNumber) === Number(e.current_step))
      if (!step) { await db.execute(sql`UPDATE sequence_enrollment SET status = 'completed', completed_at = NOW() WHERE id = ${e.id}`); continue }
      try {
        const person = { name: e.contact_name, email: e.email }
        await sendRaw({ to: e.email, subject: personalize(step.subject, person), html: decorate(personalize(step.body, person), null, e.contact_id) })
        const next = steps.find((s: any) => Number(s.stepNumber) === Number(e.current_step) + 1)
        if (next) await db.execute(sql`UPDATE sequence_enrollment SET current_step = ${Number(e.current_step) + 1}, next_email_at = NOW() + INTERVAL '1 day' * ${Number(next.delayDays || 0)} + INTERVAL '1 hour' * ${Number(next.delayHours || 0)}, last_email_at = NOW() WHERE id = ${e.id}`)
        else await db.execute(sql`UPDATE sequence_enrollment SET status = 'completed', completed_at = NOW(), last_email_at = NOW() WHERE id = ${e.id}`)
        sent++
      } catch (error: any) { console.error('[Marketing] Drip step failed:', e.id, error.message) }
    }
    return { processed: due.length, sent }
  }
  function startMarketingProcessor(intervalMs = 15 * 60 * 1000) {
    console.log('[Marketing] Starting campaign/drip processor (every 15 min)')
    const run = async () => {
      try { const c = await processScheduledCampaigns(); const d = await processDripEmails(); if (c.sent || d.sent) console.log('[Marketing] sent', c.sent, 'campaign emails,', d.sent, 'drip emails') }
      catch (err: any) { console.error('[Marketing] Processor error:', err.message) }
    }
    setInterval(run, intervalMs)
    setTimeout(run, 45_000)
  }

  // ─── tracking + unsubscribe ────────────────────────────────────────────────
  async function trackOpen(recipientId: string) {
    const row = first(await db.execute(sql`UPDATE email_recipient SET status = CASE WHEN status = 'clicked' THEN status ELSE 'opened' END, opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1 WHERE id = ${recipientId} RETURNING campaign_id, open_count`))
    if (row?.campaign_id && Number(row.open_count) === 1) await db.update(t.campaign).set({ openCount: sql`${t.campaign.openCount} + 1` }).where(eq(t.campaign.id, row.campaign_id))
  }
  async function trackClick(recipientId: string, url: string) {
    const row = first(await db.execute(sql`UPDATE email_recipient SET status = 'clicked', clicked_at = COALESCE(clicked_at, NOW()), click_count = click_count + 1 WHERE id = ${recipientId} RETURNING campaign_id, click_count`))
    if (!row) return
    await db.execute(sql`INSERT INTO email_click (id, recipient_id, url) VALUES (${createId()}, ${recipientId}, ${url.slice(0, 2000)})`).catch(() => {})
    if (row.campaign_id && Number(row.click_count) === 1) await db.update(t.campaign).set({ clickCount: sql`${t.campaign.clickCount} + 1` }).where(eq(t.campaign.id, row.campaign_id))
  }
  async function handleUnsubscribe(recipientId: string, contactId: string) {
    let campaignId: string | null = null
    if (recipientId && recipientId !== 'none') campaignId = first(await db.execute(sql`UPDATE email_recipient SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE id = ${recipientId} RETURNING campaign_id`))?.campaign_id ?? null
    const [c] = await db.select().from(t.contact).where(eq(t.contact.id, contactId))
    if (c) await db.update(t.contact).set({ emailOptOut: true, emailOptOutAt: new Date() }).where(eq(t.contact.id, contactId))
    if (campaignId) await db.update(t.campaign).set({ unsubscribeCount: sql`${t.campaign.unsubscribeCount} + 1` }).where(eq(t.campaign.id, campaignId)).catch(() => {})
    await db.execute(sql`UPDATE sequence_enrollment SET status = 'unsubscribed' WHERE contact_id = ${contactId} AND status = 'active'`)
    return { unsubscribed: true, email: c?.email ?? null }
  }
  async function resubscribe(contactId: string, companyId: string) {
    await db.update(t.contact).set({ emailOptOut: false, emailOptOutAt: null }).where(and(eq(t.contact.id, contactId), eq(t.contact.companyId, companyId)))
    return { resubscribed: true }
  }
  /** Open pixel, click tracking and the CAN-SPAM unsubscribe link. */
  function decorate(html: string, recipientId: string | null, contactId: string): string {
    const base = publicBase()
    if (!base) return html
    const unsubscribeUrl = `${base}/api/marketing/unsubscribe/${recipientId || 'none'}/${contactId}`
    let out = html || ''
    if (recipientId) out = out.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url) => url.startsWith(base + '/api/marketing/') ? `href="${url}"` : `href="${base}/api/marketing/track/click/${recipientId}?url=${encodeURIComponent(url)}"`)
    out += `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;"><p style="margin:0 0 4px;">You are receiving this because you are a customer or contact of ours.</p><p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></p></div>`
    if (recipientId) out += `<img src="${base}/api/marketing/track/open/${recipientId}" width="1" height="1" alt="" style="display:none;" />`
    return out
  }

  // ─── stats ─────────────────────────────────────────────────────────────────
  async function getMarketingStats(companyId: string) {
    const since = new Date(); since.setDate(since.getDate() - 30)
    const [[camps], [recent], seq, enr, eng, [optOuts]] = await Promise.all([
      db.select({ value: count() }).from(t.campaign).where(eq(t.campaign.companyId, companyId)),
      db.select({ value: count() }).from(t.emailLog).where(and(eq(t.emailLog.companyId, companyId), gte(t.emailLog.sentAt, since))),
      db.execute(sql`SELECT COUNT(*)::int AS active FROM drip_sequence WHERE company_id = ${companyId} AND active = true`),
      db.execute(sql`SELECT COUNT(*)::int AS active FROM sequence_enrollment se JOIN drip_sequence ds ON se.sequence_id = ds.id WHERE ds.company_id = ${companyId} AND se.status = 'active'`),
      db.execute(sql`SELECT COUNT(*)::int AS sent, COUNT(*) FILTER (WHERE er.opened_at IS NOT NULL)::int AS opened, COUNT(*) FILTER (WHERE er.clicked_at IS NOT NULL)::int AS clicked, COUNT(*) FILTER (WHERE er.status = 'unsubscribed')::int AS unsubscribed FROM email_recipient er JOIN campaign cp ON er.campaign_id = cp.id WHERE cp.company_id = ${companyId} AND er.created_at >= ${since}`),
      db.select({ value: count() }).from(t.contact).where(and(eq(t.contact.companyId, companyId), eq(t.contact.emailOptOut, true))),
    ])
    const e = first(eng) || {}
    const sent = Number(e.sent || 0)
    const pct = (n: number) => (sent ? round1((n / sent) * 100) : 0)
    return {
      totalCampaigns: Number(camps?.value ?? 0), activeSequences: Number(first(seq)?.active ?? 0), activeEnrollments: Number(first(enr)?.active ?? 0),
      emailsSent30Days: Number(recent?.value ?? 0), campaignSends30Days: sent, opened30Days: Number(e.opened || 0), clicked30Days: Number(e.clicked || 0),
      unsubscribed30Days: Number(e.unsubscribed || 0), openRate: pct(Number(e.opened || 0)), clickRate: pct(Number(e.clicked || 0)), totalOptOuts: Number(optOuts?.value ?? 0),
    }
  }

  return {
    createTemplate, getTemplates, getTemplate, updateTemplate, duplicateTemplate, deleteTemplate,
    createCampaign, getCampaigns, getCampaign, updateCampaign, getCampaignRecipients, sendCampaign, scheduleCampaign, unscheduleCampaign, deleteCampaign, processScheduledCampaigns,
    createSequence, getSequence, getSequences, updateSequence, deleteSequence, enrollInSequence, getEnrollments, processDripEmails, startMarketingProcessor,
    previewAudience, trackOpen, trackClick, handleUnsubscribe, resubscribe, getMarketingStats,
  }
}
export type MarketingService = ReturnType<typeof createMarketingService>

// ─── routes ────────────────────────────────────────────────────────────────────
const strip = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, '').trim()
const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  subject: z.string().trim().min(1, 'Subject is required').max(300),
  body: z.string().max(200_000).transform(strip).default(''),
  category: z.string().trim().max(40).optional(),
  active: z.boolean().optional(),
})
const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(200),
  subject: z.string().trim().min(1, 'Subject line is required').max(300),
  body: z.string().max(500_000).transform(strip).optional(),
  audienceType: z.enum(AUDIENCE_TYPES).optional(),
  audienceFilter: z.record(z.any()).nullable().optional(),
  scheduledFor: z.string().nullable().optional().refine((v) => !v || !isNaN(new Date(v).getTime()), { message: 'Enter a valid date and time' }),
})
const sequenceSchema = z.object({
  name: z.string().trim().min(1, 'Sequence name is required').max(120),
  description: z.string().max(1000).nullable().optional(),
  trigger: z.enum(SEQUENCE_TRIGGERS).optional(),
  active: z.boolean().optional(),
  steps: z.array(z.object({ delayDays: z.any(), delayHours: z.any(), subject: z.any(), body: z.any(), templateId: z.any().optional() })).max(30),
})

export function createMarketingRoutes({ service: m, authenticate, requirePermission, escapeHtml, featureGate, campaignsGate }: MarketingRoutesDeps) {
  const app = new Hono()
  // Tracking pixels, click redirects and unsubscribe links are opened from a mail client with no session.
  const PUBLIC = /\/(track|unsubscribe)\//
  app.use('*', async (c, next) => (PUBLIC.test(c.req.path) ? next() : authenticate(c, next)))
  // Email Marketing switched off refuses the module at the API too (403 FEATURE_NOT_ENABLED); links stay open.
  if (featureGate) app.use('*', async (c, next) => (PUBLIC.test(c.req.path) ? next() : featureGate(c, next)))
  if (campaignsGate) for (const p of ['/campaigns', '/campaigns/*', '/templates', '/templates/*', '/audience/*']) app.use(p, campaignsGate)
  const user = (c: any) => (c as any).get('user')
  const invalid = (c: any, err: z.ZodError) => c.json({ error: err.errors[0]?.message || 'Invalid request', details: err.flatten().fieldErrors }, 400)
  const guarded = (fn: (c: any) => Promise<Response>) => async (c: any) => {
    try { return await fn(c) }
    catch (e: any) { if (e instanceof MarketingError) return c.json({ error: e.message }, e.status as any); throw e }
  }
  const body = (c: any) => c.req.json().catch(() => ({}))

  // templates
  app.get('/templates', requirePermission('marketing:read'), async (c) => {
    const active = c.req.query('active')
    return c.json(await m.getTemplates(user(c).companyId, { category: c.req.query('category'), active: active === 'false' ? false : active === 'all' ? null : true }))
  })
  app.post('/templates', requirePermission('marketing:create'), guarded(async (c) => { const p = templateSchema.safeParse(await body(c)); if (!p.success) return invalid(c, p.error); return c.json(await m.createTemplate(user(c).companyId, p.data), 201) }))
  app.put('/templates/:id', requirePermission('marketing:update'), guarded(async (c) => { const p = templateSchema.partial().safeParse(await body(c)); if (!p.success) return invalid(c, p.error); return c.json(await m.updateTemplate(c.req.param('id'), user(c).companyId, p.data)) }))
  app.post('/templates/:id/duplicate', requirePermission('marketing:create'), guarded(async (c) => c.json(await m.duplicateTemplate(c.req.param('id'), user(c).companyId), 201)))
  app.delete('/templates/:id', requirePermission('marketing:delete'), guarded(async (c) => { await m.deleteTemplate(c.req.param('id'), user(c).companyId); return c.body(null, 204) }))

  // campaigns
  app.get('/campaigns', requirePermission('marketing:read'), async (c) => c.json(await m.getCampaigns(user(c).companyId, { status: c.req.query('status'), page: Math.max(1, parseInt(c.req.query('page') || '1') || 1), limit: Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50') || 50)) })))
  app.get('/campaigns/:id', requirePermission('marketing:read'), async (c) => { const row = await m.getCampaign(c.req.param('id'), user(c).companyId); return row ? c.json(row) : c.json({ error: 'Campaign not found' }, 404) })
  app.get('/campaigns/:id/recipients', requirePermission('marketing:read'), async (c) => { const r = await m.getCampaignRecipients(c.req.param('id'), user(c).companyId); return r === null ? c.json({ error: 'Campaign not found' }, 404) : c.json({ data: r }) })
  app.post('/campaigns', requirePermission('marketing:create'), guarded(async (c) => { const p = campaignSchema.safeParse(await body(c)); if (!p.success) return invalid(c, p.error); return c.json(await m.createCampaign(user(c).companyId, p.data), 201) }))
  app.put('/campaigns/:id', requirePermission('marketing:update'), guarded(async (c) => { const p = campaignSchema.partial().safeParse(await body(c)); if (!p.success) return invalid(c, p.error); return c.json(await m.updateCampaign(c.req.param('id'), user(c).companyId, p.data)) }))
  app.post('/campaigns/:id/send', requirePermission('marketing:update'), guarded(async (c) => c.json(await m.sendCampaign(c.req.param('id'), user(c).companyId))))
  app.post('/campaigns/:id/schedule', requirePermission('marketing:update'), guarded(async (c) => c.json(await m.scheduleCampaign(c.req.param('id'), user(c).companyId, String((await body(c)).scheduledFor || '')))))
  app.post('/campaigns/:id/unschedule', requirePermission('marketing:update'), guarded(async (c) => c.json(await m.unscheduleCampaign(c.req.param('id'), user(c).companyId))))
  app.delete('/campaigns/:id', requirePermission('marketing:delete'), guarded(async (c) => { await m.deleteCampaign(c.req.param('id'), user(c).companyId); return c.body(null, 204) }))
  // An audience we don't know must NOT quietly mean "everyone": previewing audienceType "clients" answered with the
  // whole list (76), so a campaign aimed at a subset looked right and would have gone to every contact. Name the
  // audiences we support instead. (Landscaping T21 M4)
  app.post('/audience/preview', requirePermission('marketing:read'), guarded(async (c) => { const b = await body(c); if (b.audienceType !== undefined && b.audienceType !== null && b.audienceType !== '' && !AUDIENCE_TYPES.includes(b.audienceType)) return c.json({ error: `Audience must be one of: ${AUDIENCE_TYPES.join(', ')}. To reach one kind of customer, use "segment" with a type filter.` }, 400); const type = b.audienceType || 'all'; return c.json(await m.previewAudience(user(c).companyId, type, b.audienceFilter ?? null)) }))

  // sequences
  app.get('/sequences', requirePermission('marketing:read'), async (c) => c.json(await m.getSequences(user(c).companyId)))
  app.get('/sequences/:id/enrollments', requirePermission('marketing:read'), async (c) => { const r = await m.getEnrollments(c.req.param('id'), user(c).companyId); return r === null ? c.json({ error: 'Sequence not found' }, 404) : c.json({ data: r }) })
  app.post('/sequences', requirePermission('marketing:create'), guarded(async (c) => { const p = sequenceSchema.safeParse(await body(c)); if (!p.success) return invalid(c, p.error); return c.json(await m.createSequence(user(c).companyId, p.data), 201) }))
  app.put('/sequences/:id', requirePermission('marketing:update'), guarded(async (c) => { const p = sequenceSchema.partial().safeParse(await body(c)); if (!p.success) return invalid(c, p.error); return c.json(await m.updateSequence(c.req.param('id'), user(c).companyId, p.data)) }))
  app.delete('/sequences/:id', requirePermission('marketing:delete'), guarded(async (c) => { await m.deleteSequence(c.req.param('id'), user(c).companyId); return c.body(null, 204) }))
  app.post('/sequences/:id/enroll', requirePermission('marketing:update'), guarded(async (c) => { const { contactId } = await body(c); if (!contactId || typeof contactId !== 'string') return c.json({ error: 'contactId is required' }, 400); return c.json(await m.enrollInSequence(c.req.param('id'), contactId, user(c).companyId), 201) }))

  // tracking (public)
  app.get('/track/open/:recipientId', async (c) => {
    try { await m.trackOpen(c.req.param('recipientId')) } catch (error) { console.error('Track open error:', error) }
    return new Response(Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (ch) => ch.charCodeAt(0)), { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } })
  })
  app.get('/track/click/:recipientId', async (c) => {
    const url = c.req.query('url') || ''
    if (!/^https?:\/\//i.test(url)) return c.text('Missing link', 400)
    try { await m.trackClick(c.req.param('recipientId'), url) } catch (error) { console.error('Track click error:', error) }
    return c.redirect(url)
  })
  app.get('/unsubscribe/:recipientId/:contactId', async (c) => {
    const page = (title: string, html: string) => c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#111827;text-align:center;"><h1 style="font-size:1.4rem;margin-bottom:.5rem;">${title}</h1>${html}</body></html>`)
    try {
      const r = await m.handleUnsubscribe(c.req.param('recipientId'), c.req.param('contactId'))
      return page('You have been unsubscribed', `<p style="color:#4b5563;">${r.email ? escapeHtml(r.email) + ' will' : 'You will'} no longer receive marketing emails from us.</p><p style="color:#6b7280;font-size:.85rem;">Messages about your jobs, quotes and invoices are not affected.</p>`)
    } catch (error) { console.error('Unsubscribe error:', error); return page('Something went wrong', '<p style="color:#4b5563;">We could not process that request. Please contact us and we will remove you manually.</p>') }
  })

  // stats + admin
  app.get('/stats', requirePermission('marketing:read'), async (c) => c.json(await m.getMarketingStats(user(c).companyId)))
  app.post('/process', requirePermission('marketing:update'), async (c) => c.json({ campaigns: await m.processScheduledCampaigns(), drips: await m.processDripEmails() }))
  app.post('/contacts/:contactId/resubscribe', requirePermission('marketing:update'), async (c) => c.json(await m.resubscribe(c.req.param('contactId'), user(c).companyId)))
  return app
}
