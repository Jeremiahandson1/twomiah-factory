import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { payrollShiftReviews, schedules, scheduleExceptions, timeEntries, users, clients } from '../../db/schema.ts'
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// POST /generate-shifts — expand schedules and match to time entries for a pay period
app.post('/generate-shifts', async (c) => {
  try {
    const { startDate, endDate } = await c.req.json()
    if (!startDate || !endDate) return c.json({ error: 'startDate and endDate required' }, 400)

    const start = new Date(startDate)
    const end = new Date(endDate)

    // Get all active schedules
    const activeSchedules = await db.select({
      schedule: schedules,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
      .from(schedules)
      .leftJoin(users, eq(schedules.caregiverId, users.id))
      .where(eq(schedules.isActive, true))

    // Get all completed time entries for the period
    const entries = await db.select()
      .from(timeEntries)
      .where(and(
        gte(timeEntries.startTime, start),
        lte(timeEntries.startTime, end),
        eq(timeEntries.isComplete, true),
      ))

    // Build a lookup map of time entries by caregiver+date+client
    const entryMap = new Map<string, typeof entries[0][]>()
    entries.forEach(e => {
      const date = new Date(e.startTime).toISOString().split('T')[0]
      const key = `${e.caregiverId}|${date}|${e.clientId}`
      if (!entryMap.has(key)) entryMap.set(key, [])
      entryMap.get(key)!.push(e)
    })

    // Also build a looser map (caregiver+date only) for schedules with null clientId
    const entryByDateMap = new Map<string, typeof entries[0][]>()
    entries.forEach(e => {
      const date = new Date(e.startTime).toISOString().split('T')[0]
      const key = `${e.caregiverId}|${date}`
      if (!entryByDateMap.has(key)) entryByDateMap.set(key, [])
      entryByDateMap.get(key)!.push(e)
    })

    // Load schedule exceptions for the period
    const exceptions = await db.select()
      .from(scheduleExceptions)
      .where(and(
        gte(scheduleExceptions.exceptionDate, startDate),
        lte(scheduleExceptions.exceptionDate, endDate),
      ))
    const exceptionMap = new Map<string, typeof exceptions[0]>()
    exceptions.forEach(ex => {
      exceptionMap.set(`${ex.scheduleId}|${ex.exceptionDate}`, ex)
    })

    // Expand schedules into shift occurrences
    const reviews: any[] = []
    let matched = 0, missingPunch = 0

    for (const row of activeSchedules) {
      const sched = row.schedule
      if (!sched.caregiverId) continue

      // Generate dates this schedule applies to
      let dates: string[] = []
      if (sched.scheduleType === 'one-time' && sched.date) {
        // Only include if the one-time date falls within the pay period
        const d = new Date(sched.date)
        if (d >= start && d <= end) {
          dates.push(sched.date)
        }
      } else if (sched.dayOfWeek !== null && sched.dayOfWeek !== undefined) {
        // Determine the effective end: min of pay period end, schedule endDate
        let schedEnd = end
        if (sched.endDate) {
          const se = new Date(sched.endDate)
          if (se < schedEnd) schedEnd = se
        }

        // Recurring: generate all matching dates in the period
        const cursor = new Date(start)
        while (cursor <= schedEnd) {
          if (cursor.getDay() === sched.dayOfWeek) {
            dates.push(cursor.toISOString().split('T')[0])
          }
          cursor.setDate(cursor.getDate() + 1)
        }

        // Filter for bi-weekly: only include every other week based on anchorDate
        if (sched.frequency === 'bi-weekly' && sched.anchorDate) {
          const anchor = new Date(sched.anchorDate).getTime()
          const weekMs = 7 * 24 * 60 * 60 * 1000
          dates = dates.filter(d => {
            const diffWeeks = Math.floor((new Date(d).getTime() - anchor) / weekMs)
            return diffWeeks % 2 === 0
          })
        }
      }

      for (const shiftDate of dates) {
        // Check for schedule exceptions
        const exception = exceptionMap.get(`${sched.id}|${shiftDate}`)
        if (exception?.exceptionType === 'cancelled') {
          // Skip cancelled occurrences entirely
          continue
        }

        // Use override caregiver/times if exception is 'modified'
        const effectiveCaregiverId = exception?.overrideCaregiverId || sched.caregiverId
        const effectiveClientId = exception?.overrideClientId || sched.clientId

        // Find matching time entry
        let matchedEntry: typeof entries[0] | undefined
        if (effectiveClientId) {
          const candidates = entryMap.get(`${effectiveCaregiverId}|${shiftDate}|${effectiveClientId}`)
          matchedEntry = candidates?.[0]
        } else {
          const candidates = entryByDateMap.get(`${effectiveCaregiverId}|${shiftDate}`)
          matchedEntry = candidates?.[0]
        }

        // Calculate scheduled minutes from start/end time
        let scheduledMinutes: number | null = null
        // Exception overrides are `time` type ("08:00"), schedule fields are `timestamp` type
        const effectiveStart = exception?.overrideStartTime || sched.startTime
        const effectiveEnd = exception?.overrideEndTime || sched.endTime
        if (effectiveStart && effectiveEnd) {
          // Extract hours:minutes regardless of whether input is time ("08:00") or timestamp
          const parseMinutesOfDay = (val: any): number => {
            const str = String(val)
            // Try HH:MM or HH:MM:SS format first (time type)
            const timeMatch = str.match(/^(\d{1,2}):(\d{2})/)
            if (timeMatch) return parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2])
            // Otherwise parse as Date (timestamp type)
            const d = new Date(str)
            if (!isNaN(d.getTime())) return d.getUTCHours() * 60 + d.getUTCMinutes()
            return -1
          }
          const startMins = parseMinutesOfDay(effectiveStart)
          const endMins = parseMinutesOfDay(effectiveEnd)
          if (startMins >= 0 && endMins >= 0) {
            scheduledMinutes = endMins >= startMins ? endMins - startMins : (1440 - startMins) + endMins
          }
        }

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

        reviews.push({
          id: createId(),
          payPeriodStart: startDate,
          payPeriodEnd: endDate,
          caregiverId: effectiveCaregiverId,
          clientId: effectiveClientId,
          scheduleId: sched.id,
          timeEntryId: matchedEntry?.id || null,
          shiftDate,
          scheduledStart: effectiveStart ? String(effectiveStart).match(/(\d{1,2}:\d{2})/)?.[1] || null : null,
          scheduledEnd: effectiveEnd ? String(effectiveEnd).match(/(\d{1,2}:\d{2})/)?.[1] || null : null,
          scheduledMinutes,
          actualStart: matchedEntry?.startTime || null,
          actualEnd: matchedEntry?.endTime || null,
          actualMinutes,
          payableMinutes: matchedEntry ? (matchedEntry.billableMinutes || actualMinutes) : null,
          status,
        })
      }
    }

    // Batch insert reviews in a transaction (atomic delete + insert)
    if (reviews.length > 0) {
      await db.transaction(async (tx) => {
        // Delete existing reviews for this period first (regeneration)
        await tx.delete(payrollShiftReviews)
          .where(and(
            eq(payrollShiftReviews.payPeriodStart, startDate),
            eq(payrollShiftReviews.payPeriodEnd, endDate),
          ))

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
      eq(payrollShiftReviews.payPeriodStart, startDate),
      eq(payrollShiftReviews.payPeriodEnd, endDate),
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
      eq(payrollShiftReviews.payPeriodStart, startDate),
      eq(payrollShiftReviews.payPeriodEnd, endDate),
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
