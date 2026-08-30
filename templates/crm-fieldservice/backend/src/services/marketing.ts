/**
 * Marketing Automation Service
 *
 * Email campaigns and drip sequences:
 * - Email templates
 * - Campaign management
 * - Drip sequences (automated followups)
 * - Audience segmentation
 * - Performance tracking
 * - Integration with SendGrid/Mailchimp
 */

import { db } from '../../db/index.ts'
import { campaign, contact, emailLog } from '../../db/schema.ts'
import { eq, and, or, desc, count, sql, gte, ilike, inArray } from 'drizzle-orm'
import { sendRaw } from './email.ts'
import { createId } from '@paralleldrive/cuid2'

// NOTE: The Drizzle schema has a simplified `campaign` table and `emailLog` table.
// The Prisma version had emailTemplate, emailCampaign, emailRecipient, emailClick,
// dripSequence, and sequenceEnrollment tables.
// For advanced features (drip sequences, recipient tracking), add those tables to the schema.
// This conversion uses the available tables and raw SQL for missing ones.

// ============================================
// EMAIL TEMPLATES
// ============================================

/**
 * Create email template
 */
export async function createTemplate(companyId: string, data: any) {
  const result = await db.execute(sql`
    INSERT INTO email_template (company_id, name, subject, body, type, active)
    VALUES (${companyId}, ${data.name}, ${data.subject}, ${data.body}, ${data.category ?? 'general'}, true)
    RETURNING *
  `)
  return result.rows?.[0] ?? result
}

/**
 * Get templates
 */
export async function getTemplates(companyId: string, { category, active = true }: { category?: string; active?: boolean | null } = {}) {
  let whereExtra = sql``
  if (category) whereExtra = sql`${whereExtra} AND type = ${category}`
  if (active !== null) whereExtra = sql`${whereExtra} AND active = ${active}`

  const result = await db.execute(sql`
    SELECT *, type AS category FROM email_template
    WHERE company_id = ${companyId} ${whereExtra}
    ORDER BY name ASC
  `)
  return result.rows ?? result
}

/**
 * Update template
 */
export async function updateTemplate(templateId: string, companyId: string, data: any) {
  // Build SET clause dynamically
  const setClauses: any[] = []
  if (data.name !== undefined) setClauses.push(sql`name = ${data.name}`)
  if (data.subject !== undefined) setClauses.push(sql`subject = ${data.subject}`)
  if (data.body !== undefined) setClauses.push(sql`body = ${data.body}`)
  if (data.category !== undefined) setClauses.push(sql`type = ${data.category}`)
  if (data.active !== undefined) setClauses.push(sql`active = ${data.active}`)

  if (setClauses.length === 0) return

  const result = await db.execute(sql`
    UPDATE email_template SET ${sql.join(setClauses, sql`, `)}
    WHERE id = ${templateId} AND company_id = ${companyId}
    RETURNING *
  `)
  return result.rows?.[0] ?? result
}

/**
 * Duplicate template
 */
export async function duplicateTemplate(templateId: string, companyId: string) {
  const origResult = await db.execute(sql`
    SELECT *, type AS category FROM email_template WHERE id = ${templateId} AND company_id = ${companyId}
  `)
  const original = (origResult.rows?.[0] ?? null) as any
  if (!original) throw new Error('Template not found')

  const result = await db.execute(sql`
    INSERT INTO email_template (company_id, name, subject, body, type, active)
    VALUES (${companyId}, ${original.name + ' (Copy)'}, ${original.subject}, ${original.body}, ${original.type ?? original.category ?? 'general'}, true)
    RETURNING *
  `)
  return result.rows?.[0] ?? result
}

// ============================================
// CAMPAIGNS
// ============================================

/**
 * Create campaign
 */
export async function createCampaign(companyId: string, data: any) {
  const [created] = await db.insert(campaign).values({
    companyId,
    name: data.name,
    type: 'email',
    subject: data.subject,
    content: data.body,
    status: 'draft',
    audienceType: data.audienceType || 'all',
    audienceFilter: data.audienceFilter ?? null,
    scheduledDate: data.scheduledFor ? new Date(data.scheduledFor) : null,
  }).returning()

  return created
}

/**
 * Get campaigns
 */
