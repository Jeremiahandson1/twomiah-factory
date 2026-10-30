// Roofing's jobs at /api/jobs, over the CRM's own job table (docs/UNIFIED_ROOF_PLAN.md decision 2). Moved from
// templates/crm-roof/backend/src/routes/jobs.ts; mounted for the roof vertical in place of the shared jobs module
// (server/modules/crm.ts, CrmSettings.roof). The registry signs the person in and applies the 'jobs' gate.
//
// Roofing's behaviour, kept: the pipeline (lead → … → collected) with Advance texting the homeowner at each stage,
// closing a job as lost or cancelled with a reason and reopening it, a job's money withheld by permission, photos
// with a type, notes and the timeline.
//
// Changes from the template:
//   · roofing's job_number / property_address / estimated_revenue are the CRM's number / address / estimated_value,
//     and the CRM's required title is the property address (what a roofer calls a job);
//   · a contact has one `name` (decision 3): the list's and the job's contact is { id, name }, a homeowner's first
//     name in a text is its first word, and search matches the name;
//   · numbers come from the shared nextNumber (numeric, only forwards, locked against two creates at once): the
//     template took the text MAX of job_number, which sorts ROOF-10000 below ROOF-9999 and would have issued 10000
//     twice;
//   · a job's money is the shared rule (packages/tenant-backend jobs/jobMoney.ts), the one every read of a job uses;
//     the list no longer carries `moneyWithheld` / `costWithheld` beside its { data, pagination } (RULEBOOK §3) — the
//     screen knows them from the same permissions (invoices:read, margin:read);
//   · a photo's type is read from its bytes by the shared sniffType, stored where every job photo is (the private
//     bucket, served by /media); a quote or invoice on the job is the CRM's;
//   · pipeline texts go through the shared SMS sender (it refuses an opted-out homeowner and a shop with texting not
//     set up) and link the homeowner's own portal when the office has given them one — the template linked a
//     /portal login page the CRM's portal (a private link per customer) doesn't have;
//   · the timeline's texts are the homeowner's conversation (the CRM files a text under the contact, not a job);
//   · lists ( /types, a job's photos, its timeline ) are { data, pagination };
//   · every read asks jobs:read, as the shared jobs module's do (the template's reads asked only that you were signed in).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, gt } from 'drizzle-orm'
import { companyTimeZone, nextNumber, normalizeDateInput, sniffType, withoutPortalCredential, jobMoneyWithheld, withoutJobMoney, normaliseZip, ZIP_ERROR, mayBeGivenWork, resolveCustomer, JOB_DISPATCH_PERMISSION, dispatchRefusal } from '@twomiah/tenant-backend'
import { company, contact, crew, invoice, job, jobNote, jobPhoto, measurementReport, quote, smsConversation, smsMessage, user } from '../../db/schema/index.ts'
import { cleanText, cleanLines } from '../../core/sanitize.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one, listAll } from '../../http/reply.ts'
import { uploadedForm } from '../office/upload.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { ownJobsWhere } from '../ownWork.ts'
import { jobOnDay } from '../../data/dayJobs.ts'
import { ROOF_JOB_TILES, roofTileCondition } from './tiles.ts'
import { AUTO_SMS, createStageEffects } from './stageEffects.ts'
import { loadPipelineConfig, stageLabelFor } from './pipeline.ts'
import { createRoofCommissions } from './commissions.ts'
import { closedBody, jobEvent, reopenedBody, statusChangeBody, withClaimFacts, withClaimFactsOne } from './jobRecord.ts'
import { JOB_PHOTO_TYPES, MEASUREMENT_STAGE, PIPELINE_STATUSES, TERMINAL_STATUSES, firstNameOf, jobStatus, onCompanyClock, optional, phone, pipelineFor } from './validation.ts'
import { partialOf } from '@twomiah/tenant-backend'

const PHOTO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX_PHOTO_SIZE = 10 * 1024 * 1024
const MEDIA_PREFIX = '/media/'

// Date fields arrive as strings from the form; an unparseable one reached Postgres as an Invalid Date and 500'd. '' clears
// the field, a bad value is a 400 naming it. The date of loss is a calendar day (the CRM's day marker, as an invoice's due
// date); the inspection and install are appointments, on the company's clock (./validation.ts onCompanyClock).
// scheduledDate is the job's day on the calendar — the CRM job's own column, a day marker that every calendar, the
// dispatch board and the field view read as the day it names — with scheduledTime the company's wall-clock HH:MM beside
// it. A roofing job could not be booked for a day and time at all (live test 2026-10-22).
const DAY_FIELDS = ['dateOfLoss', 'scheduledDate'] as const
const JOB_DATE_FIELDS = ['dateOfLoss', 'scheduledDate', 'inspectionDate', 'installDate', 'installEndDate'] as const
/** What a Field seat may not change on its own job: who and when (tenant-backend jobs/dispatch.ts). */
const ROOF_DISPATCH_FIELDS = ['assignedSalesRepId', 'assignedCrewId', 'scheduledDate', 'scheduledTime', 'inspectionDate', 'installDate', 'installEndDate'] as const
const jobDates = (data: Record<string, any>, tz: string): { error?: string; values: Record<string, Date | null | undefined> } => {
  const values: Record<string, Date | null | undefined> = {}
  for (const f of JOB_DATE_FIELDS) {
    const r = (DAY_FIELDS as readonly string[]).includes(f) ? normalizeDateInput(data[f]) : onCompanyClock(data[f], tz)
    if (r.error) return { error: `${f}: ${r.error}`, values }
    values[f] = r.value
  }
  return { values }
}

