/**
 * Marketing Service
 *
 * Simple marketing for dispensaries:
 * - Send bulk SMS/email promotions to contacts
 * - Audience segmentation by contact type, loyalty tier, opt-in status
 */

import { db } from '../../db/index.ts'
import { contact, loyaltyMember } from '../../db/schema.ts'
import { eq, and, gte, sql } from 'drizzle-orm'
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

export default {
  sendPromoEmail,
  getAudiencePreview,
  getSmsOptedInMembers,
  getEmailOptedInMembers,
  handleUnsubscribe,
  getMarketingStats,
}
