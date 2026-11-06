// Permits on a roofing job, and the status board across jobs (roofing parity, row 11; docs/parity/roof-insurance-extras.md #8;
// AccuLynx "Tips for Managing Your Roofing Permits, Mortgage Checks, & Supplements"). At /api/permits, behind the not-ready feature
// `roof_permits` (hidden, offered to roofing and to no plan).
//
//   · A PERMIT is what the city or county was asked for on one job: its type, the office that issues it, the number, the FEE (integer
//     cents) and the day it was paid, and where it stands — needed → applied → issued → finaled (closed out after the final
//     inspection), or rejected. Each step is stamped with its day; going back a step clears the days after it. The days are calendar
//     days on the COMPANY'S clock (a UTC-midnight marker, read back with markerDay), never the server's.
//   · THE BOARD is GET / with no job: every permit of every job the seat can see, with the job, its address and the homeowner beside
//     it, grouped into columns by the screen. An issued permit past its expiry day is flagged `expired`, on the company's day.
//   · Every change is a line on the job's notes ("Permit 24-0113 (Building) — issued"), so the job's page tells the story.
//
// Who may: reading is jobs:read, adding is jobs:create, editing and moving a permit is jobs:update, removing is jobs:delete — and a
// seat sees only the jobs it is on unless it reads every job (jobs:read-all; ./seatJob.ts), as the work orders do. The FEE is what the
// shop pays the city, a cost: it is shown to, and set by, a seat that reads cost (margin:read — the work-order price's rule); for any
// other seat it is absent, flagged moneyWithheld, never $0.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { companyTimeZone, dayMarker, markerDay, markerDayIsOver, storeDateString } from '@twomiah/tenant-backend'
import { contact, job, jobNote, jobPermit } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { ownJobsWhere } from '../../ownWork.ts'
import { createSeatJob } from '../seatJob.ts'

/** In the order a permit moves; `rejected` is the way off the line. */
export const PERMIT_STATUSES = ['needed', 'applied', 'issued', 'finaled', 'rejected'] as const
export type PermitStatus = (typeof PERMIT_STATUSES)[number]
/** What a person calls each status — the screens and the job's notes use these words, never the code. */
export const PERMIT_STATUS_WORDS: Record<PermitStatus, string> = { needed: 'Needed', applied: 'Applied for', issued: 'Issued', finaled: 'Finaled', rejected: 'Rejected' }
/** The day each step is stamped on; going back a step clears the days after it. */
const STATUS_DAY: Partial<Record<PermitStatus, 'appliedOn' | 'issuedOn' | 'finaledOn'>> = { applied: 'appliedOn', issued: 'issuedOn', finaled: 'finaledOn' }
const LINE: PermitStatus[] = ['needed', 'applied', 'issued', 'finaled']
/** The largest fee we take: $10 million, in cents (the column is a 32-bit integer). */
const MAX_FEE_CENTS = 1_000_000_000

const text = (max: number) => z.string().trim().max(max)
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date, like 2026-11-04').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'must be a real date')
/** A day, '' or null to clear it. */
const dayOrClear = z.union([day, z.literal(''), z.null()]).optional()
const feeCents = z.number({ error: 'The fee is an amount in cents.' }).int('The fee is a whole number of cents.').min(0, 'The fee cannot be negative.').max(MAX_FEE_CENTS, 'That fee is too large.')

const facts = z.object({
  permitType: text(80).optional(),
  jurisdiction: text(120).optional(),
  permitNumber: text(80).optional(),
  feeCents: feeCents.nullable().optional(),
  feePaidOn: dayOrClear,
  appliedOn: dayOrClear,
  issuedOn: dayOrClear,
  expiresOn: dayOrClear,
  finaledOn: dayOrClear,
  notes: text(2000).optional(),
})
const createSchema = facts.extend({ jobId: z.string().min(1), status: z.enum(PERMIT_STATUSES).optional() })
const DAY_FIELDS = ['feePaidOn', 'appliedOn', 'issuedOn', 'expiresOn', 'finaledOn'] as const
const TEXT_FIELDS = ['permitType', 'jurisdiction', 'permitNumber', 'notes'] as const