export async function getCampaigns(companyId: string, { status, page = 1, limit = 50 }: { status?: string; page?: number; limit?: number } = {}) {
  const conditions = [eq(campaign.companyId, companyId)]
  if (status) conditions.push(eq(campaign.status, status))

  const whereClause = and(...conditions)

  const [data, [totalResult]] = await Promise.all([
    db.select()
      .from(campaign)
      .where(whereClause)
      .orderBy(desc(campaign.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() })
      .from(campaign)
      .where(whereClause),
  ])

  const total = totalResult?.value ?? 0

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Get campaign with stats
 */
export async function getCampaign(campaignId: string, companyId: string) {
  const [campaignRow] = await db.select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.companyId, companyId)))

  if (!campaignRow) return null

  return {
    ...campaignRow,
    stats: {
      total: campaignRow.recipientCount,
      sent: campaignRow.recipientCount,
      opened: campaignRow.openCount,
      clicked: campaignRow.clickCount,
    },
  }
}

/**
 * Update campaign
 */
export async function updateCampaign(campaignId: string, companyId: string, data: any) {
  const [existing] = await db.select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.companyId, companyId)))

  if (!existing || existing.status === 'sent') {
    throw new Error('Cannot update sent campaign')
  }

  // Map the payload to real columns: the frontend sends `body` but the column is
  // `content`, so a raw .set(data) silently dropped the body (and passed junk keys
  // like segmentType) -> editing a campaign wiped its body. (VET-06)
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.subject !== undefined) updates.subject = data.subject
  if (data.body !== undefined) updates.content = data.body
  if (data.audienceType !== undefined) updates.audienceType = data.audienceType
  if (data.audienceFilter !== undefined) updates.audienceFilter = data.audienceFilter
  if (data.scheduledFor !== undefined) updates.scheduledDate = data.scheduledFor ? new Date(data.scheduledFor) : null

  const [updated] = await db.update(campaign)
    .set(updates)
    .where(eq(campaign.id, campaignId))
    .returning()

  return updated
}

/**
 * Send campaign
 */
/** Per-recipient delivery + engagement for one campaign. */
export async function getCampaignRecipients(campaignId: string, companyId: string) {
  const [campaignRow] = await db.select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.companyId, companyId)))
  if (!campaignRow) return null

  const result = await db.execute(sql`
    SELECT er.id, er.email, er.status, er.sent_at, er.opened_at, er.clicked_at,
           er.open_count, er.click_count, er.unsubscribed_at, c.name AS contact_name
    FROM email_recipient er
    LEFT JOIN contact c ON er.contact_id = c.id
    WHERE er.campaign_id = ${campaignId}
    ORDER BY er.created_at DESC
  `)
  return result.rows ?? []
}

export async function sendCampaign(campaignId: string, companyId: string) {
  const [campaignRow] = await db.select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.companyId, companyId)))

  if (!campaignRow || campaignRow.status === 'sent' || campaignRow.status === 'sending') {
    throw new Error('Campaign already sent or not found')
  }

  // Send to the audience the campaign was built for — not to everyone.
  const contacts = await getAudienceContacts(companyId, campaignRow.audienceType, campaignRow.audienceFilter)

  // Delivery truth (SEND-02): an empty audience is not a successful send. Refuse it
  // loudly instead of flipping the campaign to "sent" with recipientCount 0.
  if (contacts.length === 0) {
    throw new Error('This campaign has no deliverable recipients. Add contacts with email addresses to the selected audience, then send.')
  }

  await db.update(campaign)
    .set({ status: 'sending', sentAt: new Date(), recipientCount: contacts.length })
    .where(eq(campaign.id, campaignId))

  let sentCount = 0
  for (const c of contacts) {
    let recipientId: string | null = null
    try {
      // One recipient row per send — this is what open/click/unsubscribe hang off.
      const rec = await db.execute(sql`
        INSERT INTO email_recipient (id, campaign_id, contact_id, email, status)
        VALUES (${createId()}, ${campaignId}, ${c.id}, ${c.email}, 'sent')
        RETURNING id
      `)
      recipientId = ((rec.rows?.[0] as any) || {}).id ?? null

      const html = decorateCampaignHtml(
        personalizeContent(campaignRow.content || '', c),
        recipientId,
        c.id,
      )

      await sendEmail({
        to: c.email!,
        subject: personalizeContent(campaignRow.subject || '', c),
        html,
      })

      await db.execute(sql`UPDATE email_recipient SET sent_at = NOW() WHERE id = ${recipientId}`)

      await db.insert(emailLog).values({
        companyId,
        to: c.email!,
        subject: campaignRow.subject || '',
        body: campaignRow.content,
        status: 'sent',
        contactId: c.id,
        sentAt: new Date(),
      })

      sentCount++
    } catch (error: any) {
      // A recipient failing silently is how you discover a broken campaign a
      // week later. Say so in the log.
      console.error('[Marketing] Send failed for', c.email, '-', error?.message || error)
      if (recipientId) {
        await db.execute(sql`UPDATE email_recipient SET status = 'failed' WHERE id = ${recipientId}`).catch(() => {})
      }
      await db.insert(emailLog).values({
        companyId,
        to: c.email!,
        subject: campaignRow.subject || '',
        status: 'failed',
        errorMessage: error.message,
        contactId: c.id,
      })
    }
  }

  // Delivery truth (SEND-01/02): if every send failed, the campaign did NOT go out —
  // don't record it as "sent". Surface the failed count so the UI can tell the truth.
  const finalStatus = sentCount === 0 ? 'failed' : 'sent'
  await db.update(campaign)
    .set({ status: finalStatus, recipientCount: sentCount })
    .where(eq(campaign.id, campaignId))

  return { sent: sentCount, audience: contacts.length, failed: contacts.length - sentCount, status: finalStatus }
}

