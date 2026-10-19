// /api/payroll-verification — payday verification: a caregiver confirms (or disputes) their last pay period's hours
// before payroll runs. Moved from templates/crm-homecare/backend/src/routes/payrollVerification.ts (ported there from
// CVHC payrollRoutes.js "CAREGIVER PAYDAY VERIFICATION").
//
// Pay cycle: Sunday–Saturday, paid the following Friday (period end + 6 days). The period a caregiver is asked about is
// the most recent one whose pay date has arrived. OFF BY DEFAULT (company.settings.paydayVerification), as CVHC runs it:
// a persistent "confirm your hours" modal blocked caregivers from clocking in. /me/verify works either way.
//
// Permissions (the template: requireAdmin for the office's paths, "is this a caregiver" for /me/*):
//   · GET/PUT /settings, GET /   — care-payroll:update, the payroll write a caregiver does not hold;
//   · GET /me/pending            — care-payroll:read or a caregiver (shared.ts payrollOrCaregiver); anyone who is not
//                                  a caregiver is never prompted (pending: null);
//   · POST /me/verify            — care-payroll:create or a caregiver, and only a caregiver (normalizeRole 'field'), for themselves.
//
// Changes from the template: the agency is the signed-in person's company; every read and write is the company's; the
// office notified of a dispute is everyone active in the company who holds care-payroll:update (the template: role
// admin or owner — the same people unless the owner granted payroll to someone); GET / is a list reply.
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray, isNotNull, between } from 'drizzle-orm'
import { clients, company, notifications, payrollPeriodVerifications, payrollShiftReviews, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { PAYABLE_REVIEW_STATUSES } from '../core/payrollPay.ts'
import { payrollOrCaregiver } from './shared.ts'

const PAYABLE = [...PAYABLE_REVIEW_STATUSES]
const DEFAULT_RATE = () => parseFloat(process.env.DEFAULT_HOURLY_RATE || '') || 15

/** Today's calendar date in a time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The most recent Sun–Sat pay period whose Friday pay date has arrived, for the calendar day `today` (YYYY-MM-DD).
 * Computed on calendar dates so the server's own time zone cannot shift it a day.
 */
export function getCurrentPayPeriod(today: string): { start: string; end: string; payDate: string } | null {
  const d = new Date(today + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return null
  const day = 24 * 60 * 60 * 1000
  const daysSinceSat = (d.getUTCDay() + 1) % 7
  let end = new Date(d.getTime() - daysSinceSat * day)
  let payDate = new Date(end.getTime() + 6 * day)
  if (d < payDate) {
    // This week's period isn't due yet — the prior one is.
    end = new Date(end.getTime() - 7 * day)
    payDate = new Date(payDate.getTime() - 7 * day)
    if (d < payDate) return null
  }
  const start = new Date(end.getTime() - 6 * day)
  const fmt = (x: Date) => x.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end), payDate: fmt(payDate) }
}

const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T12:00:00Z').getTime())
const money = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(2))

