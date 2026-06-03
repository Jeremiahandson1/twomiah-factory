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
import { eq, and, or, desc, count, sql, gte, ilike } from 'drizzle-orm'
import sgMail from '@sendgrid/mail'

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

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
    INSERT INTO email_template (company_id, name, subject, body, category, design_json, active)
    VALUES (${companyId}, ${data.name}, ${data.subject}, ${data.body}, ${data.category}, ${data.designJson ? JSON.stringify(data.designJson) : null}, true)
    RETURNING *
  `)
  return result.rows?.[0] ?? result
}

/**
 * Get templates
 */
export async function getTemplates(companyId: string, { category, active = true }: { category?: string; active?: boolean | null } = {}) {
  let whereExtra = sql``
  if (category) whereExtra = sql`${whereExtra} AND category = ${category}`
  if (active !== null) whereExtra = sql`${whereExtra} AND active = ${active}`

  const result = await db.execute(sql`
    SELECT * FROM email_template
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
  if (data.category !== undefined) setClauses.push(sql`category = ${data.category}`)
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
    SELECT * FROM email_template WHERE id = ${templateId} AND company_id = ${companyId}
  `)
  const original = (origResult.rows?.[0] ?? null) as any
  if (!original) throw new Error('Template not found')

  const result = await db.execute(sql`
    INSERT INTO email_template (company_id, name, subject, body, category, design_json, active)
    VALUES (${companyId}, ${original.name + ' (Copy)'}, ${original.subject}, ${original.body}, ${original.category}, ${original.design_json}, true)
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

  const [updated] = await db.update(campaign)
    .set(data)
    .where(eq(campaign.id, campaignId))
    .returning()

  return updated
}

/**
 * Send campaign
 */
export async function sendCampaign(campaignId: string, companyId: string) {
  const [campaignRow] = await db.select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.companyId, companyId)))

  if (!campaignRow || campaignRow.status === 'sent') {
    throw new Error('Campaign already sent or not found')
  }

  // Get recipients based on audience
  const contacts = await getAudienceContacts(companyId, 'all', null)

  // Update campaign status
  await db.update(campaign)
    .set({ status: 'sending', sentAt: new Date(), recipientCount: contacts.length })
    .where(eq(campaign.id, campaignId))

  // Send emails
  let sentCount = 0
  for (const c of contacts) {
    try {
      await sendEmail({
        to: c.email!,
        subject: personalizeContent(campaignRow.subject || '', c),
        html: personalizeContent(campaignRow.content || '', c),
      })

      // Log the email
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

  // Update campaign status
  await db.update(campaign)
    .set({ status: 'sent' })
    .where(eq(campaign.id, campaignId))

  return { sent: sentCount }
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
  const seqResult = await db.execute(sql`
    INSERT INTO drip_sequence (company_id, name, description, trigger, active)
    VALUES (${companyId}, ${data.name}, ${data.description}, ${data.trigger}, false)
    RETURNING *
  `)
  const sequence = (seqResult.rows?.[0] as any)

  if (data.steps?.length) {
    for (let i = 0; i < data.steps.length; i++) {
      const step = data.steps[i]
      await db.execute(sql`
        INSERT INTO drip_sequence_step (sequence_id, step_number, delay_days, delay_hours, subject, body, template_id)
        VALUES (${sequence.id}, ${i + 1}, ${step.delayDays || 0}, ${step.delayHours || 0}, ${step.subject}, ${step.body}, ${step.templateId || null})
      `)
    }
  }

  return sequence
}

/**
 * Get sequences
 */
export async function getSequences(companyId: string) {
  const result = await db.execute(sql`
    SELECT ds.*, COUNT(dse.id) as enrollment_count
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
  // Check sequence exists and is active
  const seqResult = await db.execute(sql`
    SELECT * FROM drip_sequence WHERE id = ${sequenceId} AND company_id = ${companyId} AND active = true
  `)
  const sequence = (seqResult.rows?.[0] as any)
  if (!sequence) throw new Error('Sequence not found or has no steps')

  // Check if already enrolled
  const existingResult = await db.execute(sql`
    SELECT id FROM sequence_enrollment WHERE sequence_id = ${sequenceId} AND contact_id = ${contactId} AND status = 'active'
  `)
  if ((existingResult.rows?.length ?? 0) > 0) {
    throw new Error('Contact already enrolled in this sequence')
  }

  const result = await db.execute(sql`
    INSERT INTO sequence_enrollment (sequence_id, contact_id, current_step, status, next_email_at)
    VALUES (${sequenceId}, ${contactId}, 1, 'active', NOW())
    RETURNING *
  `)

  return result.rows?.[0] ?? result
}

/**
 * Process pending drip emails (called by cron)
 */
export async function processDripEmails() {
  const dueResult = await db.execute(sql`
    SELECT se.*, ds.company_id, c.email, c.name as contact_name
    FROM sequence_enrollment se
    JOIN drip_sequence ds ON se.sequence_id = ds.id
    JOIN contact c ON se.contact_id = c.id
    WHERE se.status = 'active' AND se.next_email_at <= NOW()
  `)

  const due = (dueResult.rows ?? []) as any[]
  let sent = 0

  for (const enrollment of due) {
    const stepResult = await db.execute(sql`
      SELECT * FROM drip_sequence_step WHERE sequence_id = ${enrollment.sequence_id} AND step_number = ${enrollment.current_step}
    `)
    const step = (stepResult.rows?.[0] as any)

    if (!step) {
      // Sequence complete
      await db.execute(sql`
        UPDATE sequence_enrollment SET status = 'completed', completed_at = NOW() WHERE id = ${enrollment.id}
      `)
      continue
    }

    try {
      await sendEmail({
        to: enrollment.email,
        subject: personalizeContent(step.subject, { name: enrollment.contact_name, email: enrollment.email }),
        html: personalizeContent(step.body, { name: enrollment.contact_name, email: enrollment.email }),
      })

      // Check for next step
      const nextStepResult = await db.execute(sql`
        SELECT * FROM drip_sequence_step WHERE sequence_id = ${enrollment.sequence_id} AND step_number = ${enrollment.current_step + 1}
      `)
      const nextStep = (nextStepResult.rows?.[0] as any)

      if (nextStep) {
        await db.execute(sql`
          UPDATE sequence_enrollment SET
            current_step = ${enrollment.current_step + 1},
            next_email_at = NOW() + INTERVAL '1 day' * ${nextStep.delay_days || 0} + INTERVAL '1 hour' * ${nextStep.delay_hours || 0},
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
      console.error('Failed to send drip email:', error)
    }
  }

  return { processed: due.length, sent }
}

