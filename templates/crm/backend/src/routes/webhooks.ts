import { Hono } from 'hono'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { contact, company } from '../../db/schema.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { eq } from 'drizzle-orm'
import logger from '../services/logger.ts'

const app = new Hono()

// Verify webhook secret (timing-safe)
function verifyWebhook(c: any): boolean {
  const secret = c.req.header('x-webhook-secret')
  const expected = process.env.WEBHOOK_SECRET || process.env.JWT_SECRET
  if (!expected || !secret) return false
  if (secret.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
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
  const [comp] = await db.select({ id: company.id }).from(company).limit(1)
  if (!comp) {
    logger.warn('Webhook: No company found to assign lead')
    return c.json({ error: 'No company configured' }, 500)
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
