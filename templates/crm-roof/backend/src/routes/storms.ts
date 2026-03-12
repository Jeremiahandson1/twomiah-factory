import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { stormEvent, stormLead, contact, job, company } from '../../db/schema.ts'
import { eq, and, desc, sql, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { generateStormLeads, checkExistingCustomers } from '../services/stormData.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /events — list storm events
app.get('/events', async (c) => {
  const { companyId } = c.get('user')
  const status = c.req.query('status')

  const conditions: any[] = [eq(stormEvent.companyId, companyId)]
  if (status) conditions.push(eq(stormEvent.status, status))

  const events = await db.select().from(stormEvent)
    .where(and(...conditions))
    .orderBy(desc(stormEvent.eventDate))
  return c.json(events)
})

// POST /events — manually create storm event
app.post('/events', async (c) => {
  const { companyId } = c.get('user')
  const body = await c.req.json()
  const [event] = await db.insert(stormEvent).values({
    companyId,
    eventDate: body.eventDate ? new Date(body.eventDate) : new Date(),
    eventType: body.eventType || 'hail',
    affectedZipCodes: body.affectedZipCodes || [],
    hailSizeInches: body.hailSizeInches ? String(body.hailSizeInches) : null,
    windSpeedMph: body.windSpeedMph || null,
    description: body.description || null,
    status: 'detected',
    source: 'manual',
  }).returning()
  return c.json(event, 201)
})

// GET /events/:id — event detail
app.get('/events/:id', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const [event] = await db.select().from(stormEvent)
    .where(and(eq(stormEvent.id, id), eq(stormEvent.companyId, companyId)))
    .limit(1)
  if (!event) return c.json({ error: 'Event not found' }, 404)

  // Get lead count by status
  const leadStats = await db.select({
    status: stormLead.status,
    count: count(),
  }).from(stormLead)
    .where(and(eq(stormLead.stormEventId, id), eq(stormLead.companyId, companyId)))
    .groupBy(stormLead.status)

  // Sample leads
  const sampleLeads = await db.select().from(stormLead)
    .where(and(eq(stormLead.stormEventId, id), eq(stormLead.companyId, companyId)))
    .orderBy(desc(stormLead.createdAt))
    .limit(20)

  return c.json({ ...event, leadStats, sampleLeads })
})

// POST /events/:id/generate-leads — trigger lead generation
app.post('/events/:id/generate-leads', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const [event] = await db.select().from(stormEvent)
    .where(and(eq(stormEvent.id, id), eq(stormEvent.companyId, companyId)))
    .limit(1)
  if (!event) return c.json({ error: 'Event not found' }, 404)

  const zipCodes = (event.affectedZipCodes as string[]) || []
  if (zipCodes.length === 0) return c.json({ error: 'No zip codes specified' }, 400)

  const leadCount = await generateStormLeads(companyId, id, zipCodes)

  // Check for existing customers
  const existingCustomers = await checkExistingCustomers(companyId, id)

  return c.json({ leadCount, existingCustomersFound: existingCustomers.length })
})

