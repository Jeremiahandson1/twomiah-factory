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
  marketingRecipient,
} from '../../db/schema.ts'
import { eq, and, gte, sql, desc } from 'drizzle-orm'
import sgMail from '@sendgrid/mail'
import { sendSMS } from './sms.ts'

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
export async function getAudiencePreview(companyId: string, audienceType: string, filter: any, channel = 'email') {
  const contacts = await getAudienceContacts(companyId, audienceType, filter)
  const reachable = await reachableAudience(companyId, contacts, channel)
  return {
    total: contacts.length,
    withEmail: contacts.filter(c => c.email).length,
    // T46 N9: this counted every contact holding a phone number — 26 of them — while the number
    // who had actually opted in to SMS was nought. Email is an opt-OUT medium and text messages
    // are an opt-IN one; counting them the same way is how a shop sends its first campaign to 26
    // people who never asked for it. `withPhone` is left as the raw count because the screen shows
    // it as "on file"; `reachable` is who the send will actually go to.
    withPhone: contacts.filter(c => c.phone).length,
    channel,
    reachable: reachable.length,
  }
}

/**
 * Who a campaign on this channel may lawfully go to.
 *
 *   email — anyone in the audience with an address who has not opted out (CAN-SPAM)
 *   sms   — only those who opted in, and only while they still have a number (TCPA, and every
 *           state's own rules on top of it)
 *
 * The SMS opt-in lives on the loyalty member, which is where a customer gives it. (T46 N9)
 */