/** The payday prompt's reads, for the router and the tests. */
export function createPaydayVerification(d: CrmDeps) {
  const { db } = d

  async function companySettings(companyId: string): Promise<Record<string, any> | null> {
    const [a] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!a) return null
    return (a.settings && typeof a.settings === 'object' ? a.settings : {}) as Record<string, any>
  }

  /** Is the prompt switched on for this company? */
  async function promptEnabled(companyId: string): Promise<boolean> {
    return (await companySettings(companyId))?.paydayVerification === true
  }

  /** The pending pay period for one of the company's caregivers on the calendar day `today`, or null. */
  async function pendingVerificationFor(companyId: string, caregiverId: string, today: string) {
    const period = getCurrentPayPeriod(today)
    if (!period) return null

    const [existing] = await db.select().from(payrollPeriodVerifications).where(and(
      eq(payrollPeriodVerifications.companyId, companyId),
      eq(payrollPeriodVerifications.caregiverId, caregiverId),
      eq(payrollPeriodVerifications.payPeriodStart, period.start),
      eq(payrollPeriodVerifications.payPeriodEnd, period.end),
    ))
    if (existing && (existing.verifiedAt || existing.disputedAt)) return null

    const shifts = await db.select({
      id: payrollShiftReviews.id,
      shiftDate: payrollShiftReviews.shiftDate,
      scheduledStart: payrollShiftReviews.scheduledStart,
      scheduledEnd: payrollShiftReviews.scheduledEnd,
      scheduledMinutes: payrollShiftReviews.scheduledMinutes,
      actualStart: payrollShiftReviews.actualStart,
      actualEnd: payrollShiftReviews.actualEnd,
      actualMinutes: payrollShiftReviews.actualMinutes,
      payableMinutes: payrollShiftReviews.payableMinutes,
      status: payrollShiftReviews.status,
      clientFirst: clients.firstName,
      clientLast: clients.lastName,
    })
      .from(payrollShiftReviews)
      .leftJoin(clients, eq(clients.id, payrollShiftReviews.clientId))
      .where(and(
        eq(payrollShiftReviews.companyId, companyId),
        eq(payrollShiftReviews.caregiverId, caregiverId),
        // By shift date, like every payroll reader (core/payrollPay.ts).
        between(payrollShiftReviews.shiftDate, period.start, period.end),
        inArray(payrollShiftReviews.status, PAYABLE),
        isNotNull(payrollShiftReviews.scheduleId),
      ))
      .orderBy(asc(payrollShiftReviews.shiftDate), asc(payrollShiftReviews.scheduledStart))
    if (shifts.length === 0) return null

    const [u] = await db.select({ rate: user.defaultPayRate }).from(user).where(and(eq(user.id, caregiverId), eq(user.companyId, companyId)))
    const rate = u?.rate != null ? parseFloat(String(u.rate)) : DEFAULT_RATE()
    const totalMinutes = (shifts as any[]).reduce((s, r) => s + (Number(r.payableMinutes) || 0), 0)
    const totalHours = totalMinutes / 60
    const grossPay = totalHours * rate
    return {
      payPeriodStart: period.start,
      payPeriodEnd: period.end,
      payDate: period.payDate,
      shifts,
      totalHours: parseFloat(totalHours.toFixed(2)),
      hourlyRate: rate,
      grossPay: parseFloat(grossPay.toFixed(2)),
    }
  }

  return { companySettings, promptEnabled, pendingVerificationFor }
}

