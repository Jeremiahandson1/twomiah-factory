// Memberships and prepaid packages — recurring revenue between visits. Moved from
// templates/crm-salon/backend/src/routes/memberships.ts. A plan with creditsTotal null is an open membership; with
// creditsTotal set it is a prepaid block that burns down per redeem. Enrolling bills the first period
// (./membershipBilling.ts).
import { Hono } from 'hono'
import { and, count, desc, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { roundsToNothing } from '@twomiah/tenant-backend'
import { membershipPlan, membershipEnrollment, contact } from '../../db/schema/index.ts'
import { takeMembershipCredit } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonServices } from './services.ts'

const ENROLLMENT_EDITABLE = ['planId', 'contactId', 'status', 'creditsRemaining', 'startDate', 'renewsAt', 'cancelledAt'] as const
const PLAN_EDITABLE = ['name', 'description', 'price', 'billingCycle', 'creditsTotal', 'includedServices', 'active'] as const
const BILLING_CYCLES = ['monthly', 'annual', 'one_time'] as const

/** The three fields that decide money, checked here and not only in the form. (Salon T28 M1, T51) */
function planProblem(body: Record<string, any>, { partial = false } = {}): string | null {
  if (!partial || 'price' in body) {
    if (body.price !== null && body.price !== undefined && body.price !== '') {
      const n = Number(body.price)
      if (!Number.isFinite(n)) return 'Price must be a number.'
      if (n < 0) return 'Price cannot be negative.'
      if (roundsToNothing(n)) return `${n} rounds to $0.00 — enter 0 for a free plan, or at least one cent.`
      if (n > 1_000_000) return 'Price looks too large — check the amount.'
    }
  }
  if (!partial || 'creditsTotal' in body) {
    if (body.creditsTotal !== null && body.creditsTotal !== undefined && body.creditsTotal !== '') {
      const n = Number(body.creditsTotal)
      if (!Number.isInteger(n)) return 'Visit credits must be a whole number.'
      if (n < 0) return 'Visit credits cannot be negative.'
      if (n > 10_000) return 'Visit credits looks too large — check the number.'
    }
  }
  if (!partial || 'billingCycle' in body) {
    if (body.billingCycle !== undefined && body.billingCycle !== null && body.billingCycle !== '') {
      if (!(BILLING_CYCLES as readonly string[]).includes(String(body.billingCycle))) return `Billing cycle must be one of ${BILLING_CYCLES.join(', ')}.`
    }
  }
  return null
}