/**
 * Send campaigns whose scheduled time has arrived. Nothing did this before, so
 * scheduling a campaign quietly meant it never went out.
 */
export async function processScheduledCampaigns() {
  const due = await db.select()
    .from(campaign)
    .where(and(eq(campaign.status, 'scheduled'), sql`${campaign.scheduledDate} <= NOW()`))

  let sent = 0
  for (const row of due) {
    try {
      // sendCampaign refuses anything not sendable; scheduled rows qualify.
      await db.update(campaign).set({ status: 'draft' }).where(eq(campaign.id, row.id))
      const result = await sendCampaign(row.id, row.companyId)
      sent += result.sent
    } catch (err: any) {
      console.error('[Marketing] Scheduled campaign failed:', row.id, err.message)
      await db.update(campaign).set({ status: 'failed' }).where(eq(campaign.id, row.id)).catch(() => {})
    }
  }
  return { due: due.length, sent }
}

/**
 * Schedule campaign
 */
export async function scheduleCampaign(campaignId: string, companyId: string, scheduledFor: string) {
  return db.update(campaign)
    .set({
      status: 'scheduled',
      scheduledDate: new Date(scheduledFor),
    })
    .where(and(eq(campaign.id, campaignId), eq(campaign.companyId, companyId), eq(campaign.status, 'draft')))
}

// ============================================
// DRIP SEQUENCES (Automated Followups)
// ============================================

// NOTE: dripSequence and sequenceEnrollment tables are not in the Drizzle schema.
// These functions use raw SQL. Add the tables to schema.ts for proper integration.

/**
 * Create drip sequence
 */
export async function createSequence(companyId: string, data: any) {
  // Steps live in drip_sequence.steps (json). Earlier code wrote them to a
  // drip_sequence_step table that was never created.
  const steps = (data.steps || []).map((step: any, i: number) => ({
    stepNumber: i + 1,
    delayDays: Number(step.delayDays || 0),
    delayHours: Number(step.delayHours || 0),
    subject: step.subject || '',
    body: step.body || '',
    templateId: step.templateId || null,
  }))

  const seqResult = await db.execute(sql`
    INSERT INTO drip_sequence (id, company_id, name, description, trigger, active, steps)
    VALUES (${createId()}, ${companyId}, ${data.name}, ${data.description || null}, ${data.trigger || 'manual'},
            ${data.active === true}, ${JSON.stringify(steps)}::json)
    RETURNING *
  `)
  return (seqResult.rows?.[0] as any)
}

/**
 * Update a sequence (steps included) or flip it active.
 */
