import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { clients } from '../../db/schema.ts'
import logger from '../services/logger.ts'

const app = new Hono()

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

  // Split name into first/last
  const parts = name.trim().split(/\s+/)
  const firstName = parts[0] || name
  const lastName = parts.slice(1).join(' ') || ''

  const [newClient] = await db.insert(clients).values({
    firstName,
    lastName,
    email: email || undefined,
    phone: phone || undefined,
    address: address || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    serviceType: service || undefined,
    isActive: true,
  }).returning()

  logger.info('Webhook: Lead created as client', { id: newClient.id, name, source: source || 'website' })

  return c.json({ success: true, id: newClient.id }, 201)
})

export default app
