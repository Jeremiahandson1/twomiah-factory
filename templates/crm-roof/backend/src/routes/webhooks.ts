/**
 * POST /api/webhooks/leads — the roofer's own website sending a contact-form enquiry. (Website leads, 10/14)
 *
 * Every website template posts here (website-*\/routes/admin.ts, website-premium-*\/server-static.ts) with the
 * x-webhook-secret the Factory set on the site — this CRM's JWT_SECRET, or WEBHOOK_SECRET where one is set. This CRM
 * never had the route: its x-webhook-secret check is the marketplace feed (/api/leads/inbound/:source), a different
 * address, so every enquiry from a roofing site's form answered 404 and was dropped.
 *
 * The enquiry always goes into the lead table, so the message is kept — roof's contact has no notes column to hold
 * it. With the Lead Inbox on (every current plan) that is where it shows, as `new`, beside Angi and Google. With it
 * off there would be nowhere to see it, so the person is also written as a contact (first/last name, lead source
 * 'website'), exactly as the other CRMs fall back to a lead contact.
 */
import { Hono } from 'hono'
import crypto from 'crypto'
import { asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, company, lead } from '../../db/schema.ts'
import logger from '../services/logger.ts'
import { insertLead } from '../shared/index.ts'
import { isFeatureEnabled } from '../middleware/enabledFeature.ts'

const app = new Hono()

// The same timing-safe check as every other CRM's website webhook.
function verifyWebhook(c: any): boolean {
  const secret = c.req.header('x-webhook-secret')
  const expected = process.env.WEBHOOK_SECRET || process.env.JWT_SECRET
  if (!expected || !secret) return false
  if (secret.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
}

app.post('/leads', async (c) => {
  if (!verifyWebhook(c)) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'Send the enquiry as JSON' }, 400)
  const { name, email, phone, service, message, source, address, city, state, zip } = body as Record<string, any>
  const fullName = typeof name === 'string' ? name.trim() : ''
  if (!fullName) return c.json({ error: 'Name is required' }, 400)

  // Single-tenant: the first company.
  const [comp] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
  if (!comp) {
    logger.warn('Webhook: No company found to assign lead')
    return c.json({ error: 'No company configured' }, 500)
  }

  const row = await insertLead(db, lead, {
    companyId: comp.id,
    sourceId: null,
    platform: 'website',
    parsed: {
      name: fullName,
      email,
      phone,
      jobType: service,
      location: [address, city, state, zip].filter(Boolean).join(', '),
      description: message,
    },
    rawPayload: body,
  })

  if (await isFeatureEnabled(comp.id, 'lead_inbox')) {
    logger.info('Webhook: Lead added to the Lead Inbox', { id: row.id, source: source || 'website' })
    return c.json({ success: true, id: row.id }, 201)
  }

  const [first, ...rest] = fullName.split(/\s+/)
  const [newContact] = await db.insert(contact).values({
    companyId: comp.id,
    firstName: first,
    lastName: rest.join(' '),
    email: email || undefined,
    phone: phone || undefined,
    address: address || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    leadSource: source || 'website',
  } as any).returning()
  logger.info('Webhook: Lead contact created (Lead Inbox is off)', { id: newContact.id, leadId: row.id, source: source || 'website' })
  return c.json({ success: true, id: newContact.id, leadId: row.id }, 201)
})

export default app