export async function updateSequence(sequenceId: string, companyId: string, data: any) {
  const sets: any[] = []
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.trigger !== undefined) sets.push(sql`trigger = ${data.trigger}`)
  if (data.active !== undefined) sets.push(sql`active = ${data.active === true}`)
  if (data.steps !== undefined) {
    const steps = (data.steps || []).map((step: any, i: number) => ({
      stepNumber: i + 1,
      delayDays: Number(step.delayDays || 0),
      delayHours: Number(step.delayHours || 0),
      subject: step.subject || '',
      body: step.body || '',
      templateId: step.templateId || null,
    }))
    sets.push(sql`steps = ${JSON.stringify(steps)}::json`)
  }
  if (!sets.length) return null

  const result = await db.execute(sql`
    UPDATE drip_sequence SET ${sql.join(sets, sql`, `)}, updated_at = NOW()
    WHERE id = ${sequenceId} AND company_id = ${companyId}
    RETURNING *
  `)
  return (result.rows?.[0] as any) ?? null
}

/**
 * Get sequences
 */
export async function getSequences(companyId: string) {
  const result = await db.execute(sql`
    SELECT ds.*, COUNT(dse.id) FILTER (WHERE dse.status = 'active') as active_enrollments,
           COUNT(dse.id) as enrollment_count
    FROM drip_sequence ds
    LEFT JOIN sequence_enrollment dse ON ds.id = dse.sequence_id
    WHERE ds.company_id = ${companyId}
    GROUP BY ds.id
    ORDER BY ds.name ASC
  `)
  return result.rows ?? result
}

/**
 * Enroll contact in sequence
 */
export async function enrollInSequence(sequenceId: string, contactId: string, companyId: string) {
  const seqResult = await db.execute(sql`
    SELECT * FROM drip_sequence WHERE id = ${sequenceId} AND company_id = ${companyId} AND active = true
  `)
  const sequence = (seqResult.rows?.[0] as any)
  if (!sequence) throw new Error('Sequence not found or not active')

  const steps = parseSteps(sequence.steps)
  if (!steps.length) throw new Error('Sequence has no steps')

  // Never enroll someone who has opted out of email.
  const [contactRow] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, companyId)))
  if (!contactRow) throw new Error('Contact not found')
  if (contactRow.emailOptOut) throw new Error('Contact has unsubscribed from email')
  if (!contactRow.email) throw new Error('Contact has no email address')

  const existingResult = await db.execute(sql`
    SELECT id FROM sequence_enrollment WHERE sequence_id = ${sequenceId} AND contact_id = ${contactId} AND status = 'active'
  `)
  if ((existingResult.rows?.length ?? 0) > 0) {
    throw new Error('Contact already enrolled in this sequence')
  }

  const result = await db.execute(sql`
    INSERT INTO sequence_enrollment (id, sequence_id, contact_id, current_step, status, next_email_at)
    VALUES (${createId()}, ${sequenceId}, ${contactId}, 1, 'active', NOW())
    RETURNING *
  `)

  return result.rows?.[0] ?? result
}

