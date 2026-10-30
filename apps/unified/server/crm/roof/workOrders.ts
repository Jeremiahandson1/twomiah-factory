// Work orders for crews and subcontractors (docs/parity/roof-work-orders.md; roofing depth, gap 5) — the office's half,
// at /api/work-orders (feature roof_work_orders — not ready, hidden). The crew's half, which needs no sign-in, is
// ./crewLink.ts at /api/crew-link/:token.
//
// A work order is one job's instructions for one crew or sub: scope, address, start date, the material list (WITHOUT
// prices) and some of the job's photos. The office makes it, texts it as a private link, and watches the crew accept,
// reject or complete it from that link; each step is a note on the job.
//
//   GET    /                  work orders, ?jobId= ?status=                                  jobs:read, the seat's own jobs
//   GET    /:id               one (the link itself only to a seat that may send)             jobs:read
//   POST   /                  make one (a draft)                                             jobs:dispatch
//   PUT    /:id               change it while it is a draft, sent or rejected                jobs:dispatch
//   POST   /:id/send          text the link (again, to remind; a rejected one goes out anew)  jobs:dispatch
//   POST   /:id/cancel        withdraw it                                                    jobs:dispatch
//   DELETE /:id               remove a draft or a cancelled one                               jobs:delete
//
// The link is the token the shared document links use (tenant-backend portal/documentLinks.ts: 32 random bytes as 64 hex
// characters, looked up by an exact match) at /w/<token> on the app's address, good for 30 days from the send and never
// before a week after the start date. It opens THIS work order and nothing else of the company's.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { JOB_DISPATCH_PERMISSION, companyTimeZone, newDocumentToken } from '@twomiah/tenant-backend'
import { company, crew, job, jobNote, jobPhoto, material, user, workOrder } from '../../db/schema/index.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { ownJobsWhere } from '../ownWork.ts'
import { createSeatJob } from './field/seatJob.ts'
import { onCompanyClock, optional, phone } from './validation.ts'

export const WORK_ORDER_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'completed', 'cancelled'] as const
/** The page the crew opens, on the app's address. */
export const WORK_ORDER_PAGE = '/w'
const LINK_DAYS = 30
const AFTER_START_DAYS = 7
const DAY = 24 * 60 * 60 * 1000
export const MAX_PHOTOS_SHARED = 12

export const appOrigin = () => String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')

/** When a link sent now stops answering: 30 days on, and never less than a week past the start. */
export function linkExpiry(now: Date, startDate?: Date | null): Date {
  const base = new Date(now.getTime() + LINK_DAYS * DAY)
  const afterStart = startDate ? new Date(startDate.getTime() + AFTER_START_DAYS * DAY) : base
  return afterStart > base ? afterStart : base
}

/** Whose name an automatic note goes under (job_note needs a person): the job's sales rep, else the company's owner. */
export async function noteAuthor(db: any, companyId: string, jobRow: any): Promise<string | null> {
  if (jobRow?.assignedSalesRepId) return jobRow.assignedSalesRepId as string
  const [owner] = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), eq(user.role, 'owner'))).limit(1)
  return owner?.id ?? null
}

/** The job's address on one line. */
export const addressOf = (row: any) => [row?.address, row?.city, row?.state, row?.zip].filter(Boolean).join(', ')

const line = z.object({ description: z.string().trim().min(1).max(200), qty: z.coerce.number().finite().positive(), unit: z.string().trim().max(30).optional() })

const writable = {
  title: z.string().trim().min(1, 'Give the work order a title.').max(200),
  scope: optional(z.string().trim().max(4000)),
  address: optional(z.string().trim().max(300)),
  startDate: z.string().optional().nullable(),
  recipientName: optional(z.string().trim().min(1).max(120)),
  recipientPhone: optional(phone),
  crewId: optional(z.string().min(1)),
  materialLines: z.array(line).max(60).optional(),
  materialOrderId: optional(z.string().min(1)),
  photoIds: z.array(z.string().min(1)).max(MAX_PHOTOS_SHARED).optional(),
}
const createSchema = z.object({ jobId: z.string().min(1), ...writable })
const updateSchema = z.object(writable).partial()

