import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { salesLead, contact, vehicle, user } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /sales-leads — pipeline list
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const stage = c.req.query('stage')
  const assignedTo = c.req.query('assignedTo')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(salesLead.companyId, currentUser.companyId)]
  if (stage) conditions.push(eq(salesLead.stage, stage))
  if (assignedTo) conditions.push(eq(salesLead.assignedTo, assignedTo))

  const where = and(...conditions)

  const data = await db.select({
    lead: salesLead,
    contactName: contact.name,
    contactEmail: contact.email,
    contactPhone: contact.phone,
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
    vehicleTrim: vehicle.trim,
    vehicleStockNumber: vehicle.stockNumber,
    salespersonFirstName: user.firstName,
    salespersonLastName: user.lastName,
  })
    .from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .leftJoin(vehicle, eq(salesLead.vehicleId, vehicle.id))
    .leftJoin(user, eq(salesLead.assignedTo, user.id))
    .where(where)
    .orderBy(desc(salesLead.createdAt))
    .offset((page - 1) * limit)
    .limit(limit)

  const [{ value: total }] = await db.select({ value: count() }).from(salesLead).where(where)

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// GET /sales-leads/stats
app.get('/stats', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const leads = await db.select({ stage: salesLead.stage, source: salesLead.source })
    .from(salesLead)
    .where(eq(salesLead.companyId, currentUser.companyId))

  const byStage: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1
    bySource[l.source] = (bySource[l.source] || 0) + 1
  }
  return c.json({ total: leads.length, byStage, bySource })
})

// POST /sales-leads
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(salesLead).values({
    id: createId(),
    contactId: body.contactId,
    vehicleId: body.vehicleId || null,
    source: body.source || 'web',
    stage: body.stage || 'new',
    assignedTo: body.assignedTo || null,
    notes: body.notes || null,
    tradeInInfo: body.tradeInInfo || null,
    followUpDate: body.followUpDate ? new Date(body.followUpDate) : null,
    companyId: currentUser.companyId,
  }).returning()

  await audit(currentUser, 'sales_lead', created.id, 'created', null, created)
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })
  return c.json(created, 201)
})

// PUT /sales-leads/:id — update stage, assignment, etc.
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(salesLead).where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Lead not found' }, 404)

  const updates: any = { ...body, updatedAt: new Date() }
  if (body.stage === 'closed_won' || body.stage === 'closed_lost') {
    updates.closedAt = new Date()
  }

  const [updated] = await db.update(salesLead).set(updates).where(eq(salesLead.id, id)).returning()
  await audit(currentUser, 'sales_lead', id, 'updated', existing, updated)
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })
  return c.json(updated)
})

// POST /sales-leads/import-adf — parse ADF/XML lead
app.post('/import-adf', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const contentType = c.req.header('content-type') || ''

  let xmlText: string
  if (contentType.includes('xml') || contentType.includes('text/plain')) {
    xmlText = await c.req.text()
  } else {
    const body = await c.req.json()
    xmlText = body.xml || body.adf || ''
  }

  if (!xmlText) return c.json({ error: 'No ADF/XML content provided' }, 400)

  // Lightweight XML parsing — no dependencies
  const getTag = (xml: string, tag: string, attr?: string): string => {
    if (attr) {
      const regex = new RegExp(`<${tag}[^>]*${attr}[^>]*>([^<]*)</${tag}>`, 'i')
      const match = xml.match(regex)
      return match?.[1]?.trim() || ''
    }
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i')
    const match = xml.match(regex)
    return match?.[1]?.trim() || ''
  }

  // Parse ADF fields
  const firstName = getTag(xmlText, 'name', 'part="first"') || getTag(xmlText, 'name', "part='first'")
  const lastName = getTag(xmlText, 'name', 'part="last"') || getTag(xmlText, 'name', "part='last'")
  const fullName = getTag(xmlText, 'name') // fallback if no parts
  const name = (firstName && lastName) ? `${firstName} ${lastName}` : fullName || 'Unknown'
  const email = getTag(xmlText, 'email')
  const phone = getTag(xmlText, 'phone')
  const vYear = getTag(xmlText, 'year')
  const vMake = getTag(xmlText, 'make')
  const vModel = getTag(xmlText, 'model')

  // Create or find contact
  let contactRecord: any = null
  if (email) {
    const [existing] = await db.select().from(contact)
      .where(and(eq(contact.email, email), eq(contact.companyId, currentUser.companyId)))
      .limit(1)
    contactRecord = existing
  }
  if (!contactRecord && phone) {
    const [existing] = await db.select().from(contact)
      .where(and(eq(contact.phone, phone), eq(contact.companyId, currentUser.companyId)))
      .limit(1)
    contactRecord = existing
  }
  if (!contactRecord) {
    ;[contactRecord] = await db.insert(contact).values({
      id: createId(),
      name,
      email: email || undefined,
      phone: phone || undefined,
      type: 'lead',
      source: 'adf_xml',
      companyId: currentUser.companyId,
    }).returning()
  }

  // Try to match vehicle by year/make/model
  let vehicleId: string | null = null
  if (vYear && vMake && vModel) {
    const [matched] = await db.select().from(vehicle)
      .where(and(
        eq(vehicle.companyId, currentUser.companyId),
        eq(vehicle.year, parseInt(vYear)),
        eq(vehicle.make, vMake),
        eq(vehicle.model, vModel),
        eq(vehicle.status, 'available'),
      ))
      .limit(1)
    if (matched) vehicleId = matched.id
  }

  // Create sales lead
  const [lead] = await db.insert(salesLead).values({
    id: createId(),
    contactId: contactRecord.id,
    vehicleId,
    source: 'adf_xml',
    stage: 'new',
    notes: `ADF import: interested in ${vYear || ''} ${vMake || ''} ${vModel || ''}`.trim(),
    companyId: currentUser.companyId,
  }).returning()

  await audit(currentUser, 'sales_lead', lead.id, 'created', null, { source: 'adf_xml', contact: name })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })

  return c.json({ success: true, contact: contactRecord, lead, vehicleMatched: !!vehicleId }, 201)
})

export default app
