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
import { nextNumber, round2, defaultTaxRateFrom } from '../invoicing/money'
import { jobMoneyWithheld, withoutJobMoney } from './jobMoney'
// Billing a job raises an invoice through the SAME helper every other billing path uses, so numbering,
// totals and the UTC date normalisation cannot drift from invoices, quotes, agreements or visits. (T41)
import { insertInvoice } from '../invoicing/invoices'
import { withoutPortalCredential } from '../contacts/contacts'
import { resolveCustomer } from '../contacts/customer'
import { companyTimeZone, storeDayRange, jobLocalDay, storeDateString, markerDay } from '../time/businessDay'
import { checkFilter } from '../listFilter'
import { JOB_TILES, jobsTodayCondition } from '../reporting/tileConditions'
import { withinHorizon, horizonMessage } from '../dateInput'
import { sniffType } from '../files/storage'
import { seriesDays, describeSeriesDays, MAX_SERIES, type SeriesFrequency } from '../time/series'
import { zipField } from '../address'
import { itemCodes, withoutItemCodes } from '../invoicing/itemCodes'
import { onJob, ownJobScope } from './onJob'
import { JOB_DISPATCH_PERMISSION, dispatchRefusal } from './dispatch'
import { travelMinutes, type Place } from './travel'
import { partialOf } from '../partialOf'

export interface JobTables { job: any; contact: any; user: any; project?: any; timeEntry?: any; equipment?: any; jobPhoto?: any;
  /** crew roster. Present → roster-only people (no login) can be assigned work, via job.assignedToMemberId. (T21 M12) */
  teamMember?: any
  /** Billing a job needs these two plus options.billing; see POST /:id/invoice. (T41) */
  invoice?: any
  invoiceLineItem?: any
  /**
   * The company's branches (multi_location). Present, with a location_id column on the job table → a job can be put
   * at a branch, the list filters by it (?locationId=), and each job comes back with its branch's name and code.
   */
  location?: any
  /**
   * Repeating jobs (job_series, with job.series_id / series_index). Present → a new job may carry `repeat` and is made
   * as a series of visits, GET /:id says which series a visit is in, and POST /:id/series/stop ends it. Absent → none
   * of that, as before (the CRM templates' job tables have no series).
   */
  jobSeries?: any
  /**
   * The other people on a job (job_assignee: job_id + user_id or member_id). Present → a job can carry
   * `otherAssigneeIds` beside its lead (assignedToId / assignedToMemberId), every one of them is checked for
   * double-booking, and a person's own jobs include the ones they are on (./onJob.ts). Absent → one person per job.
   */
  jobAssignee?: any
  /**
   * The logins on each crew (crew_login: user_id + crew_id or team_member_id). Present → a login's own jobs include
   * the jobs of every crew it is on (./onJob.ts). Absent → no crews.
   */
  crewLogin?: any }
export interface JobPhotoStorage { put: (key: string, body: Buffer, contentType: string) => Promise<void>; deleteFile: (key: string) => boolean | Promise<boolean | void>; storageConfigured?: () => boolean }
export type JobHook = (ctx: { job: any; companyId: string; userId: string }) => Promise<Record<string, any> | void> | Record<string, any> | void
/** A job's moments: on the way, on site, done (the vertical's texts, the review request, an agreement's next visit). */
export interface JobHooks { onStart?: JobHook; onDispatch?: JobHook; onComplete?: JobHook }
/**
 * The hook a status runs when a job moves INTO it — one table for every door a status is reached by: the buttons, the
 * edit form, the Dispatch Board (PUT /:id) and bulk updates (bulk.ts). Staying in a status runs nothing. (2026-10-22)
 */
export function jobHookFor(status: string, hooks: JobHooks | undefined): JobHook | undefined {
  if (!hooks) return undefined
  return status === 'completed' ? hooks.onComplete : status === 'in_progress' ? hooks.onStart : status === 'dispatched' ? hooks.onDispatch : undefined
}

export interface JobOptions {
  /**
   * Is every person on this job free at this time (working hours, time off)? Called on a create and on a move, after the
   * overlap and travel checks. Returns a warning the office may book past — `{ code, message, ... }`, answered as a 409
   * with `canBookAnyway` exactly as a travel-time warning is — or null. Absent → no such check (every template, as before).
   */
  availability?: (companyId: string, people: Array<{ userId: string | null; memberId: string | null }>, scheduledDate: unknown, scheduledTime: string | null | undefined, hours: unknown, exec: any) => Promise<{ code: string; message: string; [k: string]: unknown } | null>
  numbering?: { prefix?: string; pad?: number }
  /**
   * A new job's type when none is given, on a job table with a job_type column. The templates each left it to their own
   * database default ('service' in basic and bar, 'repair' in field service and landscaping); one shared database
   * needs the vertical to say.
   */
  defaultJobType?: string
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
  /**
   * Present → a NEW job must be for a customer (the one named, or its project's), refused in words when it is not, and
   * an edit may not take the customer off a job that has one. Jobs already saved without a customer stay readable and
   * editable — only making one, or clearing one, is refused. Absent → a job may have no customer, as before, so a
   * template that never sets it (the old CRM templates) is unchanged. `word` is what the trade calls its customer.
   */
  requireCustomer?: { word: string }
  /**
   * Present → POST /:id/invoice is offered: a job can be billed. (T41)
   *
   * Requires tables.invoice + tables.invoiceLineItem, and an `invoice.job_id` column on this
   * template (crm-fieldservice migration 0025). Absent → the route is not mounted at all, so no
   * vertical gains a billing path it has no column for.
   *
   * WHY IT WAS MISSING AND WHY THAT MATTERED. A quote converts to an invoice, and a quote converts
   * to a job — but a job converted to nothing, and a field-service call frequently has no quote
   * behind it. The only way to bill one was to raise an invoice by hand and pick the customer, and
   * that invoice belonged to no work: job costing attributes revenue through invoice.quote_id and
   * invoice.project_id, so a completed, invoiced, PAID call showed its cost with no revenue and read
   * as a pure loss.
   */
  billing?: {
    /** Invoice numbering for this vertical — the same options the invoices route uses. */
    numbering?: { prefix?: string; pad?: number; seed?: number }
    /** Days until due, from today. Default 30. */
    termsDays?: number
  }
}

export interface JobDeps {
  db: any
  tables: JobTables
  authenticate: any
  /**
   * REQUIRED, not optional. This module took `authenticate` and nothing else, so every route under
   * /api/jobs was open to any signed-in user: a field tech could create a service call, and delete
   * anyone's. The matrix already said field gets jobs:read + jobs:update and no more; nothing asked
   * it. Making this required means a template cannot mount the module unguarded by omission.
   * (Field Service T30 BLOCKER)
   */
  requirePermission: (permission: string) => any
  /**
   * May this caller change what a job is WORTH? Asked with `quotes:update`. (T32 M7)
   *
   * `jobs:update` has to stay with `field` — it is how a technician runs the work — and that right
   * was also letting them reprice the job: the report put JOB-00119's estimate from $11,183 to $1.
   * Not wired → allowed, so an un-migrated template is unchanged; the same convention the jobs
   * dashboard, the pricebook and the team roster all use for `canSee`.
   */
  canSee?: (role: string, permission: string, userId?: string) => Promise<boolean> | boolean
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: { JOB_CREATED: string; JOB_UPDATED: string; JOB_DELETED: string; JOB_STATUS_CHANGED: string }
  cleanText: (min?: number) => z.ZodTypeAny
  /** For the multi-line fields (description, notes): markup stripped, line breaks kept. Absent: cleanText. */
  cleanLines?: (min?: number) => z.ZodTypeAny
  options?: JobOptions
  /** Where a "book anyway" past a travel-time warning is recorded (the audit log). Absent → not recorded. */
  audit?: { log: (entry: any) => any }
}

export const JOB_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const OPEN_JOB_STATUSES = ['scheduled', 'pending', 'confirmed']
// Every job status any template actually uses: the FE default set (scheduled/dispatched/in_progress/
// completed/cancelled), the open statuses (pending/confirmed), and the import mapper's on_hold. No template
// configures a status outside this union, so validating against it rejects junk like "banana" (which
// otherwise reached the dashboard as a real bucket and was dropped from Reports, 168 vs 169) without
// breaking a real status. If a vertical ever needs its own set, thread it through JobOptions.
export const JOB_STATUSES = ['scheduled', 'pending', 'confirmed', 'dispatched', 'in_progress', 'on_hold', 'completed', 'cancelled'] as const

/** What each button (dispatch / start / complete) may move a job FROM — forward only. Anything else: see jobMoveRefusal. */
export const JOB_MOVES_FROM = {
  dispatched: ['scheduled', 'pending', 'confirmed', 'on_hold'],
  in_progress: ['scheduled', 'pending', 'confirmed', 'dispatched', 'on_hold'],
  completed: ['scheduled', 'pending', 'confirmed', 'dispatched', 'in_progress', 'on_hold'],
} as const

/** The sentence for a button that would move a job backwards (or out of cancelled). */
export function jobMoveRefusal(to: string, from: string): string {
  const doing = to === 'dispatched' ? 'sent out' : to === 'in_progress' ? 'started' : 'completed'
  if (from === 'cancelled') return `This job was cancelled, so it can't be ${doing}. Reopen it first.`
  if (from === 'completed') return `This job is already completed, so it can't be ${doing} again. Reopen it first if there is more to do.`
  return `This job is already ${from === 'in_progress' ? 'in progress' : from.replace(/_/g, ' ')}, so it can't be ${doing} now.`
}
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

/** What a job's estimated value is: a quoted figure carried onto the work. (T32 M7) */
const JOB_MONEY_PERMISSION = 'quotes:update'

