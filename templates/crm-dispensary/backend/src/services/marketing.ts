/**
 * Marketing Service
 *
 * Simple marketing for dispensaries:
 * - Send bulk SMS/email promotions to contacts
 * - Audience segmentation by contact type, loyalty tier, opt-in status
 */

import { db } from '../../db/index.ts'
import {
  contact,
  loyaltyMember,
  marketingTemplate,
  marketingCampaign,
  marketingSequence,
  marketingSequenceEnrollment,
} from '../../db/schema.ts'
import { eq, and, gte, sql, desc } from 'drizzle-orm'
import sgMail from '@sendgrid/mail'

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

// ============================================
// SEND PROMOTIONS
// ============================================

/**
 * Send a promotional email to a list of contacts
 */
export async function sendPromoEmail(
  companyId: string,
  {
    subject,
    body,
    audienceType = 'all',
    filter = null,
  }: {
    subject: string
    body: string
    audienceType?: string
    filter?: any
  }
) {
  const contacts = await getAudienceContacts(companyId, audienceType, filter)

  let sentCount = 0
  let failedCount = 0

  for (const c of contacts) {
    if (!c.email) continue
    try {
      await sendEmail({
        to: c.email,
        subject: personalizeContent(subject, c),
        html: personalizeContent(body, c),
      })
      sentCount++
    } catch (error: any) {
      failedCount++
      console.error(`Failed to send to ${c.email}:`, error.message)
    }
  }

  return { sent: sentCount, failed: failedCount, total: contacts.length }
}

/**
 * Get a preview of the audience (how many contacts will receive the message)
 */
export async function getAudiencePreview(companyId: string, audienceType: string, filter: any) {
  const contacts = await getAudienceContacts(companyId, audienceType, filter)
  return {
    total: contacts.length,
    withEmail: contacts.filter(c => c.email).length,
    withPhone: contacts.filter(c => c.phone).length,
  }
}

// ============================================
// AUDIENCE SEGMENTATION
// ============================================

/**
 * Get contacts based on audience criteria
 */
async function getAudienceContacts(companyId: string, audienceType: string, filter: any) {
  const conditions = [eq(contact.companyId, companyId)]

  if (audienceType === 'segment' && filter) {
    const parsed = typeof filter === 'string' ? JSON.parse(filter) : filter

    if (parsed.type) {
      conditions.push(eq(contact.type, parsed.type))
    }
    if (parsed.createdAfter) {
      conditions.push(gte(contact.createdAt, new Date(parsed.createdAfter)))
    }
  }

  // Filter to contacts that haven't opted out
  conditions.push(
    sql`(${contact.customFields}->>'emailOptOut' IS NULL OR ${contact.customFields}->>'emailOptOut' != 'true')`
  )

  return db.select({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
  })
    .from(contact)
    .where(and(...conditions))
}

/**
 * Get loyalty members who opted in for SMS promotions
 */
export async function getSmsOptedInMembers(companyId: string) {
  return db.select({
    memberId: loyaltyMember.id,
    contactId: loyaltyMember.contactId,
    tier: loyaltyMember.tier,
    contactName: contact.name,
    contactPhone: contact.phone,
  })
    .from(loyaltyMember)
    .innerJoin(contact, eq(loyaltyMember.contactId, contact.id))
    .where(and(
      eq(loyaltyMember.companyId, companyId),
      eq(loyaltyMember.optedInSms, true),
      sql`${contact.phone} IS NOT NULL`,
    ))
}

/**
 * Get loyalty members who opted in for email promotions
 */
export async function getEmailOptedInMembers(companyId: string) {
  return db.select({
    memberId: loyaltyMember.id,
    contactId: loyaltyMember.contactId,
    tier: loyaltyMember.tier,
    contactName: contact.name,
    contactEmail: contact.email,
  })
    .from(loyaltyMember)
    .innerJoin(contact, eq(loyaltyMember.contactId, contact.id))
    .where(and(
      eq(loyaltyMember.companyId, companyId),
      eq(loyaltyMember.optedInEmail, true),
      sql`${contact.email} IS NOT NULL`,
    ))
}

