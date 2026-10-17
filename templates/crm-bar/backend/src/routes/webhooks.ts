import { Hono } from 'hono'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { contact, company, lead } from '../../db/schema.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { eq, asc } from 'drizzle-orm'
import logger from '../services/logger.ts'
import { insertLead } from '../shared/index.ts'
import { isFeatureEnabled } from '../middleware/enabledFeature.ts'
import { createEvent, validateEventInput, DATE_RE, MAX_EVENT_NAME } from '../services/eventBooking.ts'
import { phoneKey } from '../services/barLoyalty.ts'

const app = new Hono()

// Verify webhook secret
function verifyWebhook(c: any): boolean {
  const secret = c.req.header('x-webhook-secret')
  const expected = process.env.WEBHOOK_SECRET || process.env.JWT_SECRET
  if (!expected || !secret) return false
  // Timing-safe, as every other CRM's copy: === returns as soon as a character differs, which leaks how much of a
  // guess was right.
  if (secret.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
}

// ─── The bar website's two forms (website-premium-bar handleBarForm → forwardLeadToCrm) ─────────────────
const OCCASION_TYPES: Array<[RegExp, string]> = [
  [/birthday|bday/i, 'birthday'], [/anniversar/i, 'anniversary'], [/wedding|rehearsal|shower|engagement/i, 'wedding'],
  [/christmas|holiday|xmas/i, 'christmas_party'], [/work|office|company|corporate|team/i, 'corporate'],
  [/funeral|memorial|celebration of life|wake/i, 'funeral'],
]
const occasionType = (o: string | null) => (o ? OCCASION_TYPES.find(([re]) => re.test(o))?.[1] : null) || 'other'
const clip = (v: unknown, n: number) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null }

/** The guest this form is from: the existing contact (same email, or same phone) or a new one. Never edits a guest. */
async function guestFor(tx: any, companyId: string, name: string, email: string | null, phone: string | null, type: string) {
  const rows = await tx.select().from(contact).where(eq(contact.companyId, companyId))
  // One phone key with the register's (services/barLoyalty.ts): '+1 715 555 0142' and '(715) 555-0142' are one guest.
  const e = (email || '').toLowerCase(), p = phoneKey(phone)
  const hit = rows.find((r: any) => (e && String(r.email || '').toLowerCase() === e) || (p.length >= 7 && (phoneKey(r.phone) === p || phoneKey(r.mobile) === p)))
  if (hit) return { guest: hit, created: false }
  const [row] = await tx.insert(contact).values({ name, type, email: email || undefined, phone: phone || undefined, source: 'website', companyId }).returning()
  return { guest: row, created: true }
}

/**
 * A PARTY ENQUIRY WITH A DATE IS AN EVENT ENQUIRY. The restaurant's site form had no date, so its enquiries went
 * to the Lead Inbox to be converted by hand (t59-website-enquiry). A bar's party form asks for the date and the
 * head count, so it opens the enquiry in the party book directly — status `enquiry`, which never holds a room —
 * for the guest it came from. Without a date (or with Parties switched off) it is an ordinary lead.
 */
async function partyEnquiry(companyId: string, body: any): Promise<{ eventId: string; contactId: string } | null> {
  const date = typeof body.requestedDate === 'string' && DATE_RE.test(body.requestedDate) ? body.requestedDate : null
  if (!date || !(await isFeatureEnabled(companyId, 'event_bookings'))) return null
  const name = clip(body.name, 120)!
  const size = Number.parseInt(String(body.partySize ?? ''), 10)
  const occasion = clip(body.occasion, 80)
  const input = {
    name: `${occasion || 'Party'} — ${name}`.slice(0, MAX_EVENT_NAME), eventDate: date, status: 'enquiry',
    eventType: occasionType(occasion), guestCount: Number.isFinite(size) && size > 0 && size <= 2000 ? size : null,
    notes: clip(body.message, 2000), source: 'website',
  }
  if (validateEventInput(input)) return null // a date that is not a real day: leave it to the inbox, never drop it
  return db.transaction(async (tx: any) => {
    const { guest } = await guestFor(tx, companyId, name, clip(body.email, 200), clip(body.phone, 40), 'lead')
    const ev = await createEvent(tx, companyId, { ...input, contactId: guest.id })
    return { eventId: ev.id, contactId: guest.id }
  })
}

/**
 * THE REGULARS: a guest who asked to hear from the bar. The contact is tagged `regular`; their birthday and, when
 * they ticked the box, the consent EVIDENCE (the exact words shown, where, when, from which address) go on the
 * contact's custom fields, appended — the form never changes an existing guest's name, phone or type.
 */