/** The refusal for the measurement stage while Measurement Reports is off (./validation.ts pipelineFor). */
const STAGE_OFF = 'Measurement Ordered is the measurement reports’ stage, and measurement reports are not switched on.'

/**
 * What a roofing job cannot be made without, each with the word the form uses for it. A job is a roof at an address —
 * its title is the address, the crew drives to it, the claim and the permit name it — so the address, city, state and
 * ZIP are all required (the template's rule, kept), and the New Job form marks them. A blank one is refused in those
 * words ("Enter the city, state and ZIP code."), never as the validator's "city: String must contain at least 1
 * character(s)" the form printed raw (live test 2026-10-22).
 */
export const REQUIRED_JOB_FIELDS: Record<string, string> = {
  contactId: 'homeowner', jobType: 'job type', propertyAddress: 'property address', city: 'city', state: 'state', zip: 'ZIP code',
}
const needed = (k: string) => {
  const say = `Enter the ${REQUIRED_JOB_FIELDS[k]}.`
  return z.string({ error: say }).trim().min(1, say)
}

/** "a", "a and b", "a, b and c". */
const spoken = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)

/**
 * A refused job form in plain words: the missing required fields as one sentence, then anything else wrong, each named
 * by its label — with `fields` still marking each box (RULEBOOK §3). Create and edit both answer through it.
 */
function refuseJob(c: any, error: z.ZodError) {
  const fields: Record<string, string> = {}
  const missing: string[] = []
  const other: string[] = []
  for (const i of error.issues) {
    const k = i.path.join('.')
    if (k && !fields[k]) fields[k] = i.message
    const word = REQUIRED_JOB_FIELDS[k]
    if (word && i.message === `Enter the ${word}.`) { if (!missing.includes(word)) missing.push(word); continue }
    const label = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    const said = /^[A-Z]/.test(i.message) || !label ? i.message : `${label[0].toUpperCase()}${label.slice(1)} ${i.message}`
    other.push(/[.!?]$/.test(said) ? said : `${said}.`)
  }
  const sentence = [...(missing.length ? [`Enter the ${spoken(missing)}.`] : []), ...other].join(' ')
  return fail(c, 400, sentence || 'Check the job form.', 'validation_failed', fields)
}

