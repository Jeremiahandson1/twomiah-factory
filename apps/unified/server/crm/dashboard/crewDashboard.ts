// /api/crew-dashboard — "my day" for the person doing the work (feature crew_dashboard, not ready).
//
//   GET /   jobs:read   { today, next, hours, tasks }
//
// Only THEIR OWN work, always: the jobs they lead or are on (the one rule, jobs/onJob.ts — also what narrows the Jobs list for a
// seat without jobs:read-all), the hours on their own time entries, the tasks assigned to them. The owner asking gets their own
// day, not the company's (that is the owner dashboard). Today is the company's calendar day, by the same rule as the Jobs-today
// tile. `hours` is sent where time tracking is on and the seat may read time; `tasks` where tasks are on and it may read tasks.
// An address is sent with the job (the crew goes there); the customer's phone and email are not. Nothing moves money.
import { Hono } from 'hono'
import { and, asc, eq, gte, ne, notInArray } from 'drizzle-orm'
import { companyTimeZone, storeDayRange, storeDateString, jobsTodayCondition, round2 } from '@twomiah/tenant-backend'
import { job, timeEntry, task, contact } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { ownJobsWhere } from '../ownWork.ts'
import { periodStarts } from './moneyStrip.ts'
import { jobDay, WINDOW_DAYS } from './ownerDashboard.ts'

const DONE_JOB = ['completed', 'cancelled']
const NEXT_LIMIT = 5

export function createCrewDashboardRoutes(d: CrmDeps) {
  const { db } = d
  const mayWith = canSeeWith(d.permissions)
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const companyId = me.companyId
    const [features, tz] = await Promise.all([d.features.enabledFeaturesFor(companyId), companyTimeZone(db, companyId)])
    const now = new Date()
    const fields = {
      id: job.id, number: job.number, title: job.title, status: job.status, scheduledDate: job.scheduledDate, source: job.source, scheduledTime: job.scheduledTime,
      address: job.address, city: job.city, customer: contact.name,
    }
    const mine = ownJobsWhere(db, me.userId)
    const shape = (r: any) => ({ id: r.id, number: r.number, title: r.title, status: r.status, scheduledTime: r.scheduledTime, address: r.address, city: r.city, customer: r.customer })

    const today = await db.select(fields).from(job).leftJoin(contact, eq(job.contactId, contact.id))
      .where(and(eq(job.companyId, companyId), mine, jobsTodayCondition(job, tz))).orderBy(asc(job.scheduledTime), asc(job.id))
    const todayKey = storeDateString(now, tz)
    const horizon = storeDateString(new Date(now.getTime() + WINDOW_DAYS * 86_400_000), tz)
    const later = (await db.select(fields).from(job).leftJoin(contact, eq(job.contactId, contact.id))
      .where(and(eq(job.companyId, companyId), mine, notInArray(job.status, DONE_JOB))))
      .map((r: any) => ({ r, day: jobDay(r, tz) }))
      .filter((x) => !!x.day && x.day > todayKey && x.day <= horizon)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.r.scheduledTime || '').localeCompare(String(b.r.scheduledTime || '')))
    const out: Record<string, unknown> = {
      today: today.map(shape),
      next: later.slice(0, NEXT_LIMIT).map((x) => ({ ...shape(x.r), day: x.day })),
      nextCount: later.length,
    }

    if (features.includes('time_tracking') && await mayWith(me.role, 'time:read', me.userId)) {
      const { week } = periodStarts(tz, now)
      const { start: dayStart, end: dayEnd } = storeDayRange(tz, now)
      const entries = await db.select({ hours: timeEntry.hours, date: timeEntry.date }).from(timeEntry)
        .where(and(eq(timeEntry.companyId, companyId), eq(timeEntry.userId, me.userId), gte(timeEntry.date, week)))
      const sum = (rows: any[]) => round2(rows.reduce((s, r) => s + Number(r.hours || 0), 0))
      out.hours = { today: sum(entries.filter((e: any) => new Date(e.date) >= dayStart && new Date(e.date) < dayEnd)), week: sum(entries) }
    }

    if (features.includes('tasks') && await mayWith(me.role, 'tasks:read', me.userId)) {
      const rows = await db.select({ id: task.id, title: task.title, dueDate: task.dueDate }).from(task)
        .where(and(eq(task.companyId, companyId), eq(task.assignedToId, me.userId), ne(task.status, 'completed'))).orderBy(asc(task.dueDate), asc(task.id))
      out.tasks = { open: rows.length, next: rows.slice(0, 3).map((t: any) => ({ id: t.id, title: t.title, dueDate: t.dueDate })) }
    }
    return one(c, out)
  })

  return app
}
