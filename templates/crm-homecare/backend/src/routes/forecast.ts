import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { invoices, timeEntries, users, schedules } from '../../db/schema.ts'
import { gte, sql, eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/forecast/revenue?months=6
app.get('/revenue', async (c) => {
  const months = parseInt(c.req.query('months') || '6', 10)

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const rows = await db
    .select({
      month: sql<string>`to_char(${invoices.createdAt}, 'YYYY-MM')`.as('month'),
      total: sql<string>`coalesce(sum(${invoices.total}::numeric), 0)`.as('total'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(invoices)
    .where(gte(invoices.billingPeriodStart, cutoffDate))
    .groupBy(sql`to_char(${invoices.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${invoices.createdAt}, 'YYYY-MM')`)

  return c.json(rows)
})

// GET /api/forecast/caregiver-utilization?days=30
app.get('/caregiver-utilization', async (c) => {
  const days = parseInt(c.req.query('days') || '30', 10)

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  // Get actual hours worked per caregiver from time entries
  const worked = await db
    .select({
      caregiverId: timeEntries.caregiverId,
      firstName: users.firstName,
      lastName: users.lastName,
      totalMinutes: sql<number>`coalesce(sum(${timeEntries.durationMinutes}), 0)::int`.as('totalMinutes'),
      entryCount: sql<number>`count(*)::int`.as('entryCount'),
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(gte(timeEntries.startTime, cutoff))
    .groupBy(timeEntries.caregiverId, users.firstName, users.lastName)

  // Calculate utilization assuming 40hr/week baseline
  const weeksInPeriod = Math.max(days / 7, 1)
  const scheduledMinutesPerPeriod = 40 * 60 * weeksInPeriod

  const utilization = worked.map((row) => ({
    caregiverId: row.caregiverId,
    firstName: row.firstName,
    lastName: row.lastName,
    totalMinutes: row.totalMinutes,
    totalHours: Math.round((row.totalMinutes / 60) * 100) / 100,
    scheduledHours: Math.round(scheduledMinutesPerPeriod / 60 * 100) / 100,
    utilizationPercent: Math.round((row.totalMinutes / scheduledMinutesPerPeriod) * 10000) / 100,
    entryCount: row.entryCount,
  }))

  return c.json(utilization)
})

export default app
