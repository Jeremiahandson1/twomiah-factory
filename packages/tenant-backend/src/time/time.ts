// Time tracking — ONE implementation for every CRM that offers time_tracking (vendored into each template as ../shared).
// Merges the two parallel route sets every template carried: routes/time.ts (the one the Time page used: hours-based
// entries, no permission checks, /:id/approve updated by id alone) and routes/timeTracking.ts + services/timeTracking.ts
// (clock-in/out, weekly timesheet, manual start/end entries — mounted at /api/time-tracking, which nothing called).
// One mount, /api/time:
//   GET /            list (field/viewer roles see their own entries only)      GET /summary, /summary/users, /summary/projects
//   GET /weekly      Monday-start week grouped by day                            GET /active   the caller's open clock-in
//   POST /clock-in   POST /clock-out                                             POST /        manual entry: {hours} or {startTime,endTime,breakMinutes}
//   PUT /:id         own entry, or any entry for managers; approved only by managers
//   POST /:id/approve, POST /approve {entryIds}   managers only, company-scoped   DELETE /:id   own entry, or any for managers
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, lt, count, desc, asc, sum, isNull, isNotNull, inArray } from 'drizzle-orm'

export interface TimeTables { timeEntry: any; user: any; job?: any; project?: any }
export interface TimeDeps {
  db: any
  tables: TimeTables
  authenticate: any
  requirePermission: (permission: string) => any
  audit?: { log: (entry: any) => any }
  options?: { maxLimit?: number; maxHoursPerEntry?: number }
}

const MANAGER_ROLES = new Set(['owner', 'admin', 'manager'])
const clampInt = (v: unknown, min: number, max: number, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt }
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim()
const validDate = (v: unknown) => !v || !isNaN(new Date(String(v)).getTime())
const fk = z.string().optional().nullable().transform((v) => (v ? v : null))
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/
const round2 = (n: number) => Math.round(n * 100) / 100
/** Clock in and straight back out = a mis-click; shorter than this and the clock-in is discarded, not saved as 0.00 h. */
const MIN_CLOCK_MINUTES = 1

export function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)) // Monday
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}
const parseTimeToDate = (date: Date, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const r = new Date(date); r.setHours(h, m, 0, 0); return r }

