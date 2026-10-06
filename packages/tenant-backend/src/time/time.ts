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
import { eq, and, gte, lte, lt, count, desc, asc, sum, isNull, isNotNull, inArray, sql } from 'drizzle-orm'
import { companyTimeZone, storeDateString, storeDayStart, dayMarker } from './businessDay'
import { hasHappened } from '../dateInput'

export interface TimeTables { timeEntry: any; user: any; job?: any; project?: any
  /**
   * The roster, where a person's pay rate lives. A time entry carries its own hourlyRate — the rate as it was
   * when the work was logged — but nothing ever filled it in: the screens do not ask for a rate, so every entry
   * stored null and billableAmount, which only sums entries that have one, reported 0 against 17 billable
   * hours. With the roster in reach the rate is taken from the person's card. (Field Service T26 L12)
   */
  teamMember?: any }
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
/** A timesheet records work already done, so a date years out is a typo — and a SILENT one: the entry sits outside
 *  every dated window, so the hours don't show up wrong in Reports, they don't show up at all (contractor T29 L1 —
 *  a 2099 row made a 9.5-hour month read 7.5). The rule and its one day of slack live in ../dateInput, shared with
 *  the expense sheet, which records the same kind of thing. (T30 L1) */
const notFuture = hasHappened
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
// parseTimeToDate is GONE. It did `setHours(h, m)` on a UTC-midnight day marker, which on a server
// running UTC stores the shop's wall time as if it were UTC — every clock_in in the table out by the
// offset. deriveHours resolves the instant through the company's zone instead. (T32 M5)

