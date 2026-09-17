import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { repairOrder, contact, unit, salesLead, serviceSalesAlert, user, invoice, invoiceLineItem } from '../../db/schema.ts'
import { eq, and, count, desc, isNull, sql } from 'drizzle-orm'
import { nextNumber, calcTotals, round2 } from '../shared/index.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, emitToUser, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { sendSMS } from '../services/sms.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// Customer-facing repair-order milestones → automated status text.
const RO_STATUS_TEXT: Record<string, string> = {
  in_progress: 'is now being worked on',
  waiting_parts: 'is on hold waiting for parts',
  ready: 'is ready for pickup',
}

// ---- Repair order input rules (RV T19 M3) ----
// Status is one of the shop statuses; estimated/actual totals and service labor/parts amounts are 0 or more; the
// customer, unit and technician belong to the company. (T19: an RO with a -$50 estimate and status "banana" were
// saved, and closing the -$50 RO created a $0.00 invoice marked Sent)
export const RO_STATUSES = ['open', 'in_progress', 'waiting_parts', 'ready', 'closed'] as const
const MAX_AMOUNT = 10_000_000

function roInputError(body: any, isCreate: boolean): string | null {
  if (isCreate || 'status' in body) {
    const status = isCreate ? body.status || 'open' : body.status
    if (!(RO_STATUSES as readonly string[]).includes(status)) return `Status must be one of: ${RO_STATUSES.join(', ')}`
  }
  for (const [k, label] of [['estimatedTotal', 'Estimated total'], ['actualTotal', 'Actual total']] as const) {
    const v = body[k]
    if (v === undefined || v === null || v === '') continue
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return `${label} must be an amount of 0 or more`
  }
  if (body.services !== undefined && body.services !== null) {
    if (!Array.isArray(body.services)) return 'Services must be a list'
    for (const s of body.services) {
      if (typeof s === 'string') continue
      if (!s || typeof s !== 'object') return 'Services must be a list of descriptions or service lines'
      for (const k of ['laborHours', 'laborCost', 'partsCost']) {
        if (s[k] === undefined || s[k] === null || s[k] === '') continue
        const n = Number(s[k])
        if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return 'Service labor and parts amounts must be 0 or more'
      }
    }
  }
  return null
}

async function roRefError(companyId: string, refs: { customerId?: unknown; unitId?: unknown; technicianId?: unknown }): Promise<{ status: 400 | 404; error: string } | null> {
  if (refs.customerId !== undefined) {
    if (typeof refs.customerId !== 'string' || !refs.customerId) return { status: 400, error: 'Customer is required' }
    const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, refs.customerId), eq(contact.companyId, companyId))).limit(1)
    if (!ct) return { status: 404, error: 'Customer not found' }
  }
  if (refs.unitId) {
    const [u] = await db.select({ id: unit.id }).from(unit).where(and(eq(unit.id, String(refs.unitId)), eq(unit.companyId, companyId))).limit(1)
    if (!u) return { status: 404, error: 'Unit not found' }
  }
  if (refs.technicianId) {
    const [t] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, String(refs.technicianId)), eq(user.companyId, companyId))).limit(1)
    if (!t) return { status: 404, error: 'Technician not found' }
  }
  return null
}

