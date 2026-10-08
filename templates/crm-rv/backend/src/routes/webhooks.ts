import { Hono } from 'hono'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { contact, company, salesLead } from '../../db/schema.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { eq, asc, and, isNull, sql } from 'drizzle-orm'
import logger from '../services/logger.ts'
import { leadIdentityOf, lockLeadIdentity, findLeadContact } from '../services/leadContact.ts'

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
  const [comp] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
  if (!comp) {
    logger.warn('Webhook: No company found to assign lead')
    return c.json({ error: 'No company configured' }, 500)
  }

  const notes = [
    service && `Service: ${service}`,
    message && `Message: ${message}`,
  ].filter(Boolean).join('\n')

  const leadSource = source || 'website'

  /**
   * A RETURNING CUSTOMER IS NOT A NEW PERSON. (T59)
   *
   * Every form and chat submission made a brand-new contact and a brand-new lead, so somebody who
   * asked about a second unit — or pressed Submit twice — became a second person in the CRM with a
   * second open lead. The ADF import never did that; it reuses the contact by email, or by phone when
   * nothing contradicts it, under a lock on the customer's identity. This door now asks the same rule
   * (services/leadContact.ts).
   *
   * Then the lead goes into the PIPELINE, as it always has — that is the dealership's lead queue, the
   * one the dashboard counts and the AI Lead Responder works. A resubmission of the same message by
   * the same person while their lead from it is still open (30 days) returns that lead instead of
   * opening another.
   */
  const outcome = await db.transaction(async (tx: any) => {
    const id = leadIdentityOf({ name, email, phone })
    await lockLeadIdentity(tx, comp.id, id)
    let person: any = await findLeadContact(tx, comp.id, id)
    let created = false
    if (!person) {
      ;[person] = await tx.insert(contact).values({
        name,
        type: 'lead',
        email: email || undefined,
        phone: phone || undefined,
        address: address || undefined,
        city: city || undefined,
        state: state || undefined,
        zip: zip || undefined,
        source: leadSource,
        notes: notes || undefined,
        companyId: comp.id,
      }).returning()
      created = true
    }
    if (!created) {
      const [open] = await tx.select().from(salesLead).where(and(
        eq(salesLead.companyId, comp.id),
        eq(salesLead.contactId, person.id),
        eq(salesLead.source, leadSource),
        notes ? eq(salesLead.notes, notes) : isNull(salesLead.notes),
        sql`${salesLead.stage} not in ('closed_won', 'closed_lost')`,
        sql`${salesLead.createdAt} > now() - make_interval(days => 30)`,
      )).limit(1)
      if (open) return { person, created, lead: open, duplicate: true }
    }
    const [opened] = await tx.insert(salesLead).values({ contactId: person.id, stage: 'new', source: leadSource, notes: notes || undefined, companyId: comp.id }).returning()
    return { person, created, lead: opened, duplicate: false }
  })

  if (outcome.created) emitToCompany(comp.id, EVENTS.CONTACT_CREATED, outcome.person)
  if (!outcome.duplicate) emitToCompany(comp.id, EVENTS.REFRESH, { entity: 'sales_lead' })
  logger.info(outcome.duplicate ? 'Webhook: same enquiry again — the open lead was kept' : 'Webhook: Lead created',
    { contactId: outcome.person.id, leadId: outcome.lead.id, matched: !outcome.created, name, source: leadSource })

  return c.json({ success: true, id: outcome.person.id, ...(outcome.duplicate ? { duplicate: true } : {}) }, outcome.duplicate ? 200 : 201)
})

export default app
