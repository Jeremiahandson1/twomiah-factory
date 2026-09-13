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
import { eq, and, lte, count, asc, desc, sql, inArray } from 'drizzle-orm'

export interface AgreementsTables {
  serviceAgreement: any
  agreementVisit: any
  agreementPlan: any
  contact: any
  job: any
  invoice: any
  invoiceLineItem: any
}
export interface AgreementsStripe {
  listSavedPaymentMethods: (contactRow: any) => Promise<Array<{ id: string }>>
  chargeInvoiceOffSession: (inv: any, contactRow: any, paymentMethodId: string) => Promise<{ status: string }>
}
export interface AgreementsServiceDeps {
  db: any
  tables: AgreementsTables
  stripe: AgreementsStripe
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
  const { db, tables, stripe } = deps
  const { serviceAgreement, agreementVisit, agreementPlan, contact, job, invoice, invoiceLineItem } = tables

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
  async function updatePlan(planId: string, companyId: string, data: Record<string, unknown>) {
    const [updated] = await db.update(agreementPlan).set({ ...data, updatedAt: new Date() })
      .where(and(eq(agreementPlan.id, planId), eq(agreementPlan.companyId, companyId))).returning()
    return updated
  }
  async function deletePlan(id: string, companyId: string) {
    return db.delete(agreementPlan).where(and(eq(agreementPlan.id, id), eq(agreementPlan.companyId, companyId)))
  }

  // ---- customer agreements ----
  async function createAgreement(companyId: string, data: any) {
    const startDate = data.startDate ? new Date(data.startDate) : new Date()
    const [agreement] = await db.insert(serviceAgreement).values({
      companyId,
      contactId: data.contactId,
      name: data.name,
      number: data.number,
      startDate,
      endDate: data.endDate ? new Date(data.endDate) : null,
      billingFrequency: data.billingFrequency || 'monthly',
      amount: String(data.amount),
      renewalType: data.renewalType || 'auto',
      terms: data.terms,
      notes: data.notes,
      planId: data.planId,
      status: 'active',
    }).returning()
    return agreement
  }

  async function getAgreements(companyId: string, {
    status, contactId, expiringSoon, page = 1, limit = 50,
  }: { status?: string; contactId?: string; expiringSoon?: boolean; page?: number; limit?: number } = {}) {
    const conditions = [eq(serviceAgreement.companyId, companyId)]
    if (status) conditions.push(eq(serviceAgreement.status, status))
    if (contactId) conditions.push(eq(serviceAgreement.contactId, contactId))
    if (expiringSoon) {
      const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30)
      conditions.push(lte(serviceAgreement.endDate, thirtyDays))
      conditions.push(eq(serviceAgreement.status, 'active'))
    }
    const whereClause = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(serviceAgreement).where(whereClause).orderBy(asc(serviceAgreement.endDate)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(serviceAgreement).where(whereClause),
    ])
    return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
  }

  async function getAgreement(agreementId: string, companyId: string) {
    const [result] = await db.select().from(serviceAgreement)
      .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId))).limit(1)
    if (!result) return null
    const visits = await db.select().from(agreementVisit).where(eq(agreementVisit.agreementId, agreementId)).orderBy(desc(agreementVisit.scheduledDate))
    const [relatedContact] = await db.select().from(contact).where(eq(contact.id, result.contactId)).limit(1)
    return { ...result, visits, contact: relatedContact || null }
  }

  async function updateAgreement(agreementId: string, companyId: string, data: Record<string, unknown>) {
    return db.update(serviceAgreement).set({ ...data, updatedAt: new Date() })
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
      await db.insert(job).values({
        companyId,
        contactId: agreement.contactId,
        number: `JOB-AGR-${Date.now()}`,
        title: `${agreement.name} - ${data.serviceType || 'Maintenance Visit'}`,
        scheduledDate: new Date(data.scheduledDate),
        status: 'scheduled',
        notes: `Service Agreement: ${agreement.name}`,
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
    const [inv] = await db.insert(invoice).values({
      companyId,
      contactId: agreement.contactId,
      number: `INV-AGR-${Date.now()}`,
      status: 'sent',
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      subtotal: String(agreement.amount),
      total: String(agreement.amount),
    }).returning()
    await db.insert(invoiceLineItem).values({
      invoiceId: inv.id,
      description: `${agreement.name} - ${agreement.billingFrequency} billing`,
      quantity: '1',
      unitPrice: String(agreement.amount),
      total: String(agreement.amount),
    })
    const billedAt = new Date()
    await db.update(serviceAgreement).set({
      lastBilledAt: billedAt,
      nextBillDate: addInterval(agreement.nextBillDate ? new Date(agreement.nextBillDate) : billedAt, agreement.billingFrequency),
      updatedAt: billedAt,
    }).where(eq(serviceAgreement.id, agreementId))
    return inv
  }

  async function processDueAgreements(companyId?: string) {
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
    return { due: due.length, invoiced, charged, failures }
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
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const [[{ value: active }], [{ value: expiring }]] = await Promise.all([
      db.select({ value: count() }).from(serviceAgreement).where(and(eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'))),
      db.select({ value: count() }).from(serviceAgreement).where(and(
        eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'), lte(serviceAgreement.endDate, thirtyDaysFromNow),
      )),
    ])
    const agreements = await db.select({ amount: serviceAgreement.amount, billingFrequency: serviceAgreement.billingFrequency })
      .from(serviceAgreement).where(and(eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active')))
    let monthlyRecurring = 0
    for (const a of agreements) {
      const price = Number(a.amount)
      if (a.billingFrequency === 'monthly') monthlyRecurring += price
      else if (a.billingFrequency === 'quarterly') monthlyRecurring += price / 3
      else monthlyRecurring += price / 12
    }
    return {
      activeAgreements: active,
      expiringIn30Days: expiring,
      monthlyRecurringRevenue: Math.round(monthlyRecurring * 100) / 100,
      annualRecurringRevenue: Math.round(monthlyRecurring * 12 * 100) / 100,
    }
  }

  async function getExpiringAgreements(companyId: string, daysAhead = 60) {
    const endDate = new Date(); endDate.setDate(endDate.getDate() + daysAhead)
    return db.select().from(serviceAgreement).where(and(
      eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'),
      lte(serviceAgreement.endDate, endDate), eq(serviceAgreement.renewalType, 'manual'),
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
    const [{ value: cnt }] = await db.select({ value: count() }).from(job).where(eq(job.companyId, companyId))
    const [newJob] = await db.insert(job).values({
      number: `JOB-${String(Number(cnt) + 1).padStart(5, '0')}`,
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
  app.post('/', requirePermission('agreements:create'), async (c: any) => c.json(await service.createAgreement((c.get('user')).companyId, await c.req.json()), 201))
  app.put('/:id', requirePermission('agreements:update'), async (c: any) => {
    const user = c.get('user'); const id = c.req.param('id')
    await service.updateAgreement(id, user.companyId, await c.req.json())
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