// GET /repair-orders — RO list
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions = [eq(repairOrder.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(repairOrder.status, status))

  const where = and(...conditions)

  const data = await db.select({
    ro: repairOrder,
    customerName: contact.name,
    customerPhone: contact.phone,
    unitYear: unit.year,
    unitMake: unit.make,
    unitModel: unit.modelName,
    unitVin: unit.vin,
  })
    .from(repairOrder)
    .leftJoin(contact, eq(repairOrder.customerId, contact.id))
    .leftJoin(unit, eq(repairOrder.unitId, unit.id))
    .where(where)
    .orderBy(desc(repairOrder.writeUpDate))
    .offset((page - 1) * limit)
    .limit(limit)

  const [{ value: total }] = await db.select({ value: count() }).from(repairOrder).where(where)

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// POST /repair-orders — create RO
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const inputError = roInputError(body, true)
  if (inputError) return c.json({ error: inputError }, 400)
  const refError = await roRefError(currentUser.companyId, { customerId: body.customerId ?? null, unitId: body.unitId, technicianId: body.technicianId })
  if (refError) return c.json({ error: refError.error }, refError.status)

  // RO number: the next in the RO-1001 series (the shared numbering helper, under a per-company lock) — not a row
  // count, which produced RO-00009 next to the seeded RO-1004 and repeated numbers after deletes. A number given by
  // hand must not already be in use. (RV T19 L5)
  const customNumber = typeof body.roNumber === 'string' && body.roNumber.trim() ? body.roNumber.trim() : null
  const outcome = await db.transaction(async (tx: any) => {
    let roNumber = customNumber
    if (roNumber) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${currentUser.companyId + ':RO'}))`)
      const [taken] = await tx.select({ id: repairOrder.id }).from(repairOrder).where(and(eq(repairOrder.companyId, currentUser.companyId), eq(repairOrder.roNumber, roNumber))).limit(1)
      if (taken) return { taken: roNumber }
    } else {
      roNumber = await nextNumber(tx, repairOrder, repairOrder.roNumber, repairOrder.companyId, currentUser.companyId, { prefix: 'RO', pad: 0, seed: 1000 })
    }
    const [row] = await tx.insert(repairOrder).values({
      id: createId(),
      roNumber,
      customerId: body.customerId,
      unitId: body.unitId || null,
      customerUnitInfo: body.customerUnitInfo || null,
      status: body.status || 'open',
      services: body.services || [],
      advisorName: body.advisorName || null,
      technicianId: body.technicianId || null,
      estimatedTotal: body.estimatedTotal || null,
      notes: body.notes || null,
      companyId: currentUser.companyId,
    }).returning()
    return { row }
  })
  if ('taken' in outcome) return c.json({ error: `RO number ${outcome.taken} is already in use` }, 409)
  const created = outcome.row

  await audit.log({ action: 'create', entity: 'repair_order', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'repair_order' })
  return c.json(created, 201)
})

// PUT /repair-orders/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(repairOrder).where(and(eq(repairOrder.id, id), eq(repairOrder.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Repair order not found' }, 404)

  const inputError = roInputError(body, false)
  if (inputError) return c.json({ error: inputError }, 400)
  const refError = await roRefError(currentUser.companyId, {
    customerId: 'customerId' in body && body.customerId !== existing.customerId ? body.customerId : undefined,
    unitId: 'unitId' in body && body.unitId !== existing.unitId ? body.unitId : undefined,
    technicianId: 'technicianId' in body && body.technicianId !== existing.technicianId ? body.technicianId : undefined,
  })
  if (refError) return c.json({ error: refError.error }, refError.status)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['status', 'roNumber', 'writeUpDate', 'customerUnitInfo', 'services', 'advisorName', 'estimatedTotal', 'actualTotal', 'notes', 'completedAt', 'unitId', 'technicianId', 'customerId'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  // an empty amount or picker value clears the field (it was written as "" and failed in the database)
  for (const k of ['estimatedTotal', 'actualTotal', 'unitId', 'technicianId'] as const) if (updates[k] === '') updates[k] = null
  if (body.status === 'closed' && !existing.completedAt) updates.completedAt = new Date()

  const [updated] = await db.update(repairOrder).set(updates).where(eq(repairOrder.id, id)).returning()
  await audit.log({ action: 'update', entity: 'repair_order', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'repair_order' })

  // Closing an RO bills it: create a linked invoice itemised from its services so the service
  // department actually collects (before this, closing an RO produced no invoice at all). Idempotent —
  // only the first close of an RO that has a customer creates one.
  let billedInvoice: any = null
  if (body.status === 'closed' && existing.status !== 'closed' && !existing.invoiceId && updated.customerId) {
    const services: any[] = Array.isArray(updated.services) ? updated.services : []
    let lines = services.map((s: any) => ({
      description: String(s?.description || 'Service'),
      quantity: 1,
      unitPrice: round2((Number(s?.laborCost) || 0) + (Number(s?.partsCost) || 0)),
    }))
    const svcSubtotal = lines.reduce((n, l) => n + l.unitPrice, 0)
    if (lines.length === 0 || svcSubtotal <= 0) {
      const fallback = round2(Number(updated.actualTotal ?? updated.estimatedTotal ?? 0))
      lines = [{ description: updated.roNumber ? `Repair Order ${updated.roNumber}` : 'Repair order', quantity: 1, unitPrice: fallback }]
    }
    const totals = calcTotals(lines, 0, 0)
    // nothing to collect (e.g. warranty work billed to the manufacturer): no customer invoice is sent
    if (totals.total > 0) try {
      billedInvoice = await db.transaction(async (tx: any) => {
        const number = await nextNumber(tx, invoice, invoice.number, invoice.companyId, currentUser.companyId, { prefix: 'INV', pad: 0, seed: 1000 })
        const [inv] = await tx.insert(invoice).values({
          number, status: 'sent', companyId: currentUser.companyId, contactId: updated.customerId,
          subtotal: String(totals.subtotal), taxRate: '0', taxAmount: '0', discount: '0', total: String(totals.total),
          dueDate: new Date(Date.now() + 30 * 86400000), sentAt: new Date(),
          notes: updated.roNumber ? `Auto-generated from Repair Order ${updated.roNumber}` : 'Auto-generated from a repair order',
        }).returning()
        await tx.insert(invoiceLineItem).values(lines.map((l, i) => ({
          invoiceId: inv.id, description: l.description, quantity: String(l.quantity),
          unitPrice: String(l.unitPrice), total: String(round2(l.quantity * l.unitPrice)), sortOrder: i,
        })))
        await tx.update(repairOrder).set({ invoiceId: inv.id, updatedAt: new Date() }).where(eq(repairOrder.id, id))
        return inv
      })
      emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'invoice' })
    } catch (err) {
      // Don't fail the close if billing hiccups; surface it in logs, RO is still closed.
      console.error('RO auto-invoice failed', err)
    }
  }

  // Service status text: notify the customer on a customer-facing status change.
  if (body.status && body.status !== existing.status && RO_STATUS_TEXT[body.status] && updated.customerId) {
    try {
      const [customer] = await db.select().from(contact).where(eq(contact.id, updated.customerId)).limit(1)
      const to = customer?.mobile || customer?.phone
      if (to) {
        const ref = updated.roNumber ? `RO #${updated.roNumber}` : 'Your service order'
        await sendSMS(currentUser.companyId, {
          contactId: updated.customerId,
          toPhone: to,
          message: `${ref} ${RO_STATUS_TEXT[body.status]}.`,
          userId: currentUser.userId,
        })
      }
    } catch { /* never block the RO update on an SMS failure */ }
  }

  return c.json(billedInvoice ? { ...updated, invoiceId: billedInvoice.id, invoice: billedInvoice } : updated)
})

