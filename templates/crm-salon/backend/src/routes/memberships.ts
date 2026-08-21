import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { membershipPlan, membershipEnrollment, contact } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * Memberships and prepaid packages — recurring revenue between visits.
 * A plan with creditsTotal = null is an open membership (unlimited/recurring);
 * a plan with creditsTotal set is a prepaid block that burns down per redeem.
 */

const app = new Hono()
app.use('*', authenticate)

// ==================== ENROLLMENTS ====================
// Registered before the plan /:id routes so '/enrollments' isn't matched as a plan id.

// GET /memberships/enrollments — ?contactId=, ?status=
app.get('/enrollments', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.query('contactId')
  const status = c.req.query('status')

  const conditions = [eq(membershipEnrollment.companyId, currentUser.companyId)]
  if (contactId) conditions.push(eq(membershipEnrollment.contactId, contactId))
  if (status) conditions.push(eq(membershipEnrollment.status, status))

  const data = await db.select({
    enrollment: membershipEnrollment,
    planName: membershipPlan.name,
    planPrice: membershipPlan.price,
    billingCycle: membershipPlan.billingCycle,
    clientName: contact.name,
    clientPhone: contact.phone,
  })
    .from(membershipEnrollment)
    .leftJoin(membershipPlan, eq(membershipEnrollment.planId, membershipPlan.id))
    .leftJoin(contact, eq(membershipEnrollment.contactId, contact.id))
    .where(and(...conditions))
    .orderBy(desc(membershipEnrollment.createdAt))

  // Flatten so the page can read `row.clientName` / `row.planName` / `row.startDate` directly.
  const rows = data.map((r: any) => ({
    ...r.enrollment,
    planName: r.planName, planPrice: r.planPrice, billingCycle: r.billingCycle,
    clientName: r.clientName, clientPhone: r.clientPhone,
  }))
  return c.json({ data: rows })
})

// POST /memberships/enrollments — credits seed from the plan unless overridden.
app.post('/enrollments', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (!body.planId || !body.contactId) return c.json({ error: 'planId and contactId are required' }, 400)

  const [plan] = await db.select().from(membershipPlan)
    .where(and(eq(membershipPlan.id, body.planId), eq(membershipPlan.companyId, currentUser.companyId)))
    .limit(1)
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  const [ct] = await db.select().from(contact)
    .where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!ct) return c.json({ error: 'Client not found' }, 404)

  const [created] = await db.insert(membershipEnrollment).values({
    id: createId(),
    planId: body.planId,
    contactId: body.contactId,
    status: body.status || 'active',
    creditsRemaining: body.creditsRemaining ?? plan.creditsTotal ?? null,
    startDate: body.startDate || new Date().toISOString().slice(0, 10),
    renewsAt: body.renewsAt || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'membership_enrollment', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'membership_enrollment' })
  return c.json(created, 201)
})

// PUT /memberships/enrollments/:id
app.put('/enrollments/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(membershipEnrollment)
    .where(and(eq(membershipEnrollment.id, id), eq(membershipEnrollment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Enrollment not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['planId', 'contactId', 'status', 'creditsRemaining', 'startDate', 'renewsAt', 'cancelledAt'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if (updates.cancelledAt) updates.cancelledAt = new Date(updates.cancelledAt)
  // Status change to cancelled → stamp cancelledAt if not already provided.
  if (body.status === 'cancelled' && !existing.cancelledAt && !updates.cancelledAt) {
    updates.cancelledAt = new Date()
  }

  const [updated] = await db.update(membershipEnrollment).set(updates).where(eq(membershipEnrollment.id, id)).returning()
  await audit.log({ action: 'update', entity: 'membership_enrollment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'membership_enrollment' })
  return c.json(updated)
})

// POST /memberships/enrollments/:id/redeem — burn one credit. Decremented in
// SQL so two front-desk tabs redeeming at once can't both spend the last credit.
app.post('/enrollments/:id/redeem', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(membershipEnrollment)
    .where(and(eq(membershipEnrollment.id, id), eq(membershipEnrollment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Enrollment not found' }, 404)
  if (existing.status !== 'active') return c.json({ error: 'Enrollment is not active' }, 400)
  // null credits = open membership, nothing to burn.
  if (existing.creditsRemaining === null) return c.json({ error: 'This membership has no visit credits to redeem' }, 400)

  const [updated] = await db.update(membershipEnrollment)
    .set({ creditsRemaining: sql`${membershipEnrollment.creditsRemaining} - 1`, updatedAt: new Date() })
    .where(and(
      eq(membershipEnrollment.id, id),
      eq(membershipEnrollment.companyId, currentUser.companyId),
      sql`${membershipEnrollment.creditsRemaining} > 0`,
    ))
    .returning()
  if (!updated) return c.json({ error: 'No credits remaining' }, 409)

  await audit.log({ action: 'update', entity: 'membership_enrollment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'membership_enrollment' })
  return c.json(updated)
})

// ==================== PLANS ====================

// GET /memberships — ?includeInactive=1
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const includeInactive = c.req.query('includeInactive') === '1'

  const conditions = [eq(membershipPlan.companyId, currentUser.companyId)]
  if (!includeInactive) conditions.push(eq(membershipPlan.active, true))

  const data = await db.select().from(membershipPlan)
    .where(and(...conditions))
    .orderBy(desc(membershipPlan.createdAt))

  return c.json({ data })
})

// POST /memberships
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const [created] = await db.insert(membershipPlan).values({
    id: createId(),
    name: body.name.trim(),
    description: body.description || null,
    price: body.price ?? null,
    billingCycle: body.billingCycle || 'monthly',
    creditsTotal: body.creditsTotal ?? null,
    includedServices: Array.isArray(body.includedServices) ? body.includedServices : [],
    active: body.active ?? true,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'membership_plan', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'membership_plan' })
  return c.json(created, 201)
})

// PUT /memberships/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(membershipPlan)
    .where(and(eq(membershipPlan.id, id), eq(membershipPlan.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Membership plan not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['name', 'description', 'price', 'billingCycle', 'creditsTotal', 'includedServices', 'active'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(membershipPlan).set(updates).where(eq(membershipPlan.id, id)).returning()
  await audit.log({ action: 'update', entity: 'membership_plan', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'membership_plan' })
  return c.json(updated)
})

// DELETE /memberships/:id — retire the plan. Enrollments cascade on a hard
// delete, so an active plan is deactivated instead of dropped.
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(membershipPlan)
    .where(and(eq(membershipPlan.id, id), eq(membershipPlan.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Membership plan not found' }, 404)

  const [updated] = await db.update(membershipPlan)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(membershipPlan.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'membership_plan', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'membership_plan' })
  return c.json({ success: true, plan: updated })
})

export default app
