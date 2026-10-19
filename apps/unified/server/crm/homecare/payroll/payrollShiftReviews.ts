// /api/payroll-shift-reviews — every scheduled visit of a pay period matched to its punch, for the office to verify,
// flag, excuse or approve before payroll pays it. Moved from templates/crm-homecare/backend/src/routes/payrollShiftReviews.ts.
//
// The template's router was requireAdmin for every path; here every action needs care-payroll:update, the payroll write
// a caregiver does not hold.
//
// Changes from the template: every read, the regeneration's delete and every insert are the signed-in person's company
// (the visits come from the company's own schedules through core's schedule engine); an unexpected error is the app's
// error reply rather than a hand-made { error: message } 500.
import { Hono } from 'hono'
import { createId } from '@paralleldrive/cuid2'
import { and, asc, between, eq, inArray, isNotNull } from 'drizzle-orm'
import { clients, payrollShiftReviews, user } from '../../../db/schema/index.ts'
import { caregiverVisitsInRange, completedEntriesOnAgencyDays } from '../../../data/homecarePayrollRoutes.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { isYmd } from '../core/agencyTime.ts'

/** A review the office already decided survives a regeneration when it is the same visit answered by the same punch. */
const DECIDED = ['approved', 'flagged', 'excused', 'manual_entry']
/** The statuses that record who reviewed the shift and when. */
const REVIEWED = ['approved', 'verified', 'flagged', 'excused', 'manual_entry']