// ============================================
// AUDIENCE SEGMENTATION
// ============================================

/**
 * Get contacts based on audience criteria
 */
async function getAudienceContacts(companyId: string, audienceType: string, filter: any) {
  const conditions = [eq(contact.companyId, companyId), sql`${contact.email} IS NOT NULL`]

  if (audienceType === 'segment' && filter) {
    const parsed = typeof filter === 'string' ? JSON.parse(filter) : filter

    if (parsed.type) {
      conditions.push(eq(contact.type, parsed.type))
    }
    if (parsed.createdAfter) {
      conditions.push(gte(contact.createdAt, new Date(parsed.createdAfter)))
    }
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

// ============================================
// EMAIL TRACKING
// ============================================

/**
 * Track email open
 */
export async function trackOpen(recipientId: string) {
  await db.execute(sql`
    UPDATE email_recipient SET status = 'opened', opened_at = NOW(), open_count = open_count + 1
    WHERE id = ${recipientId}
  `)
}

/**
 * Track email click
 */
export async function trackClick(recipientId: string, url: string) {
  await db.execute(sql`
    UPDATE email_recipient SET status = 'clicked', clicked_at = NOW(), click_count = click_count + 1
    WHERE id = ${recipientId}
  `)

  await db.execute(sql`
    INSERT INTO email_click (recipient_id, url) VALUES (${recipientId}, ${url})
  `)
}

/**
 * Handle unsubscribe
 */
export async function handleUnsubscribe(recipientId: string, contactId: string) {
  await db.execute(sql`
    UPDATE email_recipient SET status = 'unsubscribed' WHERE id = ${recipientId}
  `)

  // Update contact - add emailOptOut to contact notes/custom fields
  const [c] = await db.select().from(contact).where(eq(contact.id, contactId))
  if (c) {
    const customFields = (c.customFields as any) || {}
    customFields.emailOptOut = true
    customFields.emailOptOutDate = new Date().toISOString()
    await db.update(contact)
      .set({ customFields })
      .where(eq(contact.id, contactId))
  }

  // Cancel any active sequence enrollments
  await db.execute(sql`
    UPDATE sequence_enrollment SET status = 'unsubscribed'
    WHERE contact_id = ${contactId} AND status = 'active'
  `)
}

// ============================================
// HELPERS
// ============================================

async function sendEmail({ to, subject, html, fromName, fromEmail }: { to: string; subject: string; html: string; fromName?: string; fromEmail?: string }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('Email would be sent:', { to, subject })
    return
  }

  await sgMail.send({
    to,
    from: {
      email: fromEmail || process.env.DEFAULT_FROM_EMAIL!,
      name: fromName || process.env.DEFAULT_FROM_NAME!,
    },
    subject,
    html,
  })
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

  return {
    totalCampaigns: campaignCount?.value ?? 0,
    activeSequences: 0, // Would need drip_sequence table
    emailsSent30Days: recentSends?.value ?? 0,
  }
}

export default {
  createTemplate,
  getTemplates,
  updateTemplate,
  duplicateTemplate,
  createCampaign,
  getCampaigns,
  getCampaign,
  updateCampaign,
  sendCampaign,
  scheduleCampaign,
  createSequence,
  getSequences,
  enrollInSequence,
  processDripEmails,
  trackOpen,
  trackClick,
  handleUnsubscribe,
  getMarketingStats,
}
