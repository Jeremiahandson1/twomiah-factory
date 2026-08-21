/**
 * Time Tracking Service
 *
 * Track time spent on jobs and projects.
 * Uses the schema's timeEntry table with: date, hours, clockIn, clockOut, etc.
 */

import { db } from '../../db/index.ts'
import { timeEntry, user, job, project } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, asc, count, sum, sql, isNull, isNotNull, inArray, not } from 'drizzle-orm'

/**
 * Start a time entry (clock in)
 */
export async function clockIn({
  userId,
  companyId,
  jobId,
  projectId,
  notes,
}: {
  userId: string
  companyId: string
  jobId?: string
  projectId?: string
  notes?: string
}) {
  // Check for existing active entry (clockIn set but clockOut is null)
  const [activeEntry] = await db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.userId, userId), eq(timeEntry.companyId, companyId), isNull(timeEntry.clockOut), isNotNull(timeEntry.clockIn)))

  if (activeEntry) {
    throw new Error('Already clocked in. Please clock out first.')
  }

  const [entry] = await db
    .insert(timeEntry)
    .values({
      userId,
      companyId,
      jobId: jobId || null,
      projectId: projectId || null,
      clockIn: new Date(),
      date: new Date(),
      hours: '0',
      description: notes || null,
    })
    .returning()

  return entry
}

/**
 * Stop a time entry (clock out)
 */
export async function clockOut(entryId: string, { notes, breakMinutes }: { notes?: string; breakMinutes?: number } = {}) {
  const [entry] = await db.select().from(timeEntry).where(eq(timeEntry.id, entryId))

  if (!entry) throw new Error('Time entry not found')
  if (entry.clockOut) throw new Error('Already clocked out')
  if (!entry.clockIn) throw new Error('No clock in time')

  const endTime = new Date()
  const totalMinutes = Math.round((endTime.getTime() - entry.clockIn!.getTime()) / 60000)
  const workedMinutes = totalMinutes - (breakMinutes || 0)
  const hours = Math.round((workedMinutes / 60) * 100) / 100

  const [updated] = await db
    .update(timeEntry)
    .set({
      clockOut: endTime,
      hours: String(hours),
      description: notes || entry.description,
    })
    .where(eq(timeEntry.id, entryId))
    .returning()

  return updated
}

/**
 * Get current active entry for a user
 */
export async function getActiveEntry(userId: string, companyId: string) {
  const [entry] = await db
    .select({
      timeEntry,
      job: { id: job.id, title: job.title, number: job.number },
      project: { id: project.id, name: project.name, number: project.number },
    })
    .from(timeEntry)
    .leftJoin(job, eq(timeEntry.jobId, job.id))
    .leftJoin(project, eq(timeEntry.projectId, project.id))
    .where(
      and(
        eq(timeEntry.userId, userId),
        eq(timeEntry.companyId, companyId),
        isNull(timeEntry.clockOut),
        isNotNull(timeEntry.clockIn)
      )
    )

  return entry || null
}

/**
 * Create a manual time entry
 */
export async function createManualEntry({
  userId,
  companyId,
  jobId,
  projectId,
  date,
  startTime,
  endTime,
  breakMinutes = 0,
  notes,
  hourlyRate,
}: {
  userId: string
  companyId: string
  jobId?: string
  projectId?: string
  date: string
  startTime: string
  endTime: string
  breakMinutes?: number
  notes?: string
  hourlyRate?: number
}) {
  const entryDate = new Date(date)
  const start = parseTimeToDate(entryDate, startTime)
  const end = parseTimeToDate(entryDate, endTime)

  if (end <= start) {
    throw new Error('End time must be after start time')
  }

  const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
  const workedMinutes = totalMinutes - breakMinutes
  const hours = Math.round((workedMinutes / 60) * 100) / 100

  const [entry] = await db
    .insert(timeEntry)
    .values({
      userId,
      companyId,
      jobId: jobId || null,
      projectId: projectId || null,
      date: entryDate,
      clockIn: start,
      clockOut: end,
      hours: String(hours),
      hourlyRate: hourlyRate ? String(hourlyRate) : null,
      description: notes || null,
    })
    .returning()

  return entry
}

/**
 * Update a time entry
 */
export async function updateEntry(entryId: string, companyId: string, data: any) {
  const [entry] = await db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.id, entryId), eq(timeEntry.companyId, companyId)))

  if (!entry) return null

  const updateData: any = {}

  if (data.jobId !== undefined) updateData.jobId = data.jobId || null
  if (data.projectId !== undefined) updateData.projectId = data.projectId || null
  if (data.notes !== undefined) updateData.description = data.notes
  if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate ? String(data.hourlyRate) : null
  if (data.billable !== undefined) updateData.billable = data.billable
  if (data.approved !== undefined) {
    updateData.approved = data.approved
    updateData.approvedAt = data.approved ? new Date() : null
  }

  const [updated] = await db
    .update(timeEntry)
    .set(updateData)
    .where(eq(timeEntry.id, entryId))
    .returning()

  return updated
}

/**
 * Delete a time entry
 */
export async function deleteEntry(entryId: string, companyId: string): Promise<boolean> {
  const [entry] = await db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.id, entryId), eq(timeEntry.companyId, companyId)))

  if (!entry) return false

  await db.delete(timeEntry).where(eq(timeEntry.id, entryId))
  return true
}

/**
 * Get time entries with filters
 */
