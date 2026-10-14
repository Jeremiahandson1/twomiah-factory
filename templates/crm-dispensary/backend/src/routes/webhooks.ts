/**
 * POST /api/webhooks/leads — the dispensary's own website sending a contact-form enquiry. (Website leads, 10/14)
 *
 * index.ts has loaded this file since the vertical was built (March) — inside a try/catch that swallowed the failure,
 * because the file was never written. So /api/webhooks/leads did not exist, and every enquiry from website-dispensary
 * and website-premium-dispensary answered 404 and was dropped, with nothing in any log on this side.
 *
 * Where it goes: a contact, type 'lead', source 'website', with the message in its notes. Customers lists every
 * contact, so the enquiry is on the screen staff already use. Not the `leads` table: no page in this CRM reads it, so
 * an enquiry written there would be invisible. The same shape this CRM's lead-source route writes.
 */
import { Hono } from 'hono'
import crypto from 'crypto'
import { asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, company } from '../../db/schema.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import logger from '../services/logger.ts'

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

  const notes = ['Website enquiry', service && `About: ${service}`, message && `Message: ${message}`].filter(Boolean).join('\n')
  const [newContact] = await db.insert(contact).values({
    companyId: comp.id,
    type: 'lead',
    name: fullName.slice(0, 200),
    email: email || undefined,
    phone: phone || undefined,
    address: address || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    source: source || 'website',
    notes,
  } as any).returning()
  emitToCompany(comp.id, EVENTS.CONTACT_CREATED, newContact)
  logger.info('Webhook: Website enquiry saved as a lead contact', { id: newContact.id, source: source || 'website' })
  return c.json({ success: true, id: newContact.id }, 201)
})

export default app