/** Steps are stored as json; tolerate a string column too. */
function parseSteps(raw: any): any[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Process pending drip emails. Called by the marketing worker below — nothing
 * called it before, so enrolled contacts never received a single step.
 */
export async function processDripEmails() {
  const dueResult = await db.execute(sql`
    SELECT se.*, ds.company_id, ds.steps, c.email, c.name as contact_name, c.email_opt_out
    FROM sequence_enrollment se
    JOIN drip_sequence ds ON se.sequence_id = ds.id
    JOIN contact c ON se.contact_id = c.id
    WHERE se.status = 'active' AND se.next_email_at <= NOW()
  `)

  const due = (dueResult.rows ?? []) as any[]
  let sent = 0

  for (const enrollment of due) {
    // Someone who unsubscribed mid-sequence stops receiving it.
    if (enrollment.email_opt_out) {
      await db.execute(sql`
        UPDATE sequence_enrollment SET status = 'unsubscribed' WHERE id = ${enrollment.id}
      `)
      continue
    }

    const steps = parseSteps(enrollment.steps)
    const step = steps.find((s: any) => Number(s.stepNumber) === Number(enrollment.current_step))

    if (!step) {
      await db.execute(sql`
        UPDATE sequence_enrollment SET status = 'completed', completed_at = NOW() WHERE id = ${enrollment.id}
      `)
      continue
    }

    try {
      const person = { name: enrollment.contact_name, email: enrollment.email }
      await sendEmail({
        to: enrollment.email,
        subject: personalizeContent(step.subject, person),
        html: decorateCampaignHtml(personalizeContent(step.body, person), null, enrollment.contact_id),
      })

      const nextStep = steps.find((s: any) => Number(s.stepNumber) === Number(enrollment.current_step) + 1)

      if (nextStep) {
        await db.execute(sql`
          UPDATE sequence_enrollment SET
            current_step = ${Number(enrollment.current_step) + 1},
            next_email_at = NOW() + INTERVAL '1 day' * ${Number(nextStep.delayDays || 0)} + INTERVAL '1 hour' * ${Number(nextStep.delayHours || 0)},
            last_email_at = NOW()
          WHERE id = ${enrollment.id}
        `)
      } else {
        await db.execute(sql`
          UPDATE sequence_enrollment SET status = 'completed', completed_at = NOW(), last_email_at = NOW()
          WHERE id = ${enrollment.id}
        `)
      }

      sent++
    } catch (error: any) {
      console.error('[Marketing] Drip step failed:', enrollment.id, error.message)
    }
  }

  return { processed: due.length, sent }
}

/**
 * Hourly worker: send campaigns that came due and advance drip sequences.
 * Mirrors startReviewProcessor in services/reviews.ts.
 */
export function startMarketingProcessor() {
  const INTERVAL = 15 * 60 * 1000 // 15 minutes
  console.log('[Marketing] Starting campaign/drip processor (every 15 min)')

  const run = async () => {
    try {
      const campaigns = await processScheduledCampaigns()
      const drips = await processDripEmails()
      if (campaigns.sent || drips.sent) {
        console.log('[Marketing] sent', campaigns.sent, 'campaign emails,', drips.sent, 'drip emails')
      }
    } catch (err: any) {
      console.error('[Marketing] Processor error:', err.message)
    }
  }

  setInterval(run, INTERVAL)
  setTimeout(run, 45_000)
}

// ============================================
// AUDIENCE SEGMENTATION
// ============================================

/**
 * Get contacts based on audience criteria
 */
async function getAudienceContacts(companyId: string, audienceType: string, filter: any) {
  const conditions = [
    eq(contact.companyId, companyId),
    sql`${contact.email} IS NOT NULL`,
    sql`${contact.email} <> ''`,
    // Honour unsubscribes. This filter is the whole reason opt-out is a column.
    eq(contact.emailOptOut, false),
  ]

  if (audienceType === 'segment' && filter) {
    const parsed = typeof filter === 'string' ? JSON.parse(filter) : filter

    if (parsed.type) {
      conditions.push(eq(contact.type, parsed.type))
    }
    if (parsed.createdAfter) {
      conditions.push(gte(contact.createdAt, new Date(parsed.createdAfter)))
    }
    if (parsed.createdBefore) {
      conditions.push(sql`${contact.createdAt} <= ${new Date(parsed.createdBefore)}`)
    }
    if (parsed.search) {
      conditions.push(or(
        ilike(contact.name, `%${parsed.search}%`),
        ilike(contact.email, `%${parsed.search}%`),
        ilike(contact.company, `%${parsed.search}%`),
      )!)
    }
  }

  if (audienceType === 'contacts' && filter) {
    const parsed = typeof filter === 'string' ? JSON.parse(filter) : filter
    const ids: string[] = parsed.contactIds || []
    if (!ids.length) return []
    conditions.push(inArray(contact.id, ids))
  }

  return db.select({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    company: contact.company,
  })
    .from(contact)
    .where(and(...conditions))
}

/** Preview an audience before sending — how many, and who. */
export async function previewAudience(companyId: string, audienceType: string, filter: any) {
  const contacts = await getAudienceContacts(companyId, audienceType || 'all', filter ?? null)
  return { count: contacts.length, sample: contacts.slice(0, 10) }
}

// ============================================
// EMAIL TRACKING
// ============================================

/**
 * Track email open
 */
export async function trackOpen(recipientId: string) {
  const result = await db.execute(sql`
    UPDATE email_recipient
    SET status = CASE WHEN status = 'clicked' THEN status ELSE 'opened' END,
        opened_at = COALESCE(opened_at, NOW()),
        open_count = open_count + 1
    WHERE id = ${recipientId}
    RETURNING campaign_id, open_count
  `)
  const row = (result.rows?.[0] as any)
  // First open only, so the campaign counter stays a unique-opens number.
  if (row?.campaign_id && Number(row.open_count) === 1) {
    await db.update(campaign)
      .set({ openCount: sql`${campaign.openCount} + 1` })
      .where(eq(campaign.id, row.campaign_id))
  }
}

/**
 * Track email click
 */
export async function trackClick(recipientId: string, url: string) {
  const result = await db.execute(sql`
    UPDATE email_recipient
    SET status = 'clicked',
        clicked_at = COALESCE(clicked_at, NOW()),
        click_count = click_count + 1
    WHERE id = ${recipientId}
    RETURNING campaign_id, click_count
  `)
  const row = (result.rows?.[0] as any)

  await db.execute(sql`
    INSERT INTO email_click (id, recipient_id, url) VALUES (${createId()}, ${recipientId}, ${url})
  `)

  if (row?.campaign_id && Number(row.click_count) === 1) {
    await db.update(campaign)
      .set({ clickCount: sql`${campaign.clickCount} + 1` })
      .where(eq(campaign.id, row.campaign_id))
  }
}

/**
 * Handle unsubscribe — the opt-out has to stick on the contact, because that is
 * what every future send filters on.
 */
export async function handleUnsubscribe(recipientId: string, contactId: string) {
  let campaignId: string | null = null
  if (recipientId && recipientId !== 'none') {
    const result = await db.execute(sql`
      UPDATE email_recipient SET status = 'unsubscribed', unsubscribed_at = NOW()
      WHERE id = ${recipientId}
      RETURNING campaign_id
    `)
    campaignId = ((result.rows?.[0] as any) || {}).campaign_id ?? null
  }

  const [c] = await db.select().from(contact).where(eq(contact.id, contactId))
  if (c) {
    await db.update(contact)
      .set({ emailOptOut: true, emailOptOutAt: new Date() })
      .where(eq(contact.id, contactId))
  }

  if (campaignId) {
    await db.update(campaign)
      .set({ unsubscribeCount: sql`${campaign.unsubscribeCount} + 1` })
      .where(eq(campaign.id, campaignId))
      .catch(() => {})
  }

  // Stop any drip they were in the middle of.
  await db.execute(sql`
    UPDATE sequence_enrollment SET status = 'unsubscribed'
    WHERE contact_id = ${contactId} AND status = 'active'
  `)

  return { unsubscribed: true, email: c?.email ?? null }
}

/** Re-subscribe (support request, or the owner fixing a mistake). */
export async function resubscribe(contactId: string, companyId: string) {
  await db.update(contact)
    .set({ emailOptOut: false, emailOptOutAt: null })
    .where(and(eq(contact.id, contactId), eq(contact.companyId, companyId)))
  return { resubscribed: true }
}

// ============================================
// HELPERS
// ============================================

/** Public base for pixel/click/unsubscribe URLs inside campaign mail. */
function publicBaseUrl(): string {
  return (process.env.API_BASE_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '')
}

/**
 * Add what a bulk email legally and practically needs: an open pixel, click
 * tracking, and a working unsubscribe link. CAN-SPAM requires the opt-out;
 * the tracking is what makes the stats real.
 */
function decorateCampaignHtml(html: string, recipientId: string | null, contactId: string): string {
  const base = publicBaseUrl()
  if (!base) return html // no public URL configured — send the mail rather than break it

  const rid = recipientId || 'none'
  const unsubscribeUrl = `${base}/api/marketing/unsubscribe/${rid}/${contactId}`

  let out = html || ''

  // Route real links through the click tracker (skip anchors we just added).
  if (recipientId) {
    out = out.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url) => {
      if (url.startsWith(base + '/api/marketing/')) return `href="${url}"`
      return `href="${base}/api/marketing/track/click/${recipientId}?url=${encodeURIComponent(url)}"`
    })
  }

  out += `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
      <p style="margin:0 0 4px;">You are receiving this because you are a customer or contact of ours.</p>
      <p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></p>
    </div>`

  if (recipientId) {
    out += `<img src="${base}/api/marketing/track/open/${recipientId}" width="1" height="1" alt="" style="display:none;" />`
  }

  return out
}

