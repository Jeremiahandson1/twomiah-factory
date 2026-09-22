/**
 * Service Agreements / Memberships — ONE implementation for every CRM that offers `service_agreements`
 * (crm, crm-fieldservice, crm-landscaping). Vendored into each template as ../shared; the template's
 * services/agreements.ts wires in db + tables + its Stripe helpers, and routes/agreements.ts wires the
 * middleware and sets `recurrence` (fs/landscaping maintenance contracts).
 *
 * Recurring maintenance agreements: plans, customer agreements, visit scheduling, auto-renewal, member
 * discounts, revenue tracking, autopay billing (invoice + off-session charge on a saved card), and — for
 * fs/landscaping — recurrence rules that auto-generate the next maintenance job.
 *
 * Stripe: the SDK (`import('stripe')`) is used to cancel a linked subscription; the saved-card helpers
 * (listSavedPaymentMethods / chargeInvoiceOffSession) are INJECTED via deps.stripe — the old per-template
 * copies did `import('./stripe.ts')`, which cannot resolve from the vendored shared/ folder.
 */
import { Hono } from 'hono'
import { eq, and, lte, gte, count, asc, desc, sql, inArray } from 'drizzle-orm'
import { nextNumber } from '../invoicing/money'

/** A refused agreement write: bad input (400) or a customer / plan / agreement not in this company (404). */
export class AgreementError extends Error {
  status: 400 | 404
  constructor(message: string, status: 400 | 404) { super(message); this.status = status }
}
export const AGREEMENT_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'semi-annual', 'semiannual', 'semi_annual', 'annual', 'yearly']
export const AGREEMENT_STATUSES = ['active', 'pending', 'cancelled', 'expired']

export interface AgreementsTables {
  serviceAgreement: any
  agreementVisit: any
  agreementPlan: any
  contact: any
  job: any
  invoice: any
  invoiceLineItem: any
  /** For the renewal notice (company name, email, phone). Optional: without it no notices are sent. */
  company?: any
}
export interface AgreementsStripe {
  listSavedPaymentMethods: (contactRow: any) => Promise<Array<{ id: string }>>
  chargeInvoiceOffSession: (inv: any, contactRow: any, paymentMethodId: string) => Promise<{ status: string }>
}
export interface AgreementsServiceDeps {
  db: any
  tables: AgreementsTables
  stripe: AgreementsStripe
  /** The template's audit service — automatic renewals and expiries are logged when given. */
  audit?: { log: (entry: any) => any }
  /** Emails the customer before an auto-renew agreement renews (template 'agreementRenewalNotice'). Optional. */
  sendRenewalNotice?: (to: string, data: Record<string, unknown>) => Promise<unknown>
}

/** Days before an auto-renew agreement's end date that the customer is told it will renew: 30 for terms of a year or
 *  more, 14 for 3–11 months, none for shorter (month-to-month) terms — they aren't a new commitment each month. */
export function renewalNoticeDays(termMonths: number): number {
  return termMonths >= 12 ? 30 : termMonths >= 3 ? 14 : 0
}

/** An auto-renew agreement is renewed if its end date passed at most this many days ago (the worker runs every 12h);
 *  one that lapsed longer ago (the worker was down, or it predates auto-renewal) expires for the office to renew, so
 *  a customer is never renewed — and billed — months late without anyone deciding. */
export const RENEWAL_GRACE_DAYS = 7

/** The agreement's own term in whole months (start → end), 12 when it can't be worked out. */
export function agreementTermMonths(startDate: unknown, endDate: unknown): number {
  const s = new Date(String(startDate)), e = new Date(String(endDate))
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return 12
  const months = Math.round((e.getTime() - s.getTime()) / (30.4375 * 86400000))
  return Math.min(120, Math.max(1, months))
}
export interface AgreementsRoutesDeps {
  service: AgreementsService
  authenticate: any
  requirePermission: (permission: string) => any
  /** Expose the recurrence endpoints (fs / landscaping maintenance contracts). Default false. */
  recurrence?: boolean
}

/** Months between invoices for each billing frequency we support. */
function billingIntervalMonths(frequency: string): number {
  switch ((frequency || '').toLowerCase()) {
    case 'weekly': return 0.25
    case 'monthly': return 1
    case 'quarterly': return 3
    case 'semi-annual':
    case 'semiannual':
    case 'semi_annual': return 6
    case 'annual':
    case 'yearly': return 12
    default: return 1
  }
}
function addInterval(from: Date, frequency: string): Date {
  const next = new Date(from)
  const months = billingIntervalMonths(frequency)
  if (months < 1) next.setDate(next.getDate() + 7)
  else next.setMonth(next.getMonth() + months)
  return next
}
function advanceDate(current: Date, rule: { frequency: string; dayOfMonth?: number; monthOfYear?: number[] }): Date {
  const next = new Date(current)
  switch (rule.frequency) {
    case 'monthly': next.setMonth(next.getMonth() + 1); break
    case 'quarterly': next.setMonth(next.getMonth() + 3); break
    case 'biannual': next.setMonth(next.getMonth() + 6); break
    case 'annual': next.setFullYear(next.getFullYear() + 1); break
  }
  if (rule.dayOfMonth) next.setDate(rule.dayOfMonth)
  return next
}