export async function reachableAudience(
  companyId: string,
  contacts: { id: string; name: string | null; email: string | null; phone: string | null }[],
  channel: string,
): Promise<{ contactId: string; name: string | null; address: string }[]> {
  if (channel === 'sms') {
    const optedIn = await getSmsOptedInMembers(companyId)
    const allowed = new Map(optedIn.map((m: any) => [m.contactId, m.contactPhone]))
    return contacts
      .filter((c) => c.phone && allowed.has(c.id))
      .map((c) => ({ contactId: c.id, name: c.name, address: String(allowed.get(c.id) || c.phone) }))
  }
  return contacts
    .filter((c) => !!c.email)
    .map((c) => ({ contactId: c.id, name: c.name, address: String(c.email) }))
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
/**
 * Someone followed the unsubscribe link in a campaign.
 *
 * T46 N8, unreported half: the route calls this with (recipientId, contactId) and it took one
 * argument, so it received the RECIPIENT id, looked for a contact with that id, found none, and
 * did nothing at all — silently, because the caller wraps it in a try/catch and shows the same
 * "You have been unsubscribed" page either way. An unsubscribe link that lies is worse than no
 * link, and under CAN-SPAM it is the one thing a marketing email must actually do.
 *
 * The recipient row is what proves the person following the link was sent that campaign — without
 * it, the URL is an open invitation to unsubscribe anyone whose id you can guess.
 */
export async function handleUnsubscribe(recipientId: string, contactId?: string) {
  let targetId = contactId || null

  if (recipientId) {
    const [rec] = await db.select().from(marketingRecipient).where(eq(marketingRecipient.id, recipientId)).limit(1)
    if (rec) {
      // The link has to name the contact the campaign actually went to.
      if (contactId && rec.contactId && rec.contactId !== contactId) {
        throw new Error('That unsubscribe link does not match the message it came from')
      }
      targetId = rec.contactId || targetId
      await db.update(marketingRecipient)
        .set({ unsubscribedAt: new Date() } as any)
        .where(eq(marketingRecipient.id, recipientId))
    } else if (!contactId) {
      // No recipient row and no contact named: there is nothing this link can honestly do.
      throw new Error('That unsubscribe link is no longer valid')
    }
  }

  if (!targetId) throw new Error('That unsubscribe link is no longer valid')

  const [c] = await db.select().from(contact).where(eq(contact.id, targetId))
  if (!c) throw new Error('That unsubscribe link is no longer valid')

  const customFields = (c.customFields as any) || {}
  customFields.emailOptOut = true
  customFields.emailOptOutDate = new Date().toISOString()
  await db.update(contact)
    .set({ customFields })
    .where(eq(contact.id, targetId))

  // Unsubscribing from marketing means marketing, not just email. Someone who has asked to be left
  // alone should not still be on the text list.
  await db.update(loyaltyMember)
    .set({ optedInSms: false, optedInEmail: false } as any)
    .where(and(eq(loyaltyMember.companyId, c.companyId as string), eq(loyaltyMember.contactId, targetId)))

  return { contactId: targetId }
}

/** The open pixel was fetched. Recorded once — a mail client that re-renders is not a second open. */
export async function trackOpen(recipientId: string) {
  if (!recipientId) return
  await db.execute(sql`
    UPDATE marketing_recipients SET opened_at = COALESCE(opened_at, NOW()) WHERE id = ${recipientId}
  `)
}

/** A link in the campaign was followed. */
export async function trackClick(recipientId: string, _url?: string | null) {
  if (!recipientId) return
  await db.execute(sql`
    UPDATE marketing_recipients
    SET clicked_at = COALESCE(clicked_at, NOW()), opened_at = COALESCE(opened_at, NOW())
    WHERE id = ${recipientId}
  `)
}

/**
 * Send a campaign.
 *
 * T46 N8 (high): this function did not exist. The route called it, every send answered 400 with
 * the TypeError's own text — "marketing.sendCampaign is not a function" — which also put a piece
 * of the server's internals in front of the operator. No campaign could be sent at all.
 *
 * A send is recorded per recipient before anything leaves, so the open pixel, the click redirect
 * and the unsubscribe link in the message have a row to point at, and so "who did we text" can be
 * answered later. A campaign that reaches nobody is refused rather than marked sent.
 */
export async function sendCampaign(id: string, companyId: string) {
  const [campaign] = await db.select().from(marketingCampaign)
    .where(and(eq(marketingCampaign.id, id), eq(marketingCampaign.companyId, companyId))).limit(1)
  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status === 'sent') throw new Error('That campaign has already been sent')

  const channel = String(campaign.type || 'email').toLowerCase() === 'sms' ? 'sms' : 'email'
  const filter: any = campaign.audienceFilter || {}
  const audienceType = filter?.audienceType || (filter && Object.keys(filter).length ? 'segment' : 'all')

  const contacts = await getAudienceContacts(companyId, audienceType, filter)
  const recipients = await reachableAudience(companyId, contacts, channel)

  if (recipients.length === 0) {
    throw new Error(channel === 'sms'
      ? 'Nobody in this audience has opted in to text messages, so there is nobody to send to.'
      : 'Nobody in this audience has an email address, so there is nobody to send to.')
  }

  let sent = 0
  let failed = 0

  for (const r of recipients) {
    const [row] = await db.insert(marketingRecipient).values({
      companyId, campaignId: campaign.id, contactId: r.contactId,
      channel, address: r.address, status: 'sent',
    } as any).returning()

    try {
      if (channel === 'sms') {
        await sendSMS(companyId, { contactId: r.contactId, toPhone: r.address, message: personalizeContent(String(campaign.content || ''), r) })
      } else {
        await sendEmail({
          to: r.address,
          subject: personalizeContent(String(campaign.subject || campaign.name || ''), r),
          html: personalizeContent(String(campaign.content || ''), r),
        })
      }
      sent++
    } catch (err: any) {
      failed++
      await db.update(marketingRecipient)
        .set({ status: 'failed', error: String(err?.message || 'send failed').slice(0, 500) } as any)
        .where(eq(marketingRecipient.id, row.id))
    }
  }

  if (sent === 0) throw new Error(`Nothing could be sent — all ${failed} message(s) failed.`)

  await db.update(marketingCampaign).set({
    status: 'sent', sentAt: new Date(), recipientCount: sent, updatedAt: new Date(),
  } as any).where(eq(marketingCampaign.id, campaign.id))

  return { sent, failed, total: recipients.length, channel }
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
  sendCampaign,
  trackOpen,
  trackClick,
  reachableAudience,
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
