/**
 * Marketing Service
 *
 * Simple marketing for dispensaries:
 * - Send bulk SMS/email promotions to contacts
 * - Audience segmentation by contact type, loyalty tier, opt-in status
 */

import { db } from '../../db/index.ts'
import {
  company,
  contact,
  loyaltyMember,
  marketingTemplate,
  marketingCampaign,
  marketingSequence,
  marketingSequenceEnrollment,
  marketingRecipient,
} from '../../db/schema.ts'
import { eq, and, gte, sql, desc, inArray } from 'drizzle-orm'
import { sendSMS } from './sms.ts'
// The tenant's ONE email sender. The SendGrid client that used to be wired up here is gone: it was
// a second implementation of something this file already had, and it was the one that did not
// work. (T47 P1)
import emailService from './email.ts'
// A customer unsubscribing is a consent change like any other, and is written down like one. (T49 H1)
import audit from './audit.ts'

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
  // The EMAIL opt-out belongs to the email channel, and only to it. (T49 H1)
  //
  // It used to sit in getAudienceContacts, which both channels share, so following an unsubscribe
  // link in an email removed the contact from the TEXT audience as well — the tester watched a
  // segment go from 1 to 0 for both. Under US law these are two different permissions: a text needs
  // prior express consent (TCPA) and email is opt-out (CAN-SPAM). An email unsubscribe cannot
  // revoke a consent it was never given.
  const optedOut = await emailOptedOutContactIds(companyId, contacts.map((c) => c.id))
  return contacts
    .filter((c) => !!c.email && !optedOut.has(c.id))
    .map((c) => ({ contactId: c.id, name: c.name, address: String(c.email) }))
}

