/**
 * Commissions — ONE implementation for every CRM that offers `commission_tracking` (crm, crm-fieldservice,
 * crm-landscaping, crm-basic). Vendored into each template as ../shared; the template's routes/commissions.ts
 * wires in its db, tables and auth.
 *
 * It was three copies of one route file (crm-basic's had the T41 bounds, the other two did not) and none of
 * them could be used from the screen: the page listed plans and earnings but had no way to RECORD an earning,
 * so every commission row had to be typed into the API by hand. What this module adds, beyond being one copy:
 *
 *   · THE SERVER WORKS OUT THE AMOUNT. A commission recorded against a plan is calculated here from that plan
 *     — a flat rate per job, a percentage of the invoice before tax, or the tier the amount falls in — so the
 *     figure somebody is paid is not whatever a browser sent. A percent-of-margin plan needs the margin given,
 *     because margin is a job-costing number each CRM works out differently.
 *   · ONE STATUS ORDER. pending → approved → paid, with disputed reachable from pending or approved and
 *     resolved by approving again. `paid` is final. Approving a paid commission used to set it back to
 *     approved, and marking a pending one paid skipped the approval altogether.
 *   · NOBODY BELOW AN ADMIN SIGNS OFF THEIR OWN PAY. Approving and marking paid your own commission is
 *     refused unless you are an owner or admin — exactly the rule expenses follow (Salon RR6 E1).
 *   · EVERY REFERENCE IS THIS COMPANY'S. The person, the plan, the job and the invoice are each checked
 *     against the caller's company, so an id from another tenant — or a typo — is a 400, not a row that
 *     points at nothing.
 *
 * Tables: commission_plan, commission (crm-fieldservice/landscaping/basic migration 0005, crm 0041).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc, sum, inArray, gte, lte, or, isNull, ne, asc, sql } from 'drizzle-orm'
import { partialOf } from '../partialOf'
import { zmsg } from '../zodMessage'

export interface CommissionTables {
  commission: any
  commissionPlan: any
  user: any
  job: any
  invoice: any
}
export interface CommissionRoutesDeps {
  db: any
  tables: CommissionTables
  authenticate: any
  requirePermission: (permission: string) => any
  /** hasPermission(role, permission, extraPermissions) with the caller's per-user grants already resolved. */
  canSee: (role: string, permission: string, userId?: string) => Promise<boolean>
  /** The app's audit service (log({ action, entity, … req })): void and reassign are recorded with what changed. Optional. */
  audit?: { log: (entry: any) => any }
  /**
   * Offer plans that pay the job's sales rep when the whole job is paid (COMMISSION_AUTO_EARN_SALES_REP), margin plans
   * included — their margin is the job's own profit, known to the app that turns this on. Off (absent): such a plan is refused.
   */
  salesRepAutoEarn?: boolean
  /**
   * A plan can be paid on services, on retail or on both (commission_plan.sales_kind), and can pay the stylist of a visit by itself
   * (autoEarn 'visit_stylist'). Off — the default — a plan is exactly what it was; the salon turns it on.
   */
  salesKinds?: boolean
}

/**
 * A COMMISSION RATE IS A PERCENTAGE, AND PAY IS NOT NEGATIVE. (T41, crm-basic)
 *
 * 500 pays five times the invoice; −50 takes money off somebody for doing the work. 0 is allowed so a plan
 * can exist before its rate is decided; 100 is the ceiling. A flat rate is money and has no upper bound.
 * Each tier is held to the same rule as the header field.
 */
const percentRate = z.number(zmsg('A commission rate must be a number'))
  .min(0, 'A commission rate cannot be negative — that is a deduction, not a commission')
  .max(100, 'A commission rate is a percentage, so it cannot be more than 100')
const money = z.number(zmsg('An amount must be a number'))
  .min(0, 'A commission amount cannot be negative')

export const COMMISSION_PLAN_TYPES = ['flat_rate', 'percent_of_invoice', 'percent_of_margin', 'tiered'] as const
export const COMMISSION_ROLES = ['technician', 'sales_rep', 'manager', 'all'] as const
// 'cancelled': an automatic earning whose invoice was refunded in full before it was paid out.
export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'disputed', 'cancelled', 'void'] as const
/** Who a plan pays by itself when an invoice is paid in full. */
export const COMMISSION_AUTO_EARN = ['none', 'job_assignee', 'job_creator'] as const
/**
 * A job's SELLER, paid when the whole job is paid (roofing: job.assignedSalesRepId, at Collected). Not in the list above on
 * purpose — the templates' plans never name it — and refused by the routes unless the app turns it on (salesRepAutoEarn);
 * the app that does works it out itself (apps/unified server/crm/roof/commissions.ts), on the whole contract or the job's
 * gross profit. The invoice-by-invoice earner below never pays it.
 */
export const COMMISSION_AUTO_EARN_SALES_REP = 'job_sales_rep' as const
/** Where a business offers it (CommissionRoutesDeps.salesKinds): the stylist of the visit the invoice was raised from. */
export const VISIT_STYLIST = 'visit_stylist'
/** What a plan is paid on, where the business offers the choice. */
export const COMMISSION_SALES_KINDS = ['all', 'services', 'retail'] as const

