import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { lead, leadSource } from '../../db/schema.ts'
import { contact } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql, gte } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()

// ─── Public Inbound Endpoints (no auth) ────────────────────────────────────────

app.post('/inbound/email', async (c) => {
  // This endpoint receives forwarded lead notification emails
  // No auth — identified by the To address which contains the company ID
  const body = await c.req.json()

  const { to, from, subject, text, html } = body

  // Extract company ID from inbound email: leads+{companyIdPrefix}-{platform}@inbound.twomiah.com
  const toMatch = (to || '').match(/leads\+([a-z0-9]+)-([a-z_]+)@/)
  if (!toMatch) return c.json({ error: 'Invalid inbound address' }, 400)

  const companyIdPrefix = toMatch[1]
  const platform = toMatch[2]

  // Find company by ID prefix
  const companies = await db.select().from(leadSource)
    .where(eq(leadSource.platform, platform))
  const source = companies.find(s => s.companyId.startsWith(companyIdPrefix))
  if (!source || !source.enabled) return c.json({ error: 'Source not found or disabled' }, 404)

  // Parse lead details based on platform
  const parsed = parseLeadEmail(platform, subject || '', text || '', html || '')

  const [newLead] = await db.insert(lead).values({
    id: createId(),
    sourcePlatform: platform,
    sourceId: source.id,
    homeownerName: parsed.name || 'Unknown',
    email: parsed.email,
    phone: parsed.phone,
    jobType: parsed.jobType,
    location: parsed.location,
    budget: parsed.budget,
    description: parsed.description,
    status: 'new',
    rawPayload: body,
    receivedAt: new Date(),
    companyId: source.companyId,
  }).returning()

  emitToCompany(source.companyId, EVENTS.REFRESH, { entity: 'lead' })
  return c.json({ success: true, leadId: newLead.id }, 201)
})

app.post('/inbound/webhook/:source', async (c) => {
  const sourcePlatform = c.req.param('source')
  const body = await c.req.json()

  // Verify webhook secret if provided
  const secret = c.req.header('x-webhook-secret') || c.req.query('secret')

  // Find matching source by webhook secret
  let source: any = null
  if (secret) {
    const [found] = await db.select().from(leadSource)
      .where(and(eq(leadSource.platform, sourcePlatform), eq(leadSource.webhookSecret, secret)))
      .limit(1)
    source = found
  } else {
    // For platforms that don't support secrets, use company_id from query
    const companyId = c.req.query('company_id')
    if (companyId) {
      const [found] = await db.select().from(leadSource)
        .where(and(eq(leadSource.platform, sourcePlatform), eq(leadSource.companyId, companyId)))
        .limit(1)
      source = found
    }
  }

  if (!source || !source.enabled) return c.json({ error: 'Source not found or disabled' }, 404)

  const parsed = parseWebhookPayload(sourcePlatform, body)

  const [newLead] = await db.insert(lead).values({
    id: createId(),
    sourcePlatform,
    sourceId: source.id,
    homeownerName: parsed.name || 'Unknown',
    email: parsed.email,
    phone: parsed.phone,
    jobType: parsed.jobType,
    location: parsed.location,
    budget: parsed.budget,
    description: parsed.description,
    status: 'new',
    rawPayload: body,
    receivedAt: new Date(),
    companyId: source.companyId,
  }).returning()

  emitToCompany(source.companyId, EVENTS.REFRESH, { entity: 'lead' })
  return c.json({ success: true, leadId: newLead.id }, 201)
})

// ─── Authenticated Routes ──────────────────────────────────────────────────────
app.use('*', authenticate)

// ─── Lead Sources CRUD ─────────────────────────────────────────────────────────

app.get('/sources', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const sources = await db.select().from(leadSource)
    .where(eq(leadSource.companyId, currentUser.companyId))
    .orderBy(desc(leadSource.createdAt))
  return c.json({ data: sources })
})

