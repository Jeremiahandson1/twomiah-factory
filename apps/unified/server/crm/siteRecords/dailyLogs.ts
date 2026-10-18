// Daily logs: the site diary, one contemporaneous record of one day. Moved from
// templates/crm/backend/src/routes/dailyLogs.ts. The registry signs the person in and applies the 'daily_logs' gate.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, count, desc } from 'drizzle-orm'
import { companyTimeZone, storeDateString, dayMarker, markerDay } from '@twomiah/tenant-backend'
import { dailyLog, project, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'

const schema = z.object({ date: z.string().optional(), projectId: z.string(), weather: z.string().optional(), temperature: z.number().optional(), conditions: z.string().optional(), crewSize: z.number().optional(), hoursWorked: z.number().optional(), workPerformed: z.string().optional(), materials: z.string().optional(), equipment: z.string().optional(), visitors: z.string().optional(), delays: z.string().optional(), safetyNotes: z.string().optional(), notes: z.string().optional() })

/**
 * A DAILY LOG IS A CONTEMPORANEOUS RECORD OF ONE DAY. (T32 H10)
 *
 * The document a contractor reaches for when there is an argument about what happened on a site. FOUR RULES:
 *
 *  1. THE DATE NEVER CHANGES. A log filed against the wrong day is deleted and refiled, which leaves a trace.
 *  2. EDITS CLOSE AFTER THE FOLLOWING DAY. Finishing yesterday's log over coffee is how site diaries are written.
 *  3. NO FUTURE DATES.
 *  4. ONE LOG PER PERSON PER PROJECT PER DAY. Two crews on one site each file their own day.
 *
 * On the COMPANY'S clock, not the server's (companyTimeZone), or "yesterday" rolls over at 8pm in Ohio.
 */
const EDIT_WINDOW_DAYS = 1

/**
 * The calendar day an INSTANT falls on, in the company's zone, as YYYY-MM-DD. For "today" and for a log filed with
 * no date. NOT for reading `dailyLog.date` back: that column holds a calendar DAY as a midnight marker — use
 * `markerDay` for it. (T33)
 */
const dayIn = (tz: string, when: Date) => storeDateString(when, tz)

/** Whole days between two calendar-day strings. */
const daysBetween = (fromDay: string, toDay: string) =>
  Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000)