const planSchema = z.object({
  name: z.string().trim().min(1, 'A plan needs a name'),
  planType: z.enum(COMMISSION_PLAN_TYPES),
  flatRateAmount: money.optional(),
  percentRate: percentRate.optional(),
  tiers: z.array(z.object({ min: money, max: money, rate: percentRate })).optional(),
  appliesToRole: z.enum(COMMISSION_ROLES).default('all'),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
  // T58k: isActive must be in the schema or zod strips it and PUT {isActive:false} answers 200 having done nothing.
  isActive: z.boolean().optional(),
  autoEarn: z.enum([...COMMISSION_AUTO_EARN, COMMISSION_AUTO_EARN_SALES_REP]).optional(),
  /**
   * The people the plan pays (login ids of this company). Empty: anyone it reaches who is not named on another plan.
   * Where the table has no column for it (a template's own schema), it is not offered.
   */
  userIds: z.array(z.string().min(1).max(64)).max(500).optional(),
})

/** The plan's fields for a business that offers sales kinds: the same, plus what it is paid on and the visit's stylist as who it pays. */
const salonPlanSchema = planSchema.extend({
  salesKind: z.enum(COMMISSION_SALES_KINDS).optional(),
  autoEarn: z.enum([...COMMISSION_AUTO_EARN, VISIT_STYLIST]).optional(),
})

const commissionSchema = z.object({
  planId: z.string().min(1).optional(),
  userId: z.string().min(1, 'Choose who earned it'),
  jobId: z.string().min(1).optional(),
  invoiceId: z.string().min(1).optional(),
  /** What the commission is worked out on. Read off the invoice when one is given; required otherwise. */
  baseAmount: money.optional(),
  /** Only for a commission recorded WITHOUT a plan — a one-off agreed amount. */
  commissionAmount: money.optional(),
  rateApplied: percentRate.optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  notes: z.string().max(2000).optional(),
})

const cents = (n: number) => Math.round(n * 100) / 100

/**
 * Who may sign off their OWN commission: the same set expenses uses (shared expenses.ts, OWN_APPROVAL_OK).
 * An owner or admin is the top of the chain — there is often nobody else to ask. Anyone else holding
 * commissions:update through a per-user grant still needs a second person.
 */
const OWN_APPROVAL_OK = new Set(['owner', 'admin'])

/**
 * The amount a plan pays on a base. Exported so the rule is tested on its own and read in one place.
 *
 * Tiered plans apply the rate of the bracket the WHOLE base falls in (min inclusive, max inclusive), the way
 * most small businesses write "5% up to $10k, 7% above" — not a marginal tax-style split. A base outside
 * every bracket earns nothing and says so, rather than silently using the nearest one.
 */
export function commissionFor(plan: { planType: string; flatRateAmount?: any; percentRate?: any; tiers?: any }, base: number):
  { amount: number; rate: number | null } | { error: string } {
  if (plan.planType === 'flat_rate') {
    const flat = Number(plan.flatRateAmount ?? 0)
    return { amount: cents(flat), rate: null }
  }
  if (plan.planType === 'percent_of_invoice' || plan.planType === 'percent_of_margin') {
    const rate = Number(plan.percentRate ?? 0)
    return { amount: cents(base * rate / 100), rate }
  }
  if (plan.planType === 'tiered') {
    const tiers = (Array.isArray(plan.tiers) ? plan.tiers : []) as Array<{ min: number; max: number; rate: number }>
    const tier = tiers.find((t) => base >= Number(t.min) && base <= Number(t.max))
    if (!tier) return { error: 'That amount is outside every bracket on this plan, so the plan does not say what it earns' }
    return { amount: cents(base * Number(tier.rate) / 100), rate: Number(tier.rate) }
  }
  return { error: 'Unknown plan type' }
}

/** The people a plan names (commission_plan.user_ids), as a list of ids — empty when it names nobody. */
export const planPeople = (plan: { userIds?: unknown }): string[] => (Array.isArray(plan.userIds) ? plan.userIds.map(String) : [])

/**
 * WHO A PLAN PAYS. A plan that names people pays them and nobody else. A plan that names nobody pays whoever it reaches —
 * except a person some other current plan names: their own plan is the arrangement made for them, and paying them under
 * the general one as well would pay them twice. (Contractor live re-test 2026-10-22: "the Plans page can't assign a plan
 * to a person".) Exported so the rule is tested on its own and read in one place.
 */
export function planPaysPerson(plan: { id: string; userIds?: unknown }, userId: string, currentPlans: Array<{ id: string; userIds?: unknown; isActive?: boolean | null }>): boolean {
  const named = planPeople(plan)
  if (named.length) return named.includes(userId)
  return !currentPlans.some((p) => p.id !== plan.id && p.isActive !== false && planPeople(p).includes(userId))
}

/**
 * Which status a commission may move to from where it is. `paid` is final: money that has gone out is
 * corrected with a new record, never by reopening the old one.
 */
const MOVES: Record<string, Record<string, readonly string[]>> = {
  approve: { from: ['pending', 'disputed'] },
  'mark-paid': { from: ['approved'] },
  dispute: { from: ['pending', 'approved'] },
} as any