export function createPayrollShiftReviewRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('care-payroll:update'))

  // POST /generate-shifts — expand the schedules and match each visit to its punch for a pay period.
  app.post('/generate-shifts', async (c) => {
    const { companyId } = c.get('user')
    const { startDate, endDate } = await c.req.json().catch(() => ({})) as any
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')
    if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start first')
    const tz = await core.time.timezone(companyId)

    // Every scheduled occurrence in the period, through the ONE schedule engine — the same visits billing and the
    // reports count.
    const occ = await caregiverVisitsInRange(db, companyId, startDate, endDate)
    // Completed punches whose start falls on a day of the period on the AGENCY's calendar.
    const entries = await completedEntriesOnAgencyDays(db, companyId, startDate, endDate, tz)

    // Punches by caregiver + agency day + client.
    const entryMap = new Map<string, typeof entries>()
    for (const e of entries) {
      const key = `${e.caregiverId}|${e.localDate}|${e.clientId}`
      if (!entryMap.has(key)) entryMap.set(key, [])
      entryMap.get(key)!.push(e)
    }

    // Generate again must not silently undo the office's decisions; anything else is rebuilt from the schedule and clock.
    const prior = await db.select().from(payrollShiftReviews).where(and(
      eq(payrollShiftReviews.companyId, companyId),
      between(payrollShiftReviews.shiftDate, startDate, endDate),
      inArray(payrollShiftReviews.status, DECIDED),
    ))
    const hm = (t: unknown) => (t == null ? '' : String(t).slice(0, 5))
    const decidedKey = (scheduleId: unknown, shiftDate: unknown, caregiverId: unknown, start: unknown) =>
      `${scheduleId}|${String(shiftDate).slice(0, 10)}|${caregiverId}|${hm(start)}`
    const decided = new Map((prior as any[]).map((p) => [decidedKey(p.scheduleId, p.shiftDate, p.caregiverId, p.scheduledStart), p]))

    const reviews: any[] = []
    let matched = 0, missingPunch = 0, kept = 0
    for (const o of occ) {
      const matchedEntry = entryMap.get(`${o.caregiverId}|${o.shiftDate}|${o.clientId}`)?.shift() // one punch answers one visit
      const scheduledMinutes: number | null = o.minutes == null ? null : Number(o.minutes)

      let status = 'pending'
      let actualMinutes: number | null = null
      if (matchedEntry) {
        actualMinutes = matchedEntry.durationMinutes
        // Auto-verify when within 15 minutes of the scheduled length.
        if (scheduledMinutes && actualMinutes && Math.abs(actualMinutes - scheduledMinutes) <= 15) status = 'verified'
        matched++
      } else {
        status = 'missing_punch'
        missingPunch++
      }

      // billable_minutes is what the punch rule pays (0 for an accidental tap) — kept as is, never replaced by the
      // clock when it is 0.
      const payable = matchedEntry ? (matchedEntry.billableMinutes ?? actualMinutes) : null
      const was = decided.get(decidedKey(o.scheduleId, o.shiftDate, o.caregiverId, o.startHhmm))
      const keep = was && (was.timeEntryId || null) === (matchedEntry?.id || null)
      if (keep) kept++

      reviews.push({
        id: createId(),
        companyId,
        payPeriodStart: startDate,
        payPeriodEnd: endDate,
        caregiverId: o.caregiverId,
        clientId: o.clientId,
        scheduleId: o.scheduleId,
        timeEntryId: matchedEntry?.id || null,
        shiftDate: o.shiftDate,
        scheduledStart: o.startHhmm || null,
        scheduledEnd: o.endHhmm || null,
        scheduledMinutes,
        actualStart: matchedEntry?.startTime || null,
        actualEnd: matchedEntry?.endTime || null,
        actualMinutes,
        payableMinutes: keep ? was.payableMinutes : payable,
        status: keep ? was.status : status,
        ...(keep ? { flagReason: was.flagReason, resolutionNotes: was.resolutionNotes, reviewedBy: was.reviewedBy, reviewedAt: was.reviewedAt } : {}),
      })
    }

    // Atomic delete + insert.
    if (reviews.length > 0) {
      await db.transaction(async (tx: any) => {
        // Replace every review of the company dated in the range, whatever period generated it: one visit has one
        // review, so overlapping periods can never pay a shift twice (payroll reads reviews by date).
        await tx.delete(payrollShiftReviews)
          .where(and(eq(payrollShiftReviews.companyId, companyId), between(payrollShiftReviews.shiftDate, startDate, endDate)))
        for (let i = 0; i < reviews.length; i += 100) {
          await tx.insert(payrollShiftReviews).values(reviews.slice(i, i + 100).map((r) => ({ ...r, companyId })))
        }
      })
    }

    return one(c, { generated: reviews.length, matched, missingPunch, kept, payPeriodStart: startDate, payPeriodEnd: endDate })
  })

  // GET /shifts?startDate=&endDate=&status=&caregiverId= — the period's reviews, with names and totals by status.
  app.get('/shifts', async (c) => {
    const { companyId } = c.get('user')
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    const status = c.req.query('status')
    const caregiverId = c.req.query('caregiverId')
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')

    const rows = await db.select({
      review: payrollShiftReviews,
      caregiverFirstName: user.firstName,
      caregiverLastName: user.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
      .from(payrollShiftReviews)
      .leftJoin(user, eq(payrollShiftReviews.caregiverId, user.id))
      .leftJoin(clients, eq(payrollShiftReviews.clientId, clients.id))
      .where(and(
        eq(payrollShiftReviews.companyId, companyId),
        between(payrollShiftReviews.shiftDate, startDate, endDate),
        status ? eq(payrollShiftReviews.status, status) : undefined,
        caregiverId ? eq(payrollShiftReviews.caregiverId, caregiverId) : undefined,
      ))
      .orderBy(asc(payrollShiftReviews.shiftDate), asc(user.lastName))

    const result = (rows as any[]).map((r) => ({
      ...r.review,
      caregiverFirstName: r.caregiverFirstName,
      caregiverLastName: r.caregiverLastName,
      clientFirstName: r.clientFirstName,
      clientLastName: r.clientLastName,
    }))

    const stats: Record<string, number> = {}
    let totalScheduledMinutes = 0, totalActualMinutes = 0, totalPayableMinutes = 0
    for (const r of result) {
      stats[r.status] = (stats[r.status] || 0) + 1
      totalScheduledMinutes += r.scheduledMinutes || 0
      totalActualMinutes += r.actualMinutes || 0
      totalPayableMinutes += r.payableMinutes || 0
    }
    return one(c, { shifts: result, stats: { ...stats, total: result.length, totalScheduledMinutes, totalActualMinutes, totalPayableMinutes } })
  })

  // PATCH /shifts/:id — approve, flag, excuse or correct one review.
  app.patch('/shifts/:id', async (c) => {
    const me = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    const updates: any = { updatedAt: new Date() }
    if (body.status) updates.status = body.status
    if (body.payableMinutes !== undefined) updates.payableMinutes = body.payableMinutes
    if (body.flagReason !== undefined) updates.flagReason = body.flagReason
    if (body.resolutionNotes !== undefined) updates.resolutionNotes = body.resolutionNotes
    if (REVIEWED.includes(body.status)) {
      updates.reviewedBy = me.userId
      updates.reviewedAt = new Date()
    }
    const [updated] = await db.update(payrollShiftReviews)
      .set(updates)
      .where(and(eq(payrollShiftReviews.id, c.req.param('id')), eq(payrollShiftReviews.companyId, me.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Shift review not found')
    return one(c, updated)
  })

  // POST /shifts/approve-all — approve the period's clocked shifts (mode 'clocked'), or every one not flagged.
  app.post('/shifts/approve-all', async (c) => {
    const me = c.get('user')
    const { startDate, endDate, mode = 'clocked' } = await c.req.json().catch(() => ({})) as any
    if (!startDate || !endDate) return fail(c, 400, 'startDate and endDate required')

    const which = mode === 'clocked'
      // Only shifts answered by a punch.
      ? and(isNotNull(payrollShiftReviews.timeEntryId), inArray(payrollShiftReviews.status, ['pending', 'verified']))
      : inArray(payrollShiftReviews.status, ['pending', 'verified', 'missing_punch'])
    const updated = await db.update(payrollShiftReviews)
      .set({ status: 'approved', reviewedBy: me.userId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payrollShiftReviews.companyId, me.companyId), between(payrollShiftReviews.shiftDate, startDate, endDate), which))
      .returning()
    return one(c, { approved: updated.length })
  })

  return app
}
