import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, company, lead } from '../../db/schema.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { eq, asc } from 'drizzle-orm'
import logger from '../services/logger.ts'
import { insertLead } from '../shared/index.ts'
import { isFeatureEnabled } from '../middleware/enabledFeature.ts'

const app = new Hono()

// Verify webhook secret
function verifyWebhook(c: any): boolean {
  const secret = c.req.header('x-webhook-secret')
  const expected = process.env.WEBHOOK_SECRET || process.env.JWT_SECRET
  if (!expected || !secret) return false
  return secret === expected
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
