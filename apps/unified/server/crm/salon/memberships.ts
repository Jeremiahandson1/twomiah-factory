// Memberships and prepaid packages — recurring revenue between visits. Moved from
// templates/crm-salon/backend/src/routes/memberships.ts. A plan with creditsTotal null is an open membership; with
// creditsTotal set it is a prepaid block that burns down per redeem. Enrolling bills the first period
// (./membershipBilling.ts).
import { Hono } from 'hono'
import { checkFilter } from '@twomiah/tenant-backend'
import { MEMBERSHIP_TILES, activeEnrollmentCondition } from './tileConditions.ts'
import { and, count, desc, eq, inArray, notInArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { roundsToNothing } from '@twomiah/tenant-backend'
import { membershipPlan, membershipEnrollment, membershipCharge, contact, invoice, company } from '../../db/schema/index.ts'
import { MEMBERSHIP_RETRY_KEY, RETRY_DEFAULTS, RETRY_LIMITS, nextTryAt, parseRetry, readRetry } from './membershipRetry.ts'
import { settingsOf } from './patchTest.ts'
import { takeMembershipCredit } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one, listAll } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
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

  const may = canSeeWith(d.permissions)

  /**
   * Turning on "charge their card automatically" is agreeing to take money on a schedule, so it sits with the seat that
   * charges (invoices:update), needs Card on File on, a card on the client, and the client's agreement (kept with who
   * recorded it). Null = fine to turn on; otherwise the refusal to send.
   */
  async function refuseAutoCharge(c: any, user: any, contactId: string, body: any) {
    if (!(await may(user.role, 'invoices:update', user.userId || user.id))) return fail(c, 403, 'Only someone who can take payments may set a member up for automatic card payments.')
    if (body.clientAgreed !== true) return fail(c, 400, 'Confirm the client has agreed to be charged automatically each period.', 'CONSENT_REQUIRED', { clientAgreed: 'Tick that the client agreed.' })
    if (!(await d.features.isFeatureEnabled(user.companyId, 'card_on_file'))) return fail(c, 409, 'Card on file is not switched on for this salon.', 'FEATURE_OFF')
    const [card] = await salon.cards.cardsOf(user.companyId, contactId)
    if (!card) return fail(c, 409, 'This client has no card on file. Add one on their chart first.', 'NO_CARD')
    return null
  }

  // ── Enrolments (before the plan /:id routes, so '/enrollments' isn't read as a plan id) ──

  // GET /memberships/enrollments — ?contactId=, ?status=. Reading settles what has come due. (T20 H4)
  app.get('/enrollments', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.query('contactId')
    const status = c.req.query('status')
    // ?tile=active is the home screen's "Members": the active enrolments (./tileConditions.ts — the dashboard's count calls the
    // same condition). The home screen only READS, so it does not run the billing pass (the timed one bills what is due).
    const tile = c.req.query('tile')
    const badTile = checkFilter(c, 'tile', tile, MEMBERSHIP_TILES)
    if (badTile) return badTile
    if (!tile) { try { await billing.settleMembershipBilling(currentUser.companyId) } catch (e: any) { logger.warn('[memberships] billing run skipped', { error: e?.message || String(e) }) } }

    const conditions: any[] = [eq(membershipEnrollment.companyId, currentUser.companyId)]
    if (tile === 'active') conditions.push(activeEnrollmentCondition(membershipEnrollment))
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
    // The latest automatic card charge for each member who has had one: what happened, never an amount or a card id.
    const tries: any[] = data.length
      ? await db.select({ enrollmentId: membershipCharge.enrollmentId, status: membershipCharge.status, attempt: membershipCharge.attempt, failureMessage: membershipCharge.failureMessage, at: membershipCharge.updatedAt })
        .from(membershipCharge).where(and(eq(membershipCharge.companyId, currentUser.companyId), inArray(membershipCharge.enrollmentId, data.map((r) => r.enrollment.id))))
        .orderBy(desc(membershipCharge.createdAt), desc(membershipCharge.attempt))
      : []
    const lastTry = new Map<string, any>()
    for (const t of tries) if (!lastTry.has(t.enrollmentId)) lastTry.set(t.enrollmentId, { status: t.status, attempt: t.attempt, failureMessage: t.failureMessage, at: t.at })
    const rows = data.map((r) => ({ ...r.enrollment, planName: r.planName, planPrice: r.planPrice, billingCycle: r.billingCycle, clientName: r.clientName, clientPhone: r.clientPhone, lastCharge: lastTry.get(r.enrollment.id) ?? null }))
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

    let autoCharge = false
    if (body.autoCharge === true) {
      const refused = await refuseAutoCharge(c, currentUser, body.contactId, body)
      if (refused) return refused
      autoCharge = true
    }

    const [created] = await db.insert(membershipEnrollment).values({
      id: createId(),
      autoCharge,
      autoChargeConsentAt: autoCharge ? new Date() : null,
      autoChargeConsentUserId: autoCharge ? (currentUser.userId || currentUser.id || null) : null,
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
    return one(c, { ...(withBilling || created), invoiceId: firstCharge?.invoiceId ?? null, invoiceNumber: firstCharge?.number ?? null, autoChargeResult: firstCharge?.charge ?? null }, 201)
  })

  // POST /memberships/billing/run — bill every membership that has come due.
  app.post('/billing/run', requirePermission('invoices:create'), async (c) => {
    const currentUser = c.get('user') as any
    const billed = await billing.settleMembershipBilling(currentUser.companyId)
    return one(c, { billed: billed.length, invoices: billed })
  })

  // PUT /memberships/enrollments/:id/auto-charge — { on, clientAgreed } — charge this member's card on file each period, or stop.
  // Stopping needs no agreement and is open to whoever may update the member.
  app.put('/enrollments/:id/auto-charge', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.on !== 'boolean') return fail(c, 400, 'Say whether automatic card payments are on.', 'VALIDATION', { on: 'Choose on or off.' })
    const [existing] = await db.select().from(membershipEnrollment).where(and(eq(membershipEnrollment.id, id), eq(membershipEnrollment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Enrollment not found')
    if (body.on) {
      if (existing.status !== 'active') return fail(c, 409, 'Only an active membership can be charged automatically.', 'NOT_ACTIVE')
      const refused = await refuseAutoCharge(c, currentUser, existing.contactId, body)
      if (refused) return refused
    }
    const [updated] = await db.update(membershipEnrollment).set(body.on
      ? { autoCharge: true, autoChargeConsentAt: new Date(), autoChargeConsentUserId: currentUser.userId || currentUser.id || null, updatedAt: new Date() }
      : { autoCharge: false, updatedAt: new Date() }).where(eq(membershipEnrollment.id, id)).returning()
    await audit.log({ action: 'update', entity: 'membership_enrollment', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId, 'membership_enrollment')
    return one(c, updated)
  })

  // ── When a card is declined (salon parity row 6) ──
  const mayCharge = async (c: any) => { const u = c.get('user') as any; return may(u.role, 'invoices:update', u.userId || u.id) }

  // GET /memberships/retry-settings — how many tries and how many days between them (defaults 3 and 3).
  app.get('/retry-settings', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const mayChange = d.permissions.hasPermission(String(u.role || ''), 'company:update', await d.permissions.getExtraPermissions(u.userId || u.id))
    return one(c, { ...readRetry(await settingsOf(db, u.companyId)), mayChange, limits: RETRY_LIMITS, defaults: RETRY_DEFAULTS })
  })
  // PUT /memberships/retry-settings — the owner's or an admin's call: it decides how long a member's card is chased.
  app.put('/retry-settings', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const got = parseRetry(await c.req.json().catch(() => null))
    if ('fields' in got) return fail(c, 400, 'Check the highlighted boxes.', 'VALIDATION', got.fields)
    const settings: any = (await settingsOf(db, u.companyId)) ?? {}
    const before = readRetry(settings)
    await db.update(company).set({ settings: { ...settings, [MEMBERSHIP_RETRY_KEY]: got.values }, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
    await audit.log({ action: 'update', entity: 'membership_retry_settings', entityId: u.companyId, changes: audit.diff(before, got.values), req: { user: u } })
    refresh(u.companyId, 'membership_enrollment')
    return one(c, { ...got.values, mayChange: true, limits: RETRY_LIMITS, defaults: RETRY_DEFAULTS })
  })

  // GET /memberships/failed-charges — charges that were declined (or wait for the member's approval) and whose invoice is still open.
  app.get('/failed-charges', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const retry = readRetry(await settingsOf(db, u.companyId))
    const rows: any[] = await db.select({
      enrollmentId: membershipCharge.enrollmentId, invoiceId: membershipCharge.invoiceId, attempt: membershipCharge.attempt, status: membershipCharge.status,
      failureMessage: membershipCharge.failureMessage, at: membershipCharge.updatedAt, backupTried: membershipCharge.backupTried, amount: membershipCharge.amount,
      clientName: contact.name, planName: membershipPlan.name, enrollmentStatus: membershipEnrollment.status, invoiceNumber: invoice.number,
    }).from(membershipCharge)
      .innerJoin(invoice, eq(invoice.id, membershipCharge.invoiceId))
      .innerJoin(membershipEnrollment, eq(membershipEnrollment.id, membershipCharge.enrollmentId))
      .leftJoin(membershipPlan, eq(membershipPlan.id, membershipEnrollment.planId))
      .leftJoin(contact, eq(contact.id, membershipCharge.contactId))
      .where(and(eq(membershipCharge.companyId, u.companyId), inArray(membershipCharge.status, ['declined', 'needs_action']), notInArray(invoice.status, ['paid', 'void', 'refunded'])))
      .orderBy(desc(membershipCharge.createdAt), desc(membershipCharge.attempt))
    const seen = new Set<string>()
    const data = rows.filter((r) => (seen.has(r.invoiceId) ? false : (seen.add(r.invoiceId), true))).map((r) => {
      const paused = r.enrollmentStatus === 'paused'
      const triesLeft = Math.max(0, retry.tries - r.attempt)
      return {
        enrollmentId: r.enrollmentId, invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, clientName: r.clientName, planName: r.planName, amount: r.amount,
        attempt: r.attempt, tries: retry.tries, status: r.status, reason: r.failureMessage, backupTried: r.backupTried, at: r.at,
        paused, triesLeft,
        nextTryAt: paused || triesLeft === 0 ? null : nextTryAt(new Date(r.at), retry.intervalDays).toISOString(),
        canRetryNow: !paused && triesLeft > 0 && r.enrollmentStatus === 'active',
      }
    })
    return listAll(c, data)
  })

  // POST /memberships/enrollments/:id/retry — "Retry now": the next try of a declined charge without waiting out the interval. Spending
  // money, so it asks for what taking a payment asks for. Before the last try only; a paused membership is Resumed instead.
  app.post('/enrollments/:id/retry', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const out = await billing.retryNow(c.req.param('id'), u.companyId, u.userId || u.id || null)
    if (!out) return fail(c, 404, 'Enrollment not found')
    if (out.outcome === 'not_active') return fail(c, 409, out.status === 'paused' ? 'This membership is paused — use Resume.' : 'Only an active membership can be charged.', 'NOT_ACTIVE')
    if (out.outcome === 'no_invoice') return fail(c, 409, 'There is no declined charge to try again.', 'NOTHING_TO_RETRY')
    if (out.outcome === 'no_tries_left') return fail(c, 409, 'Every try has been used. Resume the membership once the client has a new card.', 'NO_TRIES_LEFT')
    refresh(u.companyId, 'membership_enrollment')
    const [row] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, c.req.param('id'))).limit(1)
    return one(c, { ...row, retryResult: out.outcome })
  })

  // POST /memberships/enrollments/:id/resume — start a membership paused for a declined card again; billing restarts and the
  // unpaid invoice is charged to the card on file now. Spending money, so it asks for what taking a payment asks for.
  app.post('/enrollments/:id/resume', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const out = await billing.resume(c.req.param('id'), currentUser.companyId)
    if (!out) return fail(c, 404, 'Enrollment not found')
    if (out.status === 'not_paused') return fail(c, 409, 'Only a membership paused for a declined card can be resumed.', 'NOT_PAUSED')
    refresh(currentUser.companyId, 'membership_enrollment')
    const [row] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, c.req.param('id'))).limit(1)
    return one(c, { ...row, resumeResult: out.outcome })
  })

  app.put('/enrollments/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [existing] = await db.select().from(membershipEnrollment).where(and(eq(membershipEnrollment.id, id), eq(membershipEnrollment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Enrollment not found')

    const updates: Record<string, any> = { updatedAt: new Date() }
    for (const k of ENROLLMENT_EDITABLE) if (k in body) updates[k] = body[k]
    // The agreement to be charged was given by THIS client: moving the membership to another client ends it.
    if (body.contactId && body.contactId !== existing.contactId && existing.autoCharge) updates.autoCharge = false
    if (updates.cancelledAt) updates.cancelledAt = new Date(updates.cancelledAt)
    // Any status change ends the pause for a card: the private card link stops working and the note on it is cleared.
    if (existing.status === 'paused' && 'status' in body && body.status !== 'paused') { updates.pausedForPaymentAt = null; updates.cardUpdateToken = null }
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
