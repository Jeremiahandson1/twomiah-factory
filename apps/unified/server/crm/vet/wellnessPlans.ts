// Wellness plans: the practice's preventive-care memberships, who is enrolled, and their billing. Moved from
// templates/crm-vet/backend/src/routes/wellnessPlans.ts. The registry signs the person in and applies the
// 'wellness_plans' gate (the template's sidebar gate; its index.ts mounted it ungated).
import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { wellnessPlan, wellnessEnrollment, patient, contact } from '../../db/schema/index.ts'
import { createWellnessBillingService } from './wellnessBillingService.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'

export function createWellnessPlanRoutes(d: CrmDeps) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const { emitToCompany, EVENTS } = d.realtime
  const billing = createWellnessBillingService(db)
  const app = new Hono<AppEnv>()

  // Due plans are billed whenever the enrolments are read and by this explicit run. (Vet T12 H3)
  app.post('/billing-run', requirePermission('invoices:create'), async (c) => {
    const currentUser = c.get('user') as any
    const billed = await billing.settle(currentUser.companyId)
    return one(c, { billed: billed.length, invoices: billed })
  })

  // ==================== ENROLMENTS ====================
  // Registered before the plan /:id routes so '/enrollments' isn't matched as a plan id.

  // GET /wellness-plans/enrollments — ?patientId=, with the plan, patient and owner names. A list reply (the
  // template: { data } alone).
  app.get('/enrollments', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const patientId = c.req.query('patientId')
    // Bill anything that came due before showing the list, so what is on screen is what has been charged.
    await billing.settle(currentUser.companyId).catch((e: any) => logger.warn('[wellness] billing run failed', { error: e?.message || String(e) }))

    const conditions = [eq(wellnessEnrollment.companyId, currentUser.companyId)]
    if (patientId) conditions.push(eq(wellnessEnrollment.patientId, patientId))

    const data = await db.select({ enrollment: wellnessEnrollment, planName: wellnessPlan.name, patientName: patient.name, ownerName: contact.name })
      .from(wellnessEnrollment)
      .leftJoin(wellnessPlan, eq(wellnessEnrollment.planId, wellnessPlan.id))
      .leftJoin(patient, eq(wellnessEnrollment.patientId, patient.id))
      .leftJoin(contact, eq(wellnessEnrollment.ownerId, contact.id))
      .where(and(...conditions))
      .orderBy(desc(wellnessEnrollment.createdAt))

    const rows = data.map((r: any) => ({ ...r.enrollment, planName: r.planName, patientName: r.patientName, ownerName: r.ownerName }))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  app.post('/enrollments', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json()

    if (!body.planId || !body.patientId) return fail(c, 400, 'planId and patientId are required')
    // A patient could be enrolled in the same plan twice (a double monthly charge). (VET-25)
    const [dupe] = await db.select({ id: wellnessEnrollment.id }).from(wellnessEnrollment)
      .where(and(
        eq(wellnessEnrollment.companyId, currentUser.companyId),
        eq(wellnessEnrollment.patientId, body.patientId),
        eq(wellnessEnrollment.planId, body.planId),
        eq(wellnessEnrollment.status, 'active'),
      )).limit(1)
    if (dupe) return fail(c, 409, 'This patient is already enrolled in that plan.')

    // The owner comes from the patient: the enrolment is billed to the pet's owner. (VET-14)
    let ownerId = body.ownerId || null
    if (!ownerId) {
      const [pat] = await db.select({ ownerId: patient.ownerId }).from(patient)
        .where(and(eq(patient.id, body.patientId), eq(patient.companyId, currentUser.companyId))).limit(1)
      ownerId = pat?.ownerId || null
    }

    const [created] = await db.insert(wellnessEnrollment).values({
      id: createId(),
      planId: body.planId,
      patientId: body.patientId,
      ownerId,
      status: body.status || 'active',
      billingCycle: body.billingCycle || 'monthly',
      // A start date by default, so enrolments don't show "—". (VET-25)
      startDate: body.startDate || new Date().toISOString().slice(0, 10),
      renewsAt: body.renewsAt || null,
      cancelledAt: body.cancelledAt ? new Date(body.cancelledAt) : null,
      companyId: currentUser.companyId,
    }).returning()

    // Bill the first period now; renewsAt is set so the next one follows.
    const firstInvoice = await billing.billFirstPeriod(created).catch((e: any) => { logger.warn('[wellness] first charge failed', { error: e?.message || String(e) }); return null })
    const [withSchedule] = await db.select().from(wellnessEnrollment).where(eq(wellnessEnrollment.id, created.id)).limit(1)

    await audit.log({ action: 'create', entity: 'wellness_enrollment', entityId: created.id, metadata: { ...created, firstInvoice: firstInvoice?.number || null }, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_enrollment' })
    return one(c, { ...(withSchedule || created), invoice: firstInvoice }, 201)
  })

  app.put('/enrollments/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(wellnessEnrollment)
      .where(and(eq(wellnessEnrollment.id, id), eq(wellnessEnrollment.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Enrollment not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['planId', 'patientId', 'ownerId', 'status', 'billingCycle', 'startDate', 'renewsAt', 'cancelledAt'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    if ('cancelledAt' in updates && updates.cancelledAt) updates.cancelledAt = new Date(updates.cancelledAt)
    // A move to cancelled stamps cancelledAt if none is given.
    if (body.status === 'cancelled' && !existing.cancelledAt && !updates.cancelledAt) updates.cancelledAt = new Date()

    const [updated] = await db.update(wellnessEnrollment).set(updates).where(eq(wellnessEnrollment.id, id)).returning()
    await audit.log({ action: 'update', entity: 'wellness_enrollment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_enrollment' })
    return one(c, updated)
  })

  // ==================== PLANS ====================

  // GET /wellness-plans. A list reply (the template: { data } alone).
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const data = await db.select().from(wellnessPlan).where(eq(wellnessPlan.companyId, currentUser.companyId)).orderBy(desc(wellnessPlan.createdAt))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

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
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(wellnessPlan)
      .where(and(eq(wellnessPlan.id, id), eq(wellnessPlan.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Wellness plan not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['name', 'description', 'species', 'monthlyPrice', 'annualPrice', 'benefits', 'active'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]

    const [updated] = await db.update(wellnessPlan).set(updates).where(eq(wellnessPlan.id, id)).returning()
    await audit.log({ action: 'update', entity: 'wellness_plan', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_plan' })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(wellnessPlan)
      .where(and(eq(wellnessPlan.id, id), eq(wellnessPlan.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Wellness plan not found')

    await db.delete(wellnessPlan).where(eq(wellnessPlan.id, id))
    await audit.log({ action: 'delete', entity: 'wellness_plan', entityId: id, metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'wellness_plan' })
    return done(c)
  })

  return app
}