async function sendEmail({ to, subject, html, fromName, fromEmail }: { to: string; subject: string; html: string; fromName?: string; fromEmail?: string }) {
  // Provider-agnostic: whatever the tenant has configured (the deploy pipeline
  // provisions Resend). This used to call SendGrid directly and no-op without
  // SENDGRID_API_KEY, which no tenant ever gets.
  await sendRaw({ to, subject, html, fromName, fromEmail })
}

function personalizeContent(content: string, contactData: any): string {
  if (!content) return content

  const replacements: Record<string, string> = {
    '{{name}}': contactData.name || 'there',
    '{{firstName}}': contactData.firstName || contactData.name?.split(' ')[0] || 'there',
    '{{lastName}}': contactData.lastName || '',
    '{{email}}': contactData.email || '',
    '{{company}}': contactData.company || '',
  }

  let result = content
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(key, 'g'), value)
  }

  return result
}

/**
 * Get marketing stats
 */
export async function getMarketingStats(companyId: string) {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [campaignCount] = await db.select({ value: count() })
    .from(campaign)
    .where(eq(campaign.companyId, companyId))

  const [recentSends] = await db.select({ value: count() })
    .from(emailLog)
    .where(and(eq(emailLog.companyId, companyId), gte(emailLog.sentAt, thirtyDaysAgo)))

  const seqResult = await db.execute(sql`
    SELECT COUNT(*)::int AS active FROM drip_sequence WHERE company_id = ${companyId} AND active = true
  `)
  const enrollResult = await db.execute(sql`
    SELECT COUNT(*)::int AS active
    FROM sequence_enrollment se JOIN drip_sequence ds ON se.sequence_id = ds.id
    WHERE ds.company_id = ${companyId} AND se.status = 'active'
  `)

  // Engagement across everything sent in the last 30 days.
  const engagement = await db.execute(sql`
    SELECT
      COUNT(*)::int AS sent,
      COUNT(*) FILTER (WHERE er.opened_at IS NOT NULL)::int AS opened,
      COUNT(*) FILTER (WHERE er.clicked_at IS NOT NULL)::int AS clicked,
      COUNT(*) FILTER (WHERE er.status = 'unsubscribed')::int AS unsubscribed
    FROM email_recipient er
    JOIN campaign cp ON er.campaign_id = cp.id
    WHERE cp.company_id = ${companyId} AND er.created_at >= ${thirtyDaysAgo}
  `)
  const eng = (engagement.rows?.[0] as any) || {}

  const [optOuts] = await db.select({ value: count() })
    .from(contact)
    .where(and(eq(contact.companyId, companyId), eq(contact.emailOptOut, true)))

  const sent = Number(eng.sent || 0)
  const pct = (n: number) => (sent ? Math.round((n / sent) * 1000) / 10 : 0)

  return {
    totalCampaigns: campaignCount?.value ?? 0,
    activeSequences: Number((seqResult.rows?.[0] as any)?.active ?? 0),
    activeEnrollments: Number((enrollResult.rows?.[0] as any)?.active ?? 0),
    emailsSent30Days: recentSends?.value ?? 0,
    campaignSends30Days: sent,
    opened30Days: Number(eng.opened || 0),
    clicked30Days: Number(eng.clicked || 0),
    unsubscribed30Days: Number(eng.unsubscribed || 0),
    openRate: pct(Number(eng.opened || 0)),
    clickRate: pct(Number(eng.clicked || 0)),
    totalOptOuts: optOuts?.value ?? 0,
  }
}

export async function deleteCampaign(id: string, companyId: string) {
  return db.delete(campaign).where(and(eq(campaign.id, id), eq(campaign.companyId, companyId)))
}

export default {
  deleteCampaign,
  createTemplate,
  getTemplates,
  updateTemplate,
  duplicateTemplate,
  createCampaign,
  getCampaigns,
  getCampaign,
  updateCampaign,
  sendCampaign,
  getCampaignRecipients,
  scheduleCampaign,
  createSequence,
  updateSequence,
  getSequences,
  enrollInSequence,
  processDripEmails,
  processScheduledCampaigns,
  startMarketingProcessor,
  previewAudience,
  resubscribe,
  trackOpen,
  trackClick,
  handleUnsubscribe,
  getMarketingStats,
}