// POST /events/:id/dismiss — dismiss event
app.post('/events/:id/dismiss', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const [updated] = await db.update(stormEvent).set({ status: 'dismissed' })
    .where(and(eq(stormEvent.id, id), eq(stormEvent.companyId, companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Event not found' }, 404)
  return c.json(updated)
})

// GET /events/:id/leads — paginated leads for event
app.get('/events/:id/leads', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const status = c.req.query('status')

  const conditions: any[] = [
    eq(stormLead.stormEventId, id),
    eq(stormLead.companyId, companyId),
  ]
  if (status) conditions.push(eq(stormLead.status, status))

  const where = and(...conditions)
  const [leads, [{ value: total }]] = await Promise.all([
    db.select().from(stormLead).where(where)
      .orderBy(desc(stormLead.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(stormLead).where(where),
  ])

  // Check which leads match existing contacts
  const existingContacts = await db.select({ address: contact.address, zip: contact.zip, id: contact.id })
    .from(contact).where(eq(contact.companyId, companyId))
  const existingSet = new Set(existingContacts.map(c => `${c.address}|${c.zip}`))

  const leadsWithFlags = leads.map(l => ({
    ...l,
    isExistingCustomer: existingSet.has(`${l.address}|${l.zip}`),
  }))

  return c.json({ data: leadsWithFlags, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// PUT /leads/:id — update lead status
app.put('/leads/:id', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const updates: any = {}
  if (body.status !== undefined) updates.status = body.status
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.estimatedDamage !== undefined) updates.estimatedDamage = body.estimatedDamage

  const [updated] = await db.update(stormLead).set(updates)
    .where(and(eq(stormLead.id, id), eq(stormLead.companyId, companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Lead not found' }, 404)
  return c.json(updated)
})

// POST /leads/:id/convert — convert storm lead to CRM job
app.post('/leads/:id/convert', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()

  const [lead] = await db.select().from(stormLead)
    .where(and(eq(stormLead.id, id), eq(stormLead.companyId, companyId)))
    .limit(1)
  if (!lead) return c.json({ error: 'Lead not found' }, 404)
  if (lead.jobId) return c.json({ error: 'Lead already converted' }, 400)

  // Get storm event for context
  const [event] = await db.select().from(stormEvent)
    .where(eq(stormEvent.id, lead.stormEventId))
    .limit(1)

  // Create contact
  const nameParts = (body.name || 'Storm Lead').split(' ')
  const [newContact] = await db.insert(contact).values({
    companyId,
    firstName: nameParts[0] || 'Storm',
    lastName: nameParts.slice(1).join(' ') || 'Lead',
    phone: body.phone || null,
    email: body.email || null,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    leadSource: 'storm',
    propertyType: 'residential',
  }).returning()

  // Generate job number
  const [maxResult] = await db
    .select({ maxNum: sql<string>`MAX(${job.jobNumber})` })
    .from(job).where(eq(job.companyId, companyId))
  let nextNum = 1
  if (maxResult?.maxNum) {
    const match = maxResult.maxNum.match(/ROOF-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }

  const stormDesc = event ? `Storm lead — ${event.eventType} ${event.hailSizeInches ? event.hailSizeInches + '" hail' : ''} on ${new Date(event.eventDate).toLocaleDateString()}` : 'Storm lead'

  const [newJob] = await db.insert(job).values({
    companyId,
    contactId: newContact.id,
    jobNumber: `ROOF-${String(nextNum).padStart(4, '0')}`,
    jobType: 'insurance',
    status: 'lead',
    propertyAddress: lead.address || '',
    city: lead.city || '',
    state: lead.state || '',
    zip: lead.zip || '',
    source: 'storm',
    priority: 'high',
    notes: stormDesc,
  }).returning()

  // Update storm lead
  await db.update(stormLead).set({
    status: 'converted',
    jobId: newJob.id,
    contactId: newContact.id,
  }).where(eq(stormLead.id, id))

  return c.json({ jobId: newJob.id, contactId: newContact.id })
})

// POST /leads/bulk-convert — convert multiple leads
app.post('/leads/bulk-convert', async (c) => {
  const { companyId } = c.get('user')
  const { leadIds } = await c.req.json()
  if (!Array.isArray(leadIds) || leadIds.length === 0) return c.json({ error: 'No leads specified' }, 400)

  let converted = 0
  for (const leadId of leadIds.slice(0, 50)) { // max 50 at a time
    try {
      const [lead] = await db.select().from(stormLead)
        .where(and(eq(stormLead.id, leadId), eq(stormLead.companyId, companyId)))
        .limit(1)
      if (!lead || lead.jobId) continue

      const [event] = lead.stormEventId
        ? await db.select().from(stormEvent).where(eq(stormEvent.id, lead.stormEventId)).limit(1)
        : [null]

      const [newContact] = await db.insert(contact).values({
        companyId,
        firstName: 'Storm',
        lastName: 'Lead',
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        leadSource: 'storm',
        propertyType: 'residential',
      }).returning()

      const [maxResult] = await db.select({ maxNum: sql<string>`MAX(${job.jobNumber})` })
        .from(job).where(eq(job.companyId, companyId))
      let nextNum = 1
      if (maxResult?.maxNum) {
        const match = maxResult.maxNum.match(/ROOF-(\d+)/)
        if (match) nextNum = parseInt(match[1], 10) + 1
      }

      const stormDesc = event ? `Storm lead — ${event.eventType} on ${new Date(event.eventDate).toLocaleDateString()}` : 'Storm lead'
      const [newJob] = await db.insert(job).values({
        companyId,
        contactId: newContact.id,
        jobNumber: `ROOF-${String(nextNum).padStart(4, '0')}`,
        jobType: 'insurance',
        status: 'lead',
        propertyAddress: lead.address || '',
        city: lead.city || '',
        state: lead.state || '',
        zip: lead.zip || '',
        source: 'storm',
        priority: 'high',
        notes: stormDesc,
      }).returning()

      await db.update(stormLead).set({ status: 'converted', jobId: newJob.id, contactId: newContact.id })
        .where(eq(stormLead.id, leadId))
      converted++
    } catch {}
  }
  return c.json({ converted })
})

// POST /leads/bulk-dismiss — dismiss multiple leads
app.post('/leads/bulk-dismiss', async (c) => {
  const { companyId } = c.get('user')
  const { leadIds } = await c.req.json()
  if (!Array.isArray(leadIds)) return c.json({ error: 'No leads specified' }, 400)

  let dismissed = 0
  for (const leadId of leadIds) {
    const [updated] = await db.update(stormLead).set({ status: 'dismissed' })
      .where(and(eq(stormLead.id, leadId), eq(stormLead.companyId, companyId)))
      .returning()
    if (updated) dismissed++
  }
  return c.json({ dismissed })
})

// GET /service-area — get configured service area
app.get('/service-area', async (c) => {
  const { companyId } = c.get('user')
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  const settings = (comp?.settings as any) || {}
  return c.json({
    zipCodes: settings.serviceAreaZips || [],
    stormAlertEnabled: settings.stormAlertEnabled || false,
    minHailSize: settings.stormMinHailSize || 1.0,
    maxLeadsPerZip: settings.stormMaxLeadsPerZip || 200,
    autoGenerate: settings.stormAutoGenerate || false,
  })
})

// PUT /service-area — update service area
app.put('/service-area', async (c) => {
  const { companyId } = c.get('user')
  const body = await c.req.json()
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)

  const settings = { ...(comp.settings as any || {}) }
  if (body.zipCodes !== undefined) settings.serviceAreaZips = body.zipCodes
  if (body.stormAlertEnabled !== undefined) settings.stormAlertEnabled = body.stormAlertEnabled
  if (body.minHailSize !== undefined) settings.stormMinHailSize = body.minHailSize
  if (body.maxLeadsPerZip !== undefined) settings.stormMaxLeadsPerZip = body.maxLeadsPerZip
  if (body.autoGenerate !== undefined) settings.stormAutoGenerate = body.autoGenerate

  await db.update(company).set({ settings, updatedAt: new Date() }).where(eq(company.id, companyId))
  return c.json({ success: true })
})

export default app