app.post('/sources', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()
  const inboundEmail = `leads+${currentUser.companyId.slice(0, 8)}-${body.platform}@inbound.twomiah.com`
  const webhookUrl = `${c.req.url.replace(/\/api\/leads\/sources$/, '')}/api/leads/inbound/webhook/${body.platform}`

  const [source] = await db.insert(leadSource).values({
    id: createId(),
    platform: body.platform,
    label: body.label || body.platform,
    inboundEmail,
    webhookUrl,
    webhookSecret: createId(),
    enabled: true,
    config: body.config || {},
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'lead_source', entityId: source.id, metadata: source, req: { user: currentUser } })
  return c.json(source, 201)
})

app.put('/sources/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(leadSource)
    .where(and(eq(leadSource.id, id), eq(leadSource.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Source not found' }, 404)

  const [updated] = await db.update(leadSource)
    .set({ label: body.label, enabled: body.enabled, config: body.config, updatedAt: new Date() })
    .where(eq(leadSource.id, id))
    .returning()

  return c.json(updated)
})

app.delete('/sources/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(leadSource)
    .where(and(eq(leadSource.id, id), eq(leadSource.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Source not found' }, 404)

  await db.delete(leadSource).where(eq(leadSource.id, id))
  await audit.log({ action: 'delete', entity: 'lead_source', entityId: id, metadata: existing, req: { user: currentUser } })
  return c.json({ success: true })
})

// ─── Lead Inbox CRUD ────────────────────────────────────────────────────────────

app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const source = c.req.query('source')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions = [eq(lead.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(lead.status, status))
  if (source) conditions.push(eq(lead.sourcePlatform, source))
  if (search) {
    conditions.push(or(
      ilike(lead.homeownerName, `%${search}%`),
      ilike(lead.email, `%${search}%`),
      ilike(lead.jobType, `%${search}%`),
      ilike(lead.location, `%${search}%`),
    )!)
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(lead).where(where).orderBy(desc(lead.receivedAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(lead).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const leads = await db.select({
    sourcePlatform: lead.sourcePlatform,
    status: lead.status,
    receivedAt: lead.receivedAt,
    contactedAt: lead.contactedAt,
  }).from(lead).where(and(
    eq(lead.companyId, currentUser.companyId),
    gte(lead.receivedAt, thirtyDaysAgo),
  ))

  const bySource: Record<string, { total: number; converted: number; contacted: number; totalResponseMs: number; respondedCount: number }> = {}

  for (const l of leads) {
    const src = l.sourcePlatform
    if (!bySource[src]) bySource[src] = { total: 0, converted: 0, contacted: 0, totalResponseMs: 0, respondedCount: 0 }
    bySource[src].total++
    if (l.status === 'converted') bySource[src].converted++
    if (l.contactedAt && l.receivedAt) {
      bySource[src].contacted++
      bySource[src].totalResponseMs += new Date(l.contactedAt).getTime() - new Date(l.receivedAt).getTime()
      bySource[src].respondedCount++
    }
  }

  const stats = Object.entries(bySource).map(([platform, s]) => ({
    platform,
    leadsReceived: s.total,
    conversionRate: s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0,
    avgResponseTimeMin: s.respondedCount > 0 ? Math.round(s.totalResponseMs / s.respondedCount / 60000) : null,
  }))

  const totals = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    converted: leads.filter(l => l.status === 'converted').length,
    dismissed: leads.filter(l => l.status === 'dismissed').length,
  }

  return c.json({ stats, totals })
})

app.put('/:id/status', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const { status } = await c.req.json()

  const [existing] = await db.select().from(lead)
    .where(and(eq(lead.id, id), eq(lead.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Lead not found' }, 404)

  const updates: any = { status, updatedAt: new Date() }
  if (status === 'contacted' && !existing.contactedAt) updates.contactedAt = new Date()

  const [updated] = await db.update(lead).set(updates).where(eq(lead.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lead' })
  return c.json(updated)
})

app.post('/:id/convert', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(lead)
    .where(and(eq(lead.id, id), eq(lead.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Lead not found' }, 404)

  // Create contact from lead
  const [newContact] = await db.insert(contact).values({
    id: createId(),
    name: existing.homeownerName,
    email: existing.email || undefined,
    phone: existing.phone || undefined,
    address: existing.location || undefined,
    source: existing.sourcePlatform,
    type: 'lead',
    notes: `Converted from ${existing.sourcePlatform} lead. Job type: ${existing.jobType || 'N/A'}. Budget: ${existing.budget || 'N/A'}. Description: ${existing.description || 'N/A'}`,
    companyId: currentUser.companyId,
  }).returning()

  // Update lead status
  await db.update(lead).set({
    status: 'converted',
    convertedContactId: newContact.id,
    updatedAt: new Date(),
  }).where(eq(lead.id, id))

  await audit.log({ action: 'status_change', entity: 'lead', entityId: id, metadata: { contactId: newContact.id }, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'lead' })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'contact' })

  return c.json({ lead: { ...existing, status: 'converted' }, contact: newContact })
})

app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(lead)
    .where(and(eq(lead.id, id), eq(lead.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Lead not found' }, 404)

  await db.delete(lead).where(eq(lead.id, id))
  return c.json({ success: true })
})

// ─── Email Parsers ──────────────────────────────────────────────────────────────

interface ParsedLead {
  name?: string
  email?: string
  phone?: string
  jobType?: string
  location?: string
  budget?: string
  description?: string
}

function parseLeadEmail(platform: string, subject: string, text: string, html: string): ParsedLead {
  const content = text || html?.replace(/<[^>]+>/g, ' ') || ''

  switch (platform) {
    case 'angi':
      return parseAngiEmail(subject, content)
    case 'homeadvisor':
      return parseHomeAdvisorEmail(subject, content)
    case 'thumbtack':
      return parseThumbtackEmail(subject, content)
    case 'google_lsa':
      return parseGoogleLSAEmail(subject, content)
    case 'houzz':
      return parseHouzzEmail(subject, content)
    default:
      return parseGenericEmail(subject, content)
  }
}

function parseAngiEmail(subject: string, content: string): ParsedLead {
  // Angi emails: "New Lead from Angi: John Smith - Bathroom Remodel"
  const nameMatch = content.match(/(?:Customer|Homeowner|Name)[:\s]+([^\n]+)/i)
  const phoneMatch = content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)
  const emailMatch = content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)
  const jobMatch = subject.match(/[-–]\s*(.+)$/) || content.match(/(?:Service|Project|Job)[:\s]+([^\n]+)/i)
  const locationMatch = content.match(/(?:Location|Address|City)[:\s]+([^\n]+)/i)
  const descMatch = content.match(/(?:Description|Details|Notes)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)

  return {
    name: nameMatch?.[1]?.trim(),
    phone: phoneMatch?.[1]?.trim(),
    email: emailMatch?.[1]?.trim(),
    jobType: jobMatch?.[1]?.trim(),
    location: locationMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
  }
}

function parseHomeAdvisorEmail(subject: string, content: string): ParsedLead {
  // HomeAdvisor format
  const nameMatch = content.match(/(?:Customer|Homeowner|Name)[:\s]+([^\n]+)/i)
  const phoneMatch = content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)
  const emailMatch = content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)
  const jobMatch = content.match(/(?:Task|Service|Category)[:\s]+([^\n]+)/i)
  const locationMatch = content.match(/(?:Location|Address|Zip)[:\s]+([^\n]+)/i)
  const budgetMatch = content.match(/(?:Budget|Estimated Cost)[:\s]+([^\n]+)/i)
  const descMatch = content.match(/(?:Description|Details)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)

  return {
    name: nameMatch?.[1]?.trim(),
    phone: phoneMatch?.[1]?.trim(),
    email: emailMatch?.[1]?.trim(),
    jobType: jobMatch?.[1]?.trim(),
    location: locationMatch?.[1]?.trim(),
    budget: budgetMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
  }
}

function parseThumbtackEmail(subject: string, content: string): ParsedLead {
  // Thumbtack: "New request from John S. - Plumbing Repair"
  const subjectNameMatch = subject.match(/from\s+(.+?)(?:\s*[-–]|$)/i)
  const nameMatch = content.match(/(?:Customer|Name)[:\s]+([^\n]+)/i) || subjectNameMatch
  const phoneMatch = content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)
  const emailMatch = content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)
  const jobMatch = subject.match(/[-–]\s*(.+)$/) || content.match(/(?:Service|Request|Project)[:\s]+([^\n]+)/i)
  const locationMatch = content.match(/(?:Location|Zip|Area)[:\s]+([^\n]+)/i)
  const budgetMatch = content.match(/(?:Budget|Price Range)[:\s]+([^\n]+)/i)
  const descMatch = content.match(/(?:Details|Description|Message)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)

  return {
    name: (nameMatch?.[1] || '').trim() || undefined,
    phone: phoneMatch?.[1]?.trim(),
    email: emailMatch?.[1]?.trim(),
    jobType: jobMatch?.[1]?.trim(),
    location: locationMatch?.[1]?.trim(),
    budget: budgetMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
  }
}

function parseGoogleLSAEmail(subject: string, content: string): ParsedLead {
  const nameMatch = content.match(/(?:Customer|Name)[:\s]+([^\n]+)/i)
  const phoneMatch = content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)
  const jobMatch = content.match(/(?:Service|Category|Job Type)[:\s]+([^\n]+)/i)
  const locationMatch = content.match(/(?:Location|Zip|City)[:\s]+([^\n]+)/i)

  return {
    name: nameMatch?.[1]?.trim(),
    phone: phoneMatch?.[1]?.trim(),
    jobType: jobMatch?.[1]?.trim(),
    location: locationMatch?.[1]?.trim(),
  }
}

function parseHouzzEmail(subject: string, content: string): ParsedLead {
  const nameMatch = content.match(/(?:From|Name|Homeowner)[:\s]+([^\n]+)/i)
  const emailMatch = content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)
  const phoneMatch = content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)
  const descMatch = content.match(/(?:Message|Description|Details)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)
  const locationMatch = content.match(/(?:Location|City|Address)[:\s]+([^\n]+)/i)

  return {
    name: nameMatch?.[1]?.trim(),
    email: emailMatch?.[1]?.trim(),
    phone: phoneMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
    location: locationMatch?.[1]?.trim(),
  }
}

function parseGenericEmail(subject: string, content: string): ParsedLead {
  const nameMatch = content.match(/(?:Name|Customer|From)[:\s]+([^\n]+)/i)
  const phoneMatch = content.match(/(?:Phone|Tel|Mobile)[:\s]+([\d\-\(\)\s\+]+)/i)
  const emailMatch = content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)
  const descMatch = content.match(/(?:Message|Details|Description|Notes)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)

  return {
    name: nameMatch?.[1]?.trim(),
    phone: phoneMatch?.[1]?.trim(),
    email: emailMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
  }
}