export function createWorkOrderRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const seatJob = createSeatJob(d)
  const app = new Hono<AppEnv>()

  const mayLink = async (c: any) => { const u = c.get('user'); try { return !!(await canSee(u.role, JOB_DISPATCH_PERMISSION, u.userId)) } catch { return false } }

  /** A work order as the office reads it. The token never leaves; the link does, to a seat that may send it. */
  function view(row: any, withLink: boolean) {
    const { publicToken, tokenExpiresAt, ...rest } = row
    const origin = appOrigin()
    return {
      ...rest,
      tokenExpiresAt,
      linkExpired: !!(tokenExpiresAt && new Date(tokenExpiresAt) < new Date()),
      ...(withLink && publicToken && origin ? { linkUrl: `${origin}${WORK_ORDER_PAGE}/${publicToken}` } : {}),
    }
  }

  const ownOrder = async (companyId: string, id: string) =>
    (await db.select().from(workOrder).where(and(eq(workOrder.id, id), eq(workOrder.companyId, companyId))).limit(1))[0]

  /** The order, if the seat may see its job. */
  async function readable(c: any) {
    const row = await ownOrder(c.get('user').companyId, c.req.param('id'))
    if (!row || !(await seatJob(c, row.jobId))) return undefined
    return row
  }

  async function addNote(companyId: string, jobId: string, userId: string | null, body: string) {
    if (!userId) return
    try { await db.insert(jobNote).values({ companyId, jobId, userId, body, isInternal: true } as any) } catch { /* the note is a courtesy */ }
  }

  /** Material lines from a material order on this job (descriptions, quantities and units — never prices) plus any typed. */
  async function linesFrom(companyId: string, jobId: string, orderId?: string, typed?: Array<{ description: string; qty: number; unit?: string }>) {
    const out: Array<{ description: string; qty: number; unit: string }> = []
    if (orderId) {
      const [m] = await db.select().from(material).where(and(eq(material.id, orderId), eq(material.companyId, companyId), eq(material.jobId, jobId))).limit(1)
      if (!m) return { error: 'That material order is not on this job.' as const }
      for (const li of (m.lineItems as any[]) || []) out.push({ description: String(li.description), qty: Number(li.qty ?? li.quantity ?? 0), unit: String(li.unit || 'ea') })
    }
    for (const t of typed || []) out.push({ description: t.description, qty: t.qty, unit: t.unit || 'ea' })
    return { lines: out }
  }

  /** The job photos shared with the crew must be this job's own. */
  async function photosOk(companyId: string, jobId: string, ids: string[]) {
    if (!ids.length) return true
    const rows = await db.select({ id: jobPhoto.id }).from(jobPhoto).where(and(eq(jobPhoto.companyId, companyId), eq(jobPhoto.jobId, jobId), inArray(jobPhoto.id, ids)))
    return rows.length === new Set(ids).size
  }

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const conditions: any[] = [eq(workOrder.companyId, me.companyId)]
    const jobId = c.req.query('jobId'), status = c.req.query('status')
    if (jobId) conditions.push(eq(workOrder.jobId, jobId))
    if (status) conditions.push(eq(workOrder.status, status))
    // A seat that is not on every job sees the work orders of the jobs it is on.
    let all = false
    try { all = !!(await canSee(me.role, 'jobs:read-all', me.userId)) } catch { all = false }
    if (!all) conditions.push(ownJobsWhere(db, String(me.userId)))
    const rows = await db.select({ wo: workOrder }).from(workOrder).innerJoin(job, and(eq(job.id, workOrder.jobId), eq(job.companyId, me.companyId)))
      .where(and(...conditions)).orderBy(desc(workOrder.createdAt), desc(workOrder.id)).limit(200)
    const withLink = await mayLink(c)
    return listAll(c, rows.map((r: any) => view(r.wo, withLink)))
  })

  app.get('/:id', requirePermission('jobs:read'), async (c) => {
    const row = await readable(c)
    if (!row) return fail(c, 404, 'Work order not found')
    return one(c, view(row, await mayLink(c)))
  })

  app.post('/', requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const me = c.get('user')
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const jobRow = await seatJob(c, data.jobId)
    if (!jobRow) return fail(c, 404, 'That job does not exist.')

    let name = data.recipientName, tel = data.recipientPhone, crewId: string | null = null
    if (data.crewId) {
      const [cr] = await db.select().from(crew).where(and(eq(crew.id, data.crewId), eq(crew.companyId, me.companyId))).limit(1)
      if (!cr) return fail(c, 404, 'That crew does not exist.')
      crewId = cr.id
      name = name || [cr.foremanName, cr.isSubcontractor && cr.subcontractorCompanyName ? `(${cr.subcontractorCompanyName})` : (cr.name ? `(${cr.name})` : '')].filter(Boolean).join(' ')
      tel = tel || cr.foremanPhone
    }
    if (!name || !tel) return fail(c, 400, 'Who is it for? Choose a crew, or enter a name and a phone number.', 'validation_failed', { ...(name ? {} : { recipientName: 'Enter a name.' }), ...(tel ? {} : { recipientPhone: 'Enter a phone number.' }) })
    const start = onCompanyClock(data.startDate ?? undefined, await companyTimeZone(db, me.companyId))
    if (start.error) return fail(c, 400, `startDate: ${start.error}`)
    const made = await linesFrom(me.companyId, jobRow.id, data.materialOrderId, data.materialLines)
    if ('error' in made) return fail(c, 404, made.error!)
    const photoIds = [...new Set(data.photoIds || [])]
    if (!(await photosOk(me.companyId, jobRow.id, photoIds))) return fail(c, 400, 'Those photos are not on this job.')

    const [created] = await db.insert(workOrder).values({
      companyId: me.companyId, jobId: jobRow.id, crewId, title: data.title, scope: data.scope ?? null,
      address: data.address || addressOf(jobRow) || null, startDate: start.value ?? jobRow.installDate ?? null,
      recipientName: name, recipientPhone: tel, materialLines: made.lines, photoIds, createdById: me.userId,
    } as any).returning()
    return one(c, view(created, true), 201)
  })

  app.put('/:id', requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const me = c.get('user')
    const row = await readable(c)
    if (!row) return fail(c, 404, 'Work order not found')
    if (!['draft', 'sent', 'rejected'].includes(row.status)) {
      return fail(c, 409, row.status === 'accepted' ? 'The crew has accepted it. Cancel it and make a new one if the job has changed.' : `A ${row.status} work order cannot be changed.`, 'wrong_status')
    }
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const set: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of ['title', 'scope', 'address', 'recipientName', 'recipientPhone'] as const) if (data[k] !== undefined) set[k] = data[k]
    if (data.crewId) {
      const [cr] = await db.select().from(crew).where(and(eq(crew.id, data.crewId), eq(crew.companyId, me.companyId))).limit(1)
      if (!cr) return fail(c, 404, 'That crew does not exist.')
      set.crewId = cr.id
      if (data.recipientName === undefined) set.recipientName = cr.foremanName
      if (data.recipientPhone === undefined) set.recipientPhone = cr.foremanPhone
    }
    if (data.startDate !== undefined) {
      const start = onCompanyClock(data.startDate ?? '', await companyTimeZone(db, me.companyId))
      if (start.error) return fail(c, 400, `startDate: ${start.error}`)
      set.startDate = start.value ?? null
    }
    if (data.materialLines !== undefined || data.materialOrderId) {
      const made = await linesFrom(me.companyId, row.jobId, data.materialOrderId, data.materialLines)
      if ('error' in made) return fail(c, 404, made.error!)
      set.materialLines = made.lines
    }
    if (data.photoIds !== undefined) {
      const photoIds = [...new Set(data.photoIds)]
      if (!(await photosOk(me.companyId, row.jobId, photoIds))) return fail(c, 400, 'Those photos are not on this job.')
      set.photoIds = photoIds
    }
    // A rejected order that is changed goes back to a draft: it is a new ask, to be sent again, with the old answer cleared.
    if (row.status === 'rejected') Object.assign(set, { status: 'draft', respondedAt: null, respondedByName: null, rejectReason: null })
    const [updated] = await db.update(workOrder).set(set as any).where(and(eq(workOrder.id, row.id), eq(workOrder.companyId, me.companyId), inArray(workOrder.status, ['draft', 'sent', 'rejected']))).returning()
    if (!updated) return fail(c, 409, 'It changed while you were editing. Open it again.', 'wrong_status')
    return one(c, view(updated, true))
  })

  app.post('/:id/send', requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const me = c.get('user')
    const row = await readable(c)
    if (!row) return fail(c, 404, 'Work order not found')
    if (['completed', 'cancelled'].includes(row.status)) return fail(c, 409, `A ${row.status} work order cannot be sent.`, 'wrong_status')
    const origin = appOrigin()
    if (!origin) return fail(c, 503, 'The app’s web address is not set up, so a link cannot be made.', 'no_origin')
    const body = (await c.req.json().catch(() => null)) as { newLink?: boolean } | null
    const now = new Date()
    // The link is made the first time and keeps working on a resend; a new one only when asked for or when it has run out.
    const expired = !!(row.tokenExpiresAt && new Date(row.tokenExpiresAt) < now)
    const token = !row.publicToken || expired || body?.newLink ? newDocumentToken() : row.publicToken
    const status = row.status === 'accepted' ? 'accepted' : 'sent'
    const [sent] = await db.update(workOrder).set({
      publicToken: token, tokenExpiresAt: linkExpiry(now, row.startDate), status, sentAt: now, updatedAt: now,
      ...(row.status === 'rejected' ? { respondedAt: null, respondedByName: null, rejectReason: null } : {}),
    } as any).where(and(eq(workOrder.id, row.id), eq(workOrder.companyId, me.companyId), inArray(workOrder.status, ['draft', 'sent', 'accepted', 'rejected']))).returning()
    if (!sent) return fail(c, 409, 'It changed while you were sending. Open it again.', 'wrong_status')

    const link = `${origin}${WORK_ORDER_PAGE}/${token}`
    const [co] = await db.select({ name: company.name, enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, me.companyId)).limit(1)
    const features = (co?.enabledFeatures as string[] | null) || []
    const date = sent.startDate ? ` Start ${new Date(sent.startDate).toLocaleDateString('en-US', { timeZone: await companyTimeZone(db, me.companyId) })}.` : ''
    const message = `${co?.name || 'Your contractor'}: work order "${sent.title}" at ${sent.address || 'the job'}.${date} See the details and accept or decline: ${link}`
    let texted = false, reason = ''
    if (!features.includes('two_way_texting') && !features.includes('all')) {
      reason = 'Texting is not switched on for this account, so nothing was sent. Copy the link and send it yourself.'
    } else {
      try {
        // The shared sender refuses an opted-out number and a business whose texting is not set up, and says so.
        const r: any = await d.services.sms.sendSMS(me.companyId, { toPhone: sent.recipientPhone, message, jobId: sent.jobId, userId: me.userId })
        if (!r || r.refused || r.status === 'failed') reason = r?.errorMessage || 'The text could not be sent. Copy the link and send it yourself.'
        else texted = true
      } catch (err: any) { reason = err?.message || 'The text could not be sent. Copy the link and send it yourself.' }
    }
    await addNote(me.companyId, sent.jobId, me.userId, texted
      ? `Work order "${sent.title}" texted to ${sent.recipientName}.`
      : `Work order "${sent.title}" made ready for ${sent.recipientName} (not texted).`)
    return one(c, { ...view(sent, true), texted, ...(reason ? { notice: reason } : {}) })
  })

  app.post('/:id/cancel', requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const me = c.get('user')
    const row = await readable(c)
    if (!row) return fail(c, 404, 'Work order not found')
    if (['completed', 'cancelled'].includes(row.status)) return fail(c, 409, `It is already ${row.status}.`, 'wrong_status')
    const [cancelled] = await db.update(workOrder).set({ status: 'cancelled', updatedAt: new Date() } as any)
      .where(and(eq(workOrder.id, row.id), eq(workOrder.companyId, me.companyId), inArray(workOrder.status, ['draft', 'sent', 'accepted', 'rejected']))).returning()
    if (!cancelled) return fail(c, 409, 'It changed while you were cancelling. Open it again.', 'wrong_status')
    await addNote(me.companyId, row.jobId, me.userId, `Work order "${row.title}" cancelled.`)
    return one(c, view(cancelled, true))
  })

  app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
    const me = c.get('user')
    const row = await readable(c)
    if (!row) return fail(c, 404, 'Work order not found')
    if (!['draft', 'cancelled'].includes(row.status)) return fail(c, 409, 'Only a draft or a cancelled work order can be removed.', 'wrong_status')
    await db.delete(workOrder).where(and(eq(workOrder.id, row.id), eq(workOrder.companyId, me.companyId)))
    return done(c)
  })

  return app
}
