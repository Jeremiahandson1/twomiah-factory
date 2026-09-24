import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { membershipPlan, membershipEnrollment, contact } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { billFirstPeriod, settleMembershipBilling } from '../services/membershipBilling.ts'
import { salonToday } from '../utils/salonDate.ts'

/**
 * Memberships and prepaid packages — recurring revenue between visits.
 * A plan with creditsTotal = null is an open membership (unlimited/recurring);
 * a plan with creditsTotal set is a prepaid block that burns down per redeem.
 */

// Typed context: every handler reads c.get('user'), and an untyped Hono app made each route
// registration a TS2769 "no overload matches this call". Naming the variable clears them.
const app = new Hono<{ Variables: { user: any } }>()
app.use('*', authenticate)

// ==================== ENROLLMENTS ====================
// Registered before the plan /:id routes so '/enrollments' isn't matched as a plan id.

// GET /memberships/enrollments — ?contactId=, ?status=
app.get('/enrollments', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.query('contactId')
  const status = c.req.query('status')

  // Settle on read: with no scheduler on a tenant backend, looking at the memberships page is what
  // brings the overdue ones up to date. Never let a billing hiccup break the list. (T20 H4)
  try { await settleMembershipBilling(currentUser.companyId) } catch (e: any) { console.warn('[memberships] billing run skipped:', e?.message || e) }

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

  // One live enrolment per client per plan. Enrolling twice was accepted in silence and BOTH
  // enrolments billed — T27 Money Client ended up with two $107.42 Blowout Club invoices from the same
  // plan, and would have been charged twice again at every renewal. Nothing about a second enrolment in
  // the same plan is meaningful: the credits, the renewal date and the billing period all describe the
  // one membership. (Salon T27 H2)
  //
  // Only ACTIVE enrolments block. A client who cancelled and comes back is enrolling again, which is a
  // real thing a salon does, and their old row is history rather than a duplicate.
  const [existingEnrolment] = await db.select({ id: membershipEnrollment.id, startDate: membershipEnrollment.startDate })
    .from(membershipEnrollment)
    .where(and(
      eq(membershipEnrollment.companyId, currentUser.companyId),
      eq(membershipEnrollment.contactId, body.contactId),
      eq(membershipEnrollment.planId, body.planId),
      eq(membershipEnrollment.status, 'active'),
    ))
    .limit(1)
  if (existingEnrolment) {
    return c.json({
      error: `${ct.name || 'This client'} is already on ${plan.name}${existingEnrolment.startDate ? ` (since ${String(existingEnrolment.startDate).slice(0, 10)})` : ''}. Cancel that membership first if they are starting a new one.`,
      code: 'ALREADY_ENROLLED',
      enrollmentId: existingEnrolment.id,
    }, 409)
  }

  const [created] = await db.insert(membershipEnrollment).values({
    id: createId(),
    planId: body.planId,
    contactId: body.contactId,
    status: body.status || 'active',
    creditsRemaining: body.creditsRemaining ?? plan.creditsTotal ?? null,
    // The day the client signed up, on the SHOP'S calendar — a 7pm Chicago enrolment used to be
    // recorded as starting tomorrow, and nextRenewal() then carried that day into every anniversary. (T25 N2)
    startDate: body.startDate || (await salonToday(currentUser.companyId)),
    renewsAt: body.renewsAt || null,
    companyId: currentUser.companyId,
  }).returning()

  // A membership sold is a membership billed: raise the first period now and set the renewal date, so
  // the enrolment does not sit at renewsAt null forever collecting nothing. (T20 H4)
  const firstCharge = await billFirstPeriod(created)
  const [withBilling] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, created.id)).limit(1)

  await audit.log({ action: 'create', entity: 'membership_enrollment', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'membership_enrollment' })
  return c.json({ ...(withBilling || created), invoiceId: firstCharge?.invoiceId ?? null, invoiceNumber: firstCharge?.number ?? null }, 201)
})

// POST /memberships/billing/run — bill every membership that has come due. There is no scheduler on a
// tenant backend, so this is the explicit handle; the enrolment reads settle as well. (T20 H4)
app.post('/billing/run', requirePermission('invoices:create'), async (c) => {
  const currentUser = c.get('user') as any
  const billed = await settleMembershipBilling(currentUser.companyId)
  return c.json({ billed: billed.length, invoices: billed })
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

/**
 * A plan is a price the salon charges, so the three fields that decide money are checked here and not
 * only in the form. Price -5, credits -1 and billingCycle "banana" all saved with 201; the -$5 plan then
 * raised no invoice on enrolment and the "banana" plan quietly renewed monthly. (Salon T28 M1)
 */
const BILLING_CYCLES = ['monthly', 'annual', 'one_time'] as const
function planProblem(body: any, { partial = false } = {}): string | null {
  if (!partial || 'price' in body) {
    if (body.price !== null && body.price !== undefined && body.price !== '') {
      const n = Number(body.price)
      if (!Number.isFinite(n)) return 'Price must be a number.'
      if (n < 0) return 'Price cannot be negative.'
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
      if (!(BILLING_CYCLES as readonly string[]).includes(String(body.billingCycle))) {
        return `Billing cycle must be one of ${BILLING_CYCLES.join(', ')}.`
      }
    }
  }
  return null
}

// POST /memberships
app.post('/', requirePermission('pricebook:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }
  const problem = planProblem(body)
  if (problem) return c.json({ error: problem }, 400)

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
app.put('/:id', requirePermission('pricebook:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(membershipPlan)
    .where(and(eq(membershipPlan.id, id), eq(membershipPlan.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Membership plan not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const editProblem = planProblem(body, { partial: true })
  if (editProblem) return c.json({ error: editProblem }, 400)

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
app.delete('/:id', requirePermission('pricebook:update'), async (c) => {
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