export function createAgreementsService(deps: AgreementsServiceDeps) {
  const { db, tables, stripe, audit, sendRenewalNotice } = deps
  const { serviceAgreement, agreementVisit, agreementPlan, contact, job, invoice, invoiceLineItem, company } = tables

  // ---- plans ----
  async function getPlans(companyId: string, { active }: { active?: boolean | null } = {}) {
    const conditions = [eq(agreementPlan.companyId, companyId)]
    if (active !== null && active !== undefined) conditions.push(eq(agreementPlan.active, active))
    return db.select().from(agreementPlan).where(and(...conditions)).orderBy(asc(agreementPlan.name))
  }
  async function createPlan(companyId: string, data: any) {
    const [plan] = await db.insert(agreementPlan).values({
      companyId,
      name: data.name,
      description: data.description,
      price: String(data.price),
      billingFrequency: data.billingFrequency || 'annual',
      visitsIncluded: data.visitsIncluded || 0,
      discountPercent: data.discountPercent ? String(data.discountPercent) : '0',
      priorityService: data.priorityService || false,
      durationMonths: data.durationMonths || 12,
      autoRenew: data.autoRenew !== false,
      includedServices: data.includedServices,
    }).returning()
    return plan
  }
  // Only a plan's own fields — the raw body was written, so a companyId in it moved the plan to another company.
  const PLAN_FIELDS = ['name', 'description', 'price', 'billingFrequency', 'visitsIncluded', 'discountPercent', 'priorityService', 'durationMonths', 'autoRenew', 'includedServices', 'active']
  async function updatePlan(planId: string, companyId: string, data: Record<string, unknown>) {
    const fields = Object.fromEntries(PLAN_FIELDS.filter((k) => data?.[k] !== undefined).map((k) => [k, data[k]]))
    const [updated] = await db.update(agreementPlan).set({ ...fields, updatedAt: new Date() })
      .where(and(eq(agreementPlan.id, planId), eq(agreementPlan.companyId, companyId))).returning()
    return updated
  }
  async function deletePlan(id: string, companyId: string) {
    return db.delete(agreementPlan).where(and(eq(agreementPlan.id, id), eq(agreementPlan.companyId, companyId)))
  }

  // ---- customer agreements ----
  // Active agreements whose end date has passed: an auto-renew one that ended within RENEWAL_GRACE_DAYS renews for
  // another term of the same length (stays active, keeps billing); anything else expires. Runs before every read
  // that shows status and before each billing run. Each update re-checks "still active and still ended", so two
  // runs at once renew or expire an agreement once. (Landscaping T14 H3: ended 1 June, still Active)
  async function settleEndedAgreements(companyId?: string) {
    const now = new Date()
    const stillEnded = (id: string) => and(eq(serviceAgreement.id, id), eq(serviceAgreement.status, 'active'), sql`${serviceAgreement.endDate} < NOW()`)
    const ended = await db.select().from(serviceAgreement).where(and(
      companyId ? eq(serviceAgreement.companyId, companyId) : undefined, eq(serviceAgreement.status, 'active'),
      sql`${serviceAgreement.endDate} IS NOT NULL AND ${serviceAgreement.endDate} < NOW()`,
    ))
    for (const agr of ended) {
      const end = new Date(agr.endDate)
      const lapsedDays = (now.getTime() - end.getTime()) / 86400000
      if (agr.renewalType === 'auto' && lapsedDays <= RENEWAL_GRACE_DAYS) {
        const termMonths = agreementTermMonths(agr.startDate, agr.endDate)
        const newEnd = new Date(end); newEnd.setMonth(newEnd.getMonth() + termMonths)
        const [renewed] = await db.update(serviceAgreement).set({ startDate: end, endDate: newEnd, updatedAt: now }).where(stillEnded(agr.id)).returning()
        if (renewed) audit?.log({ action: 'renew', entity: 'service_agreement', entityId: agr.id, entityName: agr.number, companyId: agr.companyId,
          metadata: { automatic: true, termMonths, previousStartDate: agr.startDate, previousEndDate: agr.endDate, newEndDate: newEnd } })
        continue
      }
      const [expired] = await db.update(serviceAgreement).set({ status: 'expired', updatedAt: now }).where(stillEnded(agr.id)).returning()
      if (expired) audit?.log({ action: 'expire', entity: 'service_agreement', entityId: agr.id, entityName: agr.number, companyId: agr.companyId,
        metadata: { automatic: true, endDate: agr.endDate, renewalType: agr.renewalType,
          reason: agr.renewalType === 'auto' ? `ended ${Math.floor(lapsedDays)} days ago — past the ${RENEWAL_GRACE_DAYS}-day automatic renewal window` : 'manual renewal' } })
    }
  }

  // Contact + plan for each row, from this company only — the list pages show the customer, the plan and the
  // amount. (Landscaping T14 H2: rows rendered no customer, no plan and $0.00)
  async function withRelations(companyId: string, rows: any[]) {
    const contactIds = [...new Set(rows.map((r) => r.contactId).filter(Boolean))]
    const planIds = [...new Set(rows.map((r) => r.planId).filter(Boolean))]
    const [contacts, plans] = await Promise.all([
      contactIds.length ? db.select({ id: contact.id, name: contact.name, email: contact.email, phone: contact.phone }).from(contact)
        .where(and(eq(contact.companyId, companyId), inArray(contact.id, contactIds))) : [],
      planIds.length ? db.select({ id: agreementPlan.id, name: agreementPlan.name, price: agreementPlan.price, billingFrequency: agreementPlan.billingFrequency }).from(agreementPlan)
        .where(and(eq(agreementPlan.companyId, companyId), inArray(agreementPlan.id, planIds))) : [],
    ])
    const contactById = new Map(contacts.map((x: any) => [x.id, x]))
    const planById = new Map(plans.map((x: any) => [x.id, x]))
    return rows.map((r) => ({ ...r, contact: contactById.get(r.contactId) || null, plan: (r.planId && planById.get(r.planId)) || null }))
  }

  const dateOrError = (v: unknown, label: string): Date => {
    const d = v instanceof Date ? v : new Date(String(v))
    if (typeof v === 'boolean' || v === null || v === '' || isNaN(d.getTime())) throw new AgreementError(`${label} must be a valid date.`, 400)
    return d
  }

  // The fields a customer agreement can be created or edited with — anything else in the body (companyId, number,
  // autopay, billing dates…) is ignored. A plan fills in the name, amount, billing frequency and term. (The pages
  // sent {planId, contactId, startDate, autoRenew} or a "price" and got 400; an edit wrote the raw body, so string
  // dates 500'd and a companyId in the body moved the agreement to another company.)
  async function agreementFields(companyId: string, data: any, existing: any | null) {
    const out: Record<string, unknown> = {}
    const has = (k: string) => data[k] !== undefined
    if (has('contactId') || !existing) {
      if (typeof data.contactId !== 'string' || !data.contactId) throw new AgreementError('Customer is required.', 400)
      const [row] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, data.contactId), eq(contact.companyId, companyId))).limit(1)
      if (!row) throw new AgreementError('Customer not found', 404)
      out.contactId = data.contactId
    }
    let plan: any = null
    if (has('planId')) {
      if (data.planId === null || data.planId === '') out.planId = null
      else {
        if (typeof data.planId !== 'string') throw new AgreementError('Plan not found', 404)
        ;[plan] = await db.select().from(agreementPlan).where(and(eq(agreementPlan.id, data.planId), eq(agreementPlan.companyId, companyId))).limit(1)
        if (!plan) throw new AgreementError('Plan not found', 404)
        out.planId = plan.id
      }
    }
    const planChanged = !!plan && plan.id !== existing?.planId
    if (has('name')) {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      if (!name || name.length > 200) throw new AgreementError('Name is required (up to 200 characters).', 400)
      out.name = name
    } else if (!existing || planChanged) out.name = plan?.name || existing?.name || 'Service agreement'
    if (has('amount')) {
      const n = typeof data.amount === 'number' ? data.amount : typeof data.amount === 'string' && data.amount.trim() !== '' ? Number(data.amount) : NaN
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new AgreementError('Amount must be 0 or more.', 400)
      out.amount = n.toFixed(2)
    } else if (plan && (!existing || planChanged)) out.amount = Number(plan.price).toFixed(2)
    else if (!existing) throw new AgreementError('Amount is required — enter one or pick a plan.', 400)
    if (has('billingFrequency')) {
      if (!AGREEMENT_FREQUENCIES.includes(data.billingFrequency)) throw new AgreementError(`Billing frequency must be one of: monthly, quarterly, semi-annual, annual.`, 400)
      out.billingFrequency = data.billingFrequency
    } else if (!existing || planChanged) out.billingFrequency = plan?.billingFrequency || existing?.billingFrequency || 'monthly'
    const start = has('startDate') ? dateOrError(data.startDate, 'Start date') : existing ? new Date(existing.startDate) : new Date()
    if (has('startDate') || !existing) out.startDate = start
    let end: Date | null | undefined
    if (has('endDate')) end = data.endDate === null || data.endDate === '' ? null : dateOrError(data.endDate, 'End date')
    else if (!existing) { end = new Date(start); end.setMonth(end.getMonth() + (Number(plan?.durationMonths) || 12)) }
    if (end !== undefined) out.endDate = end
    const effectiveEnd = end !== undefined ? end : existing?.endDate ? new Date(existing.endDate) : null
    if (effectiveEnd && effectiveEnd < start) throw new AgreementError("End date can't be before the start date.", 400)
    if (has('renewalType')) {
      if (!['auto', 'manual'].includes(data.renewalType)) throw new AgreementError('Renewal must be auto or manual.', 400)
      out.renewalType = data.renewalType
    } else if (has('autoRenew')) out.renewalType = data.autoRenew === false ? 'manual' : 'auto'
    for (const k of ['terms', 'notes'] as const) {
      if (!has(k)) continue
      if (data[k] !== null && typeof data[k] !== 'string') throw new AgreementError(`${k === 'terms' ? 'Terms' : 'Notes'} must be text.`, 400)
      out[k] = data[k]
    }
    if (existing && has('status')) {
      if (!AGREEMENT_STATUSES.includes(data.status)) throw new AgreementError(`Status must be one of: ${AGREEMENT_STATUSES.join(', ')}.`, 400)
      out.status = data.status
    }
    return out
  }

  async function createAgreement(companyId: string, data: any) {
    const fields = await agreementFields(companyId, data ?? {}, null)
    return db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, serviceAgreement, serviceAgreement.number, serviceAgreement.companyId, companyId, { prefix: 'AGR', pad: 5 })
      const [agreement] = await tx.insert(serviceAgreement).values({ ...fields, companyId, number, status: 'active' }).returning()
      return agreement
    })
  }

  async function getAgreements(companyId: string, {
    status, contactId, expiringSoon, page = 1, limit = 50,
  }: { status?: string; contactId?: string; expiringSoon?: boolean; page?: number; limit?: number } = {}) {
    await settleEndedAgreements(companyId)
    const conditions = [eq(serviceAgreement.companyId, companyId)]
    if (status) conditions.push(eq(serviceAgreement.status, status))
    if (contactId) conditions.push(eq(serviceAgreement.contactId, contactId))
    if (expiringSoon) {
      const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30)
      conditions.push(lte(serviceAgreement.endDate, thirtyDays))
      conditions.push(gte(serviceAgreement.endDate, new Date()))
      conditions.push(eq(serviceAgreement.status, 'active'))
      conditions.push(eq(serviceAgreement.renewalType, 'manual')) // auto-renew agreements don't expire
    }
    const whereClause = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(serviceAgreement).where(whereClause).orderBy(asc(serviceAgreement.endDate)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(serviceAgreement).where(whereClause),
    ])
    const data = await withRelations(companyId, rows)
    return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
  }

  async function getAgreement(agreementId: string, companyId: string) {
    await settleEndedAgreements(companyId)
    const [result] = await db.select().from(serviceAgreement)
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).limit(1)
    if (!result) return null
    const visits = await db.select().from(agreementVisit).where(eq(agreementVisit.agreementId, agreementId)).orderBy(desc(agreementVisit.scheduledDate))
    const [withRel] = await withRelations(companyId, [result])
    return { ...withRel, visits }
  }

  async function updateAgreement(agreementId: string, companyId: string, data: any) {
    const [existing] = await db.select().from(serviceAgreement)
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).limit(1)
    if (!existing) throw new AgreementError('Agreement not found', 404)
    const fields = await agreementFields(companyId, data ?? {}, existing)
    return db.update(serviceAgreement).set({ ...fields, updatedAt: new Date() })
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).returning()
  }

  async function cancelAgreement(agreementId: string, companyId: string, _reason?: string) {
    const [agreement] = await db.select().from(serviceAgreement)
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).limit(1)
    if (!agreement) throw new Error('Agreement not found')
    const metadata = agreement.notes ? JSON.parse(agreement.notes).stripeSubscriptionId : null
    if (metadata && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default
        const s = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any })
        await s.subscriptions.cancel(metadata)
      } catch (err) {
        console.error('Failed to cancel Stripe subscription:', (err as Error).message)
      }
    }
    return db.update(serviceAgreement).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).returning()
  }

  async function renewAgreement(agreementId: string, companyId: string) {
    const agreement = await getAgreement(agreementId, companyId)
    if (!agreement) throw new Error('Agreement not found')
    const startDate = agreement.endDate ? new Date(agreement.endDate) : new Date()
    const endDate = new Date(startDate); endDate.setFullYear(endDate.getFullYear() + 1)
    const [renewed] = await db.update(serviceAgreement)
      .set({ startDate, endDate, status: 'active', updatedAt: new Date() })
      .where(eq(serviceAgreement.id, agreementId)).returning()
    return renewed
  }

  // ---- visits ----
  async function scheduleVisit(agreementId: string, companyId: string, data: any) {
    const agreement = await getAgreement(agreementId, companyId)
    if (!agreement) throw new Error('Agreement not found')
    const [visit] = await db.insert(agreementVisit).values({
      agreementId, scheduledDate: new Date(data.scheduledDate), notes: data.notes, status: 'scheduled',
    }).returning()
    if (data.createJob) {
      // Same JOB- sequence as every other job. It used to be `JOB-AGR-<timestamp>`, so a customer's
      // list read JOB-00047, JOB-AGR-1758543210123, JOB-00048 — unreadable, out of order, and outside
      // the numbering an auditor expects to be unbroken. nextNumber takes a per-company advisory lock
      // released at commit, which is why this runs in a transaction. (N4)
      await db.transaction(async (tx: any) => {
        const number = await nextNumber(tx, job, job.number, job.companyId, companyId, { prefix: 'JOB', pad: 5 })
        await tx.insert(job).values({
          companyId,
          contactId: agreement.contactId,
          number,
          title: `${agreement.name} - ${data.serviceType || 'Maintenance Visit'}`,
          scheduledDate: new Date(data.scheduledDate),
          status: 'scheduled',
          notes: `Service Agreement: ${agreement.name}`,
        })
      })
    }
    return visit
  }

  async function completeVisit(visitId: string, companyId: string, _data: { technicianNotes?: string }) {
    const [visit] = await db.select().from(agreementVisit).where(eq(agreementVisit.id, visitId)).limit(1)
    if (!visit) throw new Error('Visit not found')
    const [agr] = await db.select().from(serviceAgreement)
      .where(and(eq(serviceAgreement.id, visit.agreementId), eq(serviceAgreement.companyId, companyId))).limit(1)
    if (!agr) throw new Error('Visit not found')
    const [updated] = await db.update(agreementVisit).set({ status: 'completed', completedAt: new Date() })
      .where(eq(agreementVisit.id, visitId)).returning()
    return updated
  }

  async function getUpcomingVisits(companyId: string, { days = 30 }: { days?: number } = {}) {
    const endDate = new Date(); endDate.setDate(endDate.getDate() + days)
    const agreements = await db.select({ id: serviceAgreement.id }).from(serviceAgreement).where(eq(serviceAgreement.companyId, companyId))
    const agreementIds = agreements.map((a: any) => a.id)
    if (agreementIds.length === 0) return []
    // inArray, not a raw "= ANY(${jsArray})" — the array didn't serialise cleanly and 500'd this endpoint.
    return db.select().from(agreementVisit).where(and(
      eq(agreementVisit.status, 'scheduled'),
      lte(agreementVisit.scheduledDate, endDate),
      inArray(agreementVisit.agreementId, agreementIds),
    )).orderBy(asc(agreementVisit.scheduledDate))
  }

  // ---- billing ----
  async function getAgreementsDueForBilling(companyId?: string) {
    const conditions = [
      eq(serviceAgreement.status, 'active'),
      sql`(${serviceAgreement.nextBillDate} IS NULL OR ${serviceAgreement.nextBillDate} <= NOW())`,
      sql`${serviceAgreement.startDate} <= NOW()`,
      sql`(${serviceAgreement.endDate} IS NULL OR ${serviceAgreement.endDate} >= NOW())`,
    ]
    if (companyId) conditions.push(eq(serviceAgreement.companyId, companyId))
    return db.select().from(serviceAgreement).where(and(...conditions))
  }

  async function setAgreementAutopay(agreementId: string, companyId: string, { enabled, paymentMethodId }: { enabled: boolean; paymentMethodId?: string | null }) {
    const agreement = await getAgreement(agreementId, companyId)
    if (!agreement) throw new Error('Agreement not found')
    let methodId = paymentMethodId ?? agreement.paymentMethodId ?? null
    if (enabled && !methodId) {
      const [contactRow] = await db.select().from(contact).where(eq(contact.id, agreement.contactId))
      const methods = await stripe.listSavedPaymentMethods(contactRow)
      if (!methods.length) throw new Error('This customer has no saved card yet. They can add one by paying an invoice online.')
      methodId = methods[0].id
    }
    const [updated] = await db.update(serviceAgreement)
      .set({ autopay: enabled, paymentMethodId: enabled ? methodId : null, autopayLastError: null, updatedAt: new Date() })
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).returning()
    return updated
  }

  async function processAgreementBilling(agreementId: string, companyId: string) {
    const agreement = await getAgreement(agreementId, companyId)
    if (!agreement) throw new Error('Agreement not found')
    // An agreement invoice is an invoice: it belongs in the INV- sequence with the rest.
    //
    // `INV-AGR-<timestamp>` put a number in the customer's list that no one can read aloud, that sorts
    // nowhere, and that breaks the unbroken sequence a tax authority expects. money.ts already had to
    // teach nextNumber to IGNORE these so they could not hijack the real sequence — damage control for
    // a number that should never have been minted. The line item is written in the same transaction so
    // an invoice can never exist without it. (N4)
    const inv = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, invoice, invoice.number, invoice.companyId, companyId, { prefix: 'INV', pad: 5 })
      const [created] = await tx.insert(invoice).values({
        companyId,
        contactId: agreement.contactId,
        number,
        status: 'sent',
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subtotal: String(agreement.amount),
        total: String(agreement.amount),
      }).returning()
      await tx.insert(invoiceLineItem).values({
        invoiceId: created.id,
        description: `${agreement.name} - ${agreement.billingFrequency} billing`,
        quantity: '1',
        unitPrice: String(agreement.amount),
        total: String(agreement.amount),
      })
      return created
    })
    const billedAt = new Date()
    await db.update(serviceAgreement).set({
      lastBilledAt: billedAt,
      nextBillDate: addInterval(agreement.nextBillDate ? new Date(agreement.nextBillDate) : billedAt, agreement.billingFrequency),
      updatedAt: billedAt,
    }).where(eq(serviceAgreement.id, agreementId))
    return inv
  }

  // Tell customers before an auto-renew agreement renews (renewalNoticeDays ahead). One notice per term: the end date
  // it was sent for is claimed on the row first (so two runs can't both send), and released again if the email fails
  // so the next run retries. A customer with no email address is logged once instead. Worker/billing-run only —
  // never on a page read.
  async function sendRenewalNotices(companyId?: string) {
    let sent = 0, failed = 0, skipped = 0
    if (!sendRenewalNotice || !company) return { sent, failed, skipped }
    const now = Date.now()
    const due = await db.select().from(serviceAgreement).where(and(
      companyId ? eq(serviceAgreement.companyId, companyId) : undefined,
      eq(serviceAgreement.status, 'active'), eq(serviceAgreement.renewalType, 'auto'),
      gte(serviceAgreement.endDate, new Date(now)), lte(serviceAgreement.endDate, new Date(now + 30 * 86400000)),
      sql`(${serviceAgreement.renewalNoticeSentFor} IS NULL OR ${serviceAgreement.renewalNoticeSentFor} <> ${serviceAgreement.endDate})`,
    ))
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    for (const agr of due) {
      const end = new Date(agr.endDate)
      const termMonths = agreementTermMonths(agr.startDate, agr.endDate)
      const days = renewalNoticeDays(termMonths)
      if (!days || end.getTime() - now > days * 86400000) continue
      const [claimed] = await db.update(serviceAgreement).set({ renewalNoticeSentFor: end }).where(and(
        eq(serviceAgreement.id, agr.id), eq(serviceAgreement.status, 'active'),
        sql`(${serviceAgreement.renewalNoticeSentFor} IS NULL OR ${serviceAgreement.renewalNoticeSentFor} <> ${serviceAgreement.endDate})`,
      )).returning()
      if (!claimed) continue
      const [ct] = await db.select().from(contact).where(and(eq(contact.id, agr.contactId), eq(contact.companyId, agr.companyId))).limit(1)
      const logNotice = (metadata: Record<string, unknown>) => audit?.log({ action: 'renewal_notice', entity: 'service_agreement', entityId: agr.id, entityName: agr.number, companyId: agr.companyId, metadata: { renewalDate: end, ...metadata } })
      if (!ct?.email) { skipped++; logNotice({ sent: false, reason: 'customer has no email address' }); continue }
      const [co] = await db.select().from(company).where(eq(company.id, agr.companyId)).limit(1)
      const newEnd = new Date(end); newEnd.setMonth(newEnd.getMonth() + termMonths)
      try {
        await sendRenewalNotice(ct.email, {
          contactName: ct.name, companyName: co?.name || '', companyEmail: co?.email || '', companyPhone: co?.phone || '',
          agreementName: agr.name, agreementNumber: agr.number, amount: agr.amount, billingFrequency: agr.billingFrequency,
          renewalDate: fmt(end), newEndDate: fmt(newEnd),
        })
        sent++
        logNotice({ sent: true, to: ct.email })
      } catch (err: any) {
        failed++
        await db.update(serviceAgreement).set({ renewalNoticeSentFor: agr.renewalNoticeSentFor ?? null }).where(eq(serviceAgreement.id, agr.id))
        console.error('[Agreements] Renewal notice failed:', agr.id, err?.message || err)
      }
    }
    return { sent, failed, skipped }
  }

  async function processDueAgreements(companyId?: string) {
    // renew (or expire) agreements that just ended first, so a renewed agreement's next period is billed on time
    await settleEndedAgreements(companyId)
    const renewalNotices = await sendRenewalNotices(companyId)
    const due = await getAgreementsDueForBilling(companyId)
    let invoiced = 0, charged = 0
    const failures: Array<{ agreementId: string; error: string }> = []
    for (const agreement of due) {
      try {
        const inv = await processAgreementBilling(agreement.id, agreement.companyId)
        invoiced++
        if (agreement.autopay && agreement.paymentMethodId) {
          try {
            const [contactRow] = await db.select().from(contact).where(eq(contact.id, agreement.contactId))
            const result = await stripe.chargeInvoiceOffSession(inv, contactRow, agreement.paymentMethodId)
            if (result.status === 'succeeded') charged++
            else failures.push({ agreementId: agreement.id, error: 'Charge status: ' + result.status })
          } catch (chargeErr: any) {
            const message = chargeErr?.message || String(chargeErr)
            failures.push({ agreementId: agreement.id, error: message })
            await db.update(serviceAgreement).set({ autopayLastError: message.slice(0, 500), updatedAt: new Date() }).where(eq(serviceAgreement.id, agreement.id))
            console.error('[Agreements] Autopay charge failed:', agreement.id, message)
          }
        }
      } catch (err: any) {
        failures.push({ agreementId: agreement.id, error: err?.message || String(err) })
        console.error('[Agreements] Billing failed:', agreement.id, err?.message || err)
      }
    }
    return { due: due.length, invoiced, charged, failures, renewalNotices }
  }

  function startBillingProcessor() {
    const INTERVAL = 12 * 60 * 60 * 1000
    console.log('[Agreements] Starting recurring billing processor (every 12h)')
    const run = async () => {
      try {
        const result = await processDueAgreements()
        if (result.invoiced || result.failures.length) {
          console.log('[Agreements] billed', result.invoiced, 'invoiced,', result.charged, 'charged,', result.failures.length, 'failed')
        }
      } catch (err: any) {
        console.error('[Agreements] Processor error:', err?.message || err)
      }
    }
    setInterval(run, INTERVAL)
    setTimeout(run, 90_000)
  }

  // ---- reports ----
  async function getAgreementStats(companyId: string) {
    await settleEndedAgreements(companyId)
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    // ending in the next 30 days: auto-renew ones will renew; manual ones will expire unless the office renews them
    const endingIn30 = (renewalType: string) => db.select({ value: count() }).from(serviceAgreement).where(and(
      eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'), lte(serviceAgreement.endDate, thirtyDaysFromNow),
      gte(serviceAgreement.endDate, new Date()), eq(serviceAgreement.renewalType, renewalType),
    ))
    const [[{ value: active }], [{ value: expiring }], [{ value: renewing }]] = await Promise.all([
      db.select({ value: count() }).from(serviceAgreement).where(and(eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'))),
      endingIn30('manual'),
      endingIn30('auto'),
    ])
    const agreements = await db.select({ amount: serviceAgreement.amount, billingFrequency: serviceAgreement.billingFrequency })
      .from(serviceAgreement).where(and(eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active')))
    let monthlyRecurring = 0
    for (const a of agreements) {
      const price = Number(a.amount)
      // per billing period → per month (semi-annual was counted as annual)
      monthlyRecurring += price / billingIntervalMonths(a.billingFrequency)
    }
    return {
      activeAgreements: active,
      expiringIn30Days: expiring,
      renewingIn30Days: renewing,
      monthlyRecurringRevenue: Math.round(monthlyRecurring * 100) / 100,
      annualRecurringRevenue: Math.round(monthlyRecurring * 12 * 100) / 100,
    }
  }

  async function getExpiringAgreements(companyId: string, daysAhead = 60) {
    await settleEndedAgreements(companyId)
    const endDate = new Date(); endDate.setDate(endDate.getDate() + daysAhead)
    return db.select().from(serviceAgreement).where(and(
      eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'),
      lte(serviceAgreement.endDate, endDate), gte(serviceAgreement.endDate, new Date()), eq(serviceAgreement.renewalType, 'manual'),
    )).orderBy(asc(serviceAgreement.endDate))
  }

  // ---- recurrence (fs / landscaping maintenance contracts) ----
  async function setRecurrence(agreementId: string, companyId: string, data: any) {
    const [updated] = await db.update(serviceAgreement).set({
      recurrenceRule: data.recurrenceRule,
      nextServiceDate: new Date(data.nextServiceDate),
      autoSchedule: data.autoSchedule ?? false,
      reminderDaysBefore: data.reminderDaysBefore ?? 7,
      updatedAt: new Date(),
    }).where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).returning()
    return updated
  }

  async function generateNextJob(agreementId: string, companyId: string) {
    const [agr] = await db.select().from(serviceAgreement)
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).limit(1)
    if (!agr) throw new Error('Agreement not found')
    if (!agr.nextServiceDate || !agr.recurrenceRule) throw new Error('No recurrence configured')
    if (agr.lastGeneratedJobId) {
      const [lastJob] = await db.select({ status: job.status }).from(job).where(eq(job.id, agr.lastGeneratedJobId)).limit(1)
      if (lastJob && !['completed', 'cancelled'].includes(lastJob.status)) throw new Error('Previous scheduled job still pending')
    }
    const [agrContact] = await db.select().from(contact).where(eq(contact.id, agr.contactId)).limit(1)
    // Counting the rows was worse than the timestamp it sat beside: delete one job and the next count
    // lands on a number already in use, and job.number carries no unique constraint to catch it — two
    // jobs, one number, saved without complaint. Two staff generating at the same moment collide the
    // same way. nextNumber reads the highest number actually issued, under a per-company lock. (N4)
    const newJob = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, job, job.number, job.companyId, companyId, { prefix: 'JOB', pad: 5 })
      const [row] = await tx.insert(job).values({
      number,
      title: `${agr.name} — Scheduled Maintenance`,
      description: `Auto-generated from service agreement: ${agr.name}`,
      status: 'scheduled',
      priority: 'normal',
      jobType: 'maintenance',
      scheduledDate: agr.nextServiceDate,
      address: agrContact?.address || '',
      city: agrContact?.city || '',
      state: agrContact?.state || '',
      zip: agrContact?.zip || '',
      notes: `Service Agreement: ${agr.number}`,
      companyId,
      contactId: agr.contactId,
      serviceAgreementId: agreementId,
      }).returning()
      return row
    })
    const rule = agr.recurrenceRule as { frequency: string; dayOfMonth?: number; monthOfYear?: number[] }
    const nextDate = advanceDate(agr.nextServiceDate, rule)
    await db.update(serviceAgreement).set({ lastGeneratedJobId: newJob.id, nextServiceDate: nextDate, updatedAt: new Date() })
      .where(eq(serviceAgreement.id, agreementId))
    return { job: newJob, nextServiceDate: nextDate }
  }

  async function scanAndGenerateJobs() {
    const now = new Date()
    const allActive = await db.select().from(serviceAgreement).where(and(
      eq(serviceAgreement.status, 'active'), eq(serviceAgreement.autoSchedule, true),
    ))
    let generated = 0
    for (const agr of allActive) {
      if (!agr.nextServiceDate || !agr.recurrenceRule) continue
      const triggerDate = new Date(agr.nextServiceDate)
      triggerDate.setDate(triggerDate.getDate() - (agr.reminderDaysBefore || 7))
      if (triggerDate > now) continue
      if (agr.lastGeneratedJobId) {
        const [lastJob] = await db.select({ status: job.status }).from(job).where(eq(job.id, agr.lastGeneratedJobId)).limit(1)
        if (lastJob && !['completed', 'cancelled'].includes(lastJob.status)) continue
      }
      try { await generateNextJob(agr.id, agr.companyId); generated++ }
      catch (err) { console.error(`Failed to generate job for agreement ${agr.id}:`, err) }
    }
    if (generated > 0) console.log(`Auto-scheduled ${generated} maintenance jobs`)
    return generated
  }

  return {
    getPlans, createPlan, updatePlan, deletePlan,
    createAgreement, getAgreements, getAgreement, updateAgreement, cancelAgreement, renewAgreement,
    scheduleVisit, completeVisit, getUpcomingVisits,
    getAgreementsDueForBilling, setAgreementAutopay, processAgreementBilling, processDueAgreements, startBillingProcessor,
    getAgreementStats, getExpiringAgreements,
    setRecurrence, generateNextJob, scanAndGenerateJobs,
  }
}