export function createPermitRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const seatJob = createSeatJob(d)
  const app = new Hono<AppEnv>()

  const maySeeFee = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return !!(await canSee(u?.role, 'margin:read', u?.userId)) } catch { return false }
  }
  const mayReadAllJobs = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return !!(await canSee(u?.role, 'jobs:read-all', u?.userId)) } catch { return false }
  }

  /** A permit as the screens read it: days as YYYY-MM-DD, the fee only for a seat that reads cost, `expired` on the company's day. */
  function view(row: any, sees: boolean, tz: string, extra: Record<string, unknown> = {}) {
    const { feeCents: fee, createdById: _by, ...rest } = row
    const out: Record<string, unknown> = { ...rest, ...extra }
    for (const k of DAY_FIELDS) out[k] = row[k] ? markerDay(row[k]) : null
    out.statusLabel = PERMIT_STATUS_WORDS[row.status as PermitStatus] ?? row.status
    out.expired = row.status === 'issued' && !!row.expiresOn && markerDayIsOver(row.expiresOn, tz)
    if (sees) out.feeCents = fee ?? null
    else out.moneyWithheld = true
    return out
  }
  const ownPermit = async (c: any) => {
    const u = c.get('user')
    const [row] = await db.select().from(jobPermit).where(and(eq(jobPermit.id, c.req.param('id')), eq(jobPermit.companyId, u.companyId))).limit(1)
    if (!row) return undefined
    return (await seatJob(c, row.jobId)) ? row : undefined
  }
  const nameOf = (p: { permitNumber?: string | null; permitType?: string | null }) =>
    `Permit${p.permitNumber ? ` ${p.permitNumber}` : ''}${p.permitType ? ` (${p.permitType})` : ''}`
  const note = (companyId: string, jobId: string, userId: string, body: string) =>
    db.insert(jobNote).values({ companyId, jobId, userId, isInternal: true, body } as any)

  // ══════════════════════════════════════════════════════
  // READ: a job's permits, or the board across jobs
  // ══════════════════════════════════════════════════════

  // ?jobId= one job's permits; none: every permit of every job the seat can see (the board). ?status= narrows either.
  app.get('/', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const conditions: any[] = [eq(jobPermit.companyId, me.companyId)]
    const jobId = c.req.query('jobId'), status = c.req.query('status')
    if (jobId) conditions.push(eq(jobPermit.jobId, jobId))
    if (status) {
      if (!(PERMIT_STATUSES as readonly string[]).includes(status)) return fail(c, 400, 'status: not one of the permit statuses.')
      conditions.push(eq(jobPermit.status, status))
    }
    if (!(await mayReadAllJobs(c))) conditions.push(ownJobsWhere(db, String(me.userId)))
    const rows = await db.select({ p: jobPermit, jobNumber: job.number, address: job.address, city: job.city, jobStatus: job.status, homeowner: contact.name })
      .from(jobPermit).innerJoin(job, and(eq(job.id, jobPermit.jobId), eq(job.companyId, me.companyId))).leftJoin(contact, eq(contact.id, job.contactId))
      .where(and(...conditions)).orderBy(desc(jobPermit.createdAt), desc(jobPermit.id)).limit(500)
    const sees = await maySeeFee(c), tz = await companyTimeZone(db, me.companyId)
    return listAll(c, rows.map((r: any) => view(r.p, sees, tz, { jobNumber: r.jobNumber, address: r.address, city: r.city, jobStatus: r.jobStatus, homeowner: r.homeowner ?? null })))
  })

  // ══════════════════════════════════════════════════════
  // WRITE
  // ══════════════════════════════════════════════════════

  app.post('/', requirePermission('jobs:create'), async (c) => {
    const me = c.get('user')
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    if (data.feeCents !== undefined && data.feeCents !== null && !(await maySeeFee(c))) {
      return fail(c, 403, 'A permit fee is what the shop pays the city. Ask an owner or manager to enter it.', 'permit_fee_not_permitted')
    }
    const jobRow = await seatJob(c, data.jobId)
    if (!jobRow) return fail(c, 404, 'That job does not exist.')
    const tz = await companyTimeZone(db, me.companyId)
    const today = storeDateString(new Date(), tz)
    const status = data.status ?? 'needed'
    const values: Record<string, unknown> = {
      companyId: me.companyId, jobId: jobRow.id, status, createdById: me.userId,
      permitType: data.permitType || null, jurisdiction: data.jurisdiction || null, permitNumber: data.permitNumber || null,
      feeCents: data.feeCents ?? null, notes: data.notes || null,
    }
    for (const k of DAY_FIELDS) values[k] = data[k] ? dayMarker(data[k] as string) : null
    // A permit added already past "needed" is stamped with the day it reached its status, unless the form named it.
    const stamp = STATUS_DAY[status]
    if (stamp && !values[stamp]) values[stamp] = dayMarker(today)
    const [row] = await db.insert(jobPermit).values(values as any).returning()
    await note(me.companyId, jobRow.id, me.userId, `${nameOf(row)} added — ${PERMIT_STATUS_WORDS[status as PermitStatus].toLowerCase()}${row.jurisdiction ? ` · ${row.jurisdiction}` : ''}`)
    return one(c, view(row, await maySeeFee(c), tz), 201)
  })

  // The permit's facts. Its status moves through /status, which keeps the days; the days themselves can be corrected here.
  app.put('/:id', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const parsed = facts.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    if (data.feeCents !== undefined && !(await maySeeFee(c))) {
      return fail(c, 403, 'A permit fee is what the shop pays the city. Ask an owner or manager to change it.', 'permit_fee_not_permitted')
    }
    const found = await ownPermit(c)
    if (!found) return fail(c, 404, 'Permit not found')
    const set: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of TEXT_FIELDS) if (data[k] !== undefined) set[k] = data[k] || null
    if (data.feeCents !== undefined) set.feeCents = data.feeCents
    for (const k of DAY_FIELDS) if (data[k] !== undefined) set[k] = data[k] ? dayMarker(data[k] as string) : null
    const [row] = await db.update(jobPermit).set(set as any).where(and(eq(jobPermit.id, found.id), eq(jobPermit.companyId, me.companyId))).returning()
    return one(c, view(row, await maySeeFee(c), await companyTimeZone(db, me.companyId)))
  })

  // Move the permit along (or back), stamping the day (`on`, else today on the company's clock), with a line on the job's notes.
  app.post('/:id/status', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({ status: z.enum(PERMIT_STATUSES), on: day.optional() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const found = await ownPermit(c)
    if (!found) return fail(c, 404, 'Permit not found')
    const { status } = parsed.data
    const tz = await companyTimeZone(db, me.companyId)
    const on = dayMarker(parsed.data.on ?? storeDateString(new Date(), tz))
    const set: Record<string, unknown> = { status, updatedAt: new Date() }
    const stamp = STATUS_DAY[status]
    if (stamp) set[stamp] = on
    // Back a step (or off the line): the days after it did not happen.
    const at = LINE.indexOf(status)
    for (const later of LINE.slice(at < 0 ? LINE.indexOf('applied') + 1 : at + 1)) {
      const col = STATUS_DAY[later]
      if (col && col !== stamp) set[col] = null
    }
    const [row] = await db.update(jobPermit).set(set as any).where(and(eq(jobPermit.id, found.id), eq(jobPermit.companyId, me.companyId))).returning()
    if (found.status !== status) await note(me.companyId, found.jobId, me.userId, `${nameOf(row)} — ${PERMIT_STATUS_WORDS[status].toLowerCase()}`)
    return one(c, view(row, await maySeeFee(c), tz))
  })

  app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
    const me = c.get('user')
    const found = await ownPermit(c)
    if (!found) return fail(c, 404, 'Permit not found')
    await db.delete(jobPermit).where(and(eq(jobPermit.id, found.id), eq(jobPermit.companyId, me.companyId)))
    await note(me.companyId, found.jobId, me.userId, `${nameOf(found)} removed`)
    return done(c)
  })

  return app
}