export function createPayrollVerificationRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission, normalizeRole, hasPermission } = d.permissions
  const payday = createPaydayVerification(d)
  const app = new Hono<AppEnv>()
  const office = requirePermission('care-payroll:update')

  // GET /settings
  app.get('/settings', office, async (c) => one(c, { paydayVerification: await payday.promptEnabled(c.get('user').companyId) }))

  // PUT /settings { paydayVerification: boolean } — keeps the company's other settings.
  app.put('/settings', office, async (c) => {
    const { companyId } = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    if (typeof body.paydayVerification !== 'boolean') return fail(c, 400, 'paydayVerification must be true or false')
    const settings = await payday.companySettings(companyId)
    if (!settings) return fail(c, 404, 'No agency found')
    await db.update(company).set({ settings: { ...settings, paydayVerification: body.paydayVerification }, updatedAt: new Date() }).where(eq(company.id, companyId))
    return one(c, { paydayVerification: body.paydayVerification })
  })

  // GET /me/pending → { pending: {...} | null }. Only a caregiver is ever prompted, and only with the prompt on.
  app.get('/me/pending', payrollOrCaregiver(d, 'read'), async (c) => {
    const me = c.get('user')
    if (normalizeRole(me.role) !== 'field') return one(c, { pending: null })
    if (!(await payday.promptEnabled(me.companyId))) return one(c, { pending: null })
    const today = await core.time.today(me.companyId)
    return one(c, { pending: await payday.pendingVerificationFor(me.companyId, me.userId, today) })
  })

  // POST /me/verify { payPeriodStart, payPeriodEnd, confirmed, disputeReason?, reportedGrossPay?, reportedTotalHours? }
  app.post('/me/verify', payrollOrCaregiver(d, 'create'), async (c) => {
    const me = c.get('user')
    if (normalizeRole(me.role) !== 'field') return fail(c, 403, 'Caregivers only')
    const body = await c.req.json().catch(() => ({})) as any
    const { payPeriodStart, payPeriodEnd, confirmed } = body
    if (!payPeriodStart || !payPeriodEnd) return fail(c, 400, 'payPeriodStart and payPeriodEnd are required')
    if (!isDay(payPeriodStart) || !isDay(payPeriodEnd) || payPeriodEnd < payPeriodStart) return fail(c, 400, 'The pay period dates are not valid')
    const hours = money(body.reportedTotalHours)
    const gross = money(body.reportedGrossPay)
    const now = new Date()
    const target = [payrollPeriodVerifications.caregiverId, payrollPeriodVerifications.payPeriodStart, payrollPeriodVerifications.payPeriodEnd]

    if (confirmed) {
      await db.insert(payrollPeriodVerifications).values({
        companyId: me.companyId, caregiverId: me.userId, payPeriodStart, payPeriodEnd, verifiedAt: now,
        reportedTotalHours: hours, reportedGrossPay: gross,
      }).onConflictDoUpdate({
        target,
        set: { verifiedAt: now, disputedAt: null, disputeReason: null, reportedTotalHours: hours, reportedGrossPay: gross, updatedAt: now },
      })
      return one(c, { success: true, status: 'verified' })
    }

    const reason = typeof body.disputeReason === 'string' ? body.disputeReason.trim() : ''
    if (!reason) return fail(c, 400, 'disputeReason is required when disputing')
    await db.insert(payrollPeriodVerifications).values({
      companyId: me.companyId, caregiverId: me.userId, payPeriodStart, payPeriodEnd, disputedAt: now, disputeReason: reason,
      reportedTotalHours: hours, reportedGrossPay: gross,
    }).onConflictDoUpdate({
      target,
      set: { disputedAt: now, disputeReason: reason, verifiedAt: null, reportedTotalHours: hours, reportedGrossPay: gross, updatedAt: now },
    })

    // Tell the office so they can investigate: everyone active in the company who runs payroll. Best effort.
    try {
      const [u] = await db.select({ firstName: user.firstName, lastName: user.lastName }).from(user)
        .where(and(eq(user.id, me.userId), eq(user.companyId, me.companyId)))
      const name = u ? `${u.firstName} ${u.lastName}` : 'A caregiver'
      const people = await db.select({ id: user.id, role: user.role, extra: user.extraPermissions }).from(user)
        .where(and(eq(user.companyId, me.companyId), eq(user.isActive, true)))
      const officeIds = (people as any[])
        .filter((p) => hasPermission(p.role, 'care-payroll:update', Array.isArray(p.extra) ? p.extra : []))
        .map((p) => p.id as string)
      if (officeIds.length) {
        await db.insert(notifications).values(officeIds.map((id) => ({
          companyId: me.companyId,
          userId: id,
          type: 'payroll_dispute',
          title: 'Payroll Dispute Filed',
          message: `${name} disputed ${payPeriodStart} to ${payPeriodEnd}: "${reason}"`,
        })))
      }
    } catch (e: any) {
      d.logger.error('Failed to notify the office of a payroll dispute', { error: e?.message })
    }
    return one(c, { success: true, status: 'disputed' })
  })

  // GET /?start=&end= — the office's view of who confirmed or disputed.
  app.get('/', office, async (c) => {
    const { companyId } = c.get('user')
    const start = c.req.query('start'), end = c.req.query('end')
    const rows = await db.select({ v: payrollPeriodVerifications, firstName: user.firstName, lastName: user.lastName })
      .from(payrollPeriodVerifications)
      .innerJoin(user, eq(user.id, payrollPeriodVerifications.caregiverId))
      .where(and(
        eq(payrollPeriodVerifications.companyId, companyId),
        isDay(start) ? eq(payrollPeriodVerifications.payPeriodStart, start!) : undefined,
        isDay(end) ? eq(payrollPeriodVerifications.payPeriodEnd, end!) : undefined,
      ))
      .orderBy(desc(payrollPeriodVerifications.payPeriodEnd), asc(user.lastName))
      .limit(500)
    const result = (rows as any[]).map((r) => ({ ...r.v, firstName: r.firstName, lastName: r.lastName }))
    return list(c, result, { page: 1, limit: 500, total: result.length })
  })

  return app
}