/** Which of these contacts have asked not to receive marketing EMAIL. */
export async function emailOptedOutContactIds(companyId: string, contactIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const ids = [...new Set(contactIds.filter(Boolean))]
  if (!ids.length) return out
  const rows: any = await db.execute(sql`
    SELECT id FROM contact
    WHERE company_id = ${companyId}
      AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      AND custom_fields->>'emailOptOut' = 'true'
  `)
  for (const r of ((rows as any).rows || rows)) out.add(String(r.id))
  return out
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
      // "customer" and "client" are the SAME segment. (T49/T53/T55 M3)
      //
      // The product says customer everywhere a person can read it, and the column stores `client` —
      // contactSchema has normalised the two since T21 L3. But order-ahead and the external-POS
      // import insert straight into the table, bypassing that schema, so they wrote the literal
      // 'customer'. The tenant ended up holding 45 clients and 11 customers for one idea, and this
      // filter matched whichever word the campaign happened to be saved with: Segment → Customer
      // reached 11 of 56 people, and none of the ones added on the Customers screen.
      //
      // Both writers are corrected below, but campaigns already saved carry the old word in their
      // audienceFilter, and so do the rows written before today. Matching either is what makes an
      // existing campaign mean what its author meant.
      const wanted = String(parsed.type) === 'customer' ? ['client', 'customer']
        : String(parsed.type) === 'client' ? ['client', 'customer']
        : [String(parsed.type)]
      conditions.push(wanted.length > 1 ? inArray(contact.type, wanted) : eq(contact.type, wanted[0]))
    }
    if (parsed.createdAfter) {
      conditions.push(gte(contact.createdAt, new Date(parsed.createdAfter)))
    }
  }

  // The email opt-out is NOT applied here. It is a per-CHANNEL permission and this query serves
  // both channels, so filtering it here took an email unsubscriber off the text list too. It moved
  // to reachableAudience, which knows which channel it is answering for. (T49 H1)

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

  // EMAIL only. (T49 H1)
  //
  // This used to set optedInSms: false as well, on the reasoning that "unsubscribing from marketing
  // means marketing". That reasoning is wrong in law and wrong for the customer. A marketing text
  // needs prior express consent under the TCPA and is given at the counter; marketing email is
  // opt-out under CAN-SPAM. They are two permissions, and a link at the bottom of an email cannot
  // revoke the one it was never granted. The tester's customer agreed to texts at the till, clicked
  // unsubscribe in an email, and could never be texted again.
  //
  // The date goes with the flag: an optedInEmailAt left filled in beside optedInEmail false is the
  // "date left behind looking like live consent" that Q3 exists to prevent. (T49 L5)
  await db.update(loyaltyMember)
    .set({ optedInEmail: false, optedInEmailAt: null, updatedAt: new Date() } as any)
    .where(and(eq(loyaltyMember.companyId, c.companyId as string), eq(loyaltyMember.contactId, targetId)))

  // …and it is written down where every other consent change is written down. Every tick on the
  // Members screen is audited; the one change a CUSTOMER makes was the only one that was not, so
  // "why did this person stop receiving email" had no answer. (T49 H1)
  try {
    // There is no signed-in user on an unsubscribe — a mail client follows the link — so the
    // company is named directly and the actor is described in words.
    await audit.log({
      action: 'update', entity: 'marketing_consent', entityId: targetId, entityName: c.name || 'Customer',
      changes: { optedInEmail: { old: true, new: false } },
      metadata: { channel: 'email', by: 'the customer, through the unsubscribe link in a campaign', recipientId: recipientId || null },
      req: { user: { companyId: c.companyId, email: 'the customer (unsubscribe link)' } },
    } as any)
  } catch { /* an unsubscribe must never fail for want of an audit row */ }

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

  // Refused BEFORE anything goes out, not per recipient — a marketing email with no postal address
  // is unlawful to send at all, so the honest failure is the whole campaign, once, saying what to
  // fix. (T48 Q1)
  const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  let address: string | null = null
  if (channel === 'email') {
    address = postalAddress(co)
    if (!address) {
      throw new Error('Add your business\'s street address in Settings first. US anti-spam law requires a postal address in every marketing email, so this cannot be sent without one.')
    }
  }

  let sent = 0
  let failed = 0
  const reasons: string[] = []

  for (const r of recipients) {
    const [row] = await db.insert(marketingRecipient).values({
      companyId, campaignId: campaign.id, contactId: r.contactId,
      channel, address: r.address, status: 'sent',
    } as any).returning()

    try {
      if (channel === 'sms') {
        await sendSMS(companyId, { contactId: r.contactId, toPhone: r.address, message: personalizeContent(String(campaign.content || ''), r) })
      } else {
        // The link names this recipient row, which is what proves the person following it was sent
        // this campaign. The header is what puts an Unsubscribe control next to the sender in Gmail.
        const url = unsubscribeUrl(row.id, String(r.contactId || ''))
        await sendEmail({
          to: r.address,
          subject: personalizeContent(String(campaign.subject || campaign.name || ''), r),
          html: personalizeContent(String(campaign.content || ''), r) + marketingFooter(co, address as string, url),
          headers: {
            'List-Unsubscribe': `<${url}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })
      }
      sent++
    } catch (err: any) {
      failed++
      const reason = String(err?.message || 'send failed').slice(0, 500)
      if (!reasons.includes(reason)) reasons.push(reason)
      await db.update(marketingRecipient)
        .set({ status: 'failed', error: reason } as any)
        .where(eq(marketingRecipient.id, row.id))
    }
  }

  // Say WHY, not just how many. A campaign that reached nobody because the wallet is empty and one
  // that reached nobody because every address bounced need different things done about them. (T48 Q2)
  if (sent === 0) throw new Error(`Nothing was sent. ${reasons[0] || `All ${failed} message(s) failed.`}`)

  await db.update(marketingCampaign).set({
    status: 'sent', sentAt: new Date(), recipientCount: sent, updatedAt: new Date(),
  } as any).where(eq(marketingCampaign.id, campaign.id))

  return { sent, failed, total: recipients.length, channel }
}

/**
 * Every person a campaign was sent to, with what happened to their copy.
 *
 * Summarised as well as listed, because the question an owner asks is "did it go out" and the
 * answer is a count, not a table. (T47 P1)
 */
export async function getCampaignRecipients(campaignId: string, companyId: string) {
  const rows = await db.select().from(marketingRecipient)
    .where(and(eq(marketingRecipient.campaignId, campaignId), eq(marketingRecipient.companyId, companyId)))
    .orderBy(desc(marketingRecipient.sentAt))

  const summary = { total: rows.length, sent: 0, failed: 0, opened: 0, clicked: 0, unsubscribed: 0 }
  for (const r of rows) {
    if (r.status === 'failed') summary.failed++; else summary.sent++
    if (r.openedAt) summary.opened++
    if (r.clickedAt) summary.clicked++
    if (r.unsubscribedAt) summary.unsubscribed++
  }

  return {
    ...summary,
    recipients: rows.map((r) => ({
      id: r.id, contactId: r.contactId, channel: r.channel, address: r.address,
      status: r.status, error: r.error, sentAt: r.sentAt,
      openedAt: r.openedAt, clickedAt: r.clickedAt, unsubscribedAt: r.unsubscribedAt,
    })),
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * One sender for the whole tenant — services/email.ts, which detects Resend, SendGrid, Mailgun, SES,
 * Postmark or SMTP and refuses in production when none is configured.
 *
 * T47 P1: this used to be a PRIVATE implementation hardwired to SendGrid, which this platform does
 * not use. With no SENDGRID_API_KEY it logged "Email would be sent" and returned normally, so every
 * recipient was counted sent, the campaign was stamped sent, and nothing left the building —
 * while every other email in the tenant went out fine through the shared service. A second
 * implementation of something that already worked, silently failing next to the one that didn't.
 */
async function sendEmail({ to, subject, html, fromName, fromEmail, headers }: { to: string; subject: string; html: string; fromName?: string; fromEmail?: string; headers?: Record<string, string> }) {
  await emailService.sendRaw(to, subject, html, {
    ...(fromEmail ? { from: { name: fromName || fromEmail, address: fromEmail } } : {}),
    ...(headers ? { headers } : {}),
  })
}

// ── what the law requires to be in the message ──────────────────────────────────────────────────
//
// T48 Q1: the campaign body was sent exactly as typed and nothing else. No unsubscribe link, no
// postal address, and no List-Unsubscribe header — so Gmail showed no unsubscribe control next to
// the sender either. CAN-SPAM (15 U.S.C. §7704(a)(3),(5)) requires a working opt-out mechanism and
// the sender's valid physical postal address in every commercial email. Both were missing from
// every campaign this product has ever sent.
//
// The unsubscribe machinery already existed and worked — handleUnsubscribe, the public route, the
// recipient row that proves the link belongs to the person following it. Nothing ever put the link
// in the message. This is the half that was missing.

/** The sender's postal address on one line, or null when the tenant has not set a usable one. */
function postalAddress(co: any): string | null {
  // The STREET is required, not "two of the four fields". (T49 H3)
  //
  // The first version counted non-empty parts and accepted any two, so blanking the street while
  // city, state and zip stayed set still passed — and a campaign went out with a footer reading
  // "Columbus, OH 43004", which is not an address anyone could send post to. The refusal talks
  // about a street address, so the check has to be about the street address.
  //
  // CAN-SPAM asks for a valid physical postal address. A town and a postcode identify a place; they
  // do not identify the sender's premises, which is the point of the requirement.
  const street = String(co?.address || '').trim()
  const city = String(co?.city || '').trim()
  const region = [co?.state, co?.zip].map((p: any) => String(p || '').trim()).filter(Boolean).join(' ')
  if (!street || !city) return null
  return [street, city, region].filter(Boolean).join(', ')
}

/** Absolute, because a mail client has no page to be relative to. */
function unsubscribeUrl(recipientId: string, contactId: string): string {
  const base = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
  return `${base}/api/marketing/unsubscribe/${recipientId}/${contactId}`
}

/**
 * The footer every marketing email carries. Plain, small, and last — it is a legal notice, not a
 * design element, and it says who sent this and how to stop it.
 */
function marketingFooter(co: any, address: string, url: string): string {
  const who = esc(String(co?.name || 'This business'))
  return [
    '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#666">',
    `<p style="margin:0 0 6px">You are receiving this because you gave ${who} your email address.`,
    ` <a href="${esc(url)}" style="color:#666">Unsubscribe</a> to stop receiving marketing email from us.</p>`,
    `<p style="margin:0">${who}, ${esc(address)}</p>`,
    '</div>',
  ].join('')
}

/** The campaign body is operator-written, but the footer is ours and must not be breakable by a name. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

  /**
   * "Reachable by email" has to mean reachable. (T56)
   *
   * The tile counted `email IS NOT NULL`, which is neither of the two things that decide whether a
   * send reaches someone: an empty string passed as an address, and a contact who has unsubscribed
   * was still counted. So the page said 28 reachable while the New Campaign dialog — which asks
   * reachableAudience(), the function the send itself uses — said 25. Two numbers for one question,
   * on the same screen.
   *
   * This is now the same rule reachableAudience applies for the email channel: a non-empty address,
   * and no CAN-SPAM opt-out.
   */
  const [withEmail] = await db.select({ value: sql<number>`count(*)` })
    .from(contact)
    .where(and(
      eq(contact.companyId, companyId),
      sql`COALESCE(${contact.email}, '') <> ''`,
      sql`COALESCE(custom_fields->>'emailOptOut', '') <> 'true'`,
    ))

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
  getCampaignRecipients,
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