// POST /repair-orders/:id/check-in — THE SERVICE-TO-SALES BRIDGE
app.post('/:id/check-in', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // 1. Find the RO
  const [ro] = await db.select().from(repairOrder)
    .where(and(eq(repairOrder.id, id), eq(repairOrder.companyId, currentUser.companyId)))
    .limit(1)
  if (!ro) return c.json({ error: 'Repair order not found' }, 404)

  // 2. Mark RO as in_progress
  await db.update(repairOrder).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(repairOrder.id, id))

  // 3. Service-to-Sales Bridge: look up the customer's open sales leads
  let alertCreated = false
  let alertRecord: any = null

  if (ro.customerId) {
    // Find open sales leads for this customer assigned to a salesperson
    const openLeads = await db.select({
      lead: salesLead,
      unitYear: unit.year,
      unitMake: unit.make,
      unitModel: unit.modelName,
    })
      .from(salesLead)
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        // Open stages only
        eq(salesLead.stage, 'new'),
      ))
      .limit(5)

    // Also check contacted/demo stages
    const activeLeads = await db.select({
      lead: salesLead,
      unitYear: unit.year,
      unitMake: unit.make,
      unitModel: unit.modelName,
    })
      .from(salesLead)
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        eq(salesLead.stage, 'contacted'),
      ))
      .limit(5)

    const demoLeads = await db.select({
      lead: salesLead,
      unitYear: unit.year,
      unitMake: unit.make,
      unitModel: unit.modelName,
    })
      .from(salesLead)
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        eq(salesLead.stage, 'demo'),
      ))
      .limit(5)

    const deskingLeads = await db.select({
      lead: salesLead,
      unitYear: unit.year,
      unitMake: unit.make,
      unitModel: unit.modelName,
    })
      .from(salesLead)
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(and(
        eq(salesLead.contactId, ro.customerId),
        eq(salesLead.companyId, currentUser.companyId),
        eq(salesLead.stage, 'desking'),
      ))
      .limit(5)

    const allActiveLeads = [...openLeads, ...activeLeads, ...demoLeads, ...deskingLeads]

    // Get customer name
    const [customer] = await db.select().from(contact).where(eq(contact.id, ro.customerId)).limit(1)
    const customerName = customer?.name || 'Unknown customer'

    for (const leadRow of allActiveLeads) {
      if (!leadRow.lead.assignedTo) continue

      const unitDesc = [leadRow.unitYear, leadRow.unitMake, leadRow.unitModel].filter(Boolean).join(' ') || 'a unit'
      const message = `${customerName} just checked into service. Last interested in: ${unitDesc}. RO: ${ro.roNumber}`

      ;[alertRecord] = await db.insert(serviceSalesAlert).values({
        id: createId(),
        repairOrderId: ro.id,
        salesLeadId: leadRow.lead.id,
        salespersonId: leadRow.lead.assignedTo,
        customerId: ro.customerId,
        alertMessage: message,
        companyId: currentUser.companyId,
      }).returning()

      alertCreated = true

      // Real-time push to the specific salesperson's socket
      emitToUser(leadRow.lead.assignedTo, EVENTS.ALERT_CREATED, {
        id: alertRecord.id,
        message,
        customerName,
        customerPhone: customer?.phone || null,
        roNumber: ro.roNumber,
        unitInterest: [leadRow.unitYear, leadRow.unitMake, leadRow.unitModel].filter(Boolean).join(' ') || null,
        createdAt: alertRecord.createdAt,
      })
    }
  }

  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'repair_order' })
  return c.json({
    success: true,
    roStatus: 'in_progress',
    alertTriggered: alertCreated,
    alert: alertRecord,
  })
})

export default app
