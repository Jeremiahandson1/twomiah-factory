// The visit-done message, on the crew's and the office's side (server/data/visitReports.ts has the rules), mounted at
// /api/visit-reports behind the 'visit_reports' feature:
//
//   GET  /                         the recent reports and what became of each                      jobs:read (a crew seat: its own jobs)
//   GET  /job/:jobId               one visit's report, its after-photos and its other photos        jobs:read (own job for a crew seat)
//   PUT  /job/:jobId               the crew's note for the customer; `skip` is the office's         jobs:update (skip: jobs:dispatch)
//   POST /job/:jobId/photos        an after-photo (kept as the job's photo, marked "after")         jobs:update
//   PUT  /job/:jobId/photos/:id    mark an existing job photo as an after-photo, or take it off     jobs:update
//   POST /job/:jobId/send          send (or send again) now, for a finished visit                  jobs:update + jobs:dispatch
//
// Row 26 (visit_message_tools, not ready; Yardbook's office side):
//   GET  /job/:jobId/preview       what the customer would get now, nothing sent                    jobs:read + jobs:dispatch
//   GET  /settings                 the message's own words, the services never messaged, the alert line   jobs:read
//   PUT  /settings                                                                                   settings:update
//   PUT  /stops/:stopId            a route stop's "no visit-done message"                           jobs:update + jobs:dispatch
//
// The message itself goes out by itself when the visit is completed (crm/services.ts onComplete). A crew seat works only the jobs
// it is on; a seat that may dispatch works anyone's. Nothing here shows the job's money.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import sharp from 'sharp'
import { and, eq, asc } from 'drizzle-orm'
import { JOB_DISPATCH_PERMISSION, sniffType } from '@twomiah/tenant-backend'
import { job, jobPhoto } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import {
  getReport, saveReport, sendVisitReport, recentReports, visitSendDeps, AFTER, BEFORE, MAX_NOTE, VISIT_TOOLS, VISIT_SURVEY,
  previewVisitReport, getVisitSettings, saveVisitSettings, templateProblem, setStopSkip, PLACEHOLDERS, DEFAULT_TEMPLATES, TEMPLATE_LIMITS,
} from '../../data/visitReports.ts'

