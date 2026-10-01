import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { dailyLog, project, user } from '../../db/schema.ts'
import { eq, and, gte, lte, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { companyTimeZone, storeDateString } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

const schema = z.object({ date: z.string().optional(), projectId: z.string(), weather: z.string().optional(), temperature: z.number().optional(), conditions: z.string().optional(), crewSize: z.number().optional(), hoursWorked: z.number().optional(), workPerformed: z.string().optional(), materials: z.string().optional(), equipment: z.string().optional(), visitors: z.string().optional(), delays: z.string().optional(), safetyNotes: z.string().optional(), notes: z.string().optional() })

/**
 * A DAILY LOG IS A CONTEMPORANEOUS RECORD OF ONE DAY. (T32 H10)
 *
 * It had no rules at all. The report wrote a log for 30 September, then PUT it with new text and
 * date = 1 October: it saved, 30 September's content was gone, and 30 September had no log. A second
 * log for the same day was accepted, and so was one dated 1 March 2027.
 *
 * This is the document a contractor reaches for when there is an argument about what happened on a
 * site — a delay, an injury, a visitor. A record that can be silently rewritten afterwards, or moved
 * to a different day, is not evidence of anything.
 *
 * FOUR RULES, and what each one is for:
 *
 *  1. THE DATE NEVER CHANGES. Moving a log from one day to another destroys the day it came from and
 *     fabricates the day it lands on, in one request. There is no legitimate version of that: a log
 *     filed against the wrong day is deleted and refiled, which leaves a trace.
 *
 *  2. EDITS CLOSE AFTER THE FOLLOWING DAY. Not "after its own day", which would be too tight —
 *     finishing yesterday's log over coffee is how site diaries are actually written. After that it
 *     is a historical record. The report's own expectation was "logs locked after their day, or at
 *     least a revision history"; this is the first, and the window is the part that keeps it usable.
 *
 *  3. NO FUTURE DATES. You cannot record what happened on a day that has not happened.
 *
 *  4. ONE LOG PER PERSON PER PROJECT PER DAY. Per PERSON, not per project: two crews on one site
 *     each file their own day, which is normal. The same person filing twice is the duplicate the
 *     report created, and the second one makes the first ambiguous.
 *
 * On the COMPANY'S clock, not the server's. `new Date().setHours(0,0,0,0)` is UTC midnight on
 * Render, so "yesterday" would roll over at 8pm in Ohio and lock a log five hours early — the same
 * trap the dashboards and pay runs already go through companyTimeZone for.
 */
const EDIT_WINDOW_DAYS = 1

/** The calendar day a timestamp falls on, in the company's zone, as YYYY-MM-DD. */
const dayIn = (tz: string, when: Date) => storeDateString(when, tz)

/** Whole days between two calendar-day strings. */
const daysBetween = (fromDay: string, toDay: string) =>
  Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000)

