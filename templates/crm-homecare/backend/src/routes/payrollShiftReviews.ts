import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { payrollShiftReviews, timeEntries, users, clients } from '../../db/schema.ts'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import { agencyTimezone, localDate, isYmd } from '../services/agencyTime.ts'
import { rowsOf } from '../helpers/scheduleRows.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// POST /generate-shifts — expand schedules and match to time entries for a pay period
app.post('/generate-shifts', async (c) => {
  try {
    const { startDate, endDate } = await c.req.json()
    if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

    if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD, start first' }, 400)
    const tz = await agencyTimezone()

    // Every scheduled occurrence in the period, through the ONE schedule engine (one-time and
    // weekly / bi-weekly patterns, effective and end dates, cancelled and modified exceptions,
    // suspended service, overnight shifts) — the same visits billing and the reports count.
    const occ = await rowsOf(db, sql`
      WITH ${occurrencesCte(startDate, endDate)}
      SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS shift_date, occ.caregiver_id, occ.client_id,
             to_char(occ.start_time, 'HH24:MI') AS start_hhmm, to_char(occ.end_time, 'HH24:MI') AS end_hhmm, occ.minutes
        FROM occ
       WHERE occ.caregiver_id IS NOT NULL
       ORDER BY occ.occ_date, occ.start_time`)

    // Completed time entries whose start falls on a day of the period on the AGENCY's calendar.
    const entries = await db.select({
      id: timeEntries.id, caregiverId: timeEntries.caregiverId, clientId: timeEntries.clientId,
      startTime: timeEntries.startTime, endTime: timeEntries.endTime,
      durationMinutes: timeEntries.durationMinutes, billableMinutes: timeEntries.billableMinutes,
      localDate: sql<string>`to_char(${localDate(sql`${timeEntries.startTime}`, tz)}, 'YYYY-MM-DD')`,
    })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.isComplete, true),
        sql`${localDate(sql`${timeEntries.startTime}`, tz)} BETWEEN ${startDate}::date AND ${endDate}::date`,
      ))
      .orderBy(timeEntries.startTime)

    // Lookup of time entries by caregiver + agency day + client
    const entryMap = new Map<string, typeof entries[0][]>()
    for (const e of entries) {
      const key = `${e.caregiverId}|${e.localDate}|${e.clientId}`
      if (!entryMap.has(key)) entryMap.set(key, [])
      entryMap.get(key)!.push(e)
    }

    // A review the office already decided (approved, flagged, excused, manual entry) survives a
    // regeneration when it is the same visit answered by the same punch — Generate again must not
    // silently undo approvals. Anything else is rebuilt from the schedule and the clock.
    const DECIDED = ['approved', 'flagged', 'excused', 'manual_entry']
    const prior = await db.select().from(payrollShiftReviews).where(and(
      sql`${payrollShiftReviews.shiftDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
      inArray(payrollShiftReviews.status, DECIDED),
    ))
    const hm = (t: unknown) => (t == null ? '' : String(t).slice(0, 5))
    const decidedKey = (scheduleId: unknown, shiftDate: unknown, caregiverId: unknown, start: unknown) =>
      `${scheduleId}|${String(shiftDate).slice(0, 10)}|${caregiverId}|${hm(start)}`
    const decided = new Map(prior.map((p) => [decidedKey(p.scheduleId, p.shiftDate, p.caregiverId, p.scheduledStart), p]))

    const reviews: any[] = []
    let matched = 0, missingPunch = 0, kept = 0

    for (const o of occ) {
      const candidates = entryMap.get(`${o.caregiver_id}|${o.shift_date}|${o.client_id}`)
      const matchedEntry = candidates?.shift() // one punch answers one visit
      const scheduledMinutes: number | null = o.minutes == null ? null : Number(o.minutes)

      let status = 'pending'
      let actualMinutes: number | null = null

      if (matchedEntry) {
        actualMinutes = matchedEntry.durationMinutes
        // Auto-verify if within 15 minutes of scheduled
        if (scheduledMinutes && actualMinutes && Math.abs(actualMinutes - scheduledMinutes) <= 15) {
          status = 'verified'
        }
        matched++
      } else {
        status = 'missing_punch'
        missingPunch++
      }

      // billable_minutes is what the punch rule pays (0 for an accidental tap) — kept as is, never
      // replaced by the clock when it is 0.
      const payable = matchedEntry ? (matchedEntry.billableMinutes ?? actualMinutes) : null
      const was = decided.get(decidedKey(o.schedule_id, o.shift_date, o.caregiver_id, o.start_hhmm))
      const keep = was && (was.timeEntryId || null) === (matchedEntry?.id || null)
      if (keep) kept++

      reviews.push({
        id: createId(),
        payPeriodStart: startDate,
        payPeriodEnd: endDate,
        caregiverId: o.caregiver_id,
        clientId: o.client_id,
        scheduleId: o.schedule_id,
        timeEntryId: matchedEntry?.id || null,
        shiftDate: o.shift_date,
        scheduledStart: o.start_hhmm || null,
        scheduledEnd: o.end_hhmm || null,
        scheduledMinutes,
        actualStart: matchedEntry?.startTime || null,
        actualEnd: matchedEntry?.endTime || null,
        actualMinutes,
        payableMinutes: keep ? was.payableMinutes : payable,
        status: keep ? was.status : status,
        ...(keep ? { flagReason: was.flagReason, resolutionNotes: was.resolutionNotes, reviewedBy: was.reviewedBy, reviewedAt: was.reviewedAt } : {}),
      })
    }

    // Batch insert reviews in a transaction (atomic delete + insert)
    if (reviews.length > 0) {
      await db.transaction(async (tx) => {
        // Replace every review dated in the range, whatever period generated it: one visit has one
        // review, so overlapping periods can never pay a shift twice (payroll reads reviews by date).
        await tx.delete(payrollShiftReviews)
          .where(sql`${payrollShiftReviews.shiftDate} BETWEEN ${startDate}::date AND ${endDate}::date`)

        // Insert in batches of 100
        for (let i = 0; i < reviews.length; i += 100) {
          const batch = reviews.slice(i, i + 100)
          await tx.insert(payrollShiftReviews).values(batch)
        }
      })
    }

    return c.json({
      generated: reviews.length,
      matched,
      missingPunch,
      kept,
      payPeriodStart: startDate,
      payPeriodEnd: endDate,
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// GET /shifts — list shift reviews for a pay period
app.get('/shifts', async (c) => {
  try {
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    const status = c.req.query('status')
    const caregiverId = c.req.query('caregiverId')

    if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

    const conditions = [
      sql`${payrollShiftReviews.shiftDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
    ]
    if (status) conditions.push(eq(payrollShiftReviews.status, status))
    if (caregiverId) conditions.push(eq(payrollShiftReviews.caregiverId, caregiverId))

    const rows = await db.select({
      review: payrollShiftReviews,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
      .from(payrollShiftReviews)
      .leftJoin(users, eq(payrollShiftReviews.caregiverId, users.id))
      .leftJoin(clients, eq(payrollShiftReviews.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(payrollShiftReviews.shiftDate, users.lastName)

    const result = rows.map(r => ({
      ...r.review,
      caregiverFirstName: r.caregiverFirstName,
      caregiverLastName: r.caregiverLastName,
      clientFirstName: r.clientFirstName,
      clientLastName: r.clientLastName,
    }))

    // Compute stats by status
    const stats: Record<string, number> = {}
    let totalScheduledMinutes = 0, totalActualMinutes = 0, totalPayableMinutes = 0
    result.forEach(r => {
      stats[r.status] = (stats[r.status] || 0) + 1
      totalScheduledMinutes += r.scheduledMinutes || 0
      totalActualMinutes += r.actualMinutes || 0
      totalPayableMinutes += r.payableMinutes || 0
    })

    return c.json({
      shifts: result,
      stats: {
        ...stats,
        total: result.length,
        totalScheduledMinutes,
        totalActualMinutes,
        totalPayableMinutes,
      },
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// PATCH /shifts/:id — update a single shift review (approve, flag, etc.)
app.patch('/shifts/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const user = c.get('user' as any)
    const body = await c.req.json()

    const updates: any = { updatedAt: new Date() }
    if (body.status) updates.status = body.status
    if (body.payableMinutes !== undefined) updates.payableMinutes = body.payableMinutes
    if (body.flagReason !== undefined) updates.flagReason = body.flagReason
    if (body.resolutionNotes !== undefined) updates.resolutionNotes = body.resolutionNotes

    // Set reviewer info if approving/flagging
    if (['approved', 'verified', 'flagged', 'excused', 'manual_entry'].includes(body.status)) {
      updates.reviewedBy = user.userId
      updates.reviewedAt = new Date()
    }

    const [updated] = await db.update(payrollShiftReviews)
      .set(updates)
      .where(eq(payrollShiftReviews.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Shift review not found' }, 404)
    return c.json(updated)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST /shifts/approve-all — bulk approve shifts
app.post('/shifts/approve-all', async (c) => {
  try {
    const user = c.get('user' as any)
    const { startDate, endDate, mode = 'clocked' } = await c.req.json()
    if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

    const conditions = [
      sql`${payrollShiftReviews.shiftDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
    ]

    if (mode === 'clocked') {
      // Only approve shifts that have a matching time entry
      conditions.push(sql`${payrollShiftReviews.timeEntryId} IS NOT NULL`)
      conditions.push(
        inArray(payrollShiftReviews.status, ['pending', 'verified'])
      )
    } else {
      // Approve all non-flagged
      conditions.push(
        inArray(payrollShiftReviews.status, ['pending', 'verified', 'missing_punch'])
      )
    }

    const updated = await db.update(payrollShiftReviews)
      .set({
        status: 'approved',
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning()

    return c.json({ approved: updated.length })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