// ============================================
// UNSUBSCRIBE
// ============================================

/**
 * Handle unsubscribe
 */
export async function handleUnsubscribe(contactId: string) {
  const [c] = await db.select().from(contact).where(eq(contact.id, contactId))
  if (c) {
    const customFields = (c.customFields as any) || {}
    customFields.emailOptOut = true
    customFields.emailOptOutDate = new Date().toISOString()
    await db.update(contact)
      .set({ customFields })
      .where(eq(contact.id, contactId))
  }
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
    '{{firstName}}': contactData.name?.split(' ')[0] || 'there',
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
 * Get basic marketing stats
 */
export async function getMarketingStats(companyId: string) {
  const [totalContacts] = await db.select({ value: sql<number>`count(*)` })
    .from(contact)
    .where(eq(contact.companyId, companyId))

  const [withEmail] = await db.select({ value: sql<number>`count(*)` })
    .from(contact)
    .where(and(eq(contact.companyId, companyId), sql`${contact.email} IS NOT NULL`))

  const [smsOptIn] = await db.select({ value: sql<number>`count(*)` })
    .from(loyaltyMember)
    .where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.optedInSms, true)))

  return {
    totalContacts: totalContacts?.value ?? 0,
    contactsWithEmail: withEmail?.value ?? 0,
    smsOptedIn: smsOptIn?.value ?? 0,
  }
}

export async function deleteCampaign(id: string, companyId: string) {
  return db.delete(marketingCampaign).where(and(eq(marketingCampaign.id, id), eq(marketingCampaign.companyId, companyId)))
}

// ============================================
// TEMPLATES
// ============================================

/**
 * List marketing templates for a company, optionally filtered by category and active state.
 * `active`: true = active only, false = inactive only, null = all.
 */
export async function getTemplates(
  companyId: string,
  { category, active }: { category?: string | null; active?: boolean | null } = {}
) {
  const conditions = [eq(marketingTemplate.companyId, companyId)]
  if (category) conditions.push(eq(marketingTemplate.category, category))
  if (active === true || active === false) conditions.push(eq(marketingTemplate.isActive, active))

  return db.select()
    .from(marketingTemplate)
    .where(and(...conditions))
    .orderBy(desc(marketingTemplate.createdAt))
}

export async function createTemplate(companyId: string, body: any) {
  const [row] = await db.insert(marketingTemplate).values({
    companyId,
    name: body.name ?? null,
    subject: body.subject ?? null,
    content: body.content ?? null,
    type: body.type ?? 'email',
    category: body.category ?? null,
    variables: body.variables ?? [],
    isActive: body.isActive ?? true,
  }).returning()
  return row
}

export async function updateTemplate(id: string, companyId: string, body: any) {
  const updates: Record<string, any> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.subject !== undefined) updates.subject = body.subject
  if (body.content !== undefined) updates.content = body.content
  if (body.type !== undefined) updates.type = body.type
  if (body.category !== undefined) updates.category = body.category
  if (body.variables !== undefined) updates.variables = body.variables
  if (body.isActive !== undefined) updates.isActive = body.isActive

  const [row] = await db.update(marketingTemplate)
    .set(updates)
    .where(and(eq(marketingTemplate.id, id), eq(marketingTemplate.companyId, companyId)))
    .returning()
  return row
}

export async function duplicateTemplate(id: string, companyId: string) {
  const [existing] = await db.select()
    .from(marketingTemplate)
    .where(and(eq(marketingTemplate.id, id), eq(marketingTemplate.companyId, companyId)))
  if (!existing) return null  // route maps null → 404 (don't throw → 500)

  const [row] = await db.insert(marketingTemplate).values({
    companyId,
    name: `${existing.name ?? 'Untitled'} (Copy)`,
    subject: existing.subject,
    content: existing.content,
    type: existing.type,
    category: existing.category,
    variables: existing.variables ?? [],
    isActive: existing.isActive ?? true,
  }).returning()
  return row
}

