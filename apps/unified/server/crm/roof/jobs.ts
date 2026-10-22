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
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, gt } from 'drizzle-orm'
import { companyTimeZone, nextNumber, normalizeDateInput, sniffType, withoutPortalCredential, jobMoneyWithheld, withoutJobMoney } from '@twomiah/tenant-backend'
import { company, contact, crew, invoice, job, jobNote, jobPhoto, measurementReport, quote, smsConversation, smsMessage } from '../../db/schema/index.ts'
import { cleanText, cleanLines } from '../../core/sanitize.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { uploadedForm } from '../office/upload.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { JOB_PHOTO_TYPES, MEASUREMENT_STAGE, PIPELINE_STATUSES, TERMINAL_STATUSES, firstNameOf, jobStatus, onCompanyClock, optional, phone, pipelineFor } from './validation.ts'

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
const jobDates = (data: Record<string, any>, tz: string): { error?: string; values: Record<string, Date | null | undefined> } => {
  const values: Record<string, Date | null | undefined> = {}
  for (const f of JOB_DATE_FIELDS) {
    const r = (DAY_FIELDS as readonly string[]).includes(f) ? normalizeDateInput(data[f]) : onCompanyClock(data[f], tz)
    if (r.error) return { error: `${f}: ${r.error}`, values }
    values[f] = r.value
  }
  return { values }
}

/**
 * What the homeowner is texted when a job reaches a stage. A link only where the office has given them the portal: the
 * CRM's portal is a private link per customer, so a text without one says where else to look.
 */
const AUTO_SMS: Record<string, (p: { first: string; company: string; date: string; link: string | null }) => string> = {
  inspection_scheduled: (p) => `Hi ${p.first}, your roof inspection is scheduled for ${p.date}. – ${p.company}`,
  inspected: (p) => `Hi ${p.first}, your roof inspection is complete! We'll be preparing your estimate shortly. – ${p.company}`,
  measurement_ordered: (p) => `Hi ${p.first}, we've ordered measurements for your roof. We'll have your proposal ready soon. – ${p.company}`,
  proposal_sent: (p) => `Hi ${p.first}, your roof proposal is ready for review. ${p.link ? `View it at ${p.link}` : 'Check your email for it'}. – ${p.company}`,
  signed: (p) => `Hi ${p.first}, your contract is signed! We'll be in touch to schedule installation. – ${p.company}`,
  material_ordered: (p) => `Hi ${p.first}, materials for your roof have been ordered and are on the way. – ${p.company}`,
  in_production: (p) => `Hi ${p.first}, your roof installation has started today! Our crew is on-site. – ${p.company}`,
  final_inspection: (p) => `Hi ${p.first}, your new roof is complete! We'll be doing a final inspection. – ${p.company}`,
  invoiced: (p) => `Hi ${p.first}, your invoice is ready.${p.link ? ` Pay online at ${p.link}` : ''} – ${p.company}`,
  collected: (p) => `Hi ${p.first}, payment received — thank you!${p.link ? ` Your warranty info is at ${p.link}` : ''} – ${p.company}`,
}

/** The refusal for the measurement stage while Measurement Reports is off (./validation.ts pipelineFor). */
const STAGE_OFF = 'Measurement Ordered is the measurement reports’ stage, and measurement reports are not switched on.'