const MEDIA_PREFIX = '/media/'
const MAX_UPLOAD = 25 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function createVisitReportRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const storage = d.services.storage as any
  const app = new Hono<AppEnv>()

  const may = async (c: any, perm: string): Promise<boolean> => {
    const u = c.get('user')
    try { return hasPermission(u?.role, perm, await getExtraPermissions(u?.userId)) } catch { return false }
  }
  const on = (companyId: string, feature: string) => d.features.isFeatureEnabled(companyId, feature).catch(() => false)
  /** The not-ready switches the message reads (rows 26 and 31). */
  const flags = async (companyId: string) => ({ tools: await on(companyId, VISIT_TOOLS), survey: await on(companyId, VISIT_SURVEY) })
  /** The job, if it is this company's and this seat may work it (its own, or a dispatcher's). */
  const workable = async (c: any, jobId: string) => {
    const u = c.get('user')
    const [j] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, u.companyId))).limit(1)
    if (!j) return { error: fail(c, 404, 'Job not found') }
    if (!(await may(c, JOB_DISPATCH_PERMISSION)) && j.assignedToId !== u.userId) return { error: fail(c, 403, 'This visit is on another crew.') }
    return { job: j }
  }

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const all = await recentReports(db, u.companyId, { limit: Number(c.req.query('limit')) || 100 })
    const own = !(await may(c, JOB_DISPATCH_PERMISSION))
    return listAll(c, own ? all.filter((r: any) => r.assignedToId === u.userId) : all)
  })

  app.get('/job/:jobId', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const w = await workable(c, c.req.param('jobId'))
    if ('error' in w) return w.error
    const report = await getReport(db, u.companyId, w.job.id)
    const photos = await db.select().from(jobPhoto).where(and(eq(jobPhoto.companyId, u.companyId), eq(jobPhoto.jobId, w.job.id))).orderBy(asc(jobPhoto.createdAt), asc(jobPhoto.id))
    return one(c, {
      jobId: w.job.id, status: report?.status ?? 'draft', note: report?.note ?? null, skip: report?.skip ?? false, channel: report?.channel ?? null,
      sendAt: report?.sendAt ?? null, sentAt: report?.sentAt ?? null, error: report?.error ?? null,
      // Row 26: a copy of what was sent; row 31: the customer's rating.
      messageSubject: report?.messageSubject ?? null, messageText: report?.messageText ?? null,
      rating: report?.rating ?? null, ratingComment: report?.ratingComment ?? null, ratedAt: report?.ratedAt ?? null,
      photos: photos.map((p: any) => ({ id: p.id, url: p.url, caption: p.caption, after: p.photoType === AFTER, kind: p.photoType === BEFORE ? 'before' : p.photoType === AFTER ? 'after' : null })),
    })
  })

  app.put('/job/:jobId', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const w = await workable(c, c.req.param('jobId'))
    if ('error' in w) return w.error
    const b: any = await c.req.json().catch(() => ({}))
    const patch: { note?: string | null; skip?: boolean } = {}
    if (b?.note !== undefined) {
      if (b.note !== null && typeof b.note !== 'string') return fail(c, 400, 'The note is text.', undefined, { note: 'Invalid' })
      if (typeof b.note === 'string' && b.note.length > MAX_NOTE) return fail(c, 400, `Keep the note under ${MAX_NOTE} characters.`, undefined, { note: 'Too long' })
      patch.note = b.note
    }
    if (b?.skip !== undefined) {
      // Deciding a customer is not to be told is the office's call.
      if (!(await may(c, JOB_DISPATCH_PERMISSION))) return fail(c, 403, 'Only the office can choose not to message the customer.')
      patch.skip = b.skip === true
    }
    const row = await saveReport(db, u.companyId, w.job.id, patch)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'visit_report', entityId: row.id, entityName: `Visit note — ${w.job.title}`, userId: u.userId, companyId: u.companyId })
    return one(c, { jobId: w.job.id, status: row.status, note: row.note, skip: row.skip })
  })

  app.post('/job/:jobId/photos', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const w = await workable(c, c.req.param('jobId'))
    if ('error' in w) return w.error
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('photo')
    if (!file || typeof file === 'string') return fail(c, 400, 'Choose a photo.')
    if (file.size > MAX_UPLOAD) return fail(c, 400, 'That photo is over 25 MB.')
    const input = Buffer.from(await file.arrayBuffer())
    // Trust the bytes, not the declared type (the job photos' rule).
    const type = sniffType(input) || ''
    if (!IMAGE_TYPES.includes(type)) return fail(c, 400, 'That file is not a photo we can use.')
    // Sent in a text, a picture must stay small (carriers refuse over 5 MB), so it is kept web-sized.
    let body: Buffer
    try { body = await sharp(input).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer() }
    catch { return fail(c, 400, 'That file is not a photo we can use.') }
    const key = `photos/${u.companyId}/${w.job.id}/${crypto.randomUUID().replace(/-/g, '')}.jpg`
    await storage.put(key, body, 'image/jpeg')
    const caption = typeof form!.get('caption') === 'string' ? String(form!.get('caption')).slice(0, 200) || null : null
    const [photo] = await db.insert(jobPhoto).values({ companyId: u.companyId, jobId: w.job.id, uploadedById: u.userId, url: MEDIA_PREFIX + key, caption, photoType: AFTER }).returning()
    return one(c, { id: photo.id, url: photo.url, caption: photo.caption, after: true }, 201)
  })

  app.put('/job/:jobId/photos/:photoId', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const w = await workable(c, c.req.param('jobId'))
    if ('error' in w) return w.error
    const b: any = await c.req.json().catch(() => ({}))
    // `kind` 'before' | 'after' (the phone's before/after photos); else the older switch: after, or not.
    const photoType = b?.kind === BEFORE || b?.kind === AFTER ? b.kind : b?.after === false ? 'general' : AFTER
    const [photo] = await db.update(jobPhoto).set({ photoType })
      .where(and(eq(jobPhoto.id, c.req.param('photoId')), eq(jobPhoto.jobId, w.job.id), eq(jobPhoto.companyId, u.companyId))).returning()
    if (!photo) return fail(c, 404, 'Photo not found')
    return one(c, { id: photo.id, after: photo.photoType === AFTER, kind: photo.photoType === BEFORE ? 'before' : photo.photoType === AFTER ? 'after' : null })
  })

  app.post('/job/:jobId/send', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    const [j] = await db.select({ id: job.id, title: job.title }).from(job).where(and(eq(job.id, c.req.param('jobId')), eq(job.companyId, u.companyId))).limit(1)
    if (!j) return fail(c, 404, 'Job not found')
    const r = await sendVisitReport(db, visitSendDeps((m) => (d.services as any).emailService.sendRaw(m)), u.companyId, j.id, { force: true, ...(await flags(u.companyId)) })
    if (r.status === 'not_done') return fail(c, 409, r.reason)
    if (r.status === 'skipped' || r.status === 'nothing' || r.status === 'failed') return fail(c, 409, r.reason)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'visit_report', entityId: j.id, entityName: `Visit message sent — ${j.title}`, userId: u.userId, companyId: u.companyId })
    return one(c, r)
  })

  // ---- Row 26 (visit_message_tools, not ready) ----
  const toolsOn = async (c: any) => on(c.get('user').companyId, VISIT_TOOLS)

  app.get('/job/:jobId/preview', requirePermission('jobs:read'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    if (!(await toolsOn(c))) return fail(c, 404, 'Not found')
    const p = await previewVisitReport(db, u.companyId, c.req.param('jobId'), await flags(u.companyId))
    if (!p) return fail(c, 404, 'Job not found')
    return one(c, p)
  })

  app.get('/settings', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    if (!(await toolsOn(c))) return fail(c, 404, 'Not found')
    return one(c, { ...(await getVisitSettings(db, u.companyId)), placeholders: PLACEHOLDERS, defaults: DEFAULT_TEMPLATES, limits: TEMPLATE_LIMITS })
  })

  app.put('/settings', requirePermission('settings:update'), async (c) => {
    const u = c.get('user')
    if (!(await toolsOn(c))) return fail(c, 404, 'Not found')
    const b: any = await c.req.json().catch(() => ({}))
    const patch: Parameters<typeof saveVisitSettings>[2] = {}
    for (const k of ['text', 'subject', 'email'] as const) {
      if (b?.[k] === undefined) continue
      if (b[k] !== null && typeof b[k] !== 'string') return fail(c, 400, 'The wording is text.', undefined, { [k]: 'Invalid' })
      const problem = b[k] ? templateProblem(k, b[k]) : null
      if (problem) return fail(c, 400, problem, undefined, { [k]: problem })
      patch[k] = b[k]
    }
    if (b?.skipServices !== undefined) {
      if (!Array.isArray(b.skipServices) || b.skipServices.some((x: unknown) => typeof x !== 'string' || x.length > 60)) return fail(c, 400, 'List the services by name.', undefined, { skipServices: 'Invalid' })
      patch.skipServices = b.skipServices
    }
    if (b?.alertBelow !== undefined) {
      const n = Number(b.alertBelow)
      if (!Number.isInteger(n) || n < 1 || n > 5) return fail(c, 400, 'The alert line is a rating from 1 to 5.', undefined, { alertBelow: '1 to 5' })
      patch.alertBelow = n
    }
    const saved = await saveVisitSettings(db, u.companyId, patch)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'landscaping_setting', entityId: u.companyId, entityName: 'Visit message wording', userId: u.userId, companyId: u.companyId })
    return one(c, saved)
  })

  app.put('/stops/:stopId', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    if (!(await toolsOn(c))) return fail(c, 404, 'Not found')
    const b: any = await c.req.json().catch(() => ({}))
    if (typeof b?.skip !== 'boolean') return fail(c, 400, 'Say whether this stop is messaged.', undefined, { skip: 'Yes or no' })
    const row = await setStopSkip(db, u.companyId, c.req.param('stopId'), b.skip)
    if (!row) return fail(c, 404, 'Stop not found')
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'recurring_route_stop', entityId: row.id, entityName: b.skip ? 'No visit-done message' : 'Visit-done message on', userId: u.userId, companyId: u.companyId })
    return one(c, { id: row.id, skipVisitMessage: row.skip })
  })

  return app
}
