import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { absences, schedules, users, clients, timeEntries, caregiverAvailability } from '../../db/schema.ts'
import { eq, and, ne, sql, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/emergency/miss-reports — shifts needing coverage
app.get('/miss-reports', async (c) => {
  const rows = await db
    .select({
      id: absences.id,
      date: absences.date,
      reason: absences.reason,
      coverageNeeded: absences.coverageNeeded,
      coverageAssignedTo: absences.coverageAssignedTo,
      createdAt: absences.createdAt,
      caregiverId: absences.caregiverId,
      clientId: absences.clientId,
      firstName: users.firstName,
      lastName: users.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      // Join schedule for times
      startTime: schedules.startTime,
      endTime: schedules.endTime,
    })
    .from(absences)
    .leftJoin(users, eq(absences.caregiverId, users.id))
    .leftJoin(clients, eq(absences.clientId, clients.id))
    .leftJoin(schedules, and(
      eq(schedules.caregiverId, absences.caregiverId),
      eq(schedules.clientId, absences.clientId),
    ))
    .where(eq(absences.coverageNeeded, true))
    .orderBy(desc(absences.date))
    .limit(100)

  // Reshape for frontend expectations
  const result = rows.map(r => ({
    id: r.id,
    date: r.date,
    start_time: r.startTime ? new Date(r.startTime).toTimeString().slice(0, 5) : null,
    end_time: r.endTime ? new Date(r.endTime).toTimeString().slice(0, 5) : null,
    client_id: r.clientId,
    client_name: r.clientFirstName && r.clientLastName ? `${r.clientFirstName} ${r.clientLastName}` : null,
    first_name: r.firstName,
    last_name: r.lastName,
    reason: r.reason,
    coverage_assigned: !!r.coverageAssignedTo,
  }))

  return c.json(result)
})

// GET /api/emergency/available-caregivers?date=&startTime=&endTime=&clientId=
app.get('/available-caregivers', async (c) => {
  const { date, clientId } = c.req.query()
  if (!date) return c.json({ error: 'date is required' }, 400)

  // Get all active caregivers
  const allCaregivers = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      certifications: users.certifications,
      defaultPayRate: users.defaultPayRate,
    })
    .from(users)
    .where(and(eq(users.role, 'caregiver'), eq(users.isActive, true)))

  // Get hours worked this week for each caregiver
  const weekStart = getWeekStart(date)
  const weekEnd = getWeekEnd(date)

  const hoursThisWeek = await db
    .select({
      caregiverId: timeEntries.caregiverId,
      totalMinutes: sql<number>`COALESCE(SUM(${timeEntries.durationMinutes}), 0)`,
    })
    .from(timeEntries)
    .where(and(
      sql`${timeEntries.startTime} >= ${weekStart}`,
      sql`${timeEntries.startTime} <= ${weekEnd}`,
    ))
    .groupBy(timeEntries.caregiverId)

  const hoursMap = new Map(hoursThisWeek.map(h => [h.caregiverId, Math.round((h.totalMinutes || 0) / 60)]))

  // Check who's already scheduled on this date (busy)
  const busyOnDate = await db
    .select({ caregiverId: schedules.caregiverId })
    .from(schedules)
    .where(and(
      eq(schedules.isActive, true),
      sql`${schedules.startTime}::date = ${date}`,
    ))

  const busyIds = new Set(busyOnDate.map(b => b.caregiverId))

  const result = allCaregivers
    .filter(cg => !busyIds.has(cg.id))
    .map(cg => ({
      ...cg,
      scheduled_hours_this_week: hoursMap.get(cg.id) || 0,
      is_preferred: false, // Could cross-check with client preferences
    }))

  return c.json(result)
})

// POST /api/emergency/assign-coverage
app.post('/assign-coverage', requireAdmin, async (c) => {
  const body = await c.req.json()
  const { absenceId, caregiverId, date, startTime, endTime, clientId } = body

  if (!absenceId || !caregiverId) {
    return c.json({ error: 'absenceId and caregiverId are required' }, 400)
  }

  // Update the absence record
  await db.update(absences)
    .set({ coverageAssignedTo: caregiverId })
    .where(eq(absences.id, absenceId))

  return c.json({ ok: true, message: 'Coverage assigned' })
})

function getWeekStart(dateStr: string) {
  const d = new Date(dateStr)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d.toISOString().split('T')[0]
}

function getWeekEnd(dateStr: string) {
  const d = new Date(dateStr)
  const day = d.getDay()
  d.setDate(d.getDate() + (6 - day))
  return d.toISOString().split('T')[0]
}

export default app
