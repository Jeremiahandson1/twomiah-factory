// Jobs (service calls) — one implementation for every CRM. The template injects its Drizzle db + tables,
// auth middleware, socket emitter and sanitiser, plus options: extra writable columns (fs/landscaping
// equipmentId/siteId), an extra relation (equipment), lifecycle hooks (SMS, review requests, service
// agreements) and, when a job_photo table + storage are passed, the photo routes.
//
// Behaviour that used to differ per template and is now the same everywhere:
//   - job numbers come from the per-company max under an advisory lock — the old `count + 1` reused a
//     deleted job's number (proven live on every tenant) and raced under concurrent creates
//   - a malformed scheduledDate is a 400, not an "Invalid Date" 500
//   - the edit form's null relations and decimal-string hours are accepted on every template
//     (landscaping 400'd on both), search matches title / number / address everywhere (fieldservice
//     ignored ?search=), and related rows are fetched by id instead of the whole company
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, ne, and, gte, lt, lte, count, asc, desc, or, ilike, inArray, notInArray, sql } from 'drizzle-orm'
import { nextNumber } from '../invoicing/money'
import { companyTimeZone, storeDayRange, jobLocalDay } from '../time/businessDay'
import { checkFilter } from '../listFilter'
import { withinHorizon, horizonMessage } from '../dateInput'
import { sniffType, baseMime } from '../files/storage'

export interface JobTables { job: any; contact: any; user: any; project?: any; timeEntry?: any; equipment?: any; jobPhoto?: any;
  /** crew roster. Present → roster-only people (no login) can be assigned work, via job.assignedToMemberId. (T21 M12) */
  teamMember?: any }
export interface JobPhotoStorage { put: (key: string, body: Buffer, contentType: string) => Promise<void>; deleteFile: (key: string) => boolean | Promise<boolean | void>; storageConfigured?: () => boolean }
export type JobHook = (ctx: { job: any; companyId: string; userId: string }) => Promise<Record<string, any> | void> | Record<string, any> | void

export interface JobOptions {
  numbering?: { prefix?: string; pad?: number }
  /** extra writable columns on this vertical's job table (e.g. equipmentId, siteId) */
  extraFields?: z.ZodRawShape
  /** private object storage for job photos (with tables.jobPhoto) */
  storage?: JobPhotoStorage
  /** URL prefix the media proxy is mounted at. Default /media/ */
  mediaUrlPrefix?: string
  onStart?: JobHook
  onDispatch?: JobHook
  /** may return extra fields merged into the complete response (e.g. nextServiceDate) */
  onComplete?: JobHook
  maxLimit?: number
}

export interface JobDeps {
  db: any
  tables: JobTables
  authenticate: any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: { JOB_CREATED: string; JOB_UPDATED: string; JOB_DELETED: string; JOB_STATUS_CHANGED: string }
  cleanText: (min?: number) => z.ZodTypeAny
  options?: JobOptions
}

export const JOB_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const OPEN_JOB_STATUSES = ['scheduled', 'pending', 'confirmed']
// Every job status any template actually uses: the FE default set (scheduled/dispatched/in_progress/
// completed/cancelled), the open statuses (pending/confirmed), and the import mapper's on_hold. No template
// configures a status outside this union, so validating against it rejects junk like "banana" (which
// otherwise reached the dashboard as a real bucket and was dropped from Reports, 168 vs 169) without
// breaking a real status. If a vertical ever needs its own set, thread it through JobOptions.
export const JOB_STATUSES = ['scheduled', 'pending', 'confirmed', 'dispatched', 'in_progress', 'on_hold', 'completed', 'cancelled'] as const
const MAX_PHOTO_SIZE = 10 * 1024 * 1024
const PHOTO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v)
// A date the calendar actually has. `new Date('2026-02-30')` does not fail — it rolls over to 2 March, so an
// impossible date was accepted and silently moved. A date-only value must round-trip its own Y-M-D.
// (Landscaping T21 M5)
const validDate = (v: unknown) => {
  if (v === undefined || v === '') return true
  if (typeof v !== 'string') return false
  const d = new Date(v)
  if (isNaN(d.getTime())) return false
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return true
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3]
}