async function joinRegulars(companyId: string, body: any): Promise<string> {
  const name = clip(body.name, 120)!
  return db.transaction(async (tx: any) => {
    const { guest } = await guestFor(tx, companyId, name, clip(body.email, 200), clip(body.phone, 40), 'client')
    const tags: string[] = Array.isArray(guest.tags) ? guest.tags : []
    const custom: Record<string, any> = guest.customFields && typeof guest.customFields === 'object' ? { ...guest.customFields } : {}
    const month = Number(body.birthdayMonth), day = Number(body.birthdayDay)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) custom.birthday = { month, day }
    if (clip(body.consentText, 1000) && clip(body.email, 200)) {
      const evidence = { channel: 'email', text: clip(body.consentText, 1000), source: clip(body.consentSource, 200) || 'website', ip: clip(body.consentIp, 80), at: new Date().toISOString() }
      custom.marketingConsent = [...(Array.isArray(custom.marketingConsent) ? custom.marketingConsent : []), evidence]
    }
    await tx.update(contact).set({ tags: tags.includes('regular') ? tags : [...tags, 'regular'], customFields: custom, updatedAt: new Date() }).where(eq(contact.id, guest.id))
    return guest.id
  })
}

// POST /api/webhooks/leads - receive leads from website contact forms
app.post('/leads', async (c) => {
  if (!verifyWebhook(c)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json()
  const { name, email, phone, service, message, source, address, city, state, zip } = body

  if (!name) {
    return c.json({ error: 'Name is required' }, 400)
  }

  // Find the company (single-tenant: first company)
  const [comp] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
  if (!comp) {
    logger.warn('Webhook: No company found to assign lead')
    return c.json({ error: 'No company configured' }, 500)
  }

  // The bar's party and Regulars forms (see partyEnquiry / joinRegulars above).
  if (body.formType === 'party') {
    const made = await partyEnquiry(comp.id, body)
    if (made) {
      emitToCompany(comp.id, EVENTS.CONTACT_CREATED, { id: made.contactId })
      logger.info('Webhook: party enquiry opened', { eventId: made.eventId })
      return c.json({ success: true, eventId: made.eventId, contactId: made.contactId }, 201)
    }
  } else if (body.formType === 'regulars') {
    const id = await joinRegulars(comp.id, body)
    emitToCompany(comp.id, EVENTS.CONTACT_CREATED, { id })
    logger.info('Webhook: joined the Regulars', { id })
    return c.json({ success: true, id }, 201)
  }

  /**
   * A WEBSITE ENQUIRY IS A LEAD, SO IT GOES WHERE LEADS GO.
   *
   * This wrote a Contact of type `lead` and nothing else, so a business with the Lead Inbox had two
   * places a lead could be — Angi and Google in the inbox, its own website in Contacts — and the inbox,
   * the one with new / contacted / dismissed, never saw the enquiries that came from its own site.
   * Now it lands in the inbox as `new`, and Convert makes the contact the same way it does for every
   * other source (linking an existing one by email or phone instead of duplicating it).
   *
   * Only where the inbox is switched on. A tenant without it has nowhere to see an inbox lead, so it
   * keeps the Contact this always wrote — moving it would make every enquiry disappear.
   */
  if (await isFeatureEnabled(comp.id, 'lead_inbox')) {
    const row = await insertLead(db, lead, {
      companyId: comp.id,
      sourceId: null,
      platform: 'website',
      parsed: {
        name,
        email,
        phone,
        jobType: service,
        location: [address, city, state, zip].filter(Boolean).join(', '),
        description: message,
      },
      rawPayload: body,
    })
    emitToCompany(comp.id, EVENTS.LEAD_CREATED, { id: row.id, sourcePlatform: 'website', homeownerName: row.homeownerName })
    logger.info('Webhook: Lead added to the Lead Inbox', { id: row.id, name, source: source || 'website' })
    return c.json({ success: true, id: row.id }, 201)
  }

  const notes = [
    service && `Service: ${service}`,
    message && `Message: ${message}`,
  ].filter(Boolean).join('\n')

  const [newContact] = await db.insert(contact).values({
    name,
    type: 'lead',
    email: email || undefined,
    phone: phone || undefined,
    address: address || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    source: source || 'website',
    notes: notes || undefined,
    companyId: comp.id,
  }).returning()

  emitToCompany(comp.id, EVENTS.CONTACT_CREATED, newContact)
  logger.info('Webhook: Lead created', { id: newContact.id, name, source: source || 'website' })

  return c.json({ success: true, id: newContact.id }, 201)
})

export default app