export function createTimeRoutes(deps: TimeDeps) {
  const { db, tables: t, authenticate, requirePermission, audit } = deps
  const maxLimit = deps.options?.maxLimit || 200
  const maxHours = deps.options?.maxHoursPerEntry || 24
  const app = new Hono()
  app.use('*', authenticate)

  const isManager = (u: any) => MANAGER_ROLES.has(u.role)
  const invalid = (c: any, err: z.ZodError) => c.json({ error: err.errors[0]?.message || 'Invalid time entry', details: err.flatten().fieldErrors }, 400)

  const entrySchema = z.object({
    date: z.string().optional().nullable().refine(validDate, { message: 'Enter a valid date' }),
    hours: z.coerce.number().positive('Hours must be greater than 0').max(maxHours, `Hours cannot exceed ${maxHours} for one entry`).optional(),
    startTime: z.string().regex(TIME_RE, 'Start time must be HH:MM').optional(),
    endTime: z.string().regex(TIME_RE, 'End time must be HH:MM').optional(),
    breakMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
    hourlyRate: z.coerce.number().min(0).max(100000).optional().nullable(),
    description: z.string().max(2000).transform(stripTags).optional().nullable(),
    notes: z.string().max(2000).transform(stripTags).optional().nullable(),
    billable: z.boolean().optional(),
    projectId: fk,
    jobId: fk,
    /** managers may log time for someone else */
    userId: z.string().optional().nullable(),
  })

  const checkRefs = async (companyId: string, data: { projectId?: string | null; jobId?: string | null; userId?: string | null }) => {
    if (data.projectId && t.project) { const [p] = await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, data.projectId), eq(t.project.companyId, companyId))).limit(1); if (!p) return 'Unknown project' }
    if (data.jobId && t.job) { const [j] = await db.select({ id: t.job.id }).from(t.job).where(and(eq(t.job.id, data.jobId), eq(t.job.companyId, companyId))).limit(1); if (!j) return 'Unknown job' }
    if (data.userId) { const [u] = await db.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.id, data.userId), eq(t.user.companyId, companyId))).limit(1); if (!u) return 'Unknown user' }
    return null
  }
  /** {hours} or {startTime,endTime,breakMinutes} → { hours, clockIn?, clockOut? }; null with an error message when neither is usable. */
  const deriveHours = (data: z.infer<typeof entrySchema>, entryDate: Date) => {
    if (data.startTime && data.endTime) {
      const start = parseTimeToDate(entryDate, data.startTime), end = parseTimeToDate(entryDate, data.endTime)
      if (end <= start) return { error: 'End time must be after start time' }
      const worked = Math.round((end.getTime() - start.getTime()) / 60000) - (data.breakMinutes || 0)
      if (worked <= 0) return { error: 'Break is longer than the time worked' }
      return { hours: round2(worked / 60), clockIn: start, clockOut: end }
    }
    if (data.hours !== undefined) return { hours: round2(data.hours) }
    return { error: 'Enter hours, or a start and end time' }
  }
  const ownEntry = async (id: string, companyId: string) => { const [row] = await db.select().from(t.timeEntry).where(and(eq(t.timeEntry.id, id), eq(t.timeEntry.companyId, companyId))).limit(1); return row }
  const canTouch = (u: any, entry: any) => isManager(u) || entry.userId === u.userId

  const withRelations = async (companyId: string, rows: any[]) => {
    const userIds = [...new Set(rows.map((e) => e.userId).filter(Boolean))]
    const projectIds = [...new Set(rows.map((e) => e.projectId).filter(Boolean))]
    const jobIds = [...new Set(rows.map((e) => e.jobId).filter(Boolean))]
    const [users, projects, jobs] = await Promise.all([
      userIds.length ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, userIds))) : Promise.resolve([]),
      projectIds.length && t.project ? db.select({ id: t.project.id, name: t.project.name, number: t.project.number }).from(t.project).where(and(eq(t.project.companyId, companyId), inArray(t.project.id, projectIds))) : Promise.resolve([]),
      jobIds.length && t.job ? db.select({ id: t.job.id, title: t.job.title, number: t.job.number }).from(t.job).where(and(eq(t.job.companyId, companyId), inArray(t.job.id, jobIds))) : Promise.resolve([]),
    ])
    const um = Object.fromEntries(users.map((u: any) => [u.id, u])), pm = Object.fromEntries(projects.map((p: any) => [p.id, p])), jm = Object.fromEntries(jobs.map((j: any) => [j.id, j]))
    return rows.map((e) => ({ ...e, user: um[e.userId] || null, project: e.projectId ? pm[e.projectId] || null : null, job: e.jobId ? jm[e.jobId] || null : null }))
  }
  const rangeConds = (q: Record<string, string | undefined>) => {
    const conds: any[] = []
    if (q.startDate && validDate(q.startDate)) conds.push(gte(t.timeEntry.date, new Date(q.startDate)))
    if (q.endDate && validDate(q.endDate)) { const end = new Date(q.endDate); end.setHours(23, 59, 59, 999); conds.push(lte(t.timeEntry.date, end)) }
    return conds
  }
  /** Which user's entries this caller may look at: managers any (or all), everyone else only their own. */
  const scopeUser = (u: any, requested?: string) => (isManager(u) ? requested || undefined : u.userId)

  app.get('/', requirePermission('time:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    const page = clampInt(q.page, 1, 1_000_000, 1)
    const limit = clampInt(q.limit, 1, maxLimit, 50)
    const conditions: any[] = [eq(t.timeEntry.companyId, currentUser.companyId), ...rangeConds(q)]
    const userId = scopeUser(currentUser, q.userId)
    if (userId) conditions.push(eq(t.timeEntry.userId, userId))
    if (q.projectId) conditions.push(eq(t.timeEntry.projectId, q.projectId))
    if (q.jobId) conditions.push(eq(t.timeEntry.jobId, q.jobId))
    if (q.approved === 'true' || q.approved === 'false') conditions.push(eq(t.timeEntry.approved, q.approved === 'true'))
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(t.timeEntry).where(where).orderBy(desc(t.timeEntry.date), desc(t.timeEntry.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.timeEntry).where(where),
    ])
    return c.json({ data: await withRelations(currentUser.companyId, rows), pagination: { page, limit, total: Number(total), pages: Math.max(1, Math.ceil(Number(total) / limit)) } })
  })

  app.get('/summary', requirePermission('time:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    const conditions: any[] = [eq(t.timeEntry.companyId, currentUser.companyId), ...rangeConds(q)]
    const userId = scopeUser(currentUser, q.userId)
    if (userId) conditions.push(eq(t.timeEntry.userId, userId))
    const entries = await db.select({ hours: t.timeEntry.hours, billable: t.timeEntry.billable, hourlyRate: t.timeEntry.hourlyRate }).from(t.timeEntry).where(and(...conditions))
    const totalHours = entries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
    const billable = entries.filter((e: any) => e.billable)
    const billableHours = billable.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
    const billableAmount = billable.filter((e: any) => e.hourlyRate).reduce((s: number, e: any) => s + Number(e.hours || 0) * Number(e.hourlyRate), 0)
    return c.json({ totalHours: round2(totalHours), billableHours: round2(billableHours), nonBillableHours: round2(totalHours - billableHours), billableAmount: round2(billableAmount), entries: entries.length })
  })

  app.get('/summary/users', requirePermission('time:read'), async (c) => {
    const currentUser = (c as any).get('user')
    if (!isManager(currentUser)) return c.json({ error: 'Managers only' }, 403)
    const q = c.req.query()
    if (!q.startDate || !q.endDate || !validDate(q.startDate) || !validDate(q.endDate)) return c.json({ error: 'startDate and endDate are required' }, 400)
    const groups = await db.select({ userId: t.timeEntry.userId, totalHours: sum(t.timeEntry.hours), cnt: count() }).from(t.timeEntry)
      .where(and(eq(t.timeEntry.companyId, currentUser.companyId), ...rangeConds(q))).groupBy(t.timeEntry.userId)
    const ids = groups.map((g: any) => g.userId).filter(Boolean)
    const users = ids.length ? await db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(inArray(t.user.id, ids)) : []
    const um = new Map(users.map((u: any) => [u.id, u]))
    return c.json(groups.map((g: any) => ({ user: um.get(g.userId) || null, totalHours: round2(Number(g.totalHours || 0)), entryCount: Number(g.cnt) })))
  })

  app.get('/summary/projects', requirePermission('time:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    if (!t.project) return c.json([])
    if (!q.startDate || !q.endDate || !validDate(q.startDate) || !validDate(q.endDate)) return c.json({ error: 'startDate and endDate are required' }, 400)
    const conds: any[] = [eq(t.timeEntry.companyId, currentUser.companyId), isNotNull(t.timeEntry.projectId), ...rangeConds(q)]
    const userId = scopeUser(currentUser); if (userId) conds.push(eq(t.timeEntry.userId, userId))
    const groups = await db.select({ projectId: t.timeEntry.projectId, totalHours: sum(t.timeEntry.hours), cnt: count() }).from(t.timeEntry).where(and(...conds)).groupBy(t.timeEntry.projectId)
    const ids = groups.map((g: any) => g.projectId).filter(Boolean)
    const projects = ids.length ? await db.select({ id: t.project.id, name: t.project.name, number: t.project.number }).from(t.project).where(inArray(t.project.id, ids)) : []
    const pm = new Map(projects.map((p: any) => [p.id, p]))
    return c.json(groups.map((g: any) => ({ project: pm.get(g.projectId) || null, totalHours: round2(Number(g.totalHours || 0)), entryCount: Number(g.cnt) })))
  })

  app.get('/weekly', requirePermission('time:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    const userId = scopeUser(currentUser, q.userId) || currentUser.userId
    const weekStart = q.weekStart && validDate(q.weekStart) ? q.weekStart : getWeekStart(new Date())
    const start = new Date(weekStart); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 7)
    const rows = await db.select().from(t.timeEntry)
      .where(and(eq(t.timeEntry.userId, userId), eq(t.timeEntry.companyId, currentUser.companyId), gte(t.timeEntry.date, start), lt(t.timeEntry.date, end)))
      .orderBy(asc(t.timeEntry.date))
    const entries = await withRelations(currentUser.companyId, rows)
    const days = []
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(start); dayDate.setDate(dayDate.getDate() + i)
      const dayEntries = entries.filter((e: any) => new Date(e.date).toDateString() === dayDate.toDateString())
      days.push({ date: dayDate, dayName: dayDate.toLocaleDateString('en-US', { weekday: 'short' }), entries: dayEntries, totalHours: round2(dayEntries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)) })
    }
    return c.json({ weekStart: start, weekEnd: end, days, totalHours: round2(days.reduce((s, d) => s + d.totalHours, 0)) })
  })

  const activeEntry = async (userId: string, companyId: string) => {
    const [row] = await db.select().from(t.timeEntry)
      .where(and(eq(t.timeEntry.userId, userId), eq(t.timeEntry.companyId, companyId), isNotNull(t.timeEntry.clockIn), isNull(t.timeEntry.clockOut))).limit(1)
    return row || null
  }
  app.get('/active', requirePermission('time:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const row = await activeEntry(currentUser.userId, currentUser.companyId)
    return c.json(row ? (await withRelations(currentUser.companyId, [row]))[0] : null)
  })

  app.post('/clock-in', requirePermission('time:create'), async (c) => {
    const currentUser = (c as any).get('user')
    const parsed = entrySchema.pick({ jobId: true, projectId: true, description: true, notes: true }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const refErr = await checkRefs(currentUser.companyId, data)
    if (refErr) return c.json({ error: refErr }, 400)
    const open = await activeEntry(currentUser.userId, currentUser.companyId)
    if (open) return c.json({ error: 'Already clocked in — clock out first', entry: open }, 409)
    const now = new Date()
    const [row] = await db.insert(t.timeEntry).values({
      userId: currentUser.userId, companyId: currentUser.companyId, jobId: data.jobId, projectId: data.projectId,
      clockIn: now, date: now, hours: '0', isAutoClocked: true, description: data.description || data.notes || null,
    }).returning()
    return c.json(row, 201)
  })

  app.post('/clock-out', requirePermission('time:create'), async (c) => {
    const currentUser = (c as any).get('user')
    const parsed = entrySchema.pick({ breakMinutes: true, description: true, notes: true }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const open = await activeEntry(currentUser.userId, currentUser.companyId)
    if (!open) return c.json({ error: 'No open clock-in to clock out of' }, 400)
    const end = new Date()
    // Clocking straight back out is a mis-click, not a shift: it used to save a 0.00-hour row on the timesheet for
    // someone to wonder about later. Under a minute, the clock-in is discarded instead. (Landscaping T21 L7)
    const elapsedMinutes = (end.getTime() - new Date(open.clockIn).getTime()) / 60000
    if (elapsedMinutes < MIN_CLOCK_MINUTES) {
      await db.delete(t.timeEntry).where(and(eq(t.timeEntry.id, open.id), eq(t.timeEntry.companyId, currentUser.companyId)))
      audit?.log({ action: 'delete', entity: 'time_entry', entityId: open.id, metadata: { discarded: 'under a minute', userId: open.userId }, req: { user: currentUser } })
      return c.json({ discarded: true, message: 'That clock-in lasted less than a minute, so no time was recorded. Clock in again when you start work.' })
    }
    const worked = Math.round(elapsedMinutes) - (parsed.data.breakMinutes || 0)
    // Same answer a manual entry gives, instead of silently saving nothing worked.
    if (worked <= 0) return c.json({ error: 'Break is longer than the time worked' }, 400)
    const [row] = await db.update(t.timeEntry).set({ clockOut: end, hours: String(round2(worked / 60)), description: parsed.data.description || parsed.data.notes || open.description, updatedAt: new Date() })
      .where(and(eq(t.timeEntry.id, open.id), eq(t.timeEntry.companyId, currentUser.companyId))).returning()
    return c.json(row)
  })

  app.post('/', requirePermission('time:create'), async (c) => {
    const currentUser = (c as any).get('user')
    const parsed = entrySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const targetUserId = isManager(currentUser) && data.userId ? data.userId : currentUser.userId
    const refErr = await checkRefs(currentUser.companyId, { ...data, userId: targetUserId === currentUser.userId ? null : targetUserId })
    if (refErr) return c.json({ error: refErr }, 400)
    const entryDate = data.date ? new Date(data.date) : new Date()
    const derived = deriveHours(data, entryDate)
    if ('error' in derived) return c.json({ error: derived.error }, 400)
    const [row] = await db.insert(t.timeEntry).values({
      userId: targetUserId, companyId: currentUser.companyId, jobId: data.jobId, projectId: data.projectId,
      date: entryDate, hours: String(derived.hours), clockIn: derived.clockIn || null, clockOut: derived.clockOut || null,
      hourlyRate: data.hourlyRate == null ? null : String(data.hourlyRate), description: data.description ?? data.notes ?? null,
      billable: data.billable ?? true,
    }).returning()
    audit?.log({ action: 'create', entity: 'time_entry', entityId: row.id, metadata: { hours: row.hours, userId: targetUserId }, req: { user: currentUser } })
    return c.json(row, 201)
  })

  app.put('/:id', requirePermission('time:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const parsed = entrySchema.extend({ approved: z.boolean().optional() }).partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const existing = await ownEntry(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Time entry not found' }, 404)
    if (!canTouch(currentUser, existing)) return c.json({ error: 'You can only edit your own time entries' }, 403)
    if (existing.approved && !isManager(currentUser)) return c.json({ error: 'Approved entries can only be changed by a manager' }, 403)
    const refErr = await checkRefs(currentUser.companyId, data)
    if (refErr) return c.json({ error: refErr }, 400)
    const updates: any = { updatedAt: new Date() }
    if (data.date !== undefined && data.date) updates.date = new Date(data.date)
    const entryDate = updates.date || existing.date
    if (data.hours !== undefined || (data.startTime && data.endTime)) {
      const derived = deriveHours(data, new Date(entryDate))
      if ('error' in derived) return c.json({ error: derived.error }, 400)
      updates.hours = String(derived.hours)
      if (derived.clockIn) { updates.clockIn = derived.clockIn; updates.clockOut = derived.clockOut }
    }
    if (data.hourlyRate !== undefined) updates.hourlyRate = data.hourlyRate == null ? null : String(data.hourlyRate)
    if (data.description !== undefined) updates.description = data.description
    else if (data.notes !== undefined) updates.description = data.notes
    if (data.billable !== undefined) updates.billable = data.billable
    if (data.projectId !== undefined) updates.projectId = data.projectId
    if (data.jobId !== undefined) updates.jobId = data.jobId
    if (data.approved !== undefined) {
      if (!isManager(currentUser)) return c.json({ error: 'Only owners, admins and managers can approve time' }, 403)
      updates.approved = data.approved; updates.approvedAt = data.approved ? new Date() : null
    }
    const [row] = await db.update(t.timeEntry).set(updates).where(and(eq(t.timeEntry.id, id), eq(t.timeEntry.companyId, currentUser.companyId))).returning()
    return c.json(row)
  })

  app.delete('/:id', requirePermission('time:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const existing = await ownEntry(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Time entry not found' }, 404)
    if (!canTouch(currentUser, existing)) return c.json({ error: 'You can only delete your own time entries' }, 403)
    if (existing.approved && !isManager(currentUser)) return c.json({ error: 'Approved entries can only be removed by a manager' }, 403)
    await db.delete(t.timeEntry).where(and(eq(t.timeEntry.id, id), eq(t.timeEntry.companyId, currentUser.companyId)))
    audit?.log({ action: 'delete', entity: 'time_entry', entityId: id, metadata: { hours: existing.hours, userId: existing.userId }, req: { user: currentUser } })
    return c.body(null, 204)
  })

  app.post('/:id/approve', requirePermission('time:update'), async (c) => {
    const currentUser = (c as any).get('user')
    if (!isManager(currentUser)) return c.json({ error: 'Only owners, admins and managers can approve time' }, 403)
    const id = c.req.param('id')
    const existing = await ownEntry(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Time entry not found' }, 404)
    const [row] = await db.update(t.timeEntry).set({ approved: true, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(t.timeEntry.id, id), eq(t.timeEntry.companyId, currentUser.companyId))).returning()
    audit?.log({ action: 'status_change', entity: 'time_entry', entityId: id, metadata: { approved: true }, req: { user: currentUser } })
    return c.json(row)
  })

  app.post('/approve', requirePermission('time:update'), async (c) => {
    const currentUser = (c as any).get('user')
    if (!isManager(currentUser)) return c.json({ error: 'Only owners, admins and managers can approve time' }, 403)
    const parsed = z.object({ entryIds: z.array(z.string()).min(1).max(500) }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'entryIds array is required' }, 400)
    const rows = await db.update(t.timeEntry).set({ approved: true, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(t.timeEntry.id, parsed.data.entryIds), eq(t.timeEntry.companyId, currentUser.companyId))).returning({ id: t.timeEntry.id })
    return c.json({ approved: rows.length })
  })

  return app
}