export type AgreementsService = ReturnType<typeof createAgreementsService>

export function createAgreementsRoutes(deps: AgreementsRoutesDeps) {
  const { service, authenticate, requirePermission } = deps
  const app = new Hono()
  app.use('*', authenticate)

  // ---- plans ----
  app.get('/plans', async (c: any) => {
    const user = c.get('user')
    try {
      const active = c.req.query('active')
      const plans = await service.getPlans(user.companyId, { active: active === 'false' ? false : active === 'all' ? null : true })
      return c.json(plans)
    } catch (e: any) {
      console.error('[Agreements] GET /plans error:', e.message)
      return c.json({ error: 'Failed to load plans', detail: e.message }, 500)
    }
  })
  app.post('/plans', requirePermission('agreements:create'), async (c: any) => c.json(await service.createPlan((c.get('user')).companyId, await c.req.json()), 201))
  app.put('/plans/:id', requirePermission('agreements:update'), async (c: any) => {
    await service.updatePlan(c.req.param('id'), (c.get('user')).companyId, await c.req.json())
    return c.json({ success: true })
  })

  // ---- customer agreements ----
  app.get('/', async (c: any) => {
    const user = c.get('user')
    try {
      const { status, contactId, expiringSoon, page, limit } = c.req.query()
      const data = await service.getAgreements(user.companyId, {
        status, contactId, expiringSoon: expiringSoon === 'true',
        page: parseInt(page) || 1, limit: parseInt(limit) || 50,
      })
      return c.json(data)
    } catch (e: any) {
      console.error('[Agreements] GET / error:', e.message, e.stack?.split('\n').slice(0, 3).join('\n'))
      return c.json({ error: 'Failed to load agreements', detail: e.message }, 500)
    }
  })
  app.get('/:id', async (c: any) => {
    const agreement = await service.getAgreement(c.req.param('id'), (c.get('user')).companyId)
    if (!agreement) return c.json({ error: 'Agreement not found' }, 404)
    return c.json(agreement)
  })
  app.post('/', requirePermission('agreements:create'), async (c: any) => {
    try {
      return c.json(await service.createAgreement((c.get('user')).companyId, await c.req.json().catch(() => ({}))), 201)
    } catch (err) {
      if (err instanceof AgreementError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })
  app.put('/:id', requirePermission('agreements:update'), async (c: any) => {
    const user = c.get('user'); const id = c.req.param('id')
    try {
      await service.updateAgreement(id, user.companyId, await c.req.json().catch(() => ({})))
    } catch (err) {
      if (err instanceof AgreementError) return c.json({ error: err.message }, err.status)
      throw err
    }
    return c.json(await service.getAgreement(id, user.companyId))
  })
  app.post('/:id/cancel', requirePermission('agreements:update'), async (c: any) => {
    const { reason } = await c.req.json()
    await service.cancelAgreement(c.req.param('id'), (c.get('user')).companyId, reason)
    return c.json({ success: true })
  })
  app.post('/:id/renew', requirePermission('agreements:update'), async (c: any) => c.json(await service.renewAgreement(c.req.param('id'), (c.get('user')).companyId)))

  // ---- visits ----
  app.get('/visits/upcoming', async (c: any) => c.json(await service.getUpcomingVisits((c.get('user')).companyId, { days: parseInt(c.req.query('days')) || 30 })))
  app.post('/:id/visits', requirePermission('agreements:update'), async (c: any) => c.json(await service.scheduleVisit(c.req.param('id'), (c.get('user')).companyId, await c.req.json()), 201))
  app.post('/visits/:visitId/complete', requirePermission('agreements:update'), async (c: any) => c.json(await service.completeVisit(c.req.param('visitId'), (c.get('user')).companyId, await c.req.json())))

  // ---- billing ----
  app.get('/billing/due', async (c: any) => c.json(await service.getAgreementsDueForBilling((c.get('user')).companyId)))
  app.post('/:id/bill', requirePermission('invoices:create'), async (c: any) => c.json(await service.processAgreementBilling(c.req.param('id'), (c.get('user')).companyId)))
  app.put('/:id/autopay', requirePermission('agreements:update'), async (c: any) => {
    const user = c.get('user')
    const { enabled, paymentMethodId } = await c.req.json()
    try {
      const updated = await service.setAgreementAutopay(c.req.param('id')!, user.companyId, { enabled: enabled === true, paymentMethodId: paymentMethodId ?? null })
      return c.json(updated)
    } catch (err: any) {
      return c.json({ error: err?.message || 'Could not update autopay' }, 400)
    }
  })
  app.post('/billing/run', requirePermission('invoices:create'), async (c: any) => c.json(await service.processDueAgreements((c.get('user')).companyId)))

  // ---- reports ----
  app.get('/reports/stats', async (c: any) => c.json(await service.getAgreementStats((c.get('user')).companyId)))
  app.get('/reports/expiring', async (c: any) => c.json(await service.getExpiringAgreements((c.get('user')).companyId, parseInt(c.req.query('days')) || 60)))

  // ---- recurring scheduling (fs / landscaping) ----
  if (deps.recurrence) {
    app.put('/:id/recurrence', requirePermission('agreements:update'), async (c: any) => c.json(await service.setRecurrence(c.req.param('id'), (c.get('user')).companyId, await c.req.json())))
    app.post('/:id/schedule-next', requirePermission('agreements:update'), async (c: any) => c.json(await service.generateNextJob(c.req.param('id'), (c.get('user')).companyId)))
  }

  app.delete('/plans/:id', requirePermission('agreements:delete'), async (c: any) => {
    await service.deletePlan(c.req.param('id'), (c.get('user')).companyId)
    return c.json({ success: true })
  })

  return app
}