export function createMembershipRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const refresh = (companyId: string, entity: string) => d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity })
  const { memberships: billing, clock } = salon
  const app = new Hono<AppEnv>()

  // ── Enrolments (before the plan /:id routes, so '/enrollments' isn't read as a plan id) ──

  // GET /memberships/enrollments — ?contactId=, ?status=. Reading settles what has come due. (T20 H4)
  app.get('/enrollments', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.query('contactId')
    const status = c.req.query('status')
    try { await billing.settleMembershipBilling(currentUser.companyId) } catch (e: any) { logger.warn('[memberships] billing run skipped', { error: e?.message || String(e) }) }

    const conditions = [eq(membershipEnrollment.companyId, currentUser.companyId)]
    if (contactId) conditions.push(eq(membershipEnrollment.contactId, contactId))
    if (status) conditions.push(eq(membershipEnrollment.status, status))
    // Bounded: enrolments only ever accumulate.
    const page = Math.max(1, Number(c.req.query('page') || '1') || 1)
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || '100') || 100))

    const data: any[] = await db.select({
      enrollment: membershipEnrollment, planName: membershipPlan.name, planPrice: membershipPlan.price, billingCycle: membershipPlan.billingCycle,
      clientName: contact.name, clientPhone: contact.phone,
    })
      .from(membershipEnrollment)
      .leftJoin(membershipPlan, eq(membershipEnrollment.planId, membershipPlan.id))
      .leftJoin(contact, eq(membershipEnrollment.contactId, contact.id))
      .where(and(...conditions))
      .orderBy(desc(membershipEnrollment.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)
    const rows = data.map((r) => ({ ...r.enrollment, planName: r.planName, planPrice: r.planPrice, billingCycle: r.billingCycle, clientName: r.clientName, clientPhone: r.clientPhone }))
    const [{ total }] = await db.select({ total: count() }).from(membershipEnrollment).where(and(...conditions))
    return list(c, rows, { page, limit, total: Number(total) })
  })

  // POST /memberships/enrollments — credits seed from the plan unless overridden.
  app.post('/enrollments', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (!body.planId || !body.contactId) return fail(c, 400, 'planId and contactId are required')

    const [plan] = await db.select().from(membershipPlan).where(and(eq(membershipPlan.id, body.planId), eq(membershipPlan.companyId, currentUser.companyId))).limit(1)
    if (!plan) return fail(c, 404, 'Plan not found')
    const [ct] = await db.select().from(contact).where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId))).limit(1)
    if (!ct) return fail(c, 404, 'Client not found')

    // One live enrolment per client per plan — enrolling twice billed twice. (Salon T27 H2) Only ACTIVE ones block.
    const [existingEnrolment] = await db.select({ id: membershipEnrollment.id, startDate: membershipEnrollment.startDate })
      .from(membershipEnrollment)
      .where(and(
        eq(membershipEnrollment.companyId, currentUser.companyId), eq(membershipEnrollment.contactId, body.contactId),
        eq(membershipEnrollment.planId, body.planId), eq(membershipEnrollment.status, 'active'),
      )).limit(1)
    if (existingEnrolment) {
      // The template also sent the enrolment's id; the sentence names the plan and the date.
      return fail(c, 409, `${ct.name || 'This client'} is already on ${plan.name}${existingEnrolment.startDate ? ` (since ${String(existingEnrolment.startDate).slice(0, 10)})` : ''}. Cancel that membership first if they are starting a new one.`, 'ALREADY_ENROLLED')
    }

    const [created] = await db.insert(membershipEnrollment).values({
      id: createId(),
      planId: body.planId,
      contactId: body.contactId,
      status: body.status || 'active',
      creditsRemaining: body.creditsRemaining ?? plan.creditsTotal ?? null,
      // The day the client signed up, on the SHOP's calendar. (T25 N2)
      startDate: body.startDate || (await clock.salonToday(currentUser.companyId)),
      renewsAt: body.renewsAt || null,
      companyId: currentUser.companyId,
    }).returning()

    // A membership sold is a membership billed. (T20 H4)
    const firstCharge = await billing.billFirstPeriod(created)
    const [withBilling] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, created.id)).limit(1)

    await audit.log({ action: 'create', entity: 'membership_enrollment', entityId: created.id, metadata: created, req: { user: currentUser } })
    refresh(currentUser.companyId, 'membership_enrollment')
    return one(c, { ...(withBilling || created), invoiceId: firstCharge?.invoiceId ?? null, invoiceNumber: firstCharge?.number ?? null }, 201)
  })

  // POST /memberships/billing/run — bill every membership that has come due.
  app.post('/billing/run', requirePermission('invoices:create'), async (c) => {
    const currentUser = c.get('user') as any
    const billed = await billing.settleMembershipBilling(currentUser.companyId)
    return one(c, { billed: billed.length, invoices: billed })
  })

  app.put('/enrollments/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [existing] = await db.select().from(membershipEnrollment).where(and(eq(membershipEnrollment.id, id), eq(membershipEnrollment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Enrollment not found')

    const updates: Record<string, any> = { updatedAt: new Date() }
    for (const k of ENROLLMENT_EDITABLE) if (k in body) updates[k] = body[k]
    if (updates.cancelledAt) updates.cancelledAt = new Date(updates.cancelledAt)
    if (body.status === 'cancelled' && !existing.cancelledAt && !updates.cancelledAt) updates.cancelledAt = new Date()

    const [updated] = await db.update(membershipEnrollment).set(updates).where(eq(membershipEnrollment.id, id)).returning()
    await audit.log({ action: 'update', entity: 'membership_enrollment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId, 'membership_enrollment')
    return one(c, updated)
  })

  // POST /memberships/enrollments/:id/redeem — burn one credit, in SQL so two tabs can't both spend the last one.
  app.post('/enrollments/:id/redeem', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(membershipEnrollment).where(and(eq(membershipEnrollment.id, id), eq(membershipEnrollment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Enrollment not found')
    if (existing.status !== 'active') return fail(c, 400, 'Enrollment is not active')
    if (existing.creditsRemaining === null) return fail(c, 400, 'This membership has no visit credits to redeem')

    const updated = await takeMembershipCredit(db, id, currentUser.companyId)
    if (!updated) return fail(c, 409, 'No credits remaining')
    await audit.log({ action: 'update', entity: 'membership_enrollment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId, 'membership_enrollment')
    return one(c, updated)
  })

  // ── Plans ──

  // GET /memberships — ?includeInactive=1
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const conditions = [eq(membershipPlan.companyId, currentUser.companyId)]
    if (c.req.query('includeInactive') !== '1') conditions.push(eq(membershipPlan.active, true))
    const data = await db.select().from(membershipPlan).where(and(...conditions)).orderBy(desc(membershipPlan.createdAt))
    return listAll(c, data)
  })

  app.post('/', requirePermission('pricebook:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.name !== 'string' || !body.name.trim()) return fail(c, 400, 'name is required')
    const problem = planProblem(body)
    if (problem) return fail(c, 400, problem)

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
    refresh(currentUser.companyId, 'membership_plan')
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('pricebook:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [existing] = await db.select().from(membershipPlan).where(and(eq(membershipPlan.id, id), eq(membershipPlan.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Membership plan not found')
    const editProblem = planProblem(body, { partial: true })
    if (editProblem) return fail(c, 400, editProblem)

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of PLAN_EDITABLE) if (k in body) updates[k] = body[k]
    const [updated] = await db.update(membershipPlan).set(updates).where(eq(membershipPlan.id, id)).returning()
    await audit.log({ action: 'update', entity: 'membership_plan', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId, 'membership_plan')
    return one(c, updated)
  })

  // DELETE — retire the plan: enrolments cascade on a hard delete, so it is deactivated instead.
  app.delete('/:id', requirePermission('pricebook:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(membershipPlan).where(and(eq(membershipPlan.id, id), eq(membershipPlan.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Membership plan not found')
    const [updated] = await db.update(membershipPlan).set({ active: false, updatedAt: new Date() }).where(eq(membershipPlan.id, id)).returning()
    await audit.log({ action: 'update', entity: 'membership_plan', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId, 'membership_plan')
    return one(c, { success: true, plan: updated })
  })

  return app
}