export function createJobRoutes(deps: JobDeps) {
  const { db, tables: t, authenticate, emitToCompany, EVENTS, cleanText } = deps
  const o = deps.options || {}
  const prefix = o.numbering?.prefix || 'JOB'
  const pad = o.numbering?.pad ?? 5
  const maxLimit = o.maxLimit || 500
  const mediaPrefix = o.mediaUrlPrefix || '/media/'

  const jobSchema = z.object({
    // a title is a line, not an essay — 500 characters went in unchecked (T21 L1)
    title: cleanText(1).pipe(z.string().max(200, 'Title must be 200 characters or fewer')),
    description: cleanText().optional(),
    projectId: z.string().optional().transform(emptyToUndef as any),
    contactId: z.string().optional().transform(emptyToUndef as any),
    assignedToId: z.string().optional().transform(emptyToUndef as any),
    /** a roster-only crew member instead of a login user; either field may carry the id (T21 M12) */
    assignedToMemberId: z.string().optional().transform(emptyToUndef as any),
    priority: z.enum(JOB_PRIORITIES).default('normal'),
    // Constrained to the known status union (see JOB_STATUSES) — the dispatch board only ever sets these,
    // and a free-form string let "banana" through to the dashboard and Reports.
    status: z.enum(JOB_STATUSES).optional(),
    // Scheduling ahead is the point, so this is not the timesheet's rule — only the year has to be plausible.
    // A job booked for 9999 saved happily and then sat outside every calendar and report. (Contractor T30 L1)
    scheduledDate: z.string().optional().refine(validDate, { message: 'Invalid scheduled date' })
      .refine(withinHorizon, { message: horizonMessage('The scheduled date') }),
    // A scheduled time must be HH:MM (24-hour) — "25:99" was stored verbatim. Empty is allowed (unscheduled).
    scheduledTime: z.string().optional().refine((v: string | undefined) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), { message: 'Time must be HH:MM (24-hour).' }),
    // The edit form posts the decimal string the API returned ("4.00"), or "" when blank.
    estimatedHours: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0, 'Estimated hours cannot be negative').optional()),
    address: cleanText().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    notes: cleanText().optional(),
    ...(o.extraFields || {}),
  })

  const app = new Hono()
  app.use('*', authenticate)

  const findOwned = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.job).where(and(eq(t.job.id, id), eq(t.job.companyId, companyId))).limit(1)
    return row
  }

  /**
   * Work is assigned to someone who can open the app — assignedToId points at a login user. Picking a roster-only
   * crew member used to reach the database and come back as "A related record does not exist, or is still in use.",
   * which says nothing about why. Name the reason instead. (Landscaping T21 M6)
   */
  /**
   * Who a job is assigned to. A LOGIN user goes in assignedToId; a roster-only crew member (a team_member row
   * with no login — the crew who never touch the app) goes in assignedToMemberId. Exactly one is ever set.
   * The id may be sent as either field: a picker that only knows one list still works, and the old behaviour —
   * refusing a roster member outright — is gone. (Landscaping T21 M12)
   */
  type Assignee = { assignedToId: string | null; assignedToMemberId: string | null; error?: string }
  const CLEARED: Assignee = { assignedToId: null, assignedToMemberId: null }
  const blank = (v: unknown) => v === undefined || v === null || v === ''
  const resolveAssignee = async (companyId: string, assignedToId: unknown, memberId?: unknown): Promise<Assignee> => {
    const id = !blank(memberId) ? String(memberId) : !blank(assignedToId) ? String(assignedToId) : null
    if (!id) return CLEARED
    const [u] = await db.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, companyId))).limit(1)
    if (u) return { assignedToId: u.id, assignedToMemberId: null }
    if (t.teamMember) {
      const [m] = await db.select({ id: t.teamMember.id, active: t.teamMember.active }).from(t.teamMember).where(and(eq(t.teamMember.id, id), eq(t.teamMember.companyId, companyId))).limit(1)
      if (m && m.active) return { assignedToId: null, assignedToMemberId: m.id }
      if (m) return { ...CLEARED, error: 'That crew member is marked inactive on the Team page. Make them active again, or pick someone else.' }
    }
    return { ...CLEARED, error: 'That person is not on your team. Pick someone from the list, or add them on the Team page first.' }
  }
  /** the id currently doing the work, whichever kind it is — for double-booking and "who is on this job" */
  const assigneeIdOf = (j: any) => j?.assignedToId || j?.assignedToMemberId || null

  // Reject assigning the same person two live jobs at the same date + time. Online booking already
  // blocked its slot; manual New-Job / edit did not, so a dispatcher could stack two jobs on one tech
  // at 10:00 with no warning. Only fires when assignee, date and time are all set; cancelled/completed
  // jobs never conflict. Same-day different-time and same-time different-people are both allowed.
  // Serialises job create/update per company so two concurrent writes can't both pass the conflict check
  // and stack two jobs on one tech at the same slot (FS double-booking race). Same coarse pattern as the
  // salon/vet appointment lock (#116); job volume is low, so a per-company lock is simplest and safe.
  const jobLock = (tx: any, companyId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':job'}))`)

  /**
   * A call occupies a RANGE, not an instant.
   *
   * The check used to be `scheduledTime = scheduledTime`, so one tech could be given 08:00 (1.5h), 09:00
   * (2h), 09:30 (1h) and 10:00 (2h) on the same day and only a second 09:00 was refused — six overlapping
   * calls on one person, and dragging a call into an overlap saved too. An identical start is the one
   * overlap that check caught, not the rule.
   *
   * A job with no estimatedHours still occupies the diary, so a blank counts as one hour rather than zero
   * — treating it as a point would let a call with no duration hide inside any other. (FS T28 H1)
   */
  const DEFAULT_JOB_MINUTES = 60
  const minutesOfTime = (hhmm?: string | null) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
    if (!m) return null
    const h = Number(m[1]), min = Number(m[2])
    return h < 24 && min < 60 ? h * 60 + min : null
  }
  const minutesOfHours = (hours: unknown) => {
    const h = Number(hours)
    return Number.isFinite(h) && h > 0 ? Math.max(1, Math.round(h * 60)) : DEFAULT_JOB_MINUTES
  }

  // `who` is whichever kind of assignee the job has — a roster member can be double-booked just as a login user can.
  const assigneeConflict = async (companyId: string, who?: Assignee | null, scheduledDate?: any, scheduledTime?: string, excludeId?: string, exec: any = db, hours?: unknown) => {
    const assignedToId = who?.assignedToId || null, memberId = who?.assignedToMemberId || null
    if ((!assignedToId && !memberId) || !scheduledDate || !scheduledTime) return null
    const start = minutesOfTime(scheduledTime); if (start === null) return null
    const end = start + minutesOfHours(hours)
    const dayStart = new Date(scheduledDate); if (isNaN(dayStart.getTime())) return null
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const conds = [
      eq(t.job.companyId, companyId),
      assignedToId ? eq(t.job.assignedToId, assignedToId) : eq(t.job.assignedToMemberId, memberId as string),
      gte(t.job.scheduledDate, dayStart), lt(t.job.scheduledDate, dayEnd),
      notInArray(t.job.status, ['cancelled', 'completed']),
    ]
    if (excludeId) conds.push(ne(t.job.id, excludeId))
    // estimatedHours is not on every vertical's job table; selecting a column that is not there throws
    // inside drizzle and would 500 the whole save.
    const cols: any = { id: t.job.id, number: t.job.number, scheduledTime: t.job.scheduledTime }
    if (t.job.estimatedHours) cols.estimatedHours = t.job.estimatedHours
    const sameDay = await exec.select(cols).from(t.job).where(and(...conds))
    for (const other of sameDay) {
      const s = minutesOfTime(other.scheduledTime)
      if (s === null) continue                       // unscheduled work holds no slot
      const e = s + minutesOfHours(other.estimatedHours)
      if (start < e && end > s) return other         // half-open: 09:00–10:00 and 10:00–11:00 do NOT clash
    }
    return null
  }
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])]

  /** project / contact / assignedTo (/ equipment) for a set of rows, fetched by id and scoped to the company. */
  const withRelations = async (rows: any[], companyId: string, contactCols?: Record<string, any>) => {
    const projectIds = uniq(rows.map((j) => j.projectId)), contactIds = uniq(rows.map((j) => j.contactId)), userIds = uniq(rows.map((j) => j.assignedToId)), equipmentIds = t.equipment ? uniq(rows.map((j) => j.equipmentId)) : []
    const memberIds = t.teamMember ? uniq(rows.map((j) => j.assignedToMemberId)) : []
    const members = memberIds.length ? await db.select({ id: t.teamMember.id, name: t.teamMember.name, role: t.teamMember.role, phone: t.teamMember.phone }).from(t.teamMember).where(and(eq(t.teamMember.companyId, companyId), inArray(t.teamMember.id, memberIds))) : []
    const [projects, contacts, users, equipmentList] = await Promise.all([
      t.project && projectIds.length ? db.select({ id: t.project.id, name: t.project.name }).from(t.project).where(and(eq(t.project.companyId, companyId), inArray(t.project.id, projectIds))) : Promise.resolve([]),
      contactIds.length ? db.select(contactCols || { id: t.contact.id, name: t.contact.name }).from(t.contact).where(and(eq(t.contact.companyId, companyId), inArray(t.contact.id, contactIds))) : Promise.resolve([]),
      userIds.length ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, userIds))) : Promise.resolve([]),
      t.equipment && equipmentIds.length ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model }).from(t.equipment).where(and(eq(t.equipment.companyId, companyId), inArray(t.equipment.id, equipmentIds))) : Promise.resolve([]),
    ])
    const by = (xs: any[]) => Object.fromEntries(xs.map((x) => [x.id, x]))
    const pm = by(projects), cm = by(contacts), um = by(users), em = by(equipmentList), mm = by(members)
    // One `assignedTo` whichever kind the person is. A user keeps the shape it always had (firstName/lastName) and
    // gains name + kind; a roster member is split into the same two fields so every existing caller keeps working.
    const named = (u: any) => ({ ...u, name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), kind: 'user' as const })
    const fromMember = (m: any) => { const [first, ...rest] = String(m.name || '').split(' '); return { id: m.id, firstName: first || m.name || '', lastName: rest.join(' '), name: m.name, role: m.role || null, phone: m.phone || null, kind: 'member' as const } }
    return rows.map((j) => ({
      ...j,
      project: j.projectId ? pm[j.projectId] || null : null,
      contact: j.contactId ? cm[j.contactId] || null : null,
      assignedTo: j.assignedToId ? (um[j.assignedToId] ? named(um[j.assignedToId]) : null) : j.assignedToMemberId ? (mm[j.assignedToMemberId] ? fromMember(mm[j.assignedToMemberId]) : null) : null,
      ...(t.equipment ? { equipment: j.equipmentId ? em[j.equipmentId] || null : null } : {}),
    }))
  }
  const isOverdue = (j: any) => !!(j.scheduledDate && OPEN_JOB_STATUSES.includes(String(j.status)) && new Date(j.scheduledDate).getTime() < Date.now() - 86400000)
  const runHook = async (hook: JobHook | undefined, job: any, currentUser: any) => {
    if (!hook) return {}
    try { return (await hook({ job, companyId: currentUser.companyId, userId: currentUser.userId })) || {} } catch (err: any) { console.warn('[jobs] hook failed:', err?.message || err); return {} }
  }

  // ---------------------------------------------------------------- list / today
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const q = c.req.query()
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(q.limit || '50', 10) || 50), maxLimit)
    // A status this CRM has no word for is a typo, not an empty page. (T29 N2)
    const badStatus = checkFilter(c, 'status', q.status, JOB_STATUSES)
    if (badStatus) return badStatus
    const conditions: any[] = [eq(t.job.companyId, currentUser.companyId)]
    if (q.status) conditions.push(eq(t.job.status, q.status))
    if (q.projectId) conditions.push(eq(t.job.projectId, q.projectId))
    if (q.contactId) conditions.push(eq(t.job.contactId, q.contactId))
    if (q.assignedToId) conditions.push(eq(t.job.assignedToId, q.assignedToId))
    if (q.search?.trim()) { const p = `%${q.search.trim()}%`; conditions.push(or(ilike(t.job.title, p), ilike(t.job.number, p), ilike(t.job.address, p))!) }
    // The dispatch board passes ?date=YYYY-MM-DD (F-11).
    if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      const dayStart = new Date(q.date + 'T00:00:00')
      if (!isNaN(dayStart.getTime())) conditions.push(gte(t.job.scheduledDate, dayStart), lt(t.job.scheduledDate, new Date(dayStart.getTime() + 86400000)))
    }
    // The schedule passes ?startDate&endDate for the visible week. Every template ignored them and
    // handed back the first page of ALL jobs, so a week view silently lost jobs past the page size.
    if (q.startDate) { const d = new Date(q.startDate); if (!isNaN(d.getTime())) conditions.push(gte(t.job.scheduledDate, d)) }
    if (q.endDate) { const d = new Date(q.endDate); if (!isNaN(d.getTime())) conditions.push(lte(t.job.scheduledDate, d)) }
    const where = and(...conditions)
    /**
     * Browsing the list opens on the NEWEST work; a requested date range still reads forwards.
     *
     * One ascending order served both, so the Service Calls page opened on JOB-00001 — "Page 1 of 21,
     * 503 total" of the oldest, mostly finished work, with no sortable headers to escape it. Ascending
     * is right for the week view, which asks for a range and reads down the days; it is the wrong first
     * screen for someone opening the list to find what is happening now. (Field Service T28 L4)
     */
    const viewingRange = !!(q.startDate || q.endDate || q.date)
    const order = viewingRange
      ? [asc(t.job.scheduledDate), desc(t.job.createdAt)]
      : [desc(t.job.scheduledDate), desc(t.job.createdAt)]
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(t.job).where(where).orderBy(...order).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.job).where(where),
    ])
    const data = (await withRelations(rows, currentUser.companyId)).map((j) => ({ ...j, isOverdue: isOverdue(j) }))
    return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  app.get('/today', async (c) => {
    const currentUser = c.get('user') as any
    // The crew's day, not the server's: this listed tomorrow's work from 8pm in Ohio, because
    // setHours(0,0,0,0) is UTC midnight on Render. scheduled_date is a calendar-day marker for a job
    // made here and a real instant for one made by a booking, so the day is taken per row. An
    // unconfigured company resolves to UTC and sees exactly what it sees today. (T24 N1)
    const tz = await companyTimeZone(db, currentUser.companyId)
    const { date: localToday } = storeDayRange(tz)
    const rows = await db.select().from(t.job)
      .where(and(eq(t.job.companyId, currentUser.companyId), sql`${jobLocalDay(t.job.scheduledDate, t.job.source, tz)} = ${localToday}::date`))
      .orderBy(asc(t.job.scheduledTime))
    return c.json(await withRelations(rows, currentUser.companyId, { id: t.contact.id, name: t.contact.name, phone: t.contact.phone }))
  })

  // ---------------------------------------------------------------- photos (before /:id so /:id/photos routes resolve first)
  if (t.jobPhoto && o.storage) {
    const storage = o.storage
    const keyFromUrl = (url: string) => (url || '').startsWith(mediaPrefix) ? url.slice(mediaPrefix.length) : null

    app.post('/:id/photos', async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      const form = await c.req.formData().catch(() => null)
      const file = form?.get('photo') as File | null
      if (!file || typeof file === 'string') return c.json({ error: 'No photo provided' }, 400)
      if (file.size > MAX_PHOTO_SIZE) return c.json({ error: 'Photo exceeds 10MB limit' }, 400)
      const buffer = Buffer.from(await file.arrayBuffer())
      // Trust the bytes, not the declared type — a renamed HTML file must not be served as an image.
      const type = sniffType(buffer) || baseMime(file.type)
      if (!PHOTO_EXT[type]) return c.json({ error: 'File must be an image' }, 400)
      const key = `photos/${currentUser.companyId}/${id}/${crypto.randomUUID().replace(/-/g, '')}.${PHOTO_EXT[type]}`
      await storage.put(key, buffer, type)
      const caption = (form!.get('caption') as string) || null
      const [photo] = await db.insert(t.jobPhoto).values({ companyId: currentUser.companyId, jobId: id, uploadedById: currentUser.userId, url: mediaPrefix + key, caption }).returning()
      return c.json(photo, 201)
    })

    app.get('/:id/photos', async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      return c.json(await db.select().from(t.jobPhoto).where(and(eq(t.jobPhoto.jobId, id), eq(t.jobPhoto.companyId, currentUser.companyId))).orderBy(desc(t.jobPhoto.createdAt)))
    })

    app.delete('/:id/photos/:photoId', async (c) => {
      const currentUser = c.get('user') as any
      const [existing] = await db.select().from(t.jobPhoto).where(and(eq(t.jobPhoto.id, c.req.param('photoId')), eq(t.jobPhoto.jobId, c.req.param('id')), eq(t.jobPhoto.companyId, currentUser.companyId))).limit(1)
      if (!existing) return c.json({ error: 'Photo not found' }, 404)
      const key = keyFromUrl(existing.url)
      if (key) { try { await storage.deleteFile(key) } catch { /* the row is the source of truth */ } }
      await db.delete(t.jobPhoto).where(eq(t.jobPhoto.id, existing.id))
      return c.body(null, 204)
    })
  }

  // ---------------------------------------------------------------- one job
  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const found = await findOwned(c.req.param('id'), currentUser.companyId)
    if (!found) return c.json({ error: 'Job not found' }, 404)
    const [jobProject, jobContact, assignedUser, entries, jobEquipment] = await Promise.all([
      t.project && found.projectId ? db.select().from(t.project).where(and(eq(t.project.id, found.projectId), eq(t.project.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      found.assignedToId ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, email: t.user.email, phone: t.user.phone }).from(t.user).where(and(eq(t.user.id, found.assignedToId), eq(t.user.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      t.timeEntry ? db.select().from(t.timeEntry).where(eq(t.timeEntry.jobId, found.id)).orderBy(desc(t.timeEntry.date)).limit(10) : Promise.resolve([]),
      t.equipment && found.equipmentId ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model, serialNumber: t.equipment.serialNumber, location: t.equipment.location }).from(t.equipment).where(and(eq(t.equipment.id, found.equipmentId), eq(t.equipment.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
    ])
    const { portalToken, portalTokenExp, ...safeContact } = (jobContact[0] || {}) as any
    // one assignedTo whichever kind of person is on the job — same shape the list gives (T21 M12)
    const [withAssignee] = await withRelations([found], currentUser.companyId)
    return c.json({ ...found, project: jobProject[0] || null, contact: jobContact[0] ? safeContact : null, assignedTo: assignedUser[0] ? { ...assignedUser[0], name: `${assignedUser[0].firstName || ''} ${assignedUser[0].lastName || ''}`.trim(), kind: 'user' } : withAssignee?.assignedTo || null, timeEntries: entries, ...(t.equipment ? { equipment: jobEquipment[0] || null } : {}) })
  })

  app.post('/', async (c) => {
    const currentUser = c.get('user') as any
    const data: any = jobSchema.parse(await c.req.json())
    const who = await resolveAssignee(currentUser.companyId, data.assignedToId, data.assignedToMemberId)
    if (who.error) return c.json({ error: who.error }, 400)
    data.assignedToId = who.assignedToId
    if (t.teamMember) data.assignedToMemberId = who.assignedToMemberId
    else delete data.assignedToMemberId
    // Conflict check + insert run in ONE transaction under the per-company job lock, so two concurrent
    // New-Job requests for the same tech/slot can't both pass the check and double-book (the check ran
    // outside the write before, so a race stacked two jobs at 10:00). (FS double-booking race)
    let clash: any = null
    const created = await db.transaction(async (tx: any) => {
      await jobLock(tx, currentUser.companyId)
      clash = await assigneeConflict(currentUser.companyId, who, data.scheduledDate, data.scheduledTime, undefined, tx, data.estimatedHours)
      if (clash) return null
      const number = await nextNumber(tx, t.job, t.job.number, t.job.companyId, currentUser.companyId, { prefix, pad })
      const [row] = await tx.insert(t.job).values({
        ...data,
        number,
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
        estimatedHours: data.estimatedHours !== undefined ? String(data.estimatedHours) : null,
        companyId: currentUser.companyId,
        createdById: currentUser.userId,
      }).returning()
      return row
    })
    // Name the call AND when it starts: the clash is now an overlap, so "at this time" would be a lie
    // for a 09:30 call refused because an 09:00 two-hour one is already there. (FS T28 H1)
    if (clash) return c.json({ error: `That person is already booked on ${clash.number}${clash.scheduledTime ? ` at ${clash.scheduledTime}` : ''}, which overlaps this one. Pick another time or assignee.`, conflictId: clash.id }, 409)
    const [result] = await withRelations([created], currentUser.companyId)
    emitToCompany(currentUser.companyId, EVENTS.JOB_CREATED, result)
    return c.json(result, 201)
  })

  app.put('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // The edit form posts back exactly what the API returned, including null for empty relations;
    // optional string fields reject null, so map null → undefined (clearing a field uses '').
    const raw = (await c.req.json().catch(() => null)) ?? {}
    const data: any = jobSchema.partial().parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === null ? undefined : v])))
    // On an EDIT, '' (or null) on a link means "clear it" — the schema maps '' to undefined, which leaves the field
    // alone, so Unassign and clearing the customer/project silently did nothing. All three columns are nullable.
    for (const k of ['assignedToId', 'assignedToMemberId', 'contactId', 'projectId'] as const) {
      if (Object.prototype.hasOwnProperty.call(raw, k) && (raw[k] === '' || raw[k] === null)) data[k] = null
    }
    const existing = await findOwned(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Job not found' }, 404)
    // Either field can carry the new assignee; touching either one replaces whoever was on the job, so a job
    // never ends up with a login user AND a roster member on it. (Landscaping T21 M12)
    const touchesAssignee = data.assignedToId !== undefined || data.assignedToMemberId !== undefined
    let who: Assignee = { assignedToId: existing.assignedToId ?? null, assignedToMemberId: existing.assignedToMemberId ?? null }
    if (touchesAssignee) {
      who = await resolveAssignee(currentUser.companyId, data.assignedToId, data.assignedToMemberId)
      if (who.error) return c.json({ error: who.error }, 400)
      data.assignedToId = who.assignedToId
      if (t.teamMember) data.assignedToMemberId = who.assignedToMemberId
      else delete data.assignedToMemberId
    }
    // Check the resulting assignee/date/time (only the fields the edit changed override the existing).
    const effAssignee = who
    const effDate = data.scheduledDate !== undefined ? data.scheduledDate : existing.scheduledDate
    const effTime = data.scheduledTime !== undefined ? data.scheduledTime : existing.scheduledTime
    // The length matters as much as the start: shortening or lengthening a call changes what it overlaps,
    // so the re-check uses the duration the job will HAVE, not the one it had. (FS T28 H1)
    const effHours = data.estimatedHours !== undefined ? data.estimatedHours : existing.estimatedHours
    // Re-check + update in one transaction under the same per-company job lock, so a concurrent write
    // (create or edit) can't sneak the same tech/slot in between the check and the update.
    let clash: any = null
    const updated = await db.transaction(async (tx: any) => {
      await jobLock(tx, currentUser.companyId)
      clash = await assigneeConflict(currentUser.companyId, effAssignee, effDate, effTime, id, tx, effHours)
      if (clash) return null
      // Completing a job from the status dropdown must stamp completedAt the same way POST /:id/complete does —
      // it was only stamped by that route, so "Completed today" stayed 0 and the job had no completion time.
      // Moving it back out of completed clears the stamp, so the count stays true. (Landscaping T14 L13)
      const completedAt = data.status === undefined || data.status === existing.status ? undefined
        : data.status === 'completed' ? (existing.completedAt ?? new Date())
        : existing.completedAt ? null : undefined
      const [row] = await tx.update(t.job).set({
        ...data,
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
        estimatedHours: data.estimatedHours !== undefined ? String(data.estimatedHours) : undefined,
        ...(completedAt !== undefined ? { completedAt } : {}),
        updatedAt: new Date(),
      }).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId))).returning()
      return row
    })
    // Name the call AND when it starts: the clash is now an overlap, so "at this time" would be a lie
    // for a 09:30 call refused because an 09:00 two-hour one is already there. (FS T28 H1)
    if (clash) return c.json({ error: `That person is already booked on ${clash.number}${clash.scheduledTime ? ` at ${clash.scheduledTime}` : ''}, which overlaps this one. Pick another time or assignee.`, conflictId: clash.id }, 409)
    const [result] = await withRelations([updated], currentUser.companyId)
    emitToCompany(currentUser.companyId, EVENTS.JOB_UPDATED, result)
    return c.json(result)
  })

  app.delete('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
    await db.delete(t.job).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId)))
    emitToCompany(currentUser.companyId, EVENTS.JOB_DELETED, { id })
    return c.body(null, 204)
  })

  // ---------------------------------------------------------------- lifecycle
  const transition = (path: string, status: string, hook: () => JobHook | undefined, extra: () => Record<string, any> = () => ({})) => {
    app.post(`/:id/${path}`, async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      // Moving a job OUT of completed clears the completion stamp — the same rule the status dropdown has
      // followed since landscaping T14 L13. Start and Dispatch only wrote the status, so reopening a finished
      // job left it still claiming a completion time, and "Completed today" kept counting it. (T26 M1)
      const [updated] = await db.update(t.job).set({
        status,
        ...(status === 'completed' ? {} : { completedAt: null }),
        ...extra(),
        updatedAt: new Date(),
      }).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId))).returning()
      emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status })
      const more = await runHook(hook(), updated, currentUser)
      return c.json({ ...updated, ...more })
    })
  }
  transition('start', 'in_progress', () => o.onStart)
  transition('complete', 'completed', () => o.onComplete, () => ({ completedAt: new Date() }))
  transition('dispatch', 'dispatched', () => o.onDispatch)

  return app
}

/**
 * Public, read-only media proxy for job photos: streams objects out of the private bucket, same-origin.
 * Photos appear in the CRM and the customer portal (which may be viewed without an admin token), so
 * this matches the previous public access model; keys are opaque (companyId/jobId/random). User uploads
 * are never served as inline HTML/SVG — only known-safe raster types keep their content-type.
 */
export function createMediaRoutes(storage: { getObject: (key: string) => Promise<{ body: ArrayBuffer; contentType: string } | null>; storageConfigured?: () => boolean }, opts: { mountPath?: string } = {}) {
  const SAFE_INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])
  const mount = (opts.mountPath || '/media').replace(/\/+$/, '')
  const app = new Hono()
  app.get('/*', async (c) => {
    if (storage.storageConfigured && !storage.storageConfigured()) return c.json({ error: 'Media storage not configured' }, 503)
    const key = decodeURIComponent(c.req.path.replace(new RegExp(`^${mount}/`), ''))
    if (!key || key.includes('..') || key.startsWith('/') || !key.startsWith('photos/')) return c.json({ error: 'Invalid media key' }, 400)
    const obj = await storage.getObject(key)
    if (!obj) return c.json({ error: 'Not found' }, 404)
    const safe = SAFE_INLINE.has(obj.contentType)
    c.header('Content-Type', safe ? obj.contentType : 'application/octet-stream')
    c.header('X-Content-Type-Options', 'nosniff')
    if (!safe) c.header('Content-Disposition', 'attachment')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    return c.body(obj.body)
  })
  return app
}