/**
 * …and the READ counterpart (T41) is ./jobMoney.ts, the ONE rule for every read that can return a job row.
 *
 * T32 M7 stopped a field technician from CHANGING what a job is worth (it had dropped JOB-00119
 * from $11,183 to $1). It left them able to read it, and T41 found that on three verticals:
 * "Staff sees agreement revenue tiles, job estimatedValue" (field service), "Staff sees job
 * estimatedValue and agreement price and revenue" (showcase), and the same on landscaping.
 * The quoted value reads under `quotes:read` (it IS a quoted figure, beside the write it guards);
 * roofing's revenue and claim money under `invoices:read`, its costs under `margin:read`.
 * `estimatedHours` is deliberately NOT withheld: how long the work takes is the technician's own business.
 */

export function createJobRoutes(deps: JobDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, cleanText } = deps
  const cleanLines = deps.cleanLines ?? cleanText
  const maySetJobMoney = async (c: any) => {
    if (!deps.canSee) return true
    const u = c.get('user') as any
    try { return await deps.canSee(u?.role, JOB_MONEY_PERMISSION, u?.userId) } catch { return true }
  }
  /** Who is on a job and when it is: jobs:dispatch (./dispatch.ts). Not wired → allowed, as maySetJobMoney. */
  const mayDispatch = async (c: any) => {
    if (!deps.canSee) return true
    const u = c.get('user') as any
    try { return !!(await deps.canSee(u?.role, JOB_DISPATCH_PERMISSION, u?.userId)) } catch { return false }
  }
  /**
   * A job row (or rows) with the figures this person may not see taken off (./jobMoney.ts). Both the list and the
   * single read return `db.select().from(t.job)` — the whole row — so both carried them. (T41)
   */
  const shapeJobMoney = async <T,>(c: any, rows: T): Promise<T> => withoutJobMoney(rows, await jobMoneyWithheld(deps.canSee, c.get('user')))
  /** The vertical's own noun, for a message somebody reads. "job" where nothing says otherwise. */
  const jobWord = (deps.options?.numbering?.prefix === 'SVC' ? 'service call' : 'job')
  const o = deps.options || {}
  const prefix = o.numbering?.prefix || 'JOB'
  const pad = o.numbering?.pad ?? 5
  const maxLimit = o.maxLimit || 500
  const mediaPrefix = o.mediaUrlPrefix || '/media/'

  const jobSchema = z.object({
    // a title is a line, not an essay — 500 characters went in unchecked (T21 L1)
    title: cleanText(1).pipe(z.string().max(200, 'Title must be 200 characters or fewer')),
    description: cleanLines().optional(),
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
    /**
     * WHAT THE JOB IS WORTH — and it was not settable at all. (T32 M7, corrected)
     *
     * The report says: "As field: PUT /api/jobs/:id with estimatedValue 1. 200. JOB-00119's estimate
     * dropped from $11,183 to $1." The 200 is real. The drop is not: `estimatedValue` has never been
     * in this schema (checked with `git log -S` over both this file and the template's route), so
     * the key was parsed away and the handler succeeded having ignored it.
     *
     * That is not better, it is a different fault. A write that answers 200 and changes nothing reads
     * as success to a tester and to a user — which is exactly what happened here, and the tester went
     * on to "restore" a value that had never moved. And the other half: `job.estimated_value` is
     * written ONLY by quote → convert-to-job, so a job whose value is wrong could not be corrected
     * through any API at all.
     *
     * So the field is accepted now, and gated: changing it needs `quotes:update` (see the PUT
     * handler), which is held by manager and above and not by field or viewer. Settable by the people
     * who price work, refused — with a reason — for everybody else, and no longer silently dropped
     * for anyone.
     */
    estimatedValue: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0, 'Estimated value cannot be negative').max(1_000_000_000).optional()),
    address: cleanText().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: zipField(),
    notes: cleanLines().optional(),
    ...(t.location && t.job.locationId ? { locationId: z.string().optional().transform(emptyToUndef as any) } : {}),
    ...(o.extraFields || {}),
  })
  const branches = !!(t.location && t.job.locationId)
  /** Repeating jobs, where the vertical's tables have them (JobTables.jobSeries). */
  const seriesOn = !!(t.jobSeries && t.job.seriesId)
  /** Several people per job, where the vertical's tables have the join (JobTables.jobAssignee). */
  const crewOn = !!t.jobAssignee
  /**
   * A job's `repeat`: { frequency: 'weekly' | 'monthly', interval?: 1–12, count?: 2–52, until?: YYYY-MM-DD }. It needs
   * the job's day (the first visit), and an end — a number of visits or a last day — because a series with no end would
   * fill the calendar for good. Refusals are sentences about the boxes on the form.
   */
  const readRepeat = (raw: any, firstDate?: string): { spec: { frequency: SeriesFrequency; intervalCount: number; firstDate: string; occurrencesCount?: number | null; untilDate?: string | null } } | { error: string } => {
    const frequency = raw?.frequency
    if (frequency !== 'weekly' && frequency !== 'monthly') return { error: 'Choose how often it repeats: every week, every few weeks, or every month.' }
    const day = typeof firstDate === 'string' ? firstDate.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: `Give the ${jobWord} a scheduled date — the first visit — before making it repeat.` }
    const interval = raw?.interval === undefined || raw?.interval === null || raw?.interval === '' ? 1 : Number(raw.interval)
    if (!Number.isInteger(interval) || interval < 1 || interval > 12) return { error: 'Repeat every 1 to 12 weeks or months.' }
    const hasCount = raw?.count !== undefined && raw?.count !== null && raw?.count !== ''
    const hasUntil = typeof raw?.until === 'string' && raw.until.trim() !== ''
    if (!hasCount && !hasUntil) return { error: 'Say when the repeats end: after a number of visits, or on a date.' }
    let occurrencesCount: number | null = null, untilDate: string | null = null
    if (hasCount) {
      const n = Number(raw.count)
      if (!Number.isInteger(n) || n < 2 || n > MAX_SERIES) return { error: `A repeating ${jobWord} has 2 to ${MAX_SERIES} visits.` }
      occurrencesCount = n
    }
    if (hasUntil) {
      const u = String(raw.until).trim()
      if (!validDate(u) || !/^\d{4}-\d{2}-\d{2}$/.test(u)) return { error: 'The last day of the repeats is not a real date.' }
      if (u <= day) return { error: 'The repeats must end after the first visit.' }
      untilDate = u
    }
    return { spec: { frequency, intervalCount: interval, firstDate: day, occurrencesCount, untilDate } }
  }
  /** A branch must be one of this company's — an id from anywhere else is refused, not stored. */
  const branchRefusal = async (companyId: string, locationId: unknown) => {
    if (!branches || !locationId) return null
    const [row] = await db.select({ id: t.location.id }).from(t.location).where(and(eq(t.location.id, String(locationId)), eq(t.location.companyId, companyId))).limit(1)
    return row ? null : 'That location is not one of your branches'
  }

  const app = new Hono()
  app.use('*', authenticate)

  const findOwned = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.job).where(and(eq(t.job.id, id), eq(t.job.companyId, companyId))).limit(1)
    return row
  }

  /**
   * WHOSE WORK THIS SEAT READS: everyone's with `jobs:read-all`, else only the jobs assigned to them — Jobber's rule for
   * a field seat. A landscaping crew login was shown every job and every customer's name (live retest, 2026-10-24); the
   * vertical withholds jobs:read-all from its field seat (verticals/landscaping/settings.ts), every other seat keeps it.
   * "Their" jobs are ./onJob.ts's: led, an assignee, the sales rep, or on the job's crew (every job vertical's field
   * seat since 2026-10-24).
   * Answers the condition to narrow by, or null for all. Not wired (no canSee) → all; a failed check narrows (fails closed).
   */
  const ownScope = async (c: any): Promise<any | null> => ownJobScope(db, t, deps.canSee, c.get('user') as any)
  // Every /:id door (read, edit, photos, notes, status, invoice…) answers 404 for a job this seat may not read, as if it
  // were not there. A path word that is no job id ('today') finds no row and passes through to its own route.
  const ownJobOnly = async (c: any, next: any) => {
    const scope = await ownScope(c)
    if (scope) {
      const u = c.get('user') as any
      // A job they lead, are on, sell or crew (./onJob.ts) opens; any other answers as if it were not there.
      const where = and(eq(t.job.id, c.req.param('id')), eq(t.job.companyId, u.companyId))
      const [row] = await db.select({ id: t.job.id }).from(t.job).where(where).limit(1)
      if (row && !(await db.select({ id: t.job.id }).from(t.job).where(and(where, scope)).limit(1))[0]) return c.json({ error: 'Job not found' }, 404)
    }
    await next()
  }
  app.use('/:id', ownJobOnly)
  app.use('/:id/*', ownJobOnly)

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

  /**
   * EVERYONE ON THE JOB IS CHECKED (2026-10-24: several people per job). A person is a login user or a roster member;
   * the job's lead plus its other people (t.jobAssignee). Each one's same-day work — jobs they lead or are on
   * (./onJob.ts) — is compared with this slot, so a helper booked elsewhere at 10:00 cannot be put on a 10:00 job.
   * `excludeId` is the job being saved (or, for a re-timed day, every job being moved together).
   */
  type Person = { userId: string | null; memberId: string | null }
  const personId = (p: Person) => (p.userId || p.memberId) as string
  const leadOf = (a: Assignee): Person | null => a.assignedToId ? { userId: a.assignedToId, memberId: null } : a.assignedToMemberId ? { userId: null, memberId: a.assignedToMemberId } : null
  const sameDayFor = async (companyId: string, p: Person, scheduledDate: any, excludeId: string | string[] | undefined, exec: any, extra: Record<string, any> = {}) => {
    const dayStart = new Date(scheduledDate); if (isNaN(dayStart.getTime())) return []
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const conds = [
      eq(t.job.companyId, companyId),
      onJob(exec, t, personId(p)),
      gte(t.job.scheduledDate, dayStart), lt(t.job.scheduledDate, dayEnd),
      notInArray(t.job.status, ['cancelled', 'completed']),
    ]
    const skip = Array.isArray(excludeId) ? excludeId : excludeId ? [excludeId] : []
    if (skip.length) conds.push(notInArray(t.job.id, skip))
    // estimatedHours is not on every vertical's job table; selecting a column that is not there throws
    // inside drizzle and would 500 the whole save.
    const cols: any = { id: t.job.id, number: t.job.number, scheduledTime: t.job.scheduledTime, ...extra }
    if (t.job.estimatedHours) cols.estimatedHours = t.job.estimatedHours
    return exec.select(cols).from(t.job).where(and(...conds))
  }
  const assigneeConflict = async (companyId: string, people: Person[], scheduledDate?: any, scheduledTime?: string, excludeId?: string | string[], exec: any = db, hours?: unknown) => {
    if (!people.length || !scheduledDate || !scheduledTime) return null
    const start = minutesOfTime(scheduledTime); if (start === null) return null
    const end = start + minutesOfHours(hours)
    for (const p of people) {
      for (const other of await sameDayFor(companyId, p, scheduledDate, excludeId, exec)) {
        const s = minutesOfTime(other.scheduledTime)
        if (s === null) continue                       // unscheduled work holds no slot
        const e = s + minutesOfHours(other.estimatedHours)
        if (start < e && end > s) return { ...other, person: p }         // half-open: 09:00–10:00 and 10:00–11:00 do NOT clash
      }
    }
    return null
  }
  /** Name the call AND when it starts, and — on a job with several people — whose diary it is in. */
  const clashSentence = async (companyId: string, clash: any, many: boolean) =>
    `${many ? `${await nameOf(companyId, clash.person)} is` : 'That person is'} already booked on ${clash.number}${clash.scheduledTime ? ` at ${clash.scheduledTime}` : ''}, which overlaps this one. Pick another time or assignee.`

  /** A person's name for a sentence: the login user's, or the roster member's. `exec`: the transaction, inside one. */
  const nameOf = async (companyId: string, p: Person, exec: any = db): Promise<string> => {
    if (p.userId) {
      const [u] = await exec.select({ firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(and(eq(t.user.id, p.userId), eq(t.user.companyId, companyId))).limit(1)
      return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'That person' : 'That person'
    }
    if (t.teamMember && p.memberId) {
      const [m] = await exec.select({ name: t.teamMember.name }).from(t.teamMember).where(and(eq(t.teamMember.id, p.memberId), eq(t.teamMember.companyId, companyId))).limit(1)
      return m?.name || 'That person'
    }
    return 'That person'
  }
  const hhmmOf = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

  /**
   * TRAVEL TIME IS PART OF THE DAY (2026-10-24). Two calls that do not overlap can still be impossible: 10:00–11:00 on
   * one side of town and 11:00 on the other. For each person on the job, the work just before and just after this slot
   * on the same day is looked at: the gap between them against the drive (./travel.ts — the distance when both jobs are
   * on the map; when they are not, back-to-back at two different addresses is never enough). Too short is a WARNING the
   * office may book past ("Book anyway", recorded in the audit log) — not a refusal. An outright overlap stays a refusal
   * (assigneeConflict above).
   */
  const travelWarning = async (companyId: string, people: Person[], scheduledDate: any, scheduledTime: string | undefined | null, hours: unknown, here: Place, excludeId: string | undefined, exec: any = db) => {
    if (!people.length || !scheduledDate || !scheduledTime) return null
    const start = minutesOfTime(scheduledTime); if (start === null) return null
    const end = start + minutesOfHours(hours)
    for (const p of people) {
      const rows = await sameDayFor(companyId, p, scheduledDate, excludeId, exec, { lat: t.job.lat, lng: t.job.lng, address: t.job.address })
      let before: any = null, after: any = null
      for (const r of rows) {
        const s = minutesOfTime(r.scheduledTime); if (s === null) continue
        const e = s + minutesOfHours(r.estimatedHours)
        if (e <= start && (!before || e > before.e)) before = { ...r, s, e }
        if (s >= end && (!after || s < after.s)) after = { ...r, s, e }
      }
      const sides: Array<[any, number, boolean]> = [[before, before ? start - before.e : 0, false], [after, after ? after.s - end : 0, true]]
      for (const [other, gap, ahead] of sides) {
        if (!other) continue
        const drive = travelMinutes(other, here)
        if (drive === null || gap >= drive) continue
        const who = await nameOf(companyId, p, exec)
        const between = ahead ? `this ${jobWord} and ${other.number} (starts ${hhmmOf(other.s)})` : `${other.number} (ends ${hhmmOf(other.e)}) and this ${jobWord}`
        const mapped = here.lat != null && here.lng != null && other.lat != null && other.lng != null
        const drivePart = mapped ? `the drive is about ${drive} min` : 'the two are at different addresses'
        return {
          message: `${who} has ${gap} min between ${between}, and ${drivePart}. Book anyway, or pick another time or person.`,
          personId: personId(p), otherJobId: other.id as string, otherNumber: other.number as string, gapMinutes: gap, travelMinutes: drive,
        }
      }
    }
    return null
  }
  /** "Book anyway" past a travel warning: recorded, so the office can see who overrode what. */
  const recordOverride = (c: any, job: any, warning: any) => {
    if (!deps.audit?.log || !warning || !job) return
    try {
      deps.audit.log({ action: 'book_anyway', entity: 'job', entityId: job.id, entityName: job.number ?? null, metadata: { reason: 'travel_time', ...warning }, req: c })
    } catch { /* an audit row is never why a save fails */ }
  }
  /** 409 with a code the screens read to offer "Book anyway" (the same request again with bookAnyway: true). */
  const travelRefusal = (c: any, warning: any) => c.json({ error: warning.message, code: warning.code ?? 'travel_time', canBookAnyway: true, warning }, 409)

  /** The other people on a job (t.jobAssignee), in the order the office listed them. */
  const othersOf = async (jobId: string, exec: any = db): Promise<Person[]> => {
    if (!crewOn) return []
    const rows = await exec.select({ userId: t.jobAssignee.userId, memberId: t.jobAssignee.memberId }).from(t.jobAssignee).where(eq(t.jobAssignee.jobId, jobId)).orderBy(asc(t.jobAssignee.position), asc(t.jobAssignee.id))
    return rows.map((r: any) => ({ userId: r.userId ?? null, memberId: r.memberId ?? null }))
  }
  /** `otherAssigneeIds` from a request: each one a person on this team, repeats left out. */
  const readOthers = async (companyId: string, raw: unknown): Promise<{ people: Person[] } | { error: string }> => {
    if (!Array.isArray(raw)) return { error: 'The other people on the job must be a list.' }
    if (raw.length > 20) return { error: 'A job can have at most 20 other people on it.' }
    const out: Person[] = [], seen = new Set<string>()
    for (const id of raw) {
      if (blank(id)) continue
      const who = await resolveAssignee(companyId, id)
      if (who.error) return { error: who.error }
      const p = leadOf(who)!
      if (seen.has(personId(p))) continue
      seen.add(personId(p)); out.push(p)
    }
    return { people: out }
  }
  /**
   * The lead and the others a save ends with. Nobody leads but someone is on it → the first of them leads: a job with
   * people on it always has a lead, so every reader of assignedToId still finds someone. The lead is never also one of
   * the others.
   */
  const settleCrew = (lead: Person | null, others: Person[]): { lead: Person | null; others: Person[] } => {
    const rest = [...others]
    const l = lead || rest.shift() || null
    return { lead: l, others: rest.filter((p) => !l || personId(p) !== personId(l)) }
  }
  /** Replace a job's other people. */
  const writeOthers = async (tx: any, companyId: string, jobId: string, others: Person[]) => {
    if (!crewOn) return
    await tx.delete(t.jobAssignee).where(eq(t.jobAssignee.jobId, jobId))
    if (others.length) await tx.insert(t.jobAssignee).values(others.map((p, i) => ({ companyId, jobId, userId: p.userId, memberId: p.memberId, position: i + 1 })))
  }
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])]

  /** project / contact / assignedTo (/ equipment) for a set of rows, fetched by id and scoped to the company. */
  const withRelations = async (rows: any[], companyId: string, contactCols?: Record<string, any>) => {
    // The other people on these jobs (t.jobAssignee), named with the leads in the same two reads.
    const jobIds = uniq(rows.map((j) => j.id))
    const crewRows: any[] = crewOn && jobIds.length ? await db.select({ jobId: t.jobAssignee.jobId, userId: t.jobAssignee.userId, memberId: t.jobAssignee.memberId }).from(t.jobAssignee).where(inArray(t.jobAssignee.jobId, jobIds)).orderBy(asc(t.jobAssignee.position), asc(t.jobAssignee.id)) : []
    const projectIds = uniq(rows.map((j) => j.projectId)), contactIds = uniq(rows.map((j) => j.contactId)), userIds = uniq([...rows.map((j) => j.assignedToId), ...crewRows.map((r) => r.userId)]), equipmentIds = t.equipment ? uniq(rows.map((j) => j.equipmentId)) : []
    const memberIds = t.teamMember ? uniq([...rows.map((j) => j.assignedToMemberId), ...crewRows.map((r) => r.memberId)]) : []
    const members = memberIds.length ? await db.select({ id: t.teamMember.id, name: t.teamMember.name, role: t.teamMember.role, phone: t.teamMember.phone }).from(t.teamMember).where(and(eq(t.teamMember.companyId, companyId), inArray(t.teamMember.id, memberIds))) : []
    const [projects, contacts, users, equipmentList] = await Promise.all([
      t.project && projectIds.length ? db.select({ id: t.project.id, name: t.project.name }).from(t.project).where(and(eq(t.project.companyId, companyId), inArray(t.project.id, projectIds))) : Promise.resolve([]),
      contactIds.length ? db.select(contactCols || { id: t.contact.id, name: t.contact.name }).from(t.contact).where(and(eq(t.contact.companyId, companyId), inArray(t.contact.id, contactIds))) : Promise.resolve([]),
      userIds.length ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, userIds))) : Promise.resolve([]),
      t.equipment && equipmentIds.length ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model }).from(t.equipment).where(and(eq(t.equipment.companyId, companyId), inArray(t.equipment.id, equipmentIds))) : Promise.resolve([]),
    ])
    const locationIds = branches ? uniq(rows.map((j) => j.locationId)) : []
    const locationList = locationIds.length ? await db.select({ id: t.location.id, name: t.location.name, code: t.location.code }).from(t.location).where(and(eq(t.location.companyId, companyId), inArray(t.location.id, locationIds))) : []
    const by = (xs: any[]) => Object.fromEntries(xs.map((x) => [x.id, x]))
    const pm = by(projects), cm = by(contacts), um = by(users), em = by(equipmentList), mm = by(members), lm = by(locationList)
    // One `assignedTo` whichever kind the person is. A user keeps the shape it always had (firstName/lastName) and
    // gains name + kind; a roster member is split into the same two fields so every existing caller keeps working.
    const named = (u: any) => ({ ...u, name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), kind: 'user' as const })
    const fromMember = (m: any) => { const [first, ...rest] = String(m.name || '').split(' '); return { id: m.id, firstName: first || m.name || '', lastName: rest.join(' '), name: m.name, role: m.role || null, phone: m.phone || null, kind: 'member' as const } }
    const personFor = (userId?: string | null, memberId?: string | null) => userId ? (um[userId] ? named(um[userId]) : null) : memberId ? (mm[memberId] ? fromMember(mm[memberId]) : null) : null
    /**
     * `assignees`: EVERYONE on the job, lead first (lead: true), then the others in the order the office listed them — what the
     * Schedule's and the Dispatch Board's lanes and the job form read. `assignedTo` stays the lead alone.
     */
    const crewOf = (j: any) => {
      const lead = personFor(j.assignedToId, j.assignedToMemberId)
      const others = crewRows.filter((r) => r.jobId === j.id).map((r) => personFor(r.userId, r.memberId)).filter(Boolean)
      return [...(lead ? [{ ...lead, lead: true }] : []), ...others.map((p: any) => ({ ...p, lead: false }))]
    }
    return rows.map((j) => ({
      ...j,
      project: j.projectId ? pm[j.projectId] || null : null,
      contact: j.contactId ? cm[j.contactId] || null : null,
      assignedTo: personFor(j.assignedToId, j.assignedToMemberId),
      assignees: crewOf(j),
      ...(t.equipment ? { equipment: j.equipmentId ? em[j.equipmentId] || null : null } : {}),
      ...(branches ? { location: j.locationId ? lm[j.locationId] || null : null } : {}),
    }))
  }
  /**
   * Overdue: still open and its day is over on the company's clock (2026-10-22). It was "24 hours after midnight UTC of
   * the day", which is 7pm the next day in Chicago. The job's day is read by the rule jobLocalDay states: a booking's
   * instant on the company's clock, a day marker as the day it names.
   */
  const isOverdue = (j: any, tz: string) => {
    if (!j.scheduledDate || !OPEN_JOB_STATUSES.includes(String(j.status))) return false
    const day = j.source === 'online_booking' ? storeDateString(new Date(j.scheduledDate), tz) : markerDay(new Date(j.scheduledDate))
    return day < storeDateString(new Date(), tz)
  }
  /** The hook a status runs when a job moves into it — one table for the buttons and the edit (see PUT /:id). */
  const hookFor = (status: string): JobHook | undefined => jobHookFor(status, o)
  const runHook = async (hook: JobHook | undefined, job: any, currentUser: any) => {
    if (!hook) return {}
    try { return (await hook({ job, companyId: currentUser.companyId, userId: currentUser.userId })) || {} } catch (err: any) { console.warn('[jobs] hook failed:', err?.message || err); return {} }
  }

  // ---------------------------------------------------------------- list / today
  app.get('/', requirePermission('jobs:read'), async (c) => {
    const currentUser = c.get('user') as any
    const q = c.req.query()
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(q.limit || '50', 10) || 50), maxLimit)
    // A status this CRM has no word for is a typo, not an empty page. (T29 N2)
    const badStatus = checkFilter(c, 'status', q.status, JOB_STATUSES)
    if (badStatus) return badStatus
    const conditions: any[] = [eq(t.job.companyId, currentUser.companyId)]
    const scope = await ownScope(c)
    if (scope) conditions.push(scope)
    // ?tile= is a home-screen tile's own rows (reporting/tileConditions.ts — the dashboard's count uses the same condition).
    const badTile = checkFilter(c, 'tile', q.tile, JOB_TILES)
    if (badTile) return badTile
    if (q.status) conditions.push(eq(t.job.status, q.status))
    if (q.tile === 'today') conditions.push(jobsTodayCondition(t.job, await companyTimeZone(db, currentUser.companyId)))
    if (q.projectId) conditions.push(eq(t.job.projectId, q.projectId))
    if (q.contactId) conditions.push(eq(t.job.contactId, q.contactId))
    // A person's jobs: the ones they lead or are on (./onJob.ts) — the Schedule's and the Dispatch Board's lanes read this.
    if (q.assignedToId) conditions.push(onJob(db, t, q.assignedToId))
    if (branches && q.locationId) conditions.push(eq(t.job.locationId, q.locationId))
    if (q.search?.trim()) { const p = `%${q.search.trim()}%`; conditions.push(or(ilike(t.job.title, p), ilike(t.job.number, p), ilike(t.job.address, p))!) }
    // The dispatch board passes ?date=YYYY-MM-DD (F-11): the COMPANY'S day, read per job by the rule /today uses
    // (jobLocalDay — a booking's instant in the company's zone, a day marker as the day it names). It was the server's
    // local midnight (new Date(date + 'T00:00:00')), so a server off UTC moved the board's day (2026-10-24).
    const tzForOrder = await companyTimeZone(db, currentUser.companyId)
    if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && !isNaN(new Date(`${q.date}T00:00:00Z`).getTime())) {
      conditions.push(sql`${jobLocalDay(t.job.scheduledDate, t.job.source, tzForOrder)} = ${q.date}::date`)
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
     *
     * It took three goes to get this right, and each wrong answer was defensible on its own:
     *   ascending           opened on JOB-00001, the oldest finished work (T28 L4)
     *   descending          opened on unscheduled calls — Postgres sorts NULLs first on DESC
     *   descending dated    opened on test calls booked in 2027, still not today's work (T29)
     *
     * "Newest" was never the goal; NEXT was. The list opens on today and reads FORWARD, then past work
     * follows most-recent-first, then undated. Ordering by a single column cannot express that, which is
     * why all three attempts to pick one direction failed.
     */
    const viewingRange = !!(q.startDate || q.endDate || q.date)
    const { date: todayForOrder } = storeDayRange(tzForOrder)
    const order = viewingRange
      ? [asc(t.job.scheduledDate), desc(t.job.createdAt)]
      : [
          // upcoming (0) before past (1) before undated (2)
          sql`CASE WHEN ${t.job.scheduledDate} IS NULL THEN 2 WHEN ${t.job.scheduledDate} >= ${todayForOrder}::date THEN 0 ELSE 1 END`,
          // within upcoming: soonest first
          sql`CASE WHEN ${t.job.scheduledDate} >= ${todayForOrder}::date THEN ${t.job.scheduledDate} END ASC`,
          // within past: most recent first
          sql`CASE WHEN ${t.job.scheduledDate} < ${todayForOrder}::date THEN ${t.job.scheduledDate} END DESC`,
          desc(t.job.createdAt),
        ]
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(t.job).where(where).orderBy(...order).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.job).where(where),
    ])
    const withOverdue = (await withRelations(rows, currentUser.companyId)).map((j) => ({ ...j, isOverdue: isOverdue(j, tzForOrder) }))
    // What the work is WORTH is not part of reading the schedule. (T41)
    const data = await shapeJobMoney(c, withOverdue)
    // Every status a job can hold (JOB_STATUSES, the list the filter above and every write are checked against), so the
    // screen's status filter offers the same list: a job converted from a quote is 'pending', which the filter did not
    // offer (live test 2026-10-22).
    return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) }, statuses: [...JOB_STATUSES] })
  })

  app.get('/today', requirePermission('jobs:read'), async (c) => {
    const currentUser = c.get('user') as any
    // The crew's day, not the server's: this listed tomorrow's work from 8pm in Ohio, because
    // setHours(0,0,0,0) is UTC midnight on Render. scheduled_date is a calendar-day marker for a job
    // made here and a real instant for one made by a booking, so the day is taken per row. An
    // unconfigured company resolves to UTC and sees exactly what it sees today. (T24 N1)
    const tz = await companyTimeZone(db, currentUser.companyId)
    const { date: localToday } = storeDayRange(tz)
    const scope = await ownScope(c)
    const rows = await db.select().from(t.job)
      .where(and(eq(t.job.companyId, currentUser.companyId), sql`${jobLocalDay(t.job.scheduledDate, t.job.source, tz)} = ${localToday}::date`, scope ?? undefined))
      .orderBy(asc(t.job.scheduledTime), asc(t.job.id))
    /**
     * …and /today, which is the TECHNICIAN'S OWN SCREEN and therefore the one most likely to be
     * read by the seat this withholds from. Missing it would have left the value on the single
     * surface the finding is actually about. (T41)
     */
    const today = await withRelations(rows, currentUser.companyId, { id: t.contact.id, name: t.contact.name, phone: t.contact.phone })
    return c.json(await shapeJobMoney(c, today))
  })

  // ---------------------------------------------------------------- re-time a day's stops
  /**
   * NEW START TIMES FOR SEVERAL JOBS AT ONCE — the route optimiser's "re-time" (2026-10-24). The office reorders one
   * person's day, sees the new times, and only then sends them here. All of them are saved or none: in one transaction
   * under the job lock, each job's new slot is checked for EVERY person on it against their other work (the jobs being
   * moved together are left out of each other's check — they are laid end to end by the caller). jobs:update, as a drag
   * on the Schedule is; a seat that reads only its own jobs re-times only those.
   */
  app.post('/retime', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const currentUser = (c as any).get('user')
    const body: any = await c.req.json().catch(() => null)
    const times: Array<{ id: string; scheduledTime: string }> | null = Array.isArray(body?.times) ? body.times : null
    if (!times || times.length === 0 || times.length > 50) return c.json({ error: 'Send the new start time for each stop (1 to 50).' }, 400)
    for (const x of times) {
      if (typeof x?.id !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x?.scheduledTime || ''))) return c.json({ error: 'Each stop needs its job and a start time (HH:MM, 24-hour).' }, 400)
    }
    const ids = [...new Set(times.map((x) => x.id))]
    if (ids.length !== times.length) return c.json({ error: 'A stop is listed twice.' }, 400)
    const scope = await ownScope(c)
    const rows: any[] = await db.select().from(t.job).where(and(eq(t.job.companyId, currentUser.companyId), inArray(t.job.id, ids), ...(scope ? [scope] : [])))
    if (rows.length !== ids.length) return c.json({ error: 'Job not found' }, 404)
    let clash: any = null
    const saved = await db.transaction(async (tx: any) => {
      await jobLock(tx, currentUser.companyId)
      for (const x of times) {
        const row = rows.find((r) => r.id === x.id)
        const lead = leadOf({ assignedToId: row.assignedToId ?? null, assignedToMemberId: row.assignedToMemberId ?? null })
        const people: Person[] = [...(lead ? [lead] : []), ...(await othersOf(row.id, tx))]
        clash = await assigneeConflict(currentUser.companyId, people, row.scheduledDate, x.scheduledTime, ids, tx, row.estimatedHours)
        if (clash) return null
      }
      const out: any[] = []
      for (const x of times) {
        const [u] = await tx.update(t.job).set({ scheduledTime: x.scheduledTime, updatedAt: new Date() }).where(and(eq(t.job.id, x.id), eq(t.job.companyId, currentUser.companyId))).returning()
        out.push(u)
      }
      return out
    })
    if (clash || !saved) return c.json({ error: await clashSentence(currentUser.companyId, clash, true), conflictId: clash?.id }, 409)
    const result = await withRelations(saved, currentUser.companyId)
    for (const r of result) emitToCompany(currentUser.companyId, EVENTS.JOB_UPDATED, r)
    return c.json({ data: await shapeJobMoney(c, result) })
  })

  // ---------------------------------------------------------------- photos (before /:id so /:id/photos routes resolve first)
  if (t.jobPhoto && o.storage) {
    const storage = o.storage
    const keyFromUrl = (url: string) => (url || '').startsWith(mediaPrefix) ? url.slice(mediaPrefix.length) : null

    app.post('/:id/photos', requirePermission('jobs:update'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      const form = await c.req.formData().catch(() => null)
      const file = form?.get('photo') as File | null
      if (!file || typeof file === 'string') return c.json({ error: 'No photo provided' }, 400)
      if (file.size > MAX_PHOTO_SIZE) return c.json({ error: 'Photo exceeds 10MB limit' }, 400)
      const buffer = Buffer.from(await file.arrayBuffer())
      // Trust the bytes, not the declared type — a renamed HTML file must not be served as an image. Only the bytes:
      // falling back to the declared type when they weren't an image took an HTML file sent as image/png and stored it
      // as a photo. Roofing's copy had this fixed (templates/crm-roof routes/jobs.ts, M9); now every vertical's is.
      const type = sniffType(buffer) || ''
      if (!PHOTO_EXT[type]) return c.json({ error: 'File must be an image' }, 400)
      // No photo store set up: say so (503), rather than send the photo to an address that isn't there and 500.
      if (storage.storageConfigured && !storage.storageConfigured()) return c.json({ error: 'Photo storage is not set up yet.', code: 'storage_not_configured' }, 503)
      const key = `photos/${currentUser.companyId}/${id}/${crypto.randomUUID().replace(/-/g, '')}.${PHOTO_EXT[type]}`
      await storage.put(key, buffer, type)
      const caption = (form!.get('caption') as string) || null
      const [photo] = await db.insert(t.jobPhoto).values({ companyId: currentUser.companyId, jobId: id, uploadedById: currentUser.userId, url: mediaPrefix + key, caption }).returning()
      return c.json(photo, 201)
    })

    app.get('/:id/photos', requirePermission('jobs:read'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      return c.json(await db.select().from(t.jobPhoto).where(and(eq(t.jobPhoto.jobId, id), eq(t.jobPhoto.companyId, currentUser.companyId))).orderBy(desc(t.jobPhoto.createdAt), asc(t.jobPhoto.id)))
    })

    app.delete('/:id/photos/:photoId', requirePermission('jobs:update'), async (c) => {
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
  app.get('/:id', requirePermission('jobs:read'), async (c) => {
    const currentUser = c.get('user') as any
    const found = await findOwned(c.req.param('id'), currentUser.companyId)
    if (!found) return c.json({ error: 'Job not found' }, 404)
    const [jobProject, jobContact, assignedUser, entries, jobEquipment] = await Promise.all([
      t.project && found.projectId ? db.select().from(t.project).where(and(eq(t.project.id, found.projectId), eq(t.project.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      found.assignedToId ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, email: t.user.email, phone: t.user.phone }).from(t.user).where(and(eq(t.user.id, found.assignedToId), eq(t.user.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      t.timeEntry ? db.select().from(t.timeEntry).where(eq(t.timeEntry.jobId, found.id)).orderBy(desc(t.timeEntry.date), asc(t.timeEntry.id)).limit(10) : Promise.resolve([]),
      t.equipment && found.equipmentId ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model, serialNumber: t.equipment.serialNumber, location: t.equipment.location }).from(t.equipment).where(and(eq(t.equipment.id, found.equipmentId), eq(t.equipment.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
    ])
    // The helper, not a hand-rolled destructure: the copy here dropped the token and kept the Stripe ids in
    // customFields, so every job detail handed them to anyone who could open the job. (T69)
    const safeContact = withoutPortalCredential(jobContact[0] || {})
    // one assignedTo whichever kind of person is on the job — same shape the list gives (T21 M12)
    const [withAssignee] = await withRelations([found], currentUser.companyId)
    // The same rule as the list. Both reads return the whole job row, so both carried the value. (T41)
    const base: any = await shapeJobMoney(c, found)
    if (seriesOn && found.seriesId) base.series = await seriesOf(found, currentUser.companyId)
    // What each person on the job is PAID an hour is the pay run's (payroll:read), as on the team roster (team.ts
    // maySeePay): the time lines stay, their hourlyRate goes for a seat without it — every technician and viewer read
    // the whole crew's rates off any job they could open (live role check sweep, 2026-10-23). Open when the template
    // wired no canSee, as shapeJobMoney is; a check that throws withholds.
    let mayPay = true
    if (deps.canSee) { try { mayPay = !!(await deps.canSee(currentUser.role, 'payroll:read', currentUser.userId)) } catch { mayPay = false } }
    const timeEntries = mayPay ? entries : (entries as any[]).map(({ hourlyRate: _rate, ...e }: any) => e)
    return c.json({ ...base, project: jobProject[0] || null, contact: jobContact[0] ? safeContact : null, assignedTo: assignedUser[0] ? { ...assignedUser[0], name: `${assignedUser[0].firstName || ''} ${assignedUser[0].lastName || ''}`.trim(), kind: 'user' } : withAssignee?.assignedTo || null, timeEntries, assignees: withAssignee?.assignees ?? [], ...(t.equipment ? { equipment: jobEquipment[0] || null } : {}), ...(branches ? { location: withAssignee?.location ?? null } : {}) })
  })

  app.post('/', requirePermission('jobs:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body: any = await c.req.json()
    const data: any = jobSchema.parse(body)
    // A repeat is read beside the job (the job schema knows nothing of it) and refused in words before anything is made.
    const repeat = seriesOn && body?.repeat ? readRepeat(body.repeat, data.scheduledDate) : null
    if (repeat && 'error' in repeat) return c.json({ error: repeat.error, fields: { repeat: repeat.error } }, 400)
    const badBranch = await branchRefusal(currentUser.companyId, data.locationId)
    if (badBranch) return c.json({ error: badBranch }, 400)
    if (data.projectId && t.project && !(await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, data.projectId), eq(t.project.companyId, currentUser.companyId))).limit(1))[0]) {
      return c.json({ error: 'That project does not exist.' }, 404)
    }
    // Who the job is for: the customer named (never a vendor), else the project's (contacts/customer.ts).
    const forWhom = await resolveCustomer(db, t, currentUser.companyId, { contactId: data.contactId, projectId: data.projectId })
    if (!forWhom.ok) return c.json({ error: forWhom.error, ...(forWhom.code ? { code: forWhom.code } : {}) }, forWhom.status)
    if (forWhom.contactId !== undefined) data.contactId = forWhom.contactId
    if (o.requireCustomer && !forWhom.contactId) {
      const error = `Pick the ${o.requireCustomer.word} this ${jobWord} is for — it can't be scheduled, billed or texted without one.`
      return c.json({ error, code: 'customer_required', fields: { contactId: error } }, 400)
    }
    const who = await resolveAssignee(currentUser.companyId, data.assignedToId, data.assignedToMemberId)
    if (who.error) return c.json({ error: who.error }, 400)
    // The other people on the job (otherAssigneeIds), read beside the job as `repeat` is. Nobody leads but someone is
    // on it → the first of them leads (settleCrew).
    let asked: Person[] = []
    if (crewOn && body?.otherAssigneeIds !== undefined && body?.otherAssigneeIds !== null) {
      const read = await readOthers(currentUser.companyId, body.otherAssigneeIds)
      if ('error' in read) return c.json({ error: read.error, fields: { otherAssigneeIds: read.error } }, 400)
      asked = read.people
    }
    const crew = settleCrew(leadOf(who), asked)
    data.assignedToId = crew.lead?.userId ?? null
    if (t.teamMember) data.assignedToMemberId = crew.lead?.memberId ?? null
    else delete data.assignedToMemberId
    const everyone: Person[] = crew.lead ? [crew.lead, ...crew.others] : []
    const bookAnyway = body?.bookAnyway === true
    let travel: any = null
    // Conflict check + insert run in ONE transaction under the per-company job lock, so two concurrent
    // New-Job requests for the same tech/slot can't both pass the check and double-book (the check ran
    // outside the write before, so a race stacked two jobs at 10:00). (FS double-booking race)
    let clash: any = null
    // A repeating job's visits that could not be booked for their assignee, listed back rather than silently made.
    const skipped: Array<{ date: string; reason: string }> = []
    let seriesRow: any = null
    let made = 0
    const insertOne = async (tx: any, scheduledDate: string | undefined, extra: Record<string, unknown> = {}) => {
      const number = await nextNumber(tx, t.job, t.job.number, t.job.companyId, currentUser.companyId, { prefix, pad })
      const [row] = await tx.insert(t.job).values({
        ...data,
        ...(o.defaultJobType && t.job.jobType && !(data as any).jobType ? { jobType: o.defaultJobType } : {}),
        number,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        estimatedHours: data.estimatedHours !== undefined ? String(data.estimatedHours) : null,
        // decimal columns take a string, the same as estimatedHours above — and only on a vertical
        // whose job table actually has the column (T32 M7).
        ...(t.job.estimatedValue ? { estimatedValue: data.estimatedValue !== undefined ? String(data.estimatedValue) : null } : { estimatedValue: undefined }),
        companyId: currentUser.companyId,
        createdById: currentUser.userId,
        ...extra,
      }).returning()
      return row
    }
    const created = await db.transaction(async (tx: any) => {
      await jobLock(tx, currentUser.companyId)
      if (repeat && 'spec' in repeat) {
        /**
         * EVERY VISIT, ON THE CALENDAR, NOW. (live test 2026-10-22: "jobs have no repeat option")
         *
         * The series' days (time/series.ts — the booking engine's stepping) become job rows in this one transaction,
         * under the same lock and the same overlap check as a single job, each numbered like any other. A day the
         * assignee is already booked is listed back, not made; if none can be made, nothing is.
         */
        const days = seriesDays({ ...repeat.spec, max: MAX_SERIES })
        ;[seriesRow] = await tx.insert(t.jobSeries).values({
          companyId: currentUser.companyId, frequency: repeat.spec.frequency, intervalCount: repeat.spec.intervalCount,
          firstDate: repeat.spec.firstDate, occurrencesCount: repeat.spec.occurrencesCount ?? null, untilDate: repeat.spec.untilDate ?? null,
          createdById: currentUser.userId,
        }).returning()
        let first: any = null
        for (const day of days) {
          const other = await assigneeConflict(currentUser.companyId, everyone, day.date, data.scheduledTime, undefined, tx, data.estimatedHours)
          if (other) { clash = clash || other; skipped.push({ date: day.date, reason: `already booked on ${other.number}${other.scheduledTime ? ` at ${other.scheduledTime}` : ''}` }); continue }
          const row = await insertOne(tx, day.date, { seriesId: seriesRow.id, seriesIndex: day.index })
          await writeOthers(tx, currentUser.companyId, row.id, crew.others)
          made++
          if (!first) first = row
        }
        if (!first) { await tx.delete(t.jobSeries).where(eq(t.jobSeries.id, seriesRow.id)); seriesRow = null; return null }
        clash = null
        return first
      }
      clash = await assigneeConflict(currentUser.companyId, everyone, data.scheduledDate, data.scheduledTime, undefined, tx, data.estimatedHours)
      if (clash) return null
      // Not an overlap, but no time to get there: a warning, booked past only when the office says so.
      travel = await travelWarning(currentUser.companyId, everyone, data.scheduledDate, data.scheduledTime, data.estimatedHours, { address: data.address ?? null }, undefined, tx)
      // …or a person who is off that day or outside their hours (JobOptions.availability): the same kind of warning.
      if (!travel && o.availability) travel = await o.availability(currentUser.companyId, everyone, data.scheduledDate, data.scheduledTime, data.estimatedHours, tx)
      if (travel && !bookAnyway) return null
      const row = await insertOne(tx, data.scheduledDate)
      await writeOthers(tx, currentUser.companyId, row.id, crew.others)
      return row
    })
    // Name the call AND when it starts: the clash is now an overlap, so "at this time" would be a lie
    // for a 09:30 call refused because an 09:00 two-hour one is already there. (FS T28 H1)
    if (clash) return c.json({ error: await clashSentence(currentUser.companyId, clash, everyone.length > 1), conflictId: clash.id }, 409)
    if (!created && travel && !bookAnyway) return travelRefusal(c, travel)
    if (created && travel) recordOverride(c, created, travel)
    if (!created && repeat && 'spec' in repeat) return c.json({ error: `None of the visits could be booked: that person is ${skipped[0]?.reason || 'already booked'}. Pick another time or assignee.` }, 409)
    const [result] = await withRelations([created], currentUser.companyId)
    emitToCompany(currentUser.companyId, EVENTS.JOB_CREATED, result)
    // The saved row comes back whole; a write's reply is a read like any other (./jobMoney.ts).
    const reply: any = await shapeJobMoney(c, result)
    if (seriesRow) reply.series = { id: seriesRow.id, summary: describeSeriesDays(seriesRow), made, skipped }
    return c.json(reply, 201)
  })

  app.put('/:id', requirePermission('jobs:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    // The edit form posts back exactly what the API returned, including null for empty relations;
    // optional string fields reject null, so map null → undefined (clearing a field uses '').
    const raw = (await c.req.json().catch(() => null)) ?? {}
    const data: any = partialOf(jobSchema).parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === null ? undefined : v])))
    // On an EDIT, '' (or null) on a link means "clear it" — the schema maps '' to undefined, which leaves the field
    // alone, so Unassign and clearing the customer/project silently did nothing. All three columns are nullable.
    for (const k of ['assignedToId', 'assignedToMemberId', 'contactId', 'projectId', ...(branches ? ['locationId'] as const : [])] as const) {
      if (Object.prototype.hasOwnProperty.call(raw, k) && (raw[k] === '' || raw[k] === null)) data[k] = null
    }
    const existing = await findOwned(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Job not found' }, 404)
    const badBranch = await branchRefusal(currentUser.companyId, data.locationId)
    if (badBranch) return c.json({ error: badBranch }, 400)
    if (data.projectId && t.project && !(await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, data.projectId), eq(t.project.companyId, currentUser.companyId))).limit(1))[0]) {
      return c.json({ error: 'That project does not exist.' }, 404)
    }
    // Who the job is for, on an edit: the customer named (never a newly chosen vendor), else the one it has, else —
    // having none — the project's (contacts/customer.ts).
    const forWhom = await resolveCustomer(db, t, currentUser.companyId, { contactId: data.contactId, projectId: data.projectId }, existing)
    if (!forWhom.ok) return c.json({ error: forWhom.error, ...(forWhom.code ? { code: forWhom.code } : {}) }, forWhom.status)
    if (forWhom.contactId !== undefined) data.contactId = forWhom.contactId
    // Only TAKING the customer off a job that has one is refused; a job saved without one is still edited freely.
    if (o.requireCustomer && forWhom.contactId === null) {
      const error = `A ${jobWord} needs a ${o.requireCustomer.word} — pick another one instead of leaving it empty.`
      return c.json({ error, code: 'customer_required', fields: { contactId: error } }, 400)
    }

    /**
     * `jobs:update` IS NOT PERMISSION TO REPRICE THE JOB. (T32 M7)
     *
     * `field` holds jobs:read and jobs:update so a technician can run the work: move it along its
     * statuses, add notes, log what happened. The report used the same right to PUT
     * `{ estimatedValue: 1 }` and dropped JOB-00119 from $11,183 to $1 — a 200 — which then feeds
     * straight into job costing's revenue and variance (T32 B3) and the project's contract value.
     *
     * So the money fields on a job need the right that the rest of the money needs. `quotes:update`
     * is the one asked for: a job's estimated value is the quoted figure carried onto the work, held
     * by manager and above, and NOT by field or viewer. The alternative — a new `jobs:price`
     * resource — would be a third thing to keep in sync for one field.
     *
     * Refused rather than silently dropped. A technician who meant to change something and had it
     * ignored would come back to the same screen and try again.
     */
    const MONEY_FIELDS = ['estimatedValue', 'actualValue', 'estimatedHours'] as const
    /**
     * Compared as NUMBERS, to the cent. These are decimal columns, so the row holds "11183.00" and
     * the edit form posts back 11183 — and the form posts the WHOLE record, so a string comparison
     * refused a technician who only changed a note. My own test caught that before it shipped; it
     * would have read as "field can no longer edit a job" rather than as a money rule.
     */
    const sameMoney = (a: unknown, b: unknown) => {
      if (a === undefined || a === null || a === '') return b === undefined || b === null || b === ''
      const x = Number(a), y = Number(b)
      return Number.isFinite(x) && Number.isFinite(y) && Math.round(x * 100) === Math.round(y * 100)
    }
    const touchedMoney = MONEY_FIELDS.filter((k) => data[k] !== undefined && !sameMoney(data[k], (existing as any)[k]))
    if (touchedMoney.length && !(await maySetJobMoney(c))) {
      return c.json({
        error: `Changing what a ${jobWord} is worth needs the same right as pricing a quote. Ask a manager to change ${touchedMoney.join(', ')}.`,
        code: 'job_money_not_permitted',
        fields: touchedMoney,
        required: JOB_MONEY_PERMISSION,
      }, 403)
    }

    // Either field can carry the new assignee; touching either one replaces whoever was on the job, so a job
    // never ends up with a login user AND a roster member on it. (Landscaping T21 M12)
    const touchesAssignee = data.assignedToId !== undefined || data.assignedToMemberId !== undefined
    let who: Assignee = { assignedToId: existing.assignedToId ?? null, assignedToMemberId: existing.assignedToMemberId ?? null }
    if (touchesAssignee) {
      who = await resolveAssignee(currentUser.companyId, data.assignedToId, data.assignedToMemberId)
      if (who.error) return c.json({ error: who.error }, 400)
    }
    // The other people: replaced when the edit sends otherAssigneeIds, else kept. A new lead who was one of the others
    // leaves the others (never both); a lead taken off a job others are still on hands it to the first of them.
    const touchesCrew = crewOn && raw.otherAssigneeIds !== undefined && raw.otherAssigneeIds !== null
    let asked: Person[] = []
    if (touchesCrew) {
      const read = await readOthers(currentUser.companyId, raw.otherAssigneeIds)
      if ('error' in read) return c.json({ error: read.error, fields: { otherAssigneeIds: read.error } }, 400)
      asked = read.people
    }
    const before = await othersOf(id)
    /**
     * `jobs:update` IS NOT PERMISSION TO DISPATCH THE JOB. (HVAC live role test 2026-10-24)
     *
     * A field seat runs its own work — status, notes, photos, the checklist — and that right let a technician PUT their
     * job onto somebody else (a 200, and the job left their view) and move its day. Who does it and when are the
     * office's: `jobs:dispatch` (managers and up hold it through jobs:*; field does not). Compared with what the job has,
     * so the edit form posting the whole record back unchanged is never refused. Refused, with the fields, not dropped.
     */
    const sameDay = (v: unknown) => String(v).slice(0, 10) === (existing.scheduledDate ? new Date(existing.scheduledDate).toISOString().slice(0, 10) : '')
    const key = (p: Person | null) => (p ? personId(p) : '')
    const dispatchTouched = [
      ...(touchesAssignee && key(leadOf(who)) !== key(leadOf({ assignedToId: existing.assignedToId ?? null, assignedToMemberId: existing.assignedToMemberId ?? null })) ? ['assignedToId'] : []),
      ...(touchesCrew && [...asked.map(key)].sort().join(',') !== [...before.map(key)].sort().join(',') ? ['otherAssigneeIds'] : []),
      ...(data.scheduledDate !== undefined && !sameDay(data.scheduledDate ?? '') ? ['scheduledDate'] : []),
      ...(data.scheduledTime !== undefined && String(data.scheduledTime ?? '') !== String(existing.scheduledTime ?? '') ? ['scheduledTime'] : []),
    ]
    if (dispatchTouched.length && !(await mayDispatch(c))) return dispatchRefusal(c, dispatchTouched, jobWord)
    const crew = settleCrew(leadOf(who), touchesCrew ? asked : before)
    const crewChanged = touchesCrew || touchesAssignee
    if (crewChanged) {
      data.assignedToId = crew.lead?.userId ?? null
      if (t.teamMember) data.assignedToMemberId = crew.lead?.memberId ?? null
      else delete data.assignedToMemberId
    }
    const everyone: Person[] = crew.lead ? [crew.lead, ...crew.others] : []
    // Check the resulting assignee/date/time (only the fields the edit changed override the existing).
    const effDate = data.scheduledDate !== undefined ? data.scheduledDate : existing.scheduledDate
    const effTime = data.scheduledTime !== undefined ? data.scheduledTime : existing.scheduledTime
    // The length matters as much as the start: shortening or lengthening a call changes what it overlaps,
    // so the re-check uses the duration the job will HAVE, not the one it had. (FS T28 H1)
    const effHours = data.estimatedHours !== undefined ? data.estimatedHours : existing.estimatedHours
    // Re-check + update in one transaction under the same per-company job lock, so a concurrent write
    // (create or edit) can't sneak the same tech/slot in between the check and the update.
    let clash: any = null
    /**
     * The travel check runs when the edit changes WHEN, HOW LONG, WHO or WHERE — never on a status or a note, so a
     * technician starting a job the office already booked past a warning is not warned again.
     */
    const differs = (k: string, v: unknown) => v !== undefined && String(v ?? '') !== String((existing as any)[k] ?? '')
    const placeChanged = ['address', 'city', 'state', 'zip'].some((k) => differs(k, data[k]))
    const movesSlot = crewChanged || placeChanged || differs('scheduledTime', data.scheduledTime) || differs('estimatedHours', data.estimatedHours)
      || (data.scheduledDate !== undefined && String(data.scheduledDate).slice(0, 10) !== (existing.scheduledDate ? new Date(existing.scheduledDate).toISOString().slice(0, 10) : ''))
    // A moved address is somewhere else: its old map point would put pins and routes in the wrong place.
    if (placeChanged && t.job.lat) { data.lat = null; data.lng = null }
    const here: Place = placeChanged ? { address: data.address ?? existing.address ?? null } : { lat: existing.lat ?? null, lng: existing.lng ?? null, address: existing.address ?? null }
    const bookAnyway = raw.bookAnyway === true
    let travel: any = null
    const updated = await db.transaction(async (tx: any) => {
      await jobLock(tx, currentUser.companyId)
      clash = await assigneeConflict(currentUser.companyId, everyone, effDate, effTime, id, tx, effHours)
      if (clash) return null
      if (movesSlot) {
        travel = await travelWarning(currentUser.companyId, everyone, effDate, effTime, effHours, here, id, tx)
        if (!travel && o.availability) travel = await o.availability(currentUser.companyId, everyone, effDate, effTime, effHours, tx)
        if (travel && !bookAnyway) return null
      }
      if (crewChanged) await writeOthers(tx, currentUser.companyId, id, crew.others)
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
        ...(t.job.estimatedValue ? { estimatedValue: data.estimatedValue !== undefined ? String(data.estimatedValue) : undefined } : { estimatedValue: undefined }),
        ...(completedAt !== undefined ? { completedAt } : {}),
        updatedAt: new Date(),
      }).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId))).returning()
      return row
    })
    // Name the call AND when it starts: the clash is now an overlap, so "at this time" would be a lie
    // for a 09:30 call refused because an 09:00 two-hour one is already there. (FS T28 H1)
    if (clash) return c.json({ error: await clashSentence(currentUser.companyId, clash, everyone.length > 1), conflictId: clash.id }, 409)
    if (!updated && travel && !bookAnyway) return travelRefusal(c, travel)
    if (updated && travel) recordOverride(c, updated, travel)
    const [result] = await withRelations([updated], currentUser.companyId)
    emitToCompany(currentUser.companyId, EVENTS.JOB_UPDATED, result)
    /**
     * A STATUS IS REACHED ONE WAY, WHICHEVER DOOR. (live test 2026-10-22: no review request when a job completed)
     *
     * Complete, Start and Dispatch ran their hooks (the review request, the next agreement visit, the customer's
     * texts) only through POST /:id/complete|start|dispatch. The edit form's status box and the Dispatch Board both
     * PUT the status here, so a job completed that way asked nobody for a review and made no next visit. Moving INTO a
     * status now runs that status's hook here too; staying in it runs nothing.
     */
    const more = data.status !== undefined && data.status !== existing.status ? await runHook(hookFor(data.status), updated, currentUser) : {}
    // A field seat holds jobs:update: the saved row's money is withheld as the read's is (./jobMoney.ts).
    return c.json({ ...(await shapeJobMoney(c, result)), ...more })
  })

  app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
    await db.delete(t.job).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId)))
    emitToCompany(currentUser.companyId, EVENTS.JOB_DELETED, { id })
    return c.body(null, 204)
  })

  // ---------------------------------------------------------------- repeating jobs
  /**
   * What a series is, for the job page: "Every week, 12 times — visit 3 of 12, 9 still to come".
   * `upcoming` counts the visits after this one that are still open; those are what Stop cancels.
   */
  async function seriesOf(visit: any, companyId: string) {
    const [row] = await db.select().from(t.jobSeries).where(and(eq(t.jobSeries.id, visit.seriesId), eq(t.jobSeries.companyId, companyId))).limit(1)
    if (!row) return null
    const visits = await db.select({ id: t.job.id, status: t.job.status, scheduledDate: t.job.scheduledDate }).from(t.job)
      .where(and(eq(t.job.companyId, companyId), eq(t.job.seriesId, row.id)))
    const after = (v: any) => !!v.scheduledDate && !!visit.scheduledDate && new Date(v.scheduledDate).getTime() > new Date(visit.scheduledDate).getTime()
    const upcoming = visits.filter((v: any) => after(v) && !SERIES_DONE.includes(String(v.status))).length
    return { id: row.id, summary: describeSeriesDays(row), status: row.status, index: visit.seriesIndex ?? null, total: visits.length, upcoming }
  }
  /** A visit already under way or over is never cancelled by stopping its series. */
  const SERIES_DONE = ['in_progress', 'completed', 'cancelled']
  if (seriesOn) {
    /**
     * Stop the series from this visit on: every LATER visit still open is cancelled (kept, greyed on the calendar, the
     * way a cancelled booking series is — not deleted), and the series is marked stopped. This visit and the earlier
     * ones stay as they are. jobs:update, the right that changes a job's status.
     */
    app.post('/:id/series/stop', requirePermission('jobs:update'), async (c) => {
      const currentUser = (c as any).get('user')
      const visit = await findOwned(c.req.param('id'), currentUser.companyId)
      if (!visit) return c.json({ error: 'Job not found' }, 404)
      if (!visit.seriesId) return c.json({ error: `This ${jobWord} does not repeat.` }, 400)
      const later = and(
        eq(t.job.companyId, currentUser.companyId), eq(t.job.seriesId, visit.seriesId),
        notInArray(t.job.status, SERIES_DONE),
        visit.scheduledDate ? sql`${t.job.scheduledDate} > ${new Date(visit.scheduledDate)}` : sql`false`,
      )
      const cancelled = await db.update(t.job).set({ status: 'cancelled', updatedAt: new Date() }).where(later).returning({ id: t.job.id })
      await db.update(t.jobSeries).set({ status: 'stopped', stoppedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(t.jobSeries.id, visit.seriesId), eq(t.jobSeries.companyId, currentUser.companyId)))
      for (const r of cancelled) emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: r.id, status: 'cancelled' })
      return c.json({ cancelled: cancelled.length, series: await seriesOf(visit, currentUser.companyId) })
    })
  }

  // ---------------------------------------------------------------- lifecycle
  /**
   * The buttons only move a job FORWARD (JOB_MOVES_FROM): a repeat is nothing (no write, no hook — the customer is not
   * texted "on my way" twice, an agreement's next visit is not made twice) and a move backwards is refused in words.
   * Reopening a finished job is a deliberate edit (PUT /:id, the status field). The move is one conditional UPDATE, so
   * two taps at once — or a phone's queued "start" arriving after the office completed the job — cannot both win.
   * Before 10/30 every tap wrote and re-ran the hook, and a late tap reverted a completed job (field service PR #169).
   */
  const transition = (path: string, status: keyof typeof JOB_MOVES_FROM, hook: () => JobHook | undefined, extra: () => Record<string, any> = () => ({})) => {
    app.post(`/:id/${path}`, requirePermission('jobs:update'), async (c) => {
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
      }).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId), inArray(t.job.status, [...JOB_MOVES_FROM[status]]))).returning()
      if (!updated) {
        const now = await findOwned(id, currentUser.companyId)
        if (!now) return c.json({ error: 'Job not found' }, 404)
        if (now.status === status) return c.json({ ...(await shapeJobMoney(c, now)), unchanged: true })
        return c.json({ error: jobMoveRefusal(status, String(now.status)), code: 'JOB_MOVE_REFUSED', status: now.status }, 409)
      }
      emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status })
      const more = await runHook(hook(), updated, currentUser)
      // Start / Complete / Dispatch are a field seat's buttons; the moved row's money is withheld (./jobMoney.ts).
      return c.json({ ...(await shapeJobMoney(c, updated)), ...more })
    })
  }
  transition('start', 'in_progress', () => hookFor('in_progress'))
  transition('complete', 'completed', () => hookFor('completed'), () => ({ completedAt: new Date() }))
  transition('dispatch', 'dispatched', () => hookFor('dispatched'))

  /**
   * POST /:id/invoice — bill this job. Mounted only where options.billing says the template can. (T41)
   *
   * BILL ONCE, UNDER A LOCK. The whole handler runs inside one transaction, takes `FOR UPDATE` on
   * the job row, and re-checks for an existing invoice INSIDE the lock — because the T41 round found
   * exactly this shape raising two invoices for one piece of work on two different modules (a vet
   * visit and a quote conversion), both of which read "already billed?" outside the transaction and
   * lost the race. PGlite serialises requests so no suite in this repo can observe that race; the
   * rule is enforced statically instead, by scripts/check-billing-race-guarded.ts.
   *
   * The unique partial index on invoice.job_id (migration 0025) sits underneath as a backstop.
   *
   * WHAT IT BILLS. The quote behind the job when there is one — its lines, its tax rate and its
   * discount, the same thing convert-to-invoice copies — and otherwise the job's estimated value as
   * a single line at the company's default tax rate. Never its actual cost: cost is what the work
   * took us, and billing a customer our cost would be a different and wrong number. A quoteless job
   * with no value recorded is refused rather than invoiced for $0.00, because a zero invoice is
   * indistinguishable from a mistake. See the long note at the billing step for what T42 measured.
   */
  if (o.billing && t.invoice && t.invoiceLineItem) {
    const numbering = { prefix: 'INV', pad: 5, seed: 0, ...(o.billing.numbering || {}) }
    const termsDays = o.billing.termsDays ?? 30
    const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]

    app.post('/:id/invoice', requirePermission('invoices:create'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      // Read before the transaction opens (a pool read inside it deadlocks a one-connection database): the codes the
      // quote's lines may carry, kept off the invoice (invoicing/itemCodes.ts).
      const codes = await itemCodes(db, currentUser.companyId)

      const outcome = await db.transaction(async (tx: any) => {
        // Scoped to the company, so one tenant cannot lock another's row by guessing an id.
        const locked = rowsOf(await tx.execute(
          sql`SELECT id, contact_id, number, title, estimated_value, completed_at, quote_id
                FROM job
               WHERE id = ${id} AND company_id = ${currentUser.companyId}
                 FOR UPDATE`,
        ))
        const j = locked[0]
        if (!j) return { status: 404 as const, body: { error: 'Job not found' } }
        if (!j.contact_id) return { status: 400 as const, body: { error: 'This job has no customer to bill. Add one first.' } }

        /**
         * Already billed? Asked INSIDE the lock, and against BOTH doors — which the comment here
         * has always claimed and the query did not do: it looked at `job_id` only. A job that came
         * from a quote has two ways to become an invoice, and converting the quote and then billing
         * the job produced TWO invoices for one piece of work. On the field-service test tenant
         * both doors had been used: INV-00171 through the quote, INV-00170 and INV-00172 through
         * the job. (T42)
         */
        const already = rowsOf(await tx.execute(
          j.quote_id
            ? sql`SELECT id, number, job_id FROM invoice
                   WHERE company_id = ${currentUser.companyId}
                     AND (job_id = ${id} OR quote_id = ${j.quote_id}) LIMIT 1`
            : sql`SELECT id, number, job_id FROM invoice
                   WHERE company_id = ${currentUser.companyId} AND job_id = ${id} LIMIT 1`,
        ))
        if (already.length) {
          const a = already[0]
          const error = a.job_id === id
            ? `This job is already billed on invoice ${a.number}.`
            : `The quote behind this job was already billed on invoice ${a.number}.`
          return { status: 409 as const, body: { error, invoiceId: a.id } }
        }

        /**
         * WHAT IT BILLS — and why this is no longer one untaxed line. (T42)
         *
         *   "Invoicing from a completed job collapses the lines into one and drops the tax
         *    (INV-00170, INV-00172: $178 instead of $191.35)"
         *
         * When this route was added the job was taken to be the whole story: its estimated value as
         * a single line, taxRate hard-coded to 0. For a call with no quote behind it that is all
         * there is — but a job CARRIES `quote_id`, and a job that came from a quote has the real
         * lines, the real tax rate and the agreed discount sitting on that quote. Billing the
         * estimate instead threw all three away: measured on the live tenant, the quote path wrote
         * 2 lines at 7.5% for $191.35 and the job path wrote 1 line at 0% for $178.00 — the job's
         * estimated value having been set to the quote's SUBTOTAL.
         *
         * So: bill the quote's lines when there is a quote, exactly as convert-to-invoice does, and
         * carry `quoteId` onto the invoice so job costing and the duplicate check above can both
         * see where the money came from. Otherwise the estimate as one line — taxed at the
         * company's own default rate rather than zero, which is the other half of "drops the tax".
         *
         * Read through `tx`, never through `db`: a helper that queries the pool while this
         * transaction is open deadlocks a single-connection database, which is why the quote and
         * the settings are fetched with raw SQL here instead of through the quotes module's
         * `companySettings`.
         */
        let lines: Array<{ description: string; quantity: number; unitPrice: number }> | null = null
        let taxRate = 0
        let discount = 0
        let quoteId: string | null = null
        if (j.quote_id) {
          const q = rowsOf(await tx.execute(
            sql`SELECT id, tax_rate, discount FROM quote
                 WHERE id = ${j.quote_id} AND company_id = ${currentUser.companyId} LIMIT 1`,
          ))[0]
          const qLines = q ? rowsOf(await tx.execute(
            sql`SELECT description, quantity, unit_price FROM quote_line_item
                 WHERE quote_id = ${q.id} ORDER BY sort_order ASC`,
          )) : []
          if (q && qLines.length) {
            lines = qLines.map((r: any) => ({
              description: withoutItemCodes(r.description || '', codes),
              quantity: Number(r.quantity || 0),
              unitPrice: Number(r.unit_price || 0),
            }))
            taxRate = Number(q.tax_rate || 0)
            discount = Number(q.discount || 0)
            quoteId = String(q.id)
          }
        }
        if (!lines) {
          const amount = round2(Number(j.estimated_value || 0))
          if (!amount || amount <= 0) {
            return { status: 400 as const, body: { error: 'This job has no value to bill. Set what the work is worth, then invoice it.' } }
          }
          const settings = rowsOf(await tx.execute(
            sql`SELECT settings FROM company WHERE id = ${currentUser.companyId} LIMIT 1`,
          ))[0]?.settings
          taxRate = defaultTaxRateFrom((settings as any) || {})
          lines = [{
            description: j.title ? `${j.title}${j.number ? ` (${j.number})` : ''}` : `Service call ${j.number || ''}`.trim(),
            quantity: 1,
            unitPrice: amount,
          }]
        }

        const issueDate = new Date()
        const dueDate = new Date(issueDate.getTime() + termsDays * 86_400_000)
        const inv = await insertInvoice(
          tx,
          { invoice: t.invoice, invoiceLineItem: t.invoiceLineItem } as any,
          numbering,
          {
            companyId: currentUser.companyId,
            contactId: j.contact_id,
            issueDate, dueDate,
            taxRate, discount, status: 'draft',
            // The links that make the revenue reach the job AND the quote in job costing.
            extra: { jobId: id, ...(quoteId ? { quoteId } : {}) },
          },
          lines as any,
        )
        return { status: 201 as const, body: inv }
      })

      if (outcome.status === 201) emitToCompany(currentUser.companyId, EVENTS.JOB_UPDATED, { id })
      return c.json(outcome.body, outcome.status)
    })
  }

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