const jobSchema = z.object({
  contactId: needed('contactId'),
  jobType: needed('jobType'),
  propertyAddress: needed('propertyAddress'),
  city: needed('city'),
  state: needed('state'),
  // Required, then well formed (engine: a ZIP is 12345 or 12345-6789); a blank one is "Enter the … ZIP code." only.
  zip: needed('zip').refine((v) => v === '' || normaliseZip(v) !== null, { message: ZIP_ERROR }),
  assignedSalesRepId: z.string().optional().transform((v) => (v === '' ? undefined : v)),
  assignedCrewId: z.string().optional().transform((v) => (v === '' ? undefined : v)),
  status: optional(jobStatus),
  roofAge: z.coerce.number().optional(),
  roofType: z.string().optional(),
  stories: z.coerce.number().optional(),
  claimNumber: z.string().optional(),
  insuranceCompany: z.string().optional(),
  adjusterName: z.string().optional(),
  adjusterPhone: optional(phone),
  dateOfLoss: z.string().optional(),
  deductible: z.coerce.number().optional(),
  rcv: z.coerce.number().optional(),
  acv: z.coerce.number().optional(),
  approvedScope: z.string().optional(),
  estimatedRevenue: z.coerce.number().optional(),
  inspectionDate: z.string().optional(),
  inspectionNotes: z.string().optional(),
  installDate: z.string().optional(),
  installEndDate: z.string().optional(),
  scheduledDate: z.string().optional(),
  scheduledTime: optional(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time, HH:MM (24-hour)')),
  // The roof's size in squares (100 sq ft each): what the crew measured. The insurance scope's quantities are built from
  // it, so it is the job's own fact — not only a measurement report's.
  totalSquares: optional(z.coerce.number().finite().nonnegative()),
  source: z.string().optional(),
  priority: z.string().optional(),
  notes: cleanLines().optional(),
})
type JobInput = z.infer<typeof jobSchema>

/** A form's roofing job → the CRM's job columns (decision 2): the renames, and money as the decimal strings it stores. */
function toColumns(data: Partial<JobInput>, dates: Record<string, Date | null | undefined>): Record<string, unknown> {
  const { propertyAddress, estimatedRevenue, deductible, rcv, acv, totalSquares, dateOfLoss: _l, scheduledDate: _d, inspectionDate: _i, installDate: _s, installEndDate: _e, ...rest } = data
  const out: Record<string, unknown> = { ...rest }
  if (propertyAddress !== undefined) { out.address = propertyAddress; out.title = propertyAddress }
  if (estimatedRevenue !== undefined) out.estimatedValue = estimatedRevenue.toString()
  if (deductible !== undefined) out.deductible = deductible.toString()
  if (rcv !== undefined) out.rcv = rcv.toString()
  if (acv !== undefined) out.acv = acv.toString()
  if (totalSquares !== undefined) out.totalSquares = totalSquares.toString()
  for (const f of JOB_DATE_FIELDS) if (dates[f] !== undefined) out[f] = dates[f]
  return out
}

/**
 * A roofing job, numbered ROOF-0001… by the shared nextNumber (numeric, only forwards, locked against two creates at
 * once) and titled by its property address — the ONE way a roofing job is made: the job form here, a converted storm
 * lead and a canvassing door (field/roofJob.ts). Run inside a transaction. `values` are the CRM's job columns.
 */
export async function insertRoofJob(tx: any, companyId: string, createdById: string | null, values: Record<string, unknown> & { address: string }) {
  const number = await nextNumber(tx, job, job.number, job.companyId, companyId, { prefix: 'ROOF', pad: 4 })
  const [row] = await tx.insert(job).values({
    status: 'lead', priority: 'medium', ...values, title: values.address, number, companyId, createdById,
  } as any).returning()
  return row
}

export function createRoofJobRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()
  // The stage's text to the homeowner, the review ask and the business's switched-on features: shared with the step that
  // collects a job when its invoice is paid (./stageEffects.ts), so Advance and a payment do exactly the same.
  const { companyFeatures, stageReached, textHomeowner } = createStageEffects(d)
  // The rep is paid when the job is Collected (commissions.ts) — also when the office moves it there by hand.
  const roofCommissions = createRoofCommissions(d)
  const payRep = async (companyId: string, jobId: string, stage: string) => {
    if (stage !== 'collected') return
    try { await roofCommissions.earnForJob(companyId, jobId) } catch (err) { d.logger?.warn?.('[roof] commission not earned', { error: (err as Error).message }) }
  }

  const withheldFor = (c: any) => jobMoneyWithheld(canSee, c.get('user'))
  /**
   * WHOSE JOBS THIS SEAT READS — the shared jobs routes' rule (tenant-backend jobs.ts): everyone's with jobs:read-all,
   * else its own (assigned, or the sales rep) and its crews' (crew_login). Roofing's field seat withholds read-all
   * (verticals/roof/settings.ts). The condition, or null for all; a failed check narrows (fails closed).
   */
  const ownScope = async (c: any): Promise<any | null> => {
    const u = c.get('user')
    let all = false
    try { all = !!(await canSee(u.role, 'jobs:read-all', u.userId)) } catch { all = false }
    return all ? null : ownJobsWhere(db, String(u.userId))
  }
  // Every /:id door (read, edit, advance, photos, notes, timeline…) answers 404 for a job outside the seat's own. A path
  // word that is no job id ('types') finds no row and passes through to its own route.
  const ownJobOnly = async (c: any, next: any) => {
    const scope = await ownScope(c)
    if (scope) {
      const where = and(eq(job.id, c.req.param('id')), eq(job.companyId, c.get('user').companyId))
      const [row] = await db.select({ id: job.id }).from(job).where(where).limit(1)
      if (row && !(await db.select({ id: job.id }).from(job).where(and(where, scope)).limit(1))[0]) return fail(c, 404, 'Job not found')
    }
    await next()
  }
  app.use('/:id', ownJobOnly)
  app.use('/:id/*', ownJobOnly)
  const ownContact = async (companyId: string, contactId: string) =>
    !!(await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1))[0]
  /**
   * The homeowner: a contact of this company, never a vendor (tenant-backend contacts/customer.ts — the rule every job,
   * quote and invoice door follows; the picker lists customers only). Only a CHANGE is asked on an edit.
   */
  const homeownerRefusal = async (companyId: string, contactId: string | undefined, current?: string | null) => {
    if (!contactId) return null
    const r = await resolveCustomer(db, { contact }, companyId, { contactId }, { contactId: current ?? null })
    return r.ok ? null : r
  }
  /**
   * The sales rep: a login of this company that can be given work (tenant-backend team/work.ts) — never a view-only seat
   * or a switched-off login. It was stored unchecked. Only a change is asked, so a job keeps saving as it was.
   */
  const repRefusal = async (companyId: string, repId: string | undefined, current?: string | null) => {
    if (!repId || repId === current) return null
    const [u] = await db.select({ id: user.id, role: user.role, isActive: user.isActive }).from(user).where(and(eq(user.id, repId), eq(user.companyId, companyId))).limit(1)
    if (!u) return 'That person is not on this account.'
    return mayBeGivenWork(u) ? null : 'That person’s seat cannot take work (a view-only or switched-off login). Choose someone who can.'
  }
  const ownJob = async (companyId: string, id: string) =>
    (await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, companyId))).limit(1))[0]
  const contactNames = async (companyId: string, ids: string[]) => {
    if (!ids.length) return {} as Record<string, { id: string; name: string }>
    const rows = await db.select({ id: contact.id, name: contact.name }).from(contact)
      .where(and(eq(contact.companyId, companyId), inArray(contact.id, ids)))
    return Object.fromEntries(rows.map((r: any) => [r.id, r]))
  }

  /**
   * What each job's own documents say it is worth (live test 2026-10-22: a job showed "No quotes", Reports $0 Avg Job
   * Value and $0 Pipeline Value against $9,125.75 invoiced — a roofer prices a job with a quote and bills it with an
   * invoice, and nothing carried either figure to the job):
   *   · invoicedValue — the job's invoices that went out: every one not draft and not void, refunded included (the rule
   *     GET /api/invoices/stats counts "invoiced" by);
   *   · quotedValue   — the job's newest approved quote, else its newest quote still open (not rejected, declined or
   *     expired), without the tax: tax is the state's money, not what the job is worth (the rule convert-to-job uses).
   * Options on one job (good / better / best) are not added together: the newest stands for the job.
   */
  const DEAD_QUOTE = ['rejected', 'declined', 'expired']
  async function documentValues(companyId: string, jobIds: string[]) {
    const invoiced: Record<string, number> = {}
    const quoted: Record<string, number> = {}
    if (jobIds.length) {
      const [invs, quotes] = await Promise.all([
        db.select({ jobId: invoice.jobId, total: invoice.total, status: invoice.status }).from(invoice)
          .where(and(eq(invoice.companyId, companyId), inArray(invoice.jobId, jobIds))),
        db.select({ jobId: quote.jobId, total: quote.total, taxAmount: quote.taxAmount, status: quote.status, createdAt: quote.createdAt }).from(quote)
          .where(and(eq(quote.companyId, companyId), inArray(quote.jobId, jobIds))).orderBy(desc(quote.createdAt), desc(quote.id)),
      ])
      for (const i of invs as any[]) {
        if (i.status === 'draft' || i.status === 'void') continue
        invoiced[i.jobId] = Math.round(((invoiced[i.jobId] || 0) + Number(i.total || 0)) * 100) / 100
      }
      const pick: Record<string, any> = {}
      for (const q of quotes as any[]) {
        if (DEAD_QUOTE.includes(q.status)) continue
        if (!pick[q.jobId] || (q.status === 'approved' && pick[q.jobId].status !== 'approved')) pick[q.jobId] = q
      }
      for (const [id, q] of Object.entries(pick)) quoted[id] = Math.round((Number(q.total || 0) - Number(q.taxAmount || 0)) * 100) / 100
    }
    return (id: string) => ({ quotedValue: quoted[id] ?? null, invoicedValue: invoiced[id] ?? null })
  }

  // GET / — jobs, filtered; "My jobs" (?mine=1) are the jobs this person is the sales rep on, read from the session.
  // (A crew's logins are crew_login rows since 2026-10-24; a field seat's own-jobs scope below reads them.)
  app.get('/', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const q = c.req.query()
    const page = Math.max(parseInt(q.page || '1') || 1, 1)
    const limit = Math.max(parseInt(q.limit || '50') || 50, 1)
    const conditions: any[] = [eq(job.companyId, me.companyId)]
    // ?tile= is a home-screen tile's own rows (./tiles.ts — the dashboard's count uses the same conditions).
    if (q.tile && !(ROOF_JOB_TILES as readonly string[]).includes(q.tile)) return fail(c, 400, `"${q.tile}" is not a tile this CRM uses. Choose one of: ${ROOF_JOB_TILES.join(', ')}.`)
    if (q.tile) conditions.push(roofTileCondition(q.tile, await companyTimeZone(db, me.companyId))!)
    if (q.status) conditions.push(eq(job.status, q.status))
    if (q.jobType) conditions.push(eq(job.jobType, q.jobType))
    if (q.assignedSalesRepId) conditions.push(eq(job.assignedSalesRepId, q.assignedSalesRepId))
    if (q.assignedCrewId) conditions.push(eq(job.assignedCrewId, q.assignedCrewId))
    if (q.mine === '1') conditions.push(eq(job.assignedSalesRepId, me.userId))
    // A seat without jobs:read-all lists its own and its crews' jobs only (the pipeline board reads this list too).
    const scope = await ownScope(c)
    if (scope) conditions.push(scope)
    // One customer's jobs (the quote form's Job picker, a contact's page).
    if (q.contactId) conditions.push(eq(job.contactId, q.contactId))
    // One day, the company's (?date=YYYY-MM-DD) — the rule every other CRM's jobs list uses (packages/tenant-backend
    // jobs.ts, jobLocalDay). Roofing ignored it, so the phone's Schedule day listed every job (10/30).
    if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && !isNaN(new Date(`${q.date}T00:00:00Z`).getTime())) {
      conditions.push(jobOnDay(q.date, await companyTimeZone(db, me.companyId)))
    }
    // The calendar's week (the shared Schedule page sends ?startDate&endDate, as for every CRM's jobs).
    if (q.startDate) { const d = new Date(q.startDate); if (!isNaN(d.getTime())) conditions.push(gte(job.scheduledDate, d)) }
    if (q.endDate) { const d = new Date(q.endDate); if (!isNaN(d.getTime())) conditions.push(lte(job.scheduledDate, d)) }
    if (q.search) {
      // Case-insensitive, and the homeowner's name too — looking a job up by who it's for is how a roofer finds it.
      const pattern = `%${q.search}%`
      const named = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, me.companyId), ilike(contact.name, pattern)))
      conditions.push(or(
        ilike(job.number, pattern), ilike(job.address, pattern), ilike(job.notes, pattern),
        ...(named.length ? [inArray(job.contactId, named.map((r: any) => r.id))] : []),
      )!)
    }
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(job).where(where).orderBy(desc(job.createdAt), asc(job.id)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(job).where(where),
    ])
    const names = await contactNames(me.companyId, [...new Set(rows.map((j: any) => j.contactId).filter(Boolean))] as string[])
    const values = await documentValues(me.companyId, rows.map((j: any) => j.id))
    // A job's money is not part of reading the job list (T41/T42): Reports built revenue by rep and by crew in the
    // browser from this list, so fetching it was enough to disclose them. quotedValue / invoicedValue go by the same rule
    // (jobs/jobMoney.ts: quotes:read, invoices:read). Each job carries its claim's facts (jobRecord.ts).
    const data = withoutJobMoney((await withClaimFacts(db, me.companyId, rows)).map((j: any) => ({ ...j, ...values(j.id), contact: j.contactId ? names[j.contactId] || null : null })), await withheldFor(c))
    return list(c, data, { page, limit, total: Number(total) })
  })

  // POST / — a job, numbered ROOF-0001, ROOF-0002…
  app.post('/', requirePermission('jobs:create'), async (c) => {
    const me = c.get('user')
    const parsed = jobSchema.safeParse((await c.req.json().catch(() => null)) ?? {})
    if (!parsed.success) return refuseJob(c, parsed.error)
    const data = parsed.data
    const dates = jobDates(data, await companyTimeZone(db, me.companyId))
    if (dates.error) return fail(c, 400, dates.error)
    if (!(await ownContact(me.companyId, data.contactId))) return fail(c, 404, 'That contact does not exist.')
    const notHomeowner = await homeownerRefusal(me.companyId, data.contactId)
    if (notHomeowner) return fail(c, notHomeowner.status, notHomeowner.error, notHomeowner.code)
    const badRep = await repRefusal(me.companyId, data.assignedSalesRepId)
    if (badRep) return fail(c, 400, badRep, 'not_given_work')
    if (data.status && !(await stageOpen(me.companyId, data.status))) return fail(c, 400, STAGE_OFF, 'stage_off')
    const created = await db.transaction((tx: any) => insertRoofJob(tx, me.companyId, me.userId, {
      ...toColumns(data, dates.values), address: data.propertyAddress, source: data.source || 'manual',
      status: data.status || 'lead', priority: data.priority || 'medium',
    }))
    const names = await contactNames(me.companyId, [data.contactId])
    return one(c, withoutJobMoney({ ...created, contact: names[data.contactId] || null }, await withheldFor(c)), 201)
  })

  // GET /types — every jobType this company actually holds (a free string; an imported or older value is reachable
  // even when it's not on the page). Above '/:id', which would read "types" as an id. (roof T18)
  app.get('/types', requirePermission('jobs:read'), async (c) => {
    const rows = await db.selectDistinct({ jobType: job.jobType }).from(job).where(eq(job.companyId, c.get('user').companyId))
    const types = rows.map((r: any) => r.jobType).filter(Boolean).sort()
    return listAll(c, types)
  })

  // GET /:id — the job with its homeowner, crew, measurement, photos, notes, and — to whoever reads the books — its quotes
  // and invoices (money in their own right: handing them over through a job would walk around invoices:read, T41).
  app.get('/:id', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const own = await ownJob(me.companyId, id)
    if (!own) return fail(c, 404, 'Job not found')
    // The claim's facts over the job's own columns (jobRecord.ts): the Insurance card read the job's, never filled in.
    const found = await withClaimFactsOne(db, me.companyId, own)
    const [jobContact, jobCrew, measurement, photos, notes, jobQuotes, jobInvoices] = await Promise.all([
      found.contactId ? db.select().from(contact).where(and(eq(contact.id, found.contactId), eq(contact.companyId, me.companyId))).limit(1) : Promise.resolve([]),
      found.assignedCrewId ? db.select().from(crew).where(and(eq(crew.id, found.assignedCrewId), eq(crew.companyId, me.companyId))).limit(1) : Promise.resolve([]),
      found.measurementReportId ? db.select().from(measurementReport).where(and(eq(measurementReport.id, found.measurementReportId), eq(measurementReport.companyId, me.companyId))).limit(1) : Promise.resolve([]),
      db.select().from(jobPhoto).where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, me.companyId))).orderBy(desc(jobPhoto.createdAt), asc(jobPhoto.id)),
      db.select().from(jobNote).where(and(eq(jobNote.jobId, id), eq(jobNote.companyId, me.companyId))).orderBy(desc(jobNote.createdAt), asc(jobNote.id)),
      db.select().from(quote).where(and(eq(quote.jobId, id), eq(quote.companyId, me.companyId))).orderBy(desc(quote.createdAt)),
      db.select().from(invoice).where(and(eq(invoice.jobId, id), eq(invoice.companyId, me.companyId))).orderBy(desc(invoice.createdAt)),
    ])
    const withheld = await withheldFor(c)
    const seesBooks = !withheld.includes('finalRevenue')
    // What a measurement cost is what the company PAYS: margin:read, as /api/measurements (T62; was invoices:read, which
    // the read-only seat holds for revenue — T68).
    const seesCost = !withheld.includes('materialCost')
    return one(c, {
      ...withoutJobMoney(found, withheld),
      // The homeowner's portal credential never travels with their record (T42).
      contact: jobContact[0] ? withoutPortalCredential(jobContact[0]) : null,
      // What the crew is paid per square is the shop's cost (margin:read, as materialCost is): not in the job's crew card.
      crew: jobCrew[0] ? (withheld.includes('materialCost') ? (({ payPerSquare: _p, ...rest }: any) => rest)(jobCrew[0]) : jobCrew[0]) : null,
      measurementReport: measurement[0] ? (seesCost ? measurement[0] : (({ cost: _c, ...rest }: any) => rest)(measurement[0])) : null,
      // What people wrote. What happened to the job (stage moves, closing, reopening) is the timeline's (jobRecord.ts).
      photos, notes: notes.filter((n: any) => !jobEvent(n.body)),
      quotes: seesBooks ? jobQuotes : [],
      invoices: seesBooks ? jobInvoices : [],
    })
  })

  // PUT /:id — the edit form posts back what it was given, nulls included: null is "not sent"; '' clears.
  app.put('/:id', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const raw = (await c.req.json().catch(() => null)) ?? {}
    const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === null ? undefined : v]))
    const parsed = partialOf(jobSchema).safeParse(cleaned)
    if (!parsed.success) return refuseJob(c, parsed.error)
    const data = parsed.data
    const dates = jobDates(data, await companyTimeZone(db, me.companyId))
    if (dates.error) return fail(c, 400, dates.error)
    const before = await ownJob(me.companyId, id)
    if (!before) return fail(c, 404, 'Job not found')
    if (data.contactId && !(await ownContact(me.companyId, data.contactId))) return fail(c, 404, 'That contact does not exist.')
    const notHomeowner = await homeownerRefusal(me.companyId, data.contactId, before.contactId)
    if (notHomeowner) return fail(c, notHomeowner.status, notHomeowner.error, notHomeowner.code)
    const badRep = await repRefusal(me.companyId, data.assignedSalesRepId, before.assignedSalesRepId)
    if (badRep) return fail(c, 400, badRep, 'not_given_work')
    if (data.status && !(await stageOpen(me.companyId, data.status))) return fail(c, 400, STAGE_OFF, 'stage_off')
    const set: Record<string, unknown> = { ...toColumns(data, dates.values), updatedAt: new Date() }
    // Unassigning: the picker's "Unassigned" sends '' (or null), which the schema reads as "not sent" — so a rep or crew
    // could be set and never taken off. Present-and-empty means clear. (T63)
    for (const k of ['assignedSalesRepId', 'assignedCrewId', 'scheduledTime', 'totalSquares'] as const) {
      if (k in raw && (raw[k] === '' || raw[k] === null)) set[k] = null
    }
    // Who is on the job and when it is are jobs:dispatch; what it is worth is quotes:update — never jobs:update alone,
    // which a Field seat holds to run its own work (tenant-backend jobs/dispatch.ts; HVAC live role test 2026-10-24).
    // Compared with what the job has, so the form posting the whole record back unchanged is never refused.
    const asText = (v: unknown) => (v instanceof Date ? String(v.getTime()) : v == null || v === '' ? '' : String(v))
    const moved = ROOF_DISPATCH_FIELDS.filter((k) => k in set && asText(set[k]) !== asText((before as any)[k]))
    if (moved.length && !(await mayDo(c, JOB_DISPATCH_PERMISSION))) return dispatchRefusal(c, moved)
    const cents = (v: unknown) => (v == null || v === '' ? null : Math.round(Number(v) * 100))
    if ('estimatedValue' in set && cents(set.estimatedValue) !== cents((before as any).estimatedValue) && !(await mayDo(c, 'quotes:update'))) {
      return fail(c, 403, 'Changing what a job is worth needs the same right as pricing a quote. Ask a manager to change estimatedRevenue.', 'job_money_not_permitted')
    }
    const [updated] = await db.update(job).set(set as any).where(and(eq(job.id, id), eq(job.companyId, me.companyId))).returning()
    // Moved to the last stage from the job's own form: the same ask as Advance (askForReview).
    if (data.status) { await stageReached(me.companyId, id, data.status); await payRep(me.companyId, id, data.status) }
    return one(c, withoutJobMoney(await withClaimFactsOne(db, me.companyId, updated), await withheldFor(c)))
  })

  /**
   * POST /:id/attach { quoteId } | { invoiceId } — put an existing quote or invoice on this job. A quote written from the
   * Quotes page, or an invoice raised from a contact, belongs to no job; the job then read "No quotes" / "No invoices"
   * beside the homeowner's QTE-00001 and INV-00001 (live test 2026-10-22). Rules:
   *   · the document is this business's, and the same homeowner's as the job — a job never shows another customer's bill;
   *   · a document already on another job says which, and stays there (detach it there first);
   *   · an approved quote is a signed record and can't be edited (quotes.ts), but which job it is for is filing, not its
   *     terms — so it is attached here, not through PUT /api/quotes;
   *   · attaching a quote brings the invoices made from it (invoice.quoteId) that sit on no job.
   * Asks jobs:update and the document's own update permission (quotes:update / invoices:update).
   * POST /:id/detach takes the same body and takes it off this job.
   */
  const docBody = z.object({ quoteId: z.string().min(1).optional(), invoiceId: z.string().min(1).optional() })
    .refine((b) => !!b.quoteId !== !!b.invoiceId, { message: 'Say which quote or which invoice.' })
  const mayDo = async (c: any, permission: string) => { const u = c.get('user'); try { return !!(await canSee(u.role, permission, u.userId)) } catch { return false } }

  app.post('/:id/attach', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const parsed = docBody.safeParse((await c.req.json().catch(() => null)) ?? {})
    if (!parsed.success) return fail(c, 400, 'Say which quote or which invoice.')
    const found = await ownJob(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Job not found')
    const { quoteId, invoiceId } = parsed.data
    const table: any = quoteId ? quote : invoice
    const kind = quoteId ? 'quote' : 'invoice'
    if (!(await mayDo(c, `${kind}s:update`))) return fail(c, 403, `You don't have permission to change ${kind}s.`, 'forbidden')
    const [doc] = await db.select().from(table).where(and(eq(table.id, (quoteId || invoiceId)!), eq(table.companyId, me.companyId))).limit(1)
    if (!doc) return fail(c, 404, `That ${kind} does not exist.`)
    if (found.contactId && doc.contactId !== found.contactId) return fail(c, 400, `${doc.number} is for a different homeowner than this job.`, 'other_customer')
    if (doc.jobId && doc.jobId !== found.id) {
      const [other] = await db.select({ number: job.number }).from(job).where(and(eq(job.id, doc.jobId), eq(job.companyId, me.companyId))).limit(1)
      return fail(c, 409, `${doc.number} is already on job ${other?.number || 'another job'}. Take it off that job first.`, 'on_another_job')
    }
    await db.transaction(async (tx: any) => {
      await tx.update(table).set({ jobId: found.id, updatedAt: new Date() }).where(and(eq(table.id, doc.id), eq(table.companyId, me.companyId)))
      if (quoteId) {
        await tx.update(invoice).set({ jobId: found.id, updatedAt: new Date() } as any)
          .where(and(eq(invoice.companyId, me.companyId), eq(invoice.quoteId, doc.id), isNull(invoice.jobId)))
      }
    })
    return done(c, `${doc.number} is on ${found.number}.`)
  })

  app.post('/:id/detach', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const parsed = docBody.safeParse((await c.req.json().catch(() => null)) ?? {})
    if (!parsed.success) return fail(c, 400, 'Say which quote or which invoice.')
    const found = await ownJob(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Job not found')
    const { quoteId, invoiceId } = parsed.data
    const table: any = quoteId ? quote : invoice
    const kind = quoteId ? 'quote' : 'invoice'
    if (!(await mayDo(c, `${kind}s:update`))) return fail(c, 403, `You don't have permission to change ${kind}s.`, 'forbidden')
    const [doc] = await db.select().from(table).where(and(eq(table.id, (quoteId || invoiceId)!), eq(table.companyId, me.companyId), eq(table.jobId, found.id))).limit(1)
    if (!doc) return fail(c, 404, `That ${kind} is not on this job.`)
    await db.update(table).set({ jobId: null, updatedAt: new Date() }).where(and(eq(table.id, doc.id), eq(table.companyId, me.companyId)))
    return done(c, `${doc.number} is off ${found.number}.`)
  })

  /**
   * POST /:id/close — a job that is not going to be paid: lost (never signed) or cancelled (signed, then collapsed),
   * with the REASON, which close-rate reporting is built on. Not deletion: quotes, photos, supplements and the claim
   * trail stay attached (lien rights, warranty claims). A collected job was paid and cannot be closed.
   */
  app.post('/:id/close', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = z.object({
      status: z.enum(TERMINAL_STATUSES),
      lostReason: z.string().trim().min(1, 'A reason is required — it is what close-rate reporting is built on'),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const existing = await ownJob(me.companyId, id)
    if (!existing) return fail(c, 404, 'Job not found')
    if ((TERMINAL_STATUSES as readonly string[]).includes(existing.status)) return fail(c, 409, `This job is already ${existing.status}.`, 'already_closed')
    if (existing.status === 'collected') return fail(c, 409, 'This job was paid, so it cannot be closed as lost or cancelled.', 'paid')
    const [updated] = await db.update(job)
      .set({ status: parsed.data.status, lostReason: parsed.data.lostReason, closedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(job.id, id), eq(job.companyId, me.companyId))).returning()
    await db.insert(jobNote).values({ companyId: me.companyId, jobId: id, userId: me.userId, isInternal: true,
      body: closedBody(parsed.data.status, existing.status, parsed.data.lostReason) } as any)
    return one(c, withoutJobMoney(await withClaimFactsOne(db, me.companyId, updated), await withheldFor(c)))
  })

  // POST /:id/reopen — a carrier reverses a denial, a homeowner comes back: back on the board at a pipeline stage.
  app.post('/:id/reopen', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = z.object({ status: jobStatus }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    if (!(PIPELINE_STATUSES as readonly string[]).includes(parsed.data.status)) return fail(c, 400, 'Reopen to a pipeline stage, not a terminal one.')
    if (!(await stageOpen(me.companyId, parsed.data.status))) return fail(c, 400, STAGE_OFF, 'stage_off')
    const existing = await ownJob(me.companyId, id)
    if (!existing) return fail(c, 404, 'Job not found')
    if (!(TERMINAL_STATUSES as readonly string[]).includes(existing.status)) return fail(c, 409, 'This job is not closed.', 'not_closed')
    const [updated] = await db.update(job)
      .set({ status: parsed.data.status, lostReason: null, closedAt: null, updatedAt: new Date() } as any)
      .where(and(eq(job.id, id), eq(job.companyId, me.companyId))).returning()
    await db.insert(jobNote).values({ companyId: me.companyId, jobId: id, userId: me.userId, isInternal: true,
      body: reopenedBody(parsed.data.status, existing.status, existing.lostReason) } as any)
    return one(c, withoutJobMoney(await withClaimFactsOne(db, me.companyId, updated), await withheldFor(c)))
  })

  // POST /:id/advance — the next pipeline stage, a note of the change, and a text to the homeowner where the stage has one.
  app.post('/:id/advance', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const existing = await ownJob(me.companyId, id)
    if (!existing) return fail(c, 404, 'Job not found')
    const at = (PIPELINE_STATUSES as readonly string[]).indexOf(existing.status)
    // The next stage this business walks (pipelineFor): past the measurement stage while Measurement Reports is off.
    const walk = pipelineFor(await companyFeatures(me.companyId))
    const next = at === -1 ? undefined : PIPELINE_STATUSES.slice(at + 1).find((s) => walk.includes(s))
    if (!next) return fail(c, 400, 'Cannot advance from current status')
    const [updated] = await db.update(job).set({ status: next, updatedAt: new Date() } as any)
      .where(and(eq(job.id, id), eq(job.companyId, me.companyId))).returning()
    await db.insert(jobNote).values({ companyId: me.companyId, jobId: id, userId: me.userId, isInternal: true, body: statusChangeBody(existing.status, next) } as any)
    if (AUTO_SMS[next]) { try { await textHomeowner(me.companyId, existing, next) } catch { /* a text that can't go never holds up the job */ } }
    await stageReached(me.companyId, id, next)
    await payRep(me.companyId, id, next)
    return one(c, withoutJobMoney(await withClaimFactsOne(db, me.companyId, updated), await withheldFor(c)))
  })

  /** A stage a job may be put in here: a terminal one, or one of the pipeline this business walks (pipelineFor). */
  async function stageOpen(companyId: string, status: string): Promise<boolean> {
    return status !== MEASUREMENT_STAGE || pipelineFor(await companyFeatures(companyId)).includes(status)
  }

  // POST /:id/photos — a photo, its type read from its bytes (an HTML file sent as image/png was stored as one, M9).
  app.post('/:id/photos', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    if (!(await ownJob(me.companyId, id))) return fail(c, 404, 'Job not found')
    const form = await uploadedForm(c)
    const file = form.get('photo') as File | null
    if (!file || typeof file === 'string') return fail(c, 400, 'No photo provided')
    if (file.size > MAX_PHOTO_SIZE) return fail(c, 400, 'Photo exceeds 10MB limit')
    const photoType = (form.get('photoType') as string) || 'general'
    if (!(JOB_PHOTO_TYPES as readonly string[]).includes(photoType)) return fail(c, 400, `photoType must be one of: ${JOB_PHOTO_TYPES.join(', ')}`)
    const buffer = Buffer.from(await file.arrayBuffer())
    const type = sniffType(buffer) || ''
    if (!PHOTO_EXT[type]) return fail(c, 400, 'That file is not an image. JPEG, PNG, GIF and WebP are supported.')
    // No photo store set up: say so, rather than send the photo to an address that isn't there and answer a 500.
    if (d.services.storage.storageConfigured && !d.services.storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
    const key = `photos/${me.companyId}/${id}/${crypto.randomUUID().replace(/-/g, '')}.${PHOTO_EXT[type]}`
    await d.services.storage.put(key, buffer, type)
    const [photo] = await db.insert(jobPhoto).values({
      companyId: me.companyId, jobId: id, uploadedById: me.userId, photoType, url: MEDIA_PREFIX + key,
      caption: (form.get('caption') as string) || null, takenAt: new Date(),
    } as any).returning()
    return one(c, photo, 201)
  })

  app.get('/:id/photos', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    if (!(await ownJob(me.companyId, id))) return fail(c, 404, 'Job not found')
    const rows = await db.select().from(jobPhoto).where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, me.companyId))).orderBy(desc(jobPhoto.createdAt), asc(jobPhoto.id))
    return listAll(c, rows)
  })

  app.delete('/:id/photos/:photoId', requirePermission('jobs:delete'), async (c) => {
    const me = c.get('user')
    const [existing] = await db.select().from(jobPhoto)
      .where(and(eq(jobPhoto.id, c.req.param('photoId')), eq(jobPhoto.jobId, c.req.param('id')), eq(jobPhoto.companyId, me.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Photo not found')
    const key = String(existing.url || '').startsWith(MEDIA_PREFIX) ? existing.url.slice(MEDIA_PREFIX.length) : ''
    if (key) { try { await d.services.storage.deleteFile(key) } catch { /* the row is the source of truth */ } }
    await db.delete(jobPhoto).where(and(eq(jobPhoto.id, existing.id), eq(jobPhoto.companyId, me.companyId)))
    return c.body(null, 204)
  })

  // POST /:id/notes
  app.post('/:id/notes', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    if (!(await ownJob(me.companyId, id))) return fail(c, 404, 'Job not found')
    const parsed = z.object({ body: cleanLines(1), isInternal: z.boolean().default(true) }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [note] = await db.insert(jobNote).values({ companyId: me.companyId, jobId: id, userId: me.userId, body: parsed.data.body, isInternal: parsed.data.isInternal } as any).returning()
    return one(c, note, 201)
  })

  // GET /:id/timeline — what happened to the job since it began, newest first: its stage moves (closing and reopening
  // too), photos and the homeowner's texts, each in words with stage names. The notes people wrote are the Notes card's,
  // not repeated here (jobRecord.ts).
  app.get('/:id/timeline', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const found = await ownJob(me.companyId, id)
    if (!found) return fail(c, 404, 'Job not found')
    const [notes, photos] = await Promise.all([
      db.select().from(jobNote).where(and(eq(jobNote.jobId, id), eq(jobNote.companyId, me.companyId))),
      db.select().from(jobPhoto).where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, me.companyId))),
    ])
    const texts = found.contactId
      ? await db.select({ id: smsMessage.id, body: smsMessage.body, direction: smsMessage.direction, createdAt: smsMessage.createdAt })
        .from(smsMessage).innerJoin(smsConversation, eq(smsMessage.conversationId, smsConversation.id))
        .where(and(eq(smsConversation.companyId, me.companyId), eq(smsConversation.contactId, found.contactId), gt(smsMessage.createdAt, found.createdAt)))
      : []
    // The company's own stage names, where Pipeline Stages & Boards is on; the standard names otherwise.
    const names = (await companyFeatures(me.companyId)).includes('pipeline_boards') ? await loadPipelineConfig(db, me.companyId) : null
    const stageName = (stage: string) => stageLabelFor(names, stage, found.jobType)
    const timeline: any[] = [
      ...notes.flatMap((n: any) => { const e = jobEvent(n.body, stageName); return e ? [{ type: e.kind, id: n.id, body: e.text, userId: n.userId, createdAt: n.createdAt }] : [] }),
      // An event on a timeline says what happened (N2): a photo carries a body like a note does.
      ...photos.map((p: any) => ({ type: 'photo', id: p.id, url: p.url, caption: p.caption, photoType: p.photoType, createdAt: p.createdAt,
        body: `Photo added${p.photoType && p.photoType !== 'general' ? ` — ${p.photoType}` : ''}${p.caption ? `: ${p.caption}` : ''}` })),
      ...texts.map((m: any) => ({ type: 'sms', id: m.id, body: m.body, direction: m.direction, createdAt: m.createdAt })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return listAll(c, timeline)
  })

  return app
}