// ============================================
// CAMPAIGNS
// ============================================

export async function getCampaigns(
  companyId: string,
  { status, page = 1, limit = 50 }: { status?: string | null; page?: number; limit?: number } = {}
) {
  const conditions = [eq(marketingCampaign.companyId, companyId)]
  if (status) conditions.push(eq(marketingCampaign.status, status))

  const safeLimit = Math.max(1, limit)
  const safePage = Math.max(1, page)

  return db.select()
    .from(marketingCampaign)
    .where(and(...conditions))
    .orderBy(desc(marketingCampaign.createdAt))
    .limit(safeLimit)
    .offset((safePage - 1) * safeLimit)
}

export async function getCampaign(id: string, companyId: string) {
  const [row] = await db.select()
    .from(marketingCampaign)
    .where(and(eq(marketingCampaign.id, id), eq(marketingCampaign.companyId, companyId)))
  return row ?? null
}

export async function createCampaign(companyId: string, body: any) {
  const [row] = await db.insert(marketingCampaign).values({
    companyId,
    name: body.name ?? null,
    type: body.type ?? 'email',
    subject: body.subject ?? null,
    content: body.content ?? null,
    audienceFilter: body.audienceFilter ?? body.filter ?? {},
    status: body.status ?? 'draft',
  }).returning()
  return row
}

export async function updateCampaign(id: string, companyId: string, body: any) {
  const updates: Record<string, any> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.type !== undefined) updates.type = body.type
  if (body.subject !== undefined) updates.subject = body.subject
  if (body.content !== undefined) updates.content = body.content
  if (body.audienceFilter !== undefined) updates.audienceFilter = body.audienceFilter
  else if (body.filter !== undefined) updates.audienceFilter = body.filter
  if (body.status !== undefined) updates.status = body.status

  const [row] = await db.update(marketingCampaign)
    .set(updates)
    .where(and(eq(marketingCampaign.id, id), eq(marketingCampaign.companyId, companyId)))
    .returning()
  return row
}

export async function scheduleCampaign(id: string, companyId: string, scheduledFor: string | Date) {
  const scheduledAt = scheduledFor ? new Date(scheduledFor) : null
  const [row] = await db.update(marketingCampaign)
    .set({ status: 'scheduled', scheduledAt, updatedAt: new Date() })
    .where(and(eq(marketingCampaign.id, id), eq(marketingCampaign.companyId, companyId)))
    .returning()
  return row
}

// ============================================
// DRIP SEQUENCES
// ============================================

export async function getSequences(companyId: string) {
  return db.select()
    .from(marketingSequence)
    .where(eq(marketingSequence.companyId, companyId))
    .orderBy(desc(marketingSequence.createdAt))
}

export async function createSequence(companyId: string, body: any) {
  const [row] = await db.insert(marketingSequence).values({
    companyId,
    name: body.name ?? null,
    triggerType: body.triggerType ?? body.trigger_type ?? null,
    steps: body.steps ?? [],
    isActive: body.isActive ?? true,
  }).returning()
  return row
}

export async function enrollInSequence(sequenceId: string, contactId: string, companyId: string) {
  const [row] = await db.insert(marketingSequenceEnrollment).values({
    companyId,
    sequenceId,
    contactId,
    currentStep: 0,
    status: 'active',
  }).returning()
  return row
}

export default {
  deleteCampaign,
  sendPromoEmail,
  getAudiencePreview,
  getSmsOptedInMembers,
  getEmailOptedInMembers,
  handleUnsubscribe,
  getMarketingStats,
  // Templates
  getTemplates,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  // Campaigns
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  scheduleCampaign,
  // Sequences
  getSequences,
  createSequence,
  enrollInSequence,
}
