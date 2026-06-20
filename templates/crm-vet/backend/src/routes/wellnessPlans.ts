import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { wellnessPlan, wellnessEnrollment, patient, contact } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// ==================== ENROLLMENTS ====================
// Registered before the plan /:id routes so '/enrollments' isn't matched as a plan id.

// GET /wellness-plans/enrollments — ?patientId=, join plan name + patient name
app.get('/enrollments', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const patientId = c.req.query('patientId')

  const conditions = [eq(wellnessEnrollment.companyId, currentUser.companyId)]
  if (patientId) conditions.push(eq(wellnessEnrollment.patientId, patientId))

  const data = await db.select({
    enrollment: wellnessEnrollment,
    planName: wellnessPlan.name,
    patientName: patient.name,
    ownerName: contact.name,
  })
    .from(wellnessEnrollment)
    .leftJoin(wellnessPlan, eq(wellnessEnrollment.planId, wellnessPlan.id))
    .leftJoin(patient, eq(wellnessEnrollment.patientId, patient.id))
    .leftJoin(contact, eq(wellnessEnrollment.ownerId, contact.id))
    .where(and(...conditions))
    .orderBy(desc(wellnessEnrollment.createdAt))

  // Flatten the joined enrollment + plan/patient/owner names to one row level so
  // the page can read `row.patientName` / `row.ownerName` / `row.planName` / `row.startDate` directly.
  const rows = data.map((r: any) => ({ ...r.enrollment, planName: r.planName, patientName: r.patientName, ownerName: r.ownerName }))
  return c.json({ data: rows })
})

// POST /wellness-plans/enrollments
app.post('/enrollments', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(wellnessEnrollment).values({
    id: createId(),
    planId: body.planId,
    patientId: body.patientId,
    ownerId: body.ownerId || null,
    status: body.status || 'active',
    billingCycle: body.billingCycle || 'monthly',
    startDate: body.startDate || null,
    renewsAt: body.renewsAt || null,
    cancelledAt: body.cancelledAt ? new Date(body.cancelledAt) : null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'wellness_enrollment', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_enrollment' })
  return c.json(created, 201)
})

// PUT /wellness-plans/enrollments/:id
app.put('/enrollments/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(wellnessEnrollment)
    .where(and(eq(wellnessEnrollment.id, id), eq(wellnessEnrollment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Enrollment not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['planId', 'patientId', 'ownerId', 'status', 'billingCycle', 'startDate', 'renewsAt', 'cancelledAt'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if ('cancelledAt' in updates && updates.cancelledAt) updates.cancelledAt = new Date(updates.cancelledAt)
  // Status change to cancelled → stamp cancelledAt if not already provided.
  if (body.status === 'cancelled' && !existing.cancelledAt && !updates.cancelledAt) {
    updates.cancelledAt = new Date()
  }

  const [updated] = await db.update(wellnessEnrollment).set(updates).where(eq(wellnessEnrollment.id, id)).returning()
  await audit.log({ action: 'update', entity: 'wellness_enrollment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_enrollment' })
  return c.json(updated)
})

// ==================== PLANS ====================

// GET /wellness-plans — list plans
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any

  const data = await db.select().from(wellnessPlan)
    .where(eq(wellnessPlan.companyId, currentUser.companyId))
    .orderBy(desc(wellnessPlan.createdAt))

  return c.json({ data })
})

// POST /wellness-plans
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(wellnessPlan).values({
    id: createId(),
    name: body.name,
    description: body.description || null,
    species: body.species || null,
    monthlyPrice: body.monthlyPrice ?? null,
    annualPrice: body.annualPrice ?? null,
    benefits: body.benefits || [],
    active: body.active ?? true,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'wellness_plan', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_plan' })
  return c.json(created, 201)
})

// PUT /wellness-plans/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(wellnessPlan)
    .where(and(eq(wellnessPlan.id, id), eq(wellnessPlan.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Wellness plan not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['name', 'description', 'species', 'monthlyPrice', 'annualPrice', 'benefits', 'active'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(wellnessPlan).set(updates).where(eq(wellnessPlan.id, id)).returning()
  await audit.log({ action: 'update', entity: 'wellness_plan', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_plan' })
  return c.json(updated)
})

// DELETE /wellness-plans/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(wellnessPlan)
    .where(and(eq(wellnessPlan.id, id), eq(wellnessPlan.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Wellness plan not found' }, 404)

  await db.delete(wellnessPlan).where(eq(wellnessPlan.id, id))
  await audit.log({ action: 'delete', entity: 'wellness_plan', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_plan' })
  return c.json({ success: true })
})

export default app
