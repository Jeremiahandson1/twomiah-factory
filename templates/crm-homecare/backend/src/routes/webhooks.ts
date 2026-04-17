import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { lead, agencies } from '../../db/schema.ts'
import logger from '../services/logger.ts'

const app = new Hono()

function verifyWebhook(c: any): boolean {
  const secret = c.req.header('x-webhook-secret') || c.req.header('x-factory-key')
  const allowed = [
    process.env.WEBHOOK_SECRET,
    process.env.JWT_SECRET,
    process.env.FACTORY_SYNC_KEY,
  ].filter(Boolean)
  if (!allowed.length || !secret) return false
  return allowed.includes(secret)
}

// POST /api/webhooks/leads - receive leads from website contact forms
app.post('/leads', async (c) => {
  if (!verifyWebhook(c)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json()
  const { name, email, phone, service, message, source, address } = body

  if (!name) {
    return c.json({ error: 'Name is required' }, 400)
  }

  // Get the company ID (single-tenant DB — first agency)
  const [company] = await db.select({ id: agencies.id }).from(agencies).limit(1)
  if (!company) {
    return c.json({ error: 'No company configured' }, 500)
  }

  const [newLead] = await db.insert(lead).values({
    companyId: company.id,
    homeownerName: name,
    email: email || undefined,
    phone: phone || undefined,
    jobType: service || undefined,
    location: address || undefined,
    description: message || undefined,
    sourcePlatform: source || 'website',
    status: 'new',
  }).returning()

  logger.info('Webhook: Lead created from website', { id: newLead.id, name, source: source || 'website' })

  return c.json({ success: true, id: newLead.id }, 201)
})

export default app