const jobSchema = z.object({
  contactId: z.string().min(1),
  jobType: z.string().min(1),
  propertyAddress: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
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

  const withheldFor = (c: any) => jobMoneyWithheld(canSee, c.get('user'))
  const ownContact = async (companyId: string, contactId: string) =>
    !!(await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1))[0]
  const ownJob = async (companyId: string, id: string) =>
    (await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, companyId))).limit(1))[0]
  const contactNames = async (companyId: string, ids: string[]) => {
    if (!ids.length) return {} as Record<string, { id: string; name: string }>
    const rows = await db.select({ id: contact.id, name: contact.name }).from(contact)
      .where(and(eq(contact.companyId, companyId), inArray(contact.id, ids)))
    return Object.fromEntries(rows.map((r: any) => [r.id, r]))
  }

  // GET / — jobs, filtered; "My jobs" (?mine=1) are the jobs this person is the sales rep on, read from the session.
  // Crews carry a foreman's NAME, not a login, so a crew is not something a person can be matched to. (T63)
  app.get('/', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const q = c.req.query()
    const page = Math.max(parseInt(q.page || '1') || 1, 1)
    const limit = Math.max(parseInt(q.limit || '50') || 50, 1)
    const conditions: any[] = [eq(job.companyId, me.companyId)]
    if (q.status) conditions.push(eq(job.status, q.status))
    if (q.jobType) conditions.push(eq(job.jobType, q.jobType))
    if (q.assignedSalesRepId) conditions.push(eq(job.assignedSalesRepId, q.assignedSalesRepId))
    if (q.assignedCrewId) conditions.push(eq(job.assignedCrewId, q.assignedCrewId))
    if (q.mine === '1') conditions.push(eq(job.assignedSalesRepId, me.userId))
    // One customer's jobs (the quote form's Job picker, a contact's page).
    if (q.contactId) conditions.push(eq(job.contactId, q.contactId))
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
    // A job's money is not part of reading the job list (T41/T42): Reports built revenue by rep and by crew in the
    // browser from this list, so fetching it was enough to disclose them.
    const data = withoutJobMoney(rows.map((j: any) => ({ ...j, contact: j.contactId ? names[j.contactId] || null : null })), await withheldFor(c))
    return list(c, data, { page, limit, total: Number(total) })
  })

  // POST / — a job, numbered ROOF-0001, ROOF-0002…
  app.post('/', requirePermission('jobs:create'), async (c) => {
    const me = c.get('user')
    const parsed = jobSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const dates = jobDates(data, await companyTimeZone(db, me.companyId))
    if (dates.error) return fail(c, 400, dates.error)
    if (!(await ownContact(me.companyId, data.contactId))) return fail(c, 404, 'That contact does not exist.')
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
    return list(c, types, { page: 1, limit: types.length, total: types.length })
  })

  // GET /:id — the job with its homeowner, crew, measurement, photos, notes, and — to whoever reads the books — its quotes
  // and invoices (money in their own right: handing them over through a job would walk around invoices:read, T41).
  app.get('/:id', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const found = await ownJob(me.companyId, id)
    if (!found) return fail(c, 404, 'Job not found')
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
      crew: jobCrew[0] || null,
      measurementReport: measurement[0] ? (seesCost ? measurement[0] : (({ cost: _c, ...rest }: any) => rest)(measurement[0])) : null,
      photos, notes,
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
    const parsed = jobSchema.partial().safeParse(cleaned)
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const dates = jobDates(data, await companyTimeZone(db, me.companyId))
    if (dates.error) return fail(c, 400, dates.error)
    if (!(await ownJob(me.companyId, id))) return fail(c, 404, 'Job not found')
    if (data.contactId && !(await ownContact(me.companyId, data.contactId))) return fail(c, 404, 'That contact does not exist.')
    if (data.status && !(await stageOpen(me.companyId, data.status))) return fail(c, 400, STAGE_OFF, 'stage_off')
    const set: Record<string, unknown> = { ...toColumns(data, dates.values), updatedAt: new Date() }
    // Unassigning: the picker's "Unassigned" sends '' (or null), which the schema reads as "not sent" — so a rep or crew
    // could be set and never taken off. Present-and-empty means clear. (T63)
    for (const k of ['assignedSalesRepId', 'assignedCrewId', 'scheduledTime', 'totalSquares'] as const) {
      if (k in raw && (raw[k] === '' || raw[k] === null)) set[k] = null
    }
    const [updated] = await db.update(job).set(set as any).where(and(eq(job.id, id), eq(job.companyId, me.companyId))).returning()
    return one(c, withoutJobMoney(updated, await withheldFor(c)))
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
      body: `Job closed as ${parsed.data.status} (from ${existing.status}): ${parsed.data.lostReason}` } as any)
    return one(c, withoutJobMoney(updated, await withheldFor(c)))
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
      body: `Job reopened to ${parsed.data.status} (was ${existing.status}${existing.lostReason ? `: ${existing.lostReason}` : ''})` } as any)
    return one(c, withoutJobMoney(updated, await withheldFor(c)))
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
    await db.insert(jobNote).values({ companyId: me.companyId, jobId: id, userId: me.userId, isInternal: true, body: `Status changed: ${existing.status} → ${next}` } as any)
    if (AUTO_SMS[next]) { try { await textHomeowner(me.companyId, existing, next) } catch { /* a text that can't go never holds up the job */ } }
    return one(c, withoutJobMoney(updated, await withheldFor(c)))
  })

  /** The business's switched-on features (company.enabled_features). */
  async function companyFeatures(companyId: string): Promise<string[]> {
    const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
    return (co?.enabledFeatures as string[] | null) || []
  }
  /** A stage a job may be put in here: a terminal one, or one of the pipeline this business walks (pipelineFor). */
  async function stageOpen(companyId: string, status: string): Promise<boolean> {
    return status !== MEASUREMENT_STAGE || pipelineFor(await companyFeatures(companyId)).includes(status)
  }

  /** The stage's text to the homeowner, through the shared sender (it refuses an opted-out number and unset-up texting). */
  async function textHomeowner(companyId: string, row: any, stage: string) {
    if (!row.contactId) return
    const [co] = await db.select({ name: company.name, enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
    const features = (co?.enabledFeatures as string[] | null) || []
    if (!features.includes('two_way_texting') && !features.includes('all')) return
    const [who] = await db.select().from(contact).where(and(eq(contact.id, row.contactId), eq(contact.companyId, companyId))).limit(1)
    if (!who?.mobile && !who?.phone) return
    const portalOpen = who.portalEnabled && who.portalToken && (!who.portalTokenExp || new Date(who.portalTokenExp) > new Date())
    const origin = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    const message = AUTO_SMS[stage]({
      first: firstNameOf(who.name), company: co?.name || '',
      date: row.inspectionDate ? new Date(row.inspectionDate).toLocaleDateString('en-US') : 'TBD',
      link: portalOpen && origin ? `${origin}/portal/${who.portalToken}` : null,
    })
    await d.services.sms.sendSMS(companyId, { contactId: who.id, message, jobId: row.id })
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
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
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

  // GET /:id/timeline — notes, status changes, photos and the homeowner's texts since the job began, newest first.
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
    const timeline: any[] = [
      ...notes.map((n: any) => ({ type: n.body.startsWith('Status changed:') ? 'status_change' : 'note', id: n.id, body: n.body, userId: n.userId, createdAt: n.createdAt })),
      // An event on a timeline says what happened (N2): a photo carries a body like a note does.
      ...photos.map((p: any) => ({ type: 'photo', id: p.id, url: p.url, caption: p.caption, photoType: p.photoType, createdAt: p.createdAt,
        body: `Photo added${p.photoType && p.photoType !== 'general' ? ` — ${p.photoType}` : ''}${p.caption ? `: ${p.caption}` : ''}` })),
      ...texts.map((m: any) => ({ type: 'sms', id: m.id, body: m.body, direction: m.direction, createdAt: m.createdAt })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return list(c, timeline, { page: 1, limit: timeline.length, total: timeline.length })
  })

  return app
}