export function createTimeRoutes(deps: TimeDeps) {
  const { db, tables: t, authenticate, requirePermission, audit } = deps
  const maxLimit = deps.options?.maxLimit || 200
  const maxHours = deps.options?.maxHoursPerEntry || 24
  const app = new Hono()
  app.use('*', authenticate)

  const isManager = (u: any) => MANAGER_ROLES.has(u.role)

  // ── what an approval is, and what breaks it (RR4 M2 / M3) ─────────────────────────────────────
  //
  // An approval is a SECOND PERSON vouching for a specific number of hours before they are paid.
  // Everything below follows from that one sentence:
  //
  //   · you cannot be that second person for your own entry (M3). A manager logged an hour and
  //     approved it themselves — which removes the check for the one person who approves everyone
  //     else. The exception is the top of the tree: an owner or admin has nobody above them to ask,
  //     and refusing them would leave their own time unapprovable forever, which is the "a refusal
  //     can be the bug" failure this project has already had once.
  //
  //   · an approval vouches for the FIGURE it was given, so changing the figure ends it (M2). An
  //     approved 2.5-hour entry could be PUT to 6 hours and came back "6.00 hours, still approved" —
  //     an approval standing over a number nobody approved. The edit is still allowed, because
  //     correcting a genuine mistake is normal; what it cannot do is keep the tick. It goes back for
  //     re-approval, and the response says so rather than leaving it to be noticed.
  //
  // Taken with the expenses module's matching rule, this is what stops "log my own hours, approve
  // them, then change the number" — which is a payroll fraud in three requests.
  const OWN_APPROVAL_OK = new Set(['owner', 'admin'])
  const isOwnEntry = (u: any, entry: any) => String(entry?.userId || '') === String(u?.userId || '')
  const selfApprovalRefusal = (u: any, entry: any) =>
    isOwnEntry(u, entry) && !OWN_APPROVAL_OK.has(u.role)
      ? 'You cannot approve your own time. Approval is a second person checking the hours before they are paid — ask an owner or admin to approve this one.'
      : null
  /**
   * Did the edit actually change what the approval vouches for?
   *
   * Two corrections from Salon RR6, and they pull in opposite directions:
   *
   *   E2  "hours were sent" is not "hours changed". The Time screen's Edit dialog PUTs the whole
   *       entry back on every save, so adding a word to the description arrived carrying
   *       hours: 2.5 on a 2.50-hour entry — and the approval ended. Every edit from the screen
   *       cost a re-approval, which is exactly the obstacle this rule was written to avoid. The
   *       comparison is now numeric against the STORED value, so 2.5 and "2.50" are both no-ops.
   *
   *   E3  the hourly RATE was not part of the figure, and rate × hours is the pay. An approved
   *       2.5 hours at $40 could be PUT to $80 and stay approved — an approval standing over a
   *       pay figure nobody approved. It counts now.
   */
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v))
  const sameNumber = (a: any, b: any) => {
    const x = num(a), y = num(b)
    if (x === null && y === null) return true
    if (x === null || y === null) return false
    return Math.abs(x - y) < 0.0001
  }
  const sameDay = (a: any, b: any) => {
    if (!a || !b) return !a && !b
    return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10)
  }
  const figureChanged = (updates: any, existing: any) =>
    (updates.hours !== undefined && !sameNumber(updates.hours, existing?.hours))
    || (updates.date !== undefined && !sameDay(updates.date, existing?.date))
    || (updates.hourlyRate !== undefined && !sameNumber(updates.hourlyRate, existing?.hourlyRate))
  const invalid = (c: any, err: z.ZodError) => c.json({ error: err.errors[0]?.message || 'Invalid time entry', details: err.flatten().fieldErrors }, 400)

  const entrySchema = z.object({
    date: z.string().optional().nullable().refine(validDate, { message: 'Enter a valid date' }).refine(notFuture, { message: 'Time can only be logged for a date that has happened' }),
    // RR4 L2's rule, applied here too: the type check fires before .positive(), so without its own
    // message a typed word answers with zod's "Expected number, received nan".
    hours: z.coerce.number({ invalid_type_error: 'Hours must be a number, for example 2.5' }).positive('Hours must be greater than 0').max(maxHours, `Hours cannot exceed ${maxHours} for one entry`).optional(),
    startTime: z.string().regex(TIME_RE, 'Start time must be HH:MM').optional(),
    endTime: z.string().regex(TIME_RE, 'End time must be HH:MM').optional(),
    breakMinutes: z.coerce.number({ invalid_type_error: 'Break must be a number of minutes, for example 30' }).int('Break must be a whole number of minutes').min(0, 'Break cannot be negative').max(24 * 60).optional(),
    hourlyRate: z.coerce.number({ invalid_type_error: 'An hourly rate must be a number, for example 18.00' }).min(0, 'An hourly rate cannot be negative').max(100000).optional().nullable(),
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
  /**
   * {hours} or {startTime,endTime,breakMinutes} → { hours, clockIn?, clockOut? }.
   *
   * TRUE INSTANTS, AND OVERNIGHT SHIFTS. (T32 M5)
   *
   * Two faults, one cause: the times were read as if the shop were in UTC.
   *
   *  · `parseTimeToDate` did `setHours(19, 0)` on a UTC-midnight day marker, so 19:00 in Eau Claire
   *    was stored as 19:00Z — five hours early, and the real instant was 00:00Z the next day. The
   *    DAY was right (the entry landed on 30 Sep and the pay run for 30 Sep picked it up, which the
   *    report confirmed), so nothing visible was wrong and every clock_in in the table was out by
   *    the offset. Anything that ever reasons about the instant — an overlap check, an hours-worked
   *    report across a boundary, an export to a payroll provider — reads those wrong.
   *
   *  · A 22:00–02:00 shift was refused with "End time must be after start time". 02:00 IS after
   *    22:00; it is on the next day. Night shifts are ordinary in this trade and could not be
   *    entered at all.
   *
   * The day the entry is FILED against does not move: a shift starting at 22:00 on the 30th belongs
   * to the 30th, which is the rule the evening-shift check in this suite already pins.
   */
  const deriveHours = (data: z.infer<typeof entrySchema>, entryDate: Date, tz: string) => {
    if (data.startTime && data.endTime) {
      const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
      // Local midnight on the entry's day, as a real instant. `entryDate` is a UTC day marker, so
      // its ISO date is the calendar day the person means.
      const base = storeDayStart(entryDate.toISOString().slice(0, 10), tz).getTime()
      const startMin = minutes(data.startTime)
      let endMin = minutes(data.endTime)
      // End at or before start means it finished on the next day. 22:00 → 02:00 is four hours.
      const overnight = endMin <= startMin
      if (overnight) endMin += 24 * 60
      const start = new Date(base + startMin * 60_000)
      const end = new Date(base + endMin * 60_000)
      const worked = (endMin - startMin) - (data.breakMinutes || 0)
      if (worked <= 0) return { error: 'Break is longer than the time worked' }
      const hours = round2(worked / 60)
      /**
       * A plausibility ceiling, TIGHTER for an overnight reading than for a declared figure.
       *
       * Reading end-before-start as "the next day" is right for 22:00 → 02:00 and wrong for
       * 09:00 → 08:00, which is a mistyped 09:00 → 18:00. Both are the same shape, so the only thing
       * that separates them is how long the result is — and 23 hours sailed under the 24-hour ceiling
       * the `hours` field uses, which my own test caught.
       *
       * 16 hours: longer than any real night shift, shorter than any reversed pair worth worrying
       * about (a reversed pair is at least 24 minus the real shift, so anything mistyped by more than
       * 8 hours is caught). A genuine 20-hour stint is two entries, which the message says. The
       * declared-`hours` path keeps the configured ceiling, because a number somebody typed on
       * purpose is not a typo of this kind.
       */
      const ceiling = overnight ? Math.min(16, maxHours) : maxHours
      if (hours > ceiling) {
        return { error: overnight
          ? `${data.startTime} to ${data.endTime} reads as ${hours} hours across midnight, which is longer than a shift. If the times are the right way round, split it across two days.`
          : `That is ${hours} hours, which is more than the ${maxHours} allowed on one entry.` }
      }
      return { hours, clockIn: start, clockOut: end }
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

  /**
   * What each of these people is paid, from their roster card. The roster has no user_id — it is matched to a
   * login by EMAIL, the same way the Team page decides who already has one — so this joins on a lowercased
   * email. A person with no roster card, no email, or no rate on their card simply is not in the map.
   *
   * Used twice: to stamp a rate onto a new entry, and to value older entries that were stored before anything
   * filled that column in. Returns {} when the template did not wire the roster. (T26 L12)
   */
  const ratesByUserId = async (companyId: string, userIds: string[]): Promise<Record<string, number>> => {
    if (!t.teamMember || userIds.length === 0) return {}
    const ids = [...new Set(userIds.filter(Boolean))]
    if (!ids.length) return {}
    const [users, roster] = await Promise.all([
      db.select({ id: t.user.id, email: t.user.email }).from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, ids))),
      db.select({ email: t.teamMember.email, rate: t.teamMember.hourlyRate }).from(t.teamMember).where(eq(t.teamMember.companyId, companyId)),
    ])
    const byEmail = new Map<string, number>()
    for (const m of roster) {
      const e = String(m.email || '').toLowerCase()
      const n = Number(m.rate)
      if (e && Number.isFinite(n) && n > 0) byEmail.set(e, n)
    }
    const out: Record<string, number> = {}
    for (const u of users) {
      const rate = byEmail.get(String(u.email || '').toLowerCase())
      if (rate != null) out[String(u.id)] = rate
    }
    return out
  }

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
    const entries = await db.select({ hours: t.timeEntry.hours, billable: t.timeEntry.billable, hourlyRate: t.timeEntry.hourlyRate, userId: t.timeEntry.userId }).from(t.timeEntry).where(and(...conditions))
    const totalHours = entries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
    const billable = entries.filter((e: any) => e.billable)
    const billableHours = billable.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
    // An entry's own rate wins — it is the rate as it was when the work was logged. Entries stored before
    // anything filled that column in fall back to what the person's roster card says now, so seventeen
    // billable hours stop being worth nothing. An entry with neither still contributes 0, which is the
    // honest answer for work by somebody who has no rate anywhere. (T26 L12)
    const rates = await ratesByUserId(currentUser.companyId, billable.filter((e: any) => e.hourlyRate == null).map((e: any) => e.userId))
    const rateOf = (e: any) => (e.hourlyRate != null ? Number(e.hourlyRate) : rates[String(e.userId)] ?? 0)
    const billableAmount = billable.reduce((s: number, e: any) => s + Number(e.hours || 0) * rateOf(e), 0)
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
    // Which week "this week" is, on the crew's calendar. From 7pm on a Sunday the server is already
    // into Monday, so the sheet jumped a week ahead while the crew was still working the old one.
    const weekTz = await companyTimeZone(db, currentUser.companyId)
    const weekStart = q.weekStart && validDate(q.weekStart) ? q.weekStart : getWeekStart(dayMarker(storeDateString(new Date(), weekTz)))
    // `date` is a UTC-midnight day marker, so the week must be walked in UTC too.
    //
    // `new Date('2026-09-14')` parses as midnight UTC, and `setHours(0,0,0,0)` then moves it to the
    // server's LOCAL midnight — which on any host behind UTC is the PREVIOUS day. Asking for the week
    // of Monday the 14th returned a sheet that began on Sunday the 13th, and the buckets below had the
    // same fault from the other side: `toDateString()` reads a UTC marker in local time, so Saturday's
    // hours were counted on Friday. At a week boundary that puts them in the wrong PAY WEEK. The hours
    // were never lost — they were paid in the wrong period, which is worse. (T24 N1, the read half:
    // the write half was fixed by the day markers and /repair-day-markers.)
    const start = dayMarker(weekStart)
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7)
    const rows = await db.select().from(t.timeEntry)
      .where(and(eq(t.timeEntry.userId, userId), eq(t.timeEntry.companyId, currentUser.companyId), gte(t.timeEntry.date, start), lt(t.timeEntry.date, end)))
      .orderBy(asc(t.timeEntry.date), asc(t.timeEntry.id))
    const entries = await withRelations(currentUser.companyId, rows)
    const dayOf = (v: any) => new Date(v).toISOString().slice(0, 10)
    const days = []
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(start); dayDate.setUTCDate(dayDate.getUTCDate() + i)
      const key = dayOf(dayDate)
      const dayEntries = entries.filter((e: any) => dayOf(e.date) === key)
      days.push({ date: dayDate, dayName: dayDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), entries: dayEntries, totalHours: round2(dayEntries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)) })
    }
    return c.json({ weekStart: start, weekEnd: end, days, totalHours: round2(days.reduce((s, d) => s + d.totalHours, 0)) })
  })

  const activeEntry = async (userId: string, companyId: string) => {
    const [row] = await db.select().from(t.timeEntry)
      .where(and(eq(t.timeEntry.userId, userId), eq(t.timeEntry.companyId, companyId), isNotNull(t.timeEntry.clockIn), isNull(t.timeEntry.clockOut))).limit(1)
    return row || null
  }
  /**
   * Put the entries written before the column meant a DAY onto the day they were actually worked.
   *
   * `date` was storing an instant for a clock-in and for a manual entry with no date supplied, so any
   * hours logged after 7pm Central — the end of a shift, which is exactly when people log them — sit on
   * the next day's sheet, and on the next WEEK's when that day ended a pay week. Only rows that carry a
   * time of day are touched: a row already at midnight is a day marker and is right as it stands.
   *
   * An endpoint, not a boot job, because this rewrites what a timesheet says and somebody should
   * trigger it and see what moved. It reports every row it changed. (T24 N1, timesheets)
   */
  app.post('/repair-day-markers', requirePermission('time:update'), async (c: any) => {
    const currentUser = (c as any).get('user')
    const tz = await companyTimeZone(db, currentUser.companyId)
    // Converted in SQL, not JS. The driver hands a timestamp back as "2026-09-19 01:00:00" with no zone
    // marker, and new Date() on that reads it as LOCAL — which on a machine behind UTC moves the row a
    // day the wrong way and quietly undoes the repair. Postgres knows the column is UTC: label it, read
    // it in the crew's zone, and truncate to the day.
    const moved: any[] = ((await db.execute(sql`
      UPDATE time_entry
      SET date = date_trunc('day', (date AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))
      WHERE company_id = ${currentUser.companyId}
        AND date <> date_trunc('day', date)
      RETURNING id, date
    `) as any).rows || []) as any[]
    audit?.log({ action: 'update', entity: 'time_entry', entityId: 'repair-day-markers', metadata: { moved: moved.length }, req: { user: currentUser } })
    return c.json({ repaired: moved.length, entries: moved.slice(0, 50) })
  })

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
    // `date` is the DAY worked, not the moment. Storing the instant put a 20:00 Friday clock-in on
    // Saturday's sheet for anyone behind UTC, because the weekly view buckets this column by day — and
    // if that Friday ended a pay week, the hours moved into the next one. clockIn keeps the instant;
    // date gets the crew's calendar day. (T24 N1, timesheets)
    const tz = await companyTimeZone(db, currentUser.companyId)
    const [row] = await db.insert(t.timeEntry).values({
      userId: currentUser.userId, companyId: currentUser.companyId, jobId: data.jobId, projectId: data.projectId,
      clockIn: now, date: dayMarker(storeDateString(now, tz)), hours: '0', isAutoClocked: true, description: data.description || data.notes || null,
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
    // A supplied date already names a day. An omitted one used to mean "now", which after 7pm is
    // tomorrow in UTC — so logging time at the end of a shift filed it on the next day. (T24 N1)
    const tz = await companyTimeZone(db, currentUser.companyId)
    const entryDate = data.date ? dayMarker(String(data.date)) : dayMarker(storeDateString(new Date(), tz))
    const derived = deriveHours(data, entryDate, tz)
    if ('error' in derived) return c.json({ error: derived.error }, 400)
    // Stamp the person's rate onto the entry when the caller did not name one. The screens do not ask for a
    // rate and never have, so without this every entry stores null and is worth nothing for ever after. Taking
    // it now — rather than reading the roster at report time — is what keeps an old entry worth what the work
    // was worth when it was done, after somebody's rate changes. A caller that sends a rate still wins. (T26 L12)
    let rate = data.hourlyRate == null ? null : String(data.hourlyRate)
    if (rate == null) {
      const found = (await ratesByUserId(currentUser.companyId, [targetUserId]))[String(targetUserId)]
      if (found != null) rate = String(found)
    }
    const [row] = await db.insert(t.timeEntry).values({
      userId: targetUserId, companyId: currentUser.companyId, jobId: data.jobId, projectId: data.projectId,
      date: entryDate, hours: String(derived.hours), clockIn: derived.clockIn || null, clockOut: derived.clockOut || null,
      hourlyRate: rate, description: data.description ?? data.notes ?? null,
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
      // The company's zone, for the same reason as on create: a start/end pair is wall time in the
      // shop, not UTC. Fetched only when the edit actually touches the times. (T32 M5)
      const tz = await companyTimeZone(db, currentUser.companyId)
      const derived = deriveHours(data, new Date(entryDate), tz)
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
      if (data.approved) {
        const refusal = selfApprovalRefusal(currentUser, existing)
        if (refusal) return c.json({ error: refusal, code: 'self_approval' }, 403)
      }
      updates.approved = data.approved; updates.approvedAt = data.approved ? new Date() : null
    }
    // The approval vouched for a figure. Change the figure and it no longer vouches for anything, so
    // it goes back for re-approval — unless this same request is deliberately re-approving. (RR4 M2)
    const approvalCleared = existing.approved && figureChanged(updates, existing) && updates.approved !== true
    if (approvalCleared) { updates.approved = false; updates.approvedAt = null }

    const [row] = await db.update(t.timeEntry).set(updates).where(and(eq(t.timeEntry.id, id), eq(t.timeEntry.companyId, currentUser.companyId))).returning()
    if (approvalCleared) {
      audit?.log({ action: 'status_change', entity: 'time_entry', entityId: id, metadata: { approved: false, reason: 'the hours or the date changed after approval' }, req: { user: currentUser } })
      return c.json({ ...row, warnings: ['This entry was approved. The hours, the date or the rate changed, so the approval has been removed and it needs approving again.'] })
    }
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
    const refusal = selfApprovalRefusal(currentUser, existing)
    if (refusal) return c.json({ error: refusal, code: 'self_approval' }, 403)
    const [row] = await db.update(t.timeEntry).set({ approved: true, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(t.timeEntry.id, id), eq(t.timeEntry.companyId, currentUser.companyId))).returning()
    audit?.log({ action: 'status_change', entity: 'time_entry', entityId: id, metadata: { approved: true }, req: { user: currentUser } })
    return c.json(row)
  })

  app.post('/approve', requirePermission('time:update'), async (c) => {
    const currentUser = (c as any).get('user')
    if (!isManager(currentUser)) return c.json({ error: 'Only owners, admins and managers can approve time' }, 403)
    const parsed = z.object({ entryIds: z.array(z.string()).min(1).max(500) }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'entryIds array is required' }, 400)

    // The same door as /:id/approve, and it has to answer the same way — a rule enforced on the one
    // that approves a single entry and not on the one that approves five hundred is not a rule.
    // Own entries are left out and NAMED, rather than the whole batch being refused: a manager
    // approving the week's timesheet should not be blocked because their own line is in it.
    // (RR4 M3, and rule 2 — the same rule at every door that does the same thing.)
    let mine: string[] = []
    let ids = parsed.data.entryIds
    if (!OWN_APPROVAL_OK.has(currentUser.role)) {
      const rows = await db.select({ id: t.timeEntry.id, userId: t.timeEntry.userId }).from(t.timeEntry)
        .where(and(inArray(t.timeEntry.id, ids), eq(t.timeEntry.companyId, currentUser.companyId)))
      mine = rows.filter((r: any) => String(r.userId) === String(currentUser.userId)).map((r: any) => r.id)
      ids = ids.filter((id) => !mine.includes(id))
    }
    if (!ids.length) {
      return c.json({
        error: 'You cannot approve your own time. Approval is a second person checking the hours before they are paid — ask an owner or admin to approve these.',
        code: 'self_approval', approved: 0, skipped: mine.length,
      }, 403)
    }
    const rows = await db.update(t.timeEntry).set({ approved: true, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(t.timeEntry.id, ids), eq(t.timeEntry.companyId, currentUser.companyId))).returning({ id: t.timeEntry.id })
    return c.json({
      approved: rows.length,
      ...(mine.length ? {
        skipped: mine.length,
        // "1 of your own entry was left…" — the count reads as a partitive and then takes a
        // singular noun. One entry is "your own entry", not "1 of your own entry". (Salon RR8)
        warnings: [mine.length === 1
          ? 'Your own entry was left for someone else to approve.'
          : `${mine.length} of your own entries were left for someone else to approve.`],
      } : {}),
    })
  })

  return app
}