app.get('/', async (c) => {
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

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.get('/:id', async (c) => {
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
  if (!log) return c.json({ error: 'Daily log not found' }, 404)
  return c.json(log)
})

app.post('/', requirePermission('daily-logs:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = schema.parse(await c.req.json())
  const tz = await companyTimeZone(db, currentUser.companyId)
  const when = data.date ? new Date(data.date) : new Date()
  if (Number.isNaN(when.getTime())) return c.json({ error: 'That is not a date the log can be filed against.' }, 400)

  const logDay = dayIn(tz, when)
  const today = dayIn(tz, new Date())
  if (daysBetween(today, logDay) > 0) {
    return c.json({
      error: `A daily log cannot be dated ${logDay} — that day has not happened yet. Today is ${today}.`,
      code: 'daily_log_future_date',
    }, 400)
  }

  // One per person per project per day. Matched on the DAY in the company's zone, because the column
  // is a timestamp and two logs an hour apart are the same day's log filed twice.
  const sameDay = await db.select({ id: dailyLog.id, date: dailyLog.date }).from(dailyLog).where(and(
    eq(dailyLog.companyId, currentUser.companyId),
    eq(dailyLog.projectId, data.projectId),
    eq(dailyLog.userId, currentUser.userId),
  ))
  const clash = sameDay.find((l) => dayIn(tz, new Date(l.date)) === logDay)
  if (clash) {
    return c.json({
      error: `You have already filed a log for ${logDay} on this project. Edit that one instead of filing a second.`,
      code: 'daily_log_already_filed',
      existingId: clash.id,
    }, 409)
  }

  const [log] = await db.insert(dailyLog).values({
    ...data,
    date: when,
    companyId: currentUser.companyId,
    userId: currentUser.userId,
  }).returning()
  return c.json(log, 201)
})

app.put('/:id', requirePermission('daily-logs:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())

  // Scoped to the caller's company like the reads above, not matched on id alone.
  const [existing] = await db.select().from(dailyLog)
    .where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Daily log not found' }, 404)

  const tz = await companyTimeZone(db, currentUser.companyId)
  const logDay = dayIn(tz, new Date(existing.date))
  const today = dayIn(tz, new Date())
  const age = daysBetween(logDay, today)

  // Rule 1 — the date never moves. This is the one that took 30 September's log away.
  if (data.date !== undefined) {
    const asked = new Date(data.date)
    if (Number.isNaN(asked.getTime()) || dayIn(tz, asked) !== logDay) {
      return c.json({
        error: `A daily log stays on the day it records. This one is ${logDay}; moving it would leave that day with no log and put its contents on a day it did not happen. Delete it and file a new one if it was logged against the wrong day.`,
        code: 'daily_log_date_immutable',
        date: logDay,
      }, 400)
    }
  }

  // Rule 2 — the window. Open on the day itself and the day after; closed from then on.
  if (age > EDIT_WINDOW_DAYS) {
    return c.json({
      error: `The log for ${logDay} is ${age} days old and can no longer be edited. A site diary is a record of what happened that day; add today's log instead, or note the correction in it.`,
      code: 'daily_log_closed',
      date: logDay,
      editableUntil: EDIT_WINDOW_DAYS === 1 ? 'the day after the log' : `${EDIT_WINDOW_DAYS} days after the log`,
    }, 400)
  }

  const [log] = await db.update(dailyLog).set({
    ...data,
    // Never written, whatever arrived — rule 1 above has already refused a different day, and this
    // makes a same-day re-send a no-op rather than a silent change of the stored instant.
    date: undefined,
    updatedAt: new Date(),
  }).where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).returning()
  if (!log) return c.json({ error: 'Daily log not found' }, 404)
  return c.json(log)
})

app.delete('/:id', requirePermission('daily-logs:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  /**
   * The edit window applies here too, or the lock is theatre: delete the old log, file a new one for
   * the same day, and the record is rewritten with no trace — which is exactly what PUT was stopped
   * from doing. Inside the window, deleting and refiling is the documented way to correct a log that
   * went against the wrong day. Outside it, the correction goes in today's log, where it is dated.
   */
  const [existing] = await db.select({ date: dailyLog.date }).from(dailyLog)
    .where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Daily log not found' }, 404)

  const tz = await companyTimeZone(db, currentUser.companyId)
  const logDay = dayIn(tz, new Date(existing.date))
  const age = daysBetween(logDay, dayIn(tz, new Date()))
  if (age > EDIT_WINDOW_DAYS) {
    return c.json({
      error: `The log for ${logDay} is ${age} days old and can no longer be deleted. A site diary that can be removed afterwards is not a record of anything — put the correction in today's log.`,
      code: 'daily_log_closed',
      date: logDay,
    }, 400)
  }

  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(dailyLog).where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).returning()
  if (!gone) return c.json({ error: 'Daily log not found' }, 404)
  return c.json(null, 204)
})

export default app
