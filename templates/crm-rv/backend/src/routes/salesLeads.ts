import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { salesLead, contact, unit, user } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql, ne } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// A unit is sold by closing its deal (stage closed_won, shown as "Sold"). Closing marks the unit sold, which also
// takes it off the syndication feed. A unit already sold on another deal can't be sold again. Reopening the deal,
// or moving it to a different unit, puts the unit back on sale unless another sold deal still holds it. Other
// customers' open leads on a sold unit stay open; the pipeline flags them "Unit sold". (RV T19 B1)
const SOLD = 'closed_won'

async function sellUnit(tx: any, companyId: string, unitId: string, leadId: string | null | undefined) {
  const [u] = await tx.select({ id: unit.id }).from(unit)
    .where(and(eq(unit.id, unitId), eq(unit.companyId, companyId))).limit(1).for('update')
  if (!u) return { status: 404 as const, error: 'Unit not found' }
  const [other] = await tx.select({ id: salesLead.id, contactName: contact.name }).from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .where(and(eq(salesLead.companyId, companyId), eq(salesLead.unitId, unitId), eq(salesLead.stage, SOLD), leadId ? ne(salesLead.id, leadId) : undefined))
    .limit(1)
  if (other) return { status: 409 as const, error: other.contactName ? `This unit is already sold to ${other.contactName}.` : 'This unit is already sold on another deal.', soldLeadId: other.id }
  await tx.update(unit).set({ status: 'sold', updatedAt: new Date() }).where(eq(unit.id, unitId))
  return null
}

async function releaseUnit(tx: any, companyId: string, unitId: string | null, leadId: string | undefined) {
  if (!unitId || !leadId) return
  const [u] = await tx.select({ id: unit.id, status: unit.status }).from(unit)
    .where(and(eq(unit.id, unitId), eq(unit.companyId, companyId))).limit(1).for('update')
  if (!u || u.status !== 'sold') return
  const [other] = await tx.select({ id: salesLead.id }).from(salesLead)
    .where(and(eq(salesLead.companyId, companyId), eq(salesLead.unitId, unitId), eq(salesLead.stage, SOLD), ne(salesLead.id, leadId)))
    .limit(1)
  if (!other) await tx.update(unit).set({ status: 'available', updatedAt: new Date() }).where(eq(unit.id, unitId))
}

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
    unitYear: unit.year,
    unitMake: unit.make,
    unitModelName: unit.modelName,
    unitTrim: unit.trim,
    unitStockNumber: unit.stockNumber,
    unitStatus: unit.status,
    salespersonFirstName: user.firstName,
    salespersonLastName: user.lastName,
  })
    .from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .leftJoin(unit, eq(salesLead.unitId, unit.id))
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

  const id = createId()
  const stage = body.stage || 'new'
  const unitId = body.unitId || null
  const outcome = await db.transaction(async (tx: any) => {
    if (stage === SOLD && unitId) {
      const refusal = await sellUnit(tx, currentUser.companyId, unitId, null)
      if (refusal) return { refusal }
    }
    const [created] = await tx.insert(salesLead).values({
      id,
      contactId: body.contactId,
      unitId,
      source: body.source || 'web',
      stage,
      assignedTo: body.assignedTo || null,
      notes: body.notes || null,
      tradeInInfo: body.tradeInInfo || null,
      followUpDate: body.followUpDate ? new Date(body.followUpDate) : null,
      companyId: currentUser.companyId,
    }).returning()
    return { created }
  })
  if (outcome.refusal) {
    const { status, ...rest } = outcome.refusal
    return c.json(rest, status)
  }
  const created = outcome.created

  await audit.log({ action: 'create', entity: 'sales_lead', entityId: created.id, metadata: created, req: { user: currentUser } })
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

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['source','stage','notes','tradeInInfo','followUpDate','contactId','unitId','assignedTo'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if (body.stage === 'closed_won' || body.stage === 'closed_lost') {
    updates.closedAt = new Date()
  }

  const nextStage = 'stage' in body ? body.stage : existing.stage
  const nextUnitId = 'unitId' in body ? body.unitId || null : existing.unitId
  const wasSold = existing.stage === SOLD && !!existing.unitId
  const isSold = nextStage === SOLD && !!nextUnitId
  const sameSale = wasSold && isSold && nextUnitId === existing.unitId

  const outcome = await db.transaction(async (tx: any) => {
    // sell first: a refusal returns before anything is written
    if (isSold && !sameSale) {
      const refusal = await sellUnit(tx, currentUser.companyId, nextUnitId, id)
      if (refusal) return { refusal }
    }
    if (wasSold && !sameSale) await releaseUnit(tx, currentUser.companyId, existing.unitId, id)
    const [row] = await tx.update(salesLead).set(updates).where(eq(salesLead.id, id)).returning()
    return { updated: row }
  })
  if (outcome.refusal) {
    const { status, ...rest } = outcome.refusal
    return c.json(rest, status)
  }
  const updated = outcome.updated
  await audit.log({ action: 'update', entity: 'sales_lead', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
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
  const uYear = getTag(xmlText, 'year')
  const uMake = getTag(xmlText, 'make')
  const uModel = getTag(xmlText, 'model')

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

  // Try to match unit by year/make/model
  let unitId: string | null = null
  if (uYear && uMake && uModel) {
    const [matched] = await db.select().from(unit)
      .where(and(
        eq(unit.companyId, currentUser.companyId),
        eq(unit.year, parseInt(uYear)),
        eq(unit.make, uMake),
        eq(unit.modelName, uModel),
        eq(unit.status, 'available'),
      ))
      .limit(1)
    if (matched) unitId = matched.id
  }

  // Create sales lead
  const [lead] = await db.insert(salesLead).values({
    id: createId(),
    contactId: contactRecord.id,
    unitId,
    source: 'adf_xml',
    stage: 'new',
    notes: `ADF import: interested in ${uYear || ''} ${uMake || ''} ${uModel || ''}`.trim(),
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'sales_lead', entityId: lead.id, metadata: { source: 'adf_xml', contact: name }, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })

  return c.json({ success: true, contact: contactRecord, lead, unitMatched: !!unitId }, 201)
})

export default app