export function createDailyLogRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('daily-logs:read'), async (c) => {
    const { projectId, startDate, endDate, page = '1', limit = '50' } = c.req.query() as any
    const currentUser = c.get('user') as any
    const conditions: any[] = [eq(dailyLog.companyId, currentUser.companyId)]
    if (projectId) conditions.push(eq(dailyLog.projectId, projectId))
    if (startDate) conditions.push(gte(dailyLog.date, new Date(startDate)))
    if (endDate) conditions.push(lte(dailyLog.date, new Date(endDate)))

    const where = and(...conditions)
    const pageNum = +page
    const limitNum = +limit

    const [data, [{ value: total }]] = await Promise.all([
      db.select({
        dailyLog,
        project: { id: project.id, name: project.name },
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName },
      }).from(dailyLog)
        .leftJoin(project, eq(dailyLog.projectId, project.id))
        .leftJoin(user, eq(dailyLog.userId, user.id))
        .where(where)
        .orderBy(desc(dailyLog.date))
        .offset((pageNum - 1) * limitNum)
        .limit(limitNum),
      db.select({ value: count() }).from(dailyLog).where(where),
    ])

    return list(c, data, { page: pageNum, limit: limitNum, total: Number(total) })
  })

  app.get('/:id', requirePermission('daily-logs:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [log] = await db.select({
      dailyLog,
      project,
      user,
    }).from(dailyLog)
      .leftJoin(project, eq(dailyLog.projectId, project.id))
      .leftJoin(user, eq(dailyLog.userId, user.id))
      .where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId)))
      .limit(1)
    if (!log) return fail(c, 404, 'Daily log not found')
    return one(c, log)
  })

  app.post('/', requirePermission('daily-logs:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = schema.parse(await c.req.json())
    const tz = await companyTimeZone(db, currentUser.companyId)
    const when = data.date ? new Date(data.date) : new Date()
    if (Number.isNaN(when.getTime())) return fail(c, 400, 'That is not a date the log can be filed against.')

    // An explicit date is a DAY, taken at face value; only a missing date falls back to the company's clock. (T33)
    const logDay = data.date ? markerDay(when) : dayIn(tz, new Date())
    const today = dayIn(tz, new Date())
    if (daysBetween(today, logDay) > 0) {
      return fail(c, 400, `A daily log cannot be dated ${logDay} — that day has not happened yet. Today is ${today}.`, 'daily_log_future_date')
    }

    // One per person per project per day. Matched on the DAY, because the column is a timestamp and two logs an hour
    // apart are the same day's log filed twice.
    const sameDay: any[] = await db.select({ id: dailyLog.id, date: dailyLog.date }).from(dailyLog).where(and(
      eq(dailyLog.companyId, currentUser.companyId),
      eq(dailyLog.projectId, data.projectId),
      eq(dailyLog.userId, currentUser.userId),
    ))
    const clash = sameDay.find((l) => markerDay(new Date(l.date)) === logDay)
    if (clash) {
      return fail(c, 409, `You have already filed a log for ${logDay} on this project. Edit that one instead of filing a second.`, 'daily_log_already_filed')
    }

    const [log] = await db.insert(dailyLog).values({
      ...data,
      // The DAY, as a marker — not the instant the log happened to be filed at, so the column means one thing. (T33)
      date: dayMarker(logDay),
      companyId: currentUser.companyId,
      userId: currentUser.userId,
    }).returning()
    return one(c, log, 201)
  })

  app.put('/:id', requirePermission('daily-logs:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = schema.partial().parse(await c.req.json())

    // Scoped to the caller's company like the reads above, not matched on id alone.
    const [existing] = await db.select().from(dailyLog)
      .where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Daily log not found')

    const tz = await companyTimeZone(db, currentUser.companyId)
    const logDay = markerDay(new Date(existing.date))
    const today = dayIn(tz, new Date())
    const age = daysBetween(logDay, today)

    // Rule 1 — the date never moves. Both sides are read as markers, so a re-save of the SAME day is not a move.
    if (data.date !== undefined) {
      const asked = new Date(data.date)
      if (Number.isNaN(asked.getTime()) || markerDay(asked) !== logDay) {
        return fail(c, 400,
          `A daily log stays on the day it records. This one is ${logDay}; moving it would leave that day with no log and put its contents on a day it did not happen. Delete it and file a new one if it was logged against the wrong day.`,
          'daily_log_date_immutable')
      }
    }

    // Rule 2 — the window. Open on the day itself and the day after; closed from then on.
    if (age > EDIT_WINDOW_DAYS) {
      return fail(c, 400,
        `The log for ${logDay} is ${age} days old and can no longer be edited. A site diary is a record of what happened that day; add today's log instead, or note the correction in it.`,
        'daily_log_closed')
    }

    const [log] = await db.update(dailyLog).set({
      ...data,
      // Never written, whatever arrived — rule 1 has already refused a different day.
      date: undefined,
      updatedAt: new Date(),
    }).where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).returning()
    if (!log) return fail(c, 404, 'Daily log not found')
    return one(c, log)
  })

  app.delete('/:id', requirePermission('daily-logs:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // The edit window applies here too, or the lock is theatre: delete the old log, file a new one for the same day,
    // and the record is rewritten with no trace.
    const [existing] = await db.select({ date: dailyLog.date }).from(dailyLog)
      .where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Daily log not found')

    const tz = await companyTimeZone(db, currentUser.companyId)
    const logDay = markerDay(new Date(existing.date))
    const age = daysBetween(logDay, dayIn(tz, new Date()))
    if (age > EDIT_WINDOW_DAYS) {
      return fail(c, 400,
        `The log for ${logDay} is ${age} days old and can no longer be deleted. A site diary that can be removed afterwards is not a record of anything — put the correction in today's log.`,
        'daily_log_closed')
    }

    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(dailyLog).where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'Daily log not found')
    return c.body(null, 204)
  })

  return app
}