function parseWebhookPayload(platform: string, body: any): ParsedLead {
  // Normalize webhook payloads from different sources
  switch (platform) {
    case 'angi':
      return {
        name: body.customer_name || body.name,
        email: body.customer_email || body.email,
        phone: body.customer_phone || body.phone,
        jobType: body.service_type || body.category,
        location: body.zip_code || body.location || body.city,
        budget: body.budget,
        description: body.description || body.details,
      }
    case 'homeadvisor':
      return {
        name: body.leadName || body.consumerName,
        email: body.leadEmail || body.consumerEmail,
        phone: body.leadPhone || body.consumerPhone,
        jobType: body.taskName || body.serviceName,
        location: body.zip || body.city,
        budget: body.estimatedBudget,
        description: body.description,
      }
    case 'thumbtack':
      return {
        name: body.customer?.name || body.request?.customer_name,
        email: body.customer?.email,
        phone: body.customer?.phone,
        jobType: body.request?.category || body.category,
        location: body.request?.location || body.zip_code,
        budget: body.request?.budget,
        description: body.request?.details || body.description,
      }
    case 'google_lsa':
      return {
        name: body.lead?.customer_name || body.customerName,
        phone: body.lead?.phone_number || body.phoneNumber,
        jobType: body.lead?.category || body.jobType,
        location: body.lead?.geo || body.location,
      }
    case 'houzz':
      return {
        name: body.lead_name || body.name,
        email: body.lead_email || body.email,
        phone: body.lead_phone || body.phone,
        description: body.message || body.description,
        location: body.location || body.city,
      }
    default:
      return {
        name: body.name || body.customer_name || body.lead_name,
        email: body.email || body.customer_email,
        phone: body.phone || body.customer_phone,
        jobType: body.job_type || body.service || body.category,
        location: body.location || body.address || body.city || body.zip,
        budget: body.budget,
        description: body.description || body.message || body.details,
      }
  }
}

export default app