export async function getEntries({
  companyId,
  userId,
  jobId: filterJobId,
  projectId: filterProjectId,
  startDate,
  endDate,
  approved,
  page = 1,
  limit = 50,
}: {
  companyId: string
  userId?: string
  jobId?: string
  projectId?: string
  startDate?: string
  endDate?: string
  status?: string
  approved?: boolean
  page?: number
  limit?: number
}) {
  const conditions: any[] = [eq(timeEntry.companyId, companyId)]

  if (userId) conditions.push(eq(timeEntry.userId, userId))
  if (filterJobId) conditions.push(eq(timeEntry.jobId, filterJobId))
  if (filterProjectId) conditions.push(eq(timeEntry.projectId, filterProjectId))
  if (approved !== undefined) conditions.push(eq(timeEntry.approved, approved))

  if (startDate) conditions.push(gte(timeEntry.date, new Date(startDate)))
  if (endDate) {
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)
    conditions.push(lte(timeEntry.date, end))
  }

  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db
      .select({
        timeEntry,
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName },
        job: { id: job.id, title: job.title, number: job.number },
        project: { id: project.id, name: project.name, number: project.number },
      })
      .from(timeEntry)
      .leftJoin(user, eq(timeEntry.userId, user.id))
      .leftJoin(job, eq(timeEntry.jobId, job.id))
      .leftJoin(project, eq(timeEntry.projectId, project.id))
      .where(where)
      .orderBy(desc(timeEntry.date))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() }).from(timeEntry).where(where),
  ])

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Get time summary by user for a date range
 */
export async function getUserSummary(companyId: string, { startDate, endDate }: { startDate: string; endDate: string }) {
  const entries = await db
    .select({
      userId: timeEntry.userId,
      totalHours: sum(timeEntry.hours),
      count: count(),
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.companyId, companyId),
        gte(timeEntry.date, new Date(startDate)),
        lte(timeEntry.date, new Date(endDate))
      )
    )
    .groupBy(timeEntry.userId)

  const userIds = entries.map((e) => e.userId)
  if (userIds.length === 0) return []

  const users = await db
    .select({ id: user.id, firstName: user.firstName, lastName: user.lastName })
    .from(user)
    .where(inArray(user.id, userIds))

  const userMap = new Map(users.map((u) => [u.id, u]))

  return entries.map((e) => ({
    user: userMap.get(e.userId),
    totalHours: Math.round(Number(e.totalHours || 0) * 100) / 100,
    entryCount: e.count,
  }))
}

/**
 * Get time summary by project for a date range
 */
export async function getProjectSummary(companyId: string, { startDate, endDate }: { startDate: string; endDate: string }) {
  const entries = await db
    .select({
      projectId: timeEntry.projectId,
      totalHours: sum(timeEntry.hours),
      count: count(),
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.companyId, companyId),
        isNotNull(timeEntry.projectId),
        gte(timeEntry.date, new Date(startDate)),
        lte(timeEntry.date, new Date(endDate))
      )
    )
    .groupBy(timeEntry.projectId)

  const projectIds = entries.map((e) => e.projectId).filter(Boolean) as string[]
  if (projectIds.length === 0) return []

  const projects = await db
    .select({ id: project.id, name: project.name, number: project.number })
    .from(project)
    .where(inArray(project.id, projectIds))

  const projectMap = new Map(projects.map((p) => [p.id, p]))

  return entries.map((e) => ({
    project: projectMap.get(e.projectId!),
    totalHours: Math.round(Number(e.totalHours || 0) * 100) / 100,
    entryCount: e.count,
  }))
}

/**
 * Get weekly timesheet for a user
 */
export async function getWeeklyTimesheet(userId: string, companyId: string, weekStart: string) {
  const start = new Date(weekStart)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 7)

  const entries = await db
    .select({
      timeEntry,
      job: { title: job.title, number: job.number },
      project: { name: project.name, number: project.number },
    })
    .from(timeEntry)
    .leftJoin(job, eq(timeEntry.jobId, job.id))
    .leftJoin(project, eq(timeEntry.projectId, project.id))
    .where(
      and(
        eq(timeEntry.userId, userId),
        eq(timeEntry.companyId, companyId),
        gte(timeEntry.date, start),
        lte(timeEntry.date, end)
      )
    )
    .orderBy(asc(timeEntry.date))

  // Group by day
  const days = []
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(start)
    dayDate.setDate(dayDate.getDate() + i)

    const dayEntries = entries.filter((e) => {
      const entryDate = new Date(e.timeEntry.date)
      return entryDate.toDateString() === dayDate.toDateString()
    })

    const totalHours = dayEntries.reduce((s, e) => s + Number(e.timeEntry.hours || 0), 0)

    days.push({
      date: dayDate,
      dayName: dayDate.toLocaleDateString('en-US', { weekday: 'short' }),
      entries: dayEntries,
      totalHours: Math.round(totalHours * 100) / 100,
    })
  }

  const weekTotal = days.reduce((s, d) => s + d.totalHours, 0)

  return {
    weekStart: start,
    weekEnd: end,
    days,
    totalHours: Math.round(weekTotal * 100) / 100,
  }
}

/**
 * Approve time entries
 */
export async function approveEntries(entryIds: string[], companyId: string, approvedById: string): Promise<number> {
  const result = await db
    .update(timeEntry)
    .set({ approved: true, approvedAt: new Date() })
    .where(and(inArray(timeEntry.id, entryIds), eq(timeEntry.companyId, companyId)))

  return (result as any).rowCount || entryIds.length
}

/**
 * Helper: Parse time string to date
 */
function parseTimeToDate(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result
}

/**
 * Format minutes as hours:minutes
 */
export function formatDuration(minutes: number): string {
  if (!minutes) return '0:00'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}:${mins.toString().padStart(2, '0')}`
}

export default {
  clockIn,
  clockOut,
  getActiveEntry,
  createManualEntry,
  updateEntry,
  deleteEntry,
  getEntries,
  getUserSummary,
  getProjectSummary,
  getWeeklyTimesheet,
  approveEntries,
  formatDuration,
}