export function createCommissionRoutes(deps: CommissionRoutesDeps) {
  const { db, tables: t, authenticate, requirePermission, canSee } = deps
  const app = new Hono()
  app.use('*', authenticate)
  const planShape: typeof planSchema = (deps.salesKinds ? salonPlanSchema : planSchema) as any

  const owned = async (table: any, id: string, companyId: string) => {
    const [row] = await db.select().from(table).where(and(eq(table.id, id), eq(table.companyId, companyId))).limit(1)
    return row || null
  }

  // ── plans ────────────────────────────────────────────────────────────────────────────────────────────
  // commissions:read, like every read of the pay structure (T38: this was once the one open route).
  app.get('/plans', requirePermission('commissions:read'), async (c) => {
    const currentUser = c.get('user') as any
    const plans = await db.select().from(t.commissionPlan).where(eq(t.commissionPlan.companyId, currentUser.companyId))
    return c.json({ data: plans })
  })

  /**
   * AUTOMATIC EARNING STARTS WHEN IT IS SWITCHED ON. autoSince is stamped the moment a plan goes from 'none' to
   * paying somebody, and cleared when it goes back — so the sweep only ever pays invoices paid from then on, and an
   * owner who switches it on does not wake up to a commission for every invoice imported from their old system.
   * A margin plan cannot earn by itself: its base is the job's margin, which the person recording it supplies.
   */
  /**
   * WHO A PLAN PAYS is checked like every other reference: each person must be a login of this company. A person who
   * has since left (switched off) may stay on a plan being edited, so their old earnings keep their name.
   */
  const peopleRefusal = async (companyId: string, userIds: string[] | undefined, keep: string[] = []) => {
    if (!userIds?.length || !t.commissionPlan.userIds) return null
    const ids = [...new Set(userIds)]
    const rows = await db.select({ id: t.user.id, isActive: t.user.isActive }).from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, ids)))
    const found = new Map(rows.map((r: any) => [r.id, r]))
    if (ids.some((id) => !found.has(id))) return 'Someone chosen for this plan is not on this account.'
    if (ids.some((id) => (found.get(id) as any).isActive === false && !keep.includes(id))) return 'Someone chosen for this plan has been switched off. Choose people who are still on the team.'
    return null
  }
  const autoRefusal = (planType: string | undefined, autoEarn: string | undefined) => {
    if (autoEarn === COMMISSION_AUTO_EARN_SALES_REP) {
      return deps.salesRepAutoEarn ? null : 'This business does not pay the job\u2019s sales rep automatically.'
    }
    return autoEarn && autoEarn !== 'none' && planType === 'percent_of_margin'
      ? 'A margin plan cannot pay automatically — its margin has to be entered when the commission is recorded.'
      : null
  }
  // Either shape: the base plan (roofing's seller choice included) or the salon's (its sales kind and the visit's stylist).
  const planValues = (data: Partial<Omit<z.infer<typeof planSchema>, 'autoEarn'>> & { autoEarn?: string; salesKind?: (typeof COMMISSION_SALES_KINDS)[number] }) => {
    const v: Record<string, any> = { ...data }
    if (data.userIds !== undefined) v.userIds = [...new Set(data.userIds)]
    if (!t.commissionPlan.userIds) delete v.userIds
    if (!deps.salesKinds || !t.commissionPlan.salesKind) delete v.salesKind
    if (data.flatRateAmount !== undefined) v.flatRateAmount = String(data.flatRateAmount)
    if (data.percentRate !== undefined) v.percentRate = String(data.percentRate)
    if (data.effectiveFrom !== undefined) v.effectiveFrom = data.effectiveFrom ? new Date(data.effectiveFrom) : null
    if (data.effectiveTo !== undefined) v.effectiveTo = data.effectiveTo ? new Date(data.effectiveTo) : null
    return v
  }

  app.post('/plans', requirePermission('commissions:create'), async (c) => {
    const currentUser = c.get('user') as any
    const parsed = planShape.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Check the plan', issues: parsed.error.issues }, 400)
    const data = parsed.data
    const refusal = autoRefusal(data.planType, data.autoEarn)
    if (refusal) return c.json({ error: refusal, code: 'margin_not_automatic' }, 400)
    const notPeople = await peopleRefusal(currentUser.companyId, data.userIds)
    if (notPeople) return c.json({ error: notPeople, code: 'plan_people' }, 400)
    const [created] = await db.insert(t.commissionPlan).values({
      ...planValues(data),
      autoEarn: data.autoEarn || 'none',
      autoSince: data.autoEarn && data.autoEarn !== 'none' ? new Date() : null,
      flatRateAmount: data.flatRateAmount !== undefined ? String(data.flatRateAmount) : null,
      percentRate: data.percentRate !== undefined ? String(data.percentRate) : null,
      companyId: currentUser.companyId,
    } as any).returning()
    return c.json(created, 201)
  })

  app.put('/plans/:id', requirePermission('commissions:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const parsed = partialOf(planShape).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Check the plan', issues: parsed.error.issues }, 400)
    const existing = await owned(t.commissionPlan, id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Commission plan not found' }, 404)
    const nextType = parsed.data.planType ?? existing.planType
    const nextAuto = parsed.data.autoEarn ?? existing.autoEarn
    const refusal = autoRefusal(nextType, nextAuto)
    if (refusal) return c.json({ error: refusal, code: 'margin_not_automatic' }, 400)
    const notPeople = await peopleRefusal(currentUser.companyId, parsed.data.userIds, Array.isArray(existing.userIds) ? existing.userIds : [])
    if (notPeople) return c.json({ error: notPeople, code: 'plan_people' }, 400)
    const set: Record<string, any> = { ...planValues(parsed.data), updatedAt: new Date() }
    if (parsed.data.autoEarn !== undefined && parsed.data.autoEarn !== existing.autoEarn) {
      set.autoSince = parsed.data.autoEarn === 'none' ? null : (existing.autoEarn === 'none' || !existing.autoSince ? new Date() : existing.autoSince)
    }
    const [updated] = await db.update(t.commissionPlan).set(set as any)
      .where(and(eq(t.commissionPlan.id, id), eq(t.commissionPlan.companyId, currentUser.companyId))).returning()
    if (!updated) return c.json({ error: 'Commission plan not found' }, 404)
    return c.json(updated)
  })

  // Retire, not delete: earnings already worked out under a plan keep pointing at it.
  app.delete('/plans/:id', requirePermission('commissions:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [gone] = await db.update(t.commissionPlan).set({ isActive: false, updatedAt: new Date() } as any)
      .where(and(eq(t.commissionPlan.id, id), eq(t.commissionPlan.companyId, currentUser.companyId))).returning()
    if (!gone) return c.json({ error: 'Commission plan not found' }, 404)
    return c.body(null, 204)
  })

  // ── earnings ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * The list, with the earner's NAME. The page printed the first eight characters of a user id, which
   * told an owner nothing about who was owed what. Without commissions:read you see only your own.
   */
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const userId = c.req.query('userId')
    const status = c.req.query('status')
    const canSeeEveryone = await canSee(currentUser.role, 'commissions:read', currentUser.userId)

    const conditions = [eq(t.commission.companyId, currentUser.companyId)]
    if (!canSeeEveryone) conditions.push(eq(t.commission.userId, currentUser.userId))
    else if (userId) conditions.push(eq(t.commission.userId, userId))
    if (status) conditions.push(eq(t.commission.status, status))

    const rows = await db.select().from(t.commission).where(and(...conditions)).orderBy(desc(t.commission.earnedAt))
    const ids = [...new Set(rows.map((r: any) => r.userId).filter(Boolean))] as string[]
    const people = ids.length
      ? await db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, email: t.user.email })
          .from(t.user).where(and(eq(t.user.companyId, currentUser.companyId), inArray(t.user.id, ids)))
      : []
    const nameOf = Object.fromEntries(people.map((p: any) => [p.id, [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email]))
    return c.json({ data: rows.map((r: any) => ({ ...r, userName: nameOf[r.userId] || null })) })
  })

  /**
   * Record an earning. With a plan, the server works the amount out; without one, the amount given is the
   * agreed one-off figure and is stored as typed. Either way the base, the person, the job and the invoice
   * must be this company's.
   */
  app.post('/', requirePermission('commissions:create'), async (c) => {
    const currentUser = c.get('user') as any
    const parsed = commissionSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Check the commission', issues: parsed.error.issues }, 400)
    const data = parsed.data
    const companyId = currentUser.companyId

    const earner = await owned(t.user, data.userId, companyId)
    if (!earner) return c.json({ error: 'That person is not on this account' }, 400)
    if (data.jobId && !(await owned(t.job, data.jobId, companyId))) return c.json({ error: 'That job is not on this account' }, 400)

    let base = data.baseAmount
    // A margin plan is worked out on the MARGIN, which only job costing knows — never on the invoice it came from.
    // Read off the invoice, a 20%-of-margin plan paid 20% of the whole sale.
    const planRow = data.planId ? await owned(t.commissionPlan, data.planId, companyId) : null
    const baseFromInvoice = planRow?.planType !== 'percent_of_margin'
    if (data.invoiceId) {
      const inv = await owned(t.invoice, data.invoiceId, companyId)
      if (!inv) return c.json({ error: 'That invoice is not on this account' }, 400)
      if (['draft', 'void', 'voided', 'cancelled'].includes(String(inv.status))) {
        return c.json({ error: `That invoice is ${inv.status}, so there is nothing to pay commission on yet` }, 400)
      }
      // Before tax, after the discount: tax is not the business's money, a discount is money it never got.
      if (base === undefined && baseFromInvoice) base = cents(Math.max(0, Number(inv.subtotal ?? inv.total ?? 0) - Number(inv.discount ?? 0)))
    }

    let amount: number
    let rate: number | null = data.rateApplied ?? null
    let planId: string | null = null
    if (data.planId) {
      const plan = planRow
      if (!plan) return c.json({ error: 'That commission plan is not on this account' }, 400)
      if (plan.isActive === false) return c.json({ error: 'That plan has been retired. Choose a current one.' }, 400)
      // A plan that names its people pays them only (planPaysPerson).
      if (planPeople(plan).length && !planPeople(plan).includes(earner.id)) return c.json({ error: 'That plan is for other people. Choose the plan this person is on, or record an agreed amount without a plan.', code: 'not_on_plan' }, 400)
      if (plan.planType !== 'flat_rate' && base === undefined) {
        return c.json({ error: plan.planType === 'percent_of_margin' ? 'Enter the margin this commission is worked out on' : 'Choose an invoice or enter the amount this commission is worked out on' }, 400)
      }
      const result = commissionFor(plan, base ?? 0)
      if ('error' in result) return c.json({ error: result.error }, 400)
      amount = result.amount
      rate = result.rate
      planId = plan.id
    } else {
      if (data.commissionAmount === undefined) return c.json({ error: 'Choose a plan, or enter the commission amount' }, 400)
      amount = cents(data.commissionAmount)
    }

    const [created] = await db.insert(t.commission).values({
      companyId,
      planId,
      userId: earner.id,
      jobId: data.jobId || null,
      invoiceId: data.invoiceId || null,
      baseAmount: String(cents(base ?? 0)),
      rateApplied: rate !== null ? String(rate) : null,
      commissionAmount: String(amount),
      periodStart: data.periodStart ? new Date(data.periodStart) : null,
      periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
      notes: data.notes || null,
    } as any).returning()
    return c.json(created, 201)
  })

  const move = (action: 'approve' | 'mark-paid' | 'dispute', to: string) => {
    app.post(`/:id/${action}`, requirePermission('commissions:update'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({})) as { notes?: string }
      const existing = await owned(t.commission, id, currentUser.companyId)
      if (!existing) return c.json({ error: 'Commission not found' }, 404)
      if (action !== 'dispute' && existing.userId === currentUser.userId && !OWN_APPROVAL_OK.has(currentUser.role)) {
        return c.json({ error: 'You cannot approve or pay your own commission. Approval is a second person checking it before the money goes out — ask an owner or admin.', code: 'self_approval' }, 403)
      }
      const from = MOVES[action].from as readonly string[]
      if (!from.includes(existing.status)) {
        return c.json({ error: existing.status === 'paid' ? 'This commission has been paid. Record a correction instead of reopening it.' : `A ${existing.status} commission cannot be ${to === 'paid' ? 'marked paid' : to === 'approved' ? 'approved' : 'disputed'}`, code: 'status_order', status: existing.status }, 409)
      }
      const set: Record<string, any> = { status: to, updatedAt: new Date() }
      if (to === 'paid') set.paidAt = new Date()
      if (action === 'dispute' && typeof body.notes === 'string') set.notes = body.notes.slice(0, 2000)
      // The status is in the WHERE too, so two clicks in two tabs cannot both move it.
      const [updated] = await db.update(t.commission).set(set as any)
        .where(and(eq(t.commission.id, id), eq(t.commission.companyId, currentUser.companyId), eq(t.commission.status, existing.status))).returning()
      if (!updated) return c.json({ error: 'This commission changed while you were looking at it. Reload and try again.', code: 'changed' }, 409)
      return c.json(updated)
    })
  }
  move('approve', 'approved')
  move('mark-paid', 'paid')
  move('dispute', 'disputed')

  /**
   * VOID AND REASSIGN. (Contractor live re-test 3, 2026-10-24: a $165 commission read "Former team member" — its login
   * had been deleted and added again — and nothing could put it right.) commissions:update, like the status moves; only
   * while the money has not gone out (paid is final: a correction is a new record). The row is never deleted: void keeps
   * it, marked void with the reason, out of every total. Each is recorded in the audit log with what changed.
   */
  const OPEN_STATUSES = ['pending', 'approved', 'disputed']
  const audited = (c: any, row: any, changes: Record<string, { old: unknown; new: unknown }>, description: string) => {
    try { deps.audit?.log({ action: 'update', entity: 'commission', entityId: row.id, entityName: `${row.commissionAmount}`, changes, metadata: { description }, req: c }) } catch { /* the audit never fails the change */ }
  }
  app.post('/:id/void', requirePermission('commissions:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const body = await c.req.json().catch(() => ({})) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    if (!reason) return c.json({ error: 'Say why it is void — the reason is kept on the record.', code: 'reason_required' }, 400)
    const existing = await owned(t.commission, c.req.param('id'), currentUser.companyId)
    if (!existing) return c.json({ error: 'Commission not found' }, 404)
    if (!OPEN_STATUSES.includes(existing.status)) {
      return c.json({ error: existing.status === 'paid' ? 'This commission has been paid. Record a correction instead of voiding it.' : `A ${existing.status} commission cannot be voided.`, code: 'status_order', status: existing.status }, 409)
    }
    const set: Record<string, any> = { status: 'void', updatedAt: new Date() }
    // Where the table keeps the reason (the unified app), it goes there; a template's table keeps it in the notes.
    if (t.commission.voidReason) Object.assign(set, { voidReason: reason, voidedAt: new Date(), voidedById: currentUser.userId })
    else set.notes = `${existing.notes ? existing.notes + ' · ' : ''}Void: ${reason}`
    const [updated] = await db.update(t.commission).set(set as any)
      .where(and(eq(t.commission.id, existing.id), eq(t.commission.companyId, currentUser.companyId), eq(t.commission.status, existing.status))).returning()
    if (!updated) return c.json({ error: 'This commission changed while you were looking at it. Reload and try again.', code: 'changed' }, 409)
    audited(c, updated, { status: { old: existing.status, new: 'void' }, voidReason: { old: null, new: reason } }, `Commission voided — ${reason}`)
    return c.json(updated)
  })

  app.post('/:id/reassign', requirePermission('commissions:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const body = await c.req.json().catch(() => ({})) as { userId?: unknown }
    const userId = typeof body.userId === 'string' ? body.userId : ''
    if (!userId) return c.json({ error: 'Choose who earned it', code: 'user_required' }, 400)
    const existing = await owned(t.commission, c.req.param('id'), currentUser.companyId)
    if (!existing) return c.json({ error: 'Commission not found' }, 404)
    if (!OPEN_STATUSES.includes(existing.status)) {
      return c.json({ error: existing.status === 'paid' ? 'This commission has been paid. Record a correction instead of moving it.' : `A ${existing.status} commission cannot be moved.`, code: 'status_order', status: existing.status }, 409)
    }
    const earner = await owned(t.user, userId, currentUser.companyId)
    if (!earner) return c.json({ error: 'That person is not on this account' }, 400)
    if (earner.isActive === false) return c.json({ error: 'That login is switched off. Choose someone still on the team.', code: 'inactive' }, 400)
    if (earner.id === existing.userId) return c.json({ error: 'It is already theirs.', code: 'unchanged' }, 400)
    // The same rule as approving: below an admin, nobody moves pay to or from themselves.
    if ((earner.id === currentUser.userId || existing.userId === currentUser.userId) && !OWN_APPROVAL_OK.has(currentUser.role)) {
      return c.json({ error: 'You cannot move a commission to or from yourself — ask an owner or admin.', code: 'self_approval' }, 403)
    }
    const [updated] = await db.update(t.commission).set({ userId: earner.id, updatedAt: new Date() } as any)
      .where(and(eq(t.commission.id, existing.id), eq(t.commission.companyId, currentUser.companyId), eq(t.commission.status, existing.status))).returning()
    if (!updated) return c.json({ error: 'This commission changed while you were looking at it. Reload and try again.', code: 'changed' }, 409)
    const name = [earner.firstName, earner.lastName].filter(Boolean).join(' ') || earner.email
    audited(c, updated, { userId: { old: existing.userId, new: earner.id } }, `Commission moved to ${name}`)
    return c.json({ ...updated, userName: name })
  })

  /**
   * A STATEMENT: one person's commissions over a period — every line, and what is pending, approved, paid and
   * owed. The person sees their own; seeing anybody else's is commissions:read, like the list.
   */
  app.get('/statement', async (c) => {
    const currentUser = c.get('user') as any
    const companyId = currentUser.companyId
    const userId = c.req.query('userId') || currentUser.userId
    const canSeeEveryone = await canSee(currentUser.role, 'commissions:read', currentUser.userId)
    if (userId !== currentUser.userId && !canSeeEveryone) return c.json({ error: 'You can see your own statement only.' }, 403)
    const person = await owned(t.user, userId, companyId)
    if (!person) return c.json({ error: 'That person is not on this account' }, 404)
    const day = /^\d{4}-\d{2}-\d{2}$/
    const fromQ = c.req.query('from'), toQ = c.req.query('to')
    if ((fromQ && !day.test(fromQ)) || (toQ && !day.test(toQ))) return c.json({ error: 'Dates are YYYY-MM-DD' }, 400)
    const conditions: any[] = [eq(t.commission.companyId, companyId), eq(t.commission.userId, userId)]
    if (fromQ) conditions.push(gte(t.commission.earnedAt, new Date(`${fromQ}T00:00:00`)))
    if (toQ) conditions.push(lte(t.commission.earnedAt, new Date(`${toQ}T23:59:59.999`)))
    const lines = await db.select().from(t.commission).where(and(...conditions)).orderBy(asc(t.commission.earnedAt))
    const total = (status: string) => cents(lines.filter((l: any) => l.status === status).reduce((a: number, l: any) => a + Number(l.commissionAmount || 0), 0))
    const totals = { pending: total('pending'), approved: total('approved'), paid: total('paid'), disputed: total('disputed') }
    return c.json({
      person: { id: person.id, name: [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email },
      from: fromQ || null, to: toQ || null,
      lines: lines.filter((l: any) => l.status !== 'cancelled' && l.status !== 'void'),
      totals: { ...totals, owed: cents(totals.pending + totals.approved) },
    })
  })

  // Total earned / approved / paid / disputed per person.
  app.get('/summary/by-user', requirePermission('commissions:read'), async (c) => {
    const currentUser = c.get('user') as any
    const data = await db
      .select({ userId: t.commission.userId, status: t.commission.status, total: sum(t.commission.commissionAmount) })
      .from(t.commission)
      .where(eq(t.commission.companyId, currentUser.companyId))
      .groupBy(t.commission.userId, t.commission.status)
    return c.json({ data })
  })

  return app
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// AUTOMATIC EARNING
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface CommissionEarnerTables extends CommissionTables { company: any }
export interface CommissionEarnerDeps {
  db: any
  tables: CommissionEarnerTables
  /**
   * How an invoice reaches its job. 'jobId' where the invoice table carries invoice.job_id (crm-fieldservice);
   * 'quoteId' everywhere else — the job raised from the same quote. An invoice that reaches no job earns nothing:
   * there is nobody to attribute it to, and a guess (every job on a project) would pay the wrong person.
   */
  invoiceJobLink: 'jobId' | 'quoteId'
}

/**
 * WHEN AN INVOICE IS PAID IN FULL, EACH PLAN THAT PAYS AUTOMATICALLY PAYS ITS PERSON — ONCE.
 *
 * An invoice becomes paid through a dozen doors: Record payment, the Stripe webhook, a payment link, autopay, bulk
 * mark-paid, a credit that clears the balance, an edit that lowers the total under what was paid, the boot-time
 * status repair. A hook on each door would be a dozen places to forget one. So this is a SWEEP, the same shape the
 * store's refunds use: it looks at invoices paid since a plan started paying automatically, works out what each one
 * owes, and writes it under a unique index (commission_auto_once) so a second look — the sweep, the webhook retrying,
 * two servers — can never pay twice. The routes that record money call earnForInvoice straight away as well, so the
 * commission shows at once; the sweep is what makes it certain.
 *
 *   who      the plan's autoEarn: 'job_assignee' (the person assigned the job — a roster-only crew member has no
 *            login and cannot be paid through the CRM, so is skipped) or 'job_creator' (whoever booked the job)
 *   on what  the invoice before tax, after its discount — the same base a commission recorded by hand uses
 *   when     paidAt on or after the plan's autoSince, inside its effective dates — never imported history
 *   refunds  an invoice refunded IN FULL takes the commission back: one not yet paid out is cancelled; one already
 *            paid out gets a reversal line (a negative amount, pending, against the next pay) — money that went out
 *            is corrected by a new record, never by rewriting the old one. A partial refund leaves it standing.
 */
export function createCommissionEarner(deps: CommissionEarnerDeps) {
  const { db, tables: t, invoiceJobLink } = deps

  const featureOn = async (companyId: string) => {
    const [co] = await db.select({ enabledFeatures: t.company.enabledFeatures }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
    return ((co?.enabledFeatures || []) as string[]).includes('commission_tracking')
  }
  const autoPlans = async (companyId: string) => db.select().from(t.commissionPlan).where(and(
    eq(t.commissionPlan.companyId, companyId),
    eq(t.commissionPlan.isActive, true),
    ne(t.commissionPlan.autoEarn, 'none'),
  ))
  /** Every current plan, automatic or not: who each one names decides who the general ones pay (planPaysPerson). */
  const currentPlans = async (companyId: string) => db.select().from(t.commissionPlan).where(and(
    eq(t.commissionPlan.companyId, companyId),
    eq(t.commissionPlan.isActive, true),
  ))
  const jobFor = async (inv: any) => {
    if (invoiceJobLink === 'jobId' && inv.jobId) {
      const [j] = await db.select().from(t.job).where(and(eq(t.job.id, inv.jobId), eq(t.job.companyId, inv.companyId))).limit(1)
      if (j) return j
    }
    if (!inv.quoteId) return null
    const [j] = await db.select().from(t.job).where(and(eq(t.job.quoteId, inv.quoteId), eq(t.job.companyId, inv.companyId))).orderBy(asc(t.job.createdAt)).limit(1)
    return j || null
  }

  /** Earn — or take back — every automatic commission one invoice owes. Safe to call any number of times. */
  async function earnForInvoice(invoiceId: string): Promise<{ earned: number; cancelled: number; reversed: number }> {
    const out = { earned: 0, cancelled: 0, reversed: 0 }
    const [inv] = await db.select().from(t.invoice).where(eq(t.invoice.id, invoiceId)).limit(1)
    if (!inv || !(await featureOn(inv.companyId))) return out

    if (inv.status === 'paid' && inv.paidAt) {
      const paidAt = new Date(inv.paidAt)
      const plans = (await autoPlans(inv.companyId)).filter((p: any) =>
        p.planType !== 'percent_of_margin' && p.autoEarn !== COMMISSION_AUTO_EARN_SALES_REP
        && p.autoSince && new Date(p.autoSince) <= paidAt
        && (!p.effectiveFrom || new Date(p.effectiveFrom) <= paidAt)
        && (!p.effectiveTo || new Date(p.effectiveTo) >= paidAt))
      if (!plans.length) return out
      const job = await jobFor(inv)
      if (!job) return out
      const base = cents(Math.max(0, Number(inv.subtotal ?? inv.total ?? 0) - Number(inv.discount ?? 0)))
      const everyPlan = await currentPlans(inv.companyId)
      for (const plan of plans) {
        const earnerId = plan.autoEarn === 'job_assignee' ? job.assignedToId : plan.autoEarn === 'job_creator' ? job.createdById : null
        if (!earnerId) continue
        // A plan pays the people it names; a general plan, anyone it reaches who has no plan of their own.
        if (!planPaysPerson(plan, earnerId, everyPlan)) continue
        const [person] = await db.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.id, earnerId), eq(t.user.companyId, inv.companyId))).limit(1)
        if (!person) continue
        const result = commissionFor(plan, base)
        if ('error' in result) continue
        const rows = await db.insert(t.commission).values({
          companyId: inv.companyId, planId: plan.id, userId: person.id, jobId: job.id, invoiceId: inv.id,
          baseAmount: String(base), rateApplied: result.rate !== null ? String(result.rate) : null,
          commissionAmount: String(result.amount), earnedAt: paidAt, source: 'auto',
          notes: `Earned automatically when ${inv.number || 'the invoice'} was paid in full`,
        } as any).onConflictDoNothing().returning({ id: t.commission.id })
        out.earned += rows.length
      }
      return out
    }

    if (inv.status === 'refunded') {
      const autos = await db.select().from(t.commission).where(and(
        eq(t.commission.companyId, inv.companyId), eq(t.commission.invoiceId, inv.id), eq(t.commission.source, 'auto'),
      ))
      for (const a of autos) {
        if (['pending', 'approved', 'disputed'].includes(a.status)) {
          const rows = await db.update(t.commission).set({ status: 'cancelled', notes: `${a.notes ? a.notes + ' · ' : ''}Cancelled: ${inv.number || 'the invoice'} was refunded in full`, updatedAt: new Date() } as any)
            .where(and(eq(t.commission.id, a.id), eq(t.commission.status, a.status))).returning({ id: t.commission.id })
          out.cancelled += rows.length
        } else if (a.status === 'paid') {
          const rows = await db.insert(t.commission).values({
            companyId: a.companyId, planId: a.planId, userId: a.userId, jobId: a.jobId, invoiceId: a.invoiceId,
            baseAmount: String(-Number(a.baseAmount || 0)), rateApplied: a.rateApplied,
            commissionAmount: String(-Number(a.commissionAmount || 0)), source: 'reversal', reversalOf: a.id,
            notes: `Taken back: ${inv.number || 'the invoice'} was refunded in full after this commission was paid`,
          } as any).onConflictDoNothing().returning({ id: t.commission.id })
          out.reversed += rows.length
        }
      }
    }
    return out
  }

  /**
   * Every invoice that may owe something: paid on or after the earliest autoSince of a company's automatic plans,
   * and refunded ones that carry an automatic commission. Bounded per run; the next run picks up the rest.
   */
  async function sweep({ batch = 500 } = {}): Promise<{ invoices: number; earned: number; cancelled: number; reversed: number }> {
    const total = { invoices: 0, earned: 0, cancelled: 0, reversed: 0 }
    const companies = await db.select({ id: t.company.id, enabledFeatures: t.company.enabledFeatures }).from(t.company)
    for (const co of companies as any[]) {
      if (!((co.enabledFeatures || []) as string[]).includes('commission_tracking')) continue
      const plans = (await autoPlans(co.id)).filter((p: any) => p.autoSince && p.planType !== 'percent_of_margin' && p.autoEarn !== COMMISSION_AUTO_EARN_SALES_REP)
      const since = plans.reduce((min: Date | null, p: any) => (!min || new Date(p.autoSince) < min ? new Date(p.autoSince) : min), null as Date | null)
      const ids = new Set<string>()
      if (since) {
        // Not yet earned on, newest first, inside the last 30 days (or since the plan started, if later). The
        // routes earn at once and the sweep runs every 5 minutes, so 30 days is slack, not a limit anyone meets —
        // and it keeps an invoice that reaches no job from being looked at for ever.
        const floor = new Date(Math.max(since.getTime(), Date.now() - 30 * 24 * 60 * 60 * 1000))
        const paid = await db.select({ id: t.invoice.id }).from(t.invoice)
          .where(and(
            eq(t.invoice.companyId, co.id), eq(t.invoice.status, 'paid'), gte(t.invoice.paidAt, floor),
            sql`NOT EXISTS (SELECT 1 FROM commission c WHERE c.invoice_id = ${t.invoice.id} AND c.source = 'auto')`,
          )).orderBy(desc(t.invoice.paidAt)).limit(batch)
        for (const r of paid as any[]) ids.add(r.id)
      }
      const refunded = await db.select({ id: t.commission.invoiceId }).from(t.commission)
        .innerJoin(t.invoice, eq(t.invoice.id, t.commission.invoiceId))
        .where(and(eq(t.commission.companyId, co.id), eq(t.commission.source, 'auto'), eq(t.invoice.status, 'refunded'), or(ne(t.commission.status, 'cancelled'), isNull(t.commission.status)))).limit(batch)
      for (const r of refunded as any[]) if (r.id) ids.add(r.id)
      for (const id of ids) {
        try {
          const r = await earnForInvoice(id)
          total.invoices++; total.earned += r.earned; total.cancelled += r.cancelled; total.reversed += r.reversed
        } catch (err: any) { console.warn('[Commissions] earn failed for invoice', id, err?.message || err) }
      }
    }
    return total
  }

  /** Every 5 minutes, and once shortly after boot. stop() for a test or a shutdown. */
  function startCommissionEarner({ intervalMs = 5 * 60 * 1000, firstRunMs = 90_000 } = {}) {
    const run = async () => {
      try {
        const r = await sweep()
        if (r.earned || r.cancelled || r.reversed) console.log('[Commissions] earned', r.earned, '· cancelled', r.cancelled, '· reversed', r.reversed)
      } catch (err: any) { console.error('[Commissions] sweep error:', err?.message || err) }
    }
    const interval = setInterval(run, intervalMs)
    const first = setTimeout(run, firstRunMs)
    return { stop: () => { clearInterval(interval); clearTimeout(first) } }
  }

  return { earnForInvoice, sweep, startCommissionEarner }
}
export type CommissionEarner = ReturnType<typeof createCommissionEarner>
