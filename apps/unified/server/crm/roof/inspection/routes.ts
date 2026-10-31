// Roofing's inspection report (docs/parity/roof-inspection-report.md; roofing depth gap 6), behind `inspection_reports`
// (not ready). Two mounts, both gated by that one switch (./index.ts):
//
//   /api/inspection-reports        the office — signed in, each action asking its permission
//     GET    /?jobId=              a job's reports                                        jobs:read
//     POST   /                     make one from the job's photos (damage and before, unless sections are named)   jobs:update
//     GET    /:id                  the report as the page reads it (brand, job, sections, photos)   jobs:read
//     PUT    /:id                  title, intro, sections                                  jobs:update
//     DELETE /:id                                                                           jobs:delete
//     GET    /:id/pdf              the PDF                                                  jobs:read
//     POST   /:id/link             switch the private link on (renew: a new address; expiresAt: a last day)   portal:share
//     DELETE /:id/link             switch it off                                            portal:share
//
//   /api/inspection-report-view    the homeowner's or adjuster's, by the private link — no sign-in
//     GET /:token                  the page
//     GET /:token/pdf              the PDF
//     GET /:token/photos/:photoId  one photo of THIS report (a photo not in it is not found)
//
// The link is a 64-character random token (the kind a quote's link is: tenant-backend portal/documentLinks.ts). It opens
// that one report: a wrong, switched-off or run-out link all answer the same "not valid" so nothing says which.
// A seat reads and changes only the jobs it may (the shared jobs rule: everyone's with jobs:read-all, else its own).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { isDocumentToken, newDocumentToken, publicApiBase } from '@twomiah/tenant-backend'
import { inspectionReport, job, jobPhoto } from '../../../db/schema/index.ts'
import { cleanLines, cleanText } from '../../../core/sanitize.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import { createGuessLimiter, TOKEN_GUESS_MAX, TOKEN_GUESS_WINDOW_MS } from '../../../http/guards.ts'
import type { CrmDeps } from '../../deps.ts'
import { createSeatJob } from '../seatJob.ts'
import { renderReportHtml } from './render.ts'
import { reportFileName, reportPdf } from './pdf.ts'
import { buildReportView, sectionsOf, type ReportSection, type ReportView } from './view.ts'

export const VIEW_PATH = '/api/inspection-report-view'
const MEDIA_PREFIX = '/media/'
const MAX_SECTIONS = 20
const MAX_PHOTOS = 60

const sectionBody = z.object({
  title: cleanText(1).pipe(z.string().max(80, 'A section title is 80 characters at most')),
  notes: cleanLines().pipe(z.string().max(2000, 'Section notes are 2000 characters at most')).default(''),
  photoIds: z.array(z.string().min(1)).max(MAX_PHOTOS, `A section holds ${MAX_PHOTOS} photos at most`).default([]),
})
const reportBody = z.object({
  title: cleanText(1).pipe(z.string().max(120, 'A title is 120 characters at most')),
  intro: cleanLines().pipe(z.string().max(4000, 'The introduction is 4000 characters at most')),
  sections: z.array(sectionBody).max(MAX_SECTIONS, `A report holds ${MAX_SECTIONS} sections at most`),
})

const securityHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
}
const PAGE_CSP = "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export function createInspectionReportRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const storage = d.services.storage as any

  /** This seat's job (../seatJob.ts): the company's, and unless the seat reads every job, one of its own. Null reads as 404. */
  const jobFor = createSeatJob(d)
  /** The report, if it is the company's and its job is this seat's. */
  async function reportFor(c: any, id: string) {
    const u = c.get('user')
    const [r] = await db.select().from(inspectionReport).where(and(eq(inspectionReport.id, id), eq(inspectionReport.companyId, u.companyId))).limit(1)
    if (!r) return null
    return (await jobFor(c, r.jobId)) ? r : null
  }
  /** Section photo ids that are not this job's photos, so a report cannot name another job's picture. */
  async function foreignPhotoIds(companyId: string, jobId: string, sections: ReportSection[]) {
    const wanted = [...new Set(sections.flatMap((s) => s.photoIds))]
    if (!wanted.length) return []
    const rows = await db.select({ id: jobPhoto.id }).from(jobPhoto).where(and(inArray(jobPhoto.id, wanted), eq(jobPhoto.jobId, jobId), eq(jobPhoto.companyId, companyId)))
    const ok = new Set(rows.map((r: any) => r.id))
    return wanted.filter((id) => !ok.has(id))
  }
  /** Each photo once, in the first section that names it. */
  const dedupe = (sections: ReportSection[]): ReportSection[] => {
    const seen = new Set<string>()
    return sections.map((s) => ({ ...s, photoIds: s.photoIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true))) }))
  }
  const linkOf = (r: any) => {
    if (!r.publicToken) return null
    const path = `${VIEW_PATH}/${r.publicToken}`
    return { token: r.publicToken, path, url: `${publicApiBase()}${path}`, pdfPath: `${path}/pdf`, expiresAt: r.linkExpiresAt ? new Date(r.linkExpiresAt).toISOString() : null, expired: !!r.linkExpiresAt && new Date(r.linkExpiresAt).getTime() <= Date.now() }
  }
  const shaped = async (r: any) => ({
    ...(await buildReportView(db, r)), sharedWithCustomer: !!r.sharedWithCustomer, link: linkOf(r), createdAt: new Date(r.createdAt).toISOString(),
  })

  // GET /?jobId= — a job's reports, newest first.
  app.get('/', requirePermission('jobs:read'), async (c) => {
    const jobId = c.req.query('jobId')
    if (!jobId) return fail(c, 400, 'Say which job (jobId).', 'validation_failed', { jobId: 'Required' })
    if (!(await jobFor(c, jobId))) return fail(c, 404, 'Job not found')
    const rows = await db.select().from(inspectionReport).where(and(eq(inspectionReport.jobId, jobId), eq(inspectionReport.companyId, c.get('user').companyId))).orderBy(desc(inspectionReport.createdAt), asc(inspectionReport.id))
    return listAll(c, rows.map((r: any) => ({
      id: r.id, jobId: r.jobId, title: r.title, photoCount: sectionsOf(r.sections).reduce((n, s) => n + s.photoIds.length, 0),
      linkOn: !!r.publicToken, sharedWithCustomer: !!r.sharedWithCustomer, updatedAt: new Date(r.updatedAt).toISOString(),
    })))
  })

  // POST / — make a report from the job's photos. With no sections named it takes the job's damage photos and its before
  // photos, each in a section of its own, in the order they were taken.
  app.post('/', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const raw: any = (await c.req.json().catch(() => null)) ?? {}
    const jobId = typeof raw.jobId === 'string' ? raw.jobId : ''
    const jb = jobId ? await jobFor(c, jobId) : null
    if (!jb) return fail(c, 404, 'Job not found')
    const parsed = reportBody.safeParse({ title: raw.title ?? `Roof inspection — ${jb.address || jb.number}`.slice(0, 120), intro: raw.intro ?? '', sections: raw.sections ?? [] })
    if (!parsed.success) return invalid(c, parsed.error)
    const { title, intro } = parsed.data
    let sections: ReportSection[]
    if (raw.sections !== undefined) {
      sections = dedupe(parsed.data.sections)
      const foreign = await foreignPhotoIds(me.companyId, jobId, sections)
      if (foreign.length) return fail(c, 400, 'Some of those photos are not on this job.', 'validation_failed', { sections: 'Photos must be this job’s own' })
    } else {
      const all = await db.select({ id: jobPhoto.id, photoType: jobPhoto.photoType, sourcePhotoId: jobPhoto.sourcePhotoId }).from(jobPhoto)
        .where(and(eq(jobPhoto.jobId, jobId), eq(jobPhoto.companyId, me.companyId), inArray(jobPhoto.photoType, ['damage', 'before']))).orderBy(asc(jobPhoto.takenAt), asc(jobPhoto.id))
      // A photo that has been drawn on shows its marked copy (photoMarkup/): the arrows are the point of the picture. The
      // original stays on the job, and the report can still be changed to use it.
      const marked = new Set(all.map((p: any) => p.sourcePhotoId).filter(Boolean))
      const photos = all.filter((p: any) => !marked.has(p.id))
      sections = []
      for (const [type, name] of [['damage', 'Damage found'], ['before', 'Before']] as const) {
        const ids = photos.filter((p: any) => p.photoType === type).map((p: any) => p.id).slice(0, MAX_PHOTOS)
        if (ids.length) sections.push({ title: name, notes: '', photoIds: ids })
      }
    }
    const [made] = await db.insert(inspectionReport).values({ companyId: me.companyId, jobId, title, intro: intro || null, sections, createdById: me.userId } as any).returning()
    return one(c, await shaped(made), 201)
  })

  app.get('/:id', requirePermission('jobs:read'), async (c) => {
    const r = await reportFor(c, c.req.param('id'))
    return r ? one(c, await shaped(r)) : fail(c, 404, 'Report not found')
  })

  app.put('/:id', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const r = await reportFor(c, c.req.param('id'))
    if (!r) return fail(c, 404, 'Report not found')
    const raw: any = (await c.req.json().catch(() => null)) ?? {}
    const parsed = reportBody.safeParse({ title: raw.title ?? r.title, intro: raw.intro ?? r.intro ?? '', sections: raw.sections ?? sectionsOf(r.sections) })
    if (!parsed.success) return invalid(c, parsed.error)
    const sections = dedupe(parsed.data.sections)
    if ((await foreignPhotoIds(me.companyId, r.jobId, sections)).length) return fail(c, 400, 'Some of those photos are not on this job.', 'validation_failed', { sections: 'Photos must be this job’s own' })
    const [saved] = await db.update(inspectionReport).set({ title: parsed.data.title, intro: parsed.data.intro || null, sections, updatedAt: new Date() } as any)
      .where(and(eq(inspectionReport.id, r.id), eq(inspectionReport.companyId, me.companyId))).returning()
    return one(c, await shaped(saved))
  })

  app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
    const r = await reportFor(c, c.req.param('id'))
    if (!r) return fail(c, 404, 'Report not found')
    await db.delete(inspectionReport).where(and(eq(inspectionReport.id, r.id), eq(inspectionReport.companyId, r.companyId)))
    return c.body(null, 204)
  })

  app.get('/:id/pdf', requirePermission('jobs:read'), async (c) => {
    const r = await reportFor(c, c.req.param('id'))
    if (!r) return fail(c, 404, 'Report not found')
    return pdfResponse(await buildReportView(db, r), r.companyId)
  })

  // The private link: on (a first time or a renewed one), with an optional last day; off.
  app.post('/:id/link', requirePermission('portal:share'), async (c) => {
    const r = await reportFor(c, c.req.param('id'))
    if (!r) return fail(c, 404, 'Report not found')
    const parsed = z.object({ renew: z.boolean().optional(), expiresAt: z.string().datetime({ offset: true }).nullable().optional() }).safeParse((await c.req.json().catch(() => null)) ?? {})
    if (!parsed.success) return invalid(c, parsed.error)
    if (parsed.data.expiresAt && new Date(parsed.data.expiresAt).getTime() <= Date.now()) return fail(c, 400, 'The last day has to be in the future.', 'validation_failed', { expiresAt: 'Choose a later day' })
    const set: any = { updatedAt: new Date() }
    if (!r.publicToken || parsed.data.renew) set.publicToken = newDocumentToken()
    if (parsed.data.expiresAt !== undefined) set.linkExpiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
    else if (parsed.data.renew) set.linkExpiresAt = null
    const [saved] = await db.update(inspectionReport).set(set).where(and(eq(inspectionReport.id, r.id), eq(inspectionReport.companyId, r.companyId))).returning()
    return one(c, { link: linkOf(saved) })
  })
  app.delete('/:id/link', requirePermission('portal:share'), async (c) => {
    const r = await reportFor(c, c.req.param('id'))
    if (!r) return fail(c, 404, 'Report not found')
    await db.update(inspectionReport).set({ publicToken: null, linkExpiresAt: null, updatedAt: new Date() } as any).where(and(eq(inspectionReport.id, r.id), eq(inspectionReport.companyId, r.companyId)))
    return done(c)
  })

  async function pdfResponse(view: ReportView, _companyId: string) {
    const pdf = await reportPdf(storage, view)
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${reportFileName(view.job.number)}"`, ...securityHeaders } })
  }

  return { app, pdfResponse }
}

/** The link's side: a homeowner or adjuster opens one report by its token. */
export function createInspectionViewRoutes(d: CrmDeps, shared: { pdfResponse: (view: ReportView, companyId: string) => Promise<Response> }) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const NOT_VALID = 'This link is not valid. Please contact the business that sent it.'

  /** The report this link names — a wrong, switched-off or run-out link are all null. */
  const guesses = createGuessLimiter(TOKEN_GUESS_WINDOW_MS, TOKEN_GUESS_MAX)
  async function byToken(c: any, token: string) {
    // An address that keeps missing is answered like a wrong token (never a 429), valid link or not.
    if (guesses.shut(c)) return null
    if (!isDocumentToken(token)) { guesses.miss(c); return null }
    const [r] = await db.select().from(inspectionReport).where(eq(inspectionReport.publicToken, token)).limit(1)
    if (!r) { guesses.miss(c); return null }
    if (r.linkExpiresAt && new Date(r.linkExpiresAt).getTime() <= Date.now()) return null
    return r
  }

  app.get('/:token', async (c) => {
    const r = await byToken(c, c.req.param('token'))
    if (!r) return c.html(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Link not valid</title><body style="font:16px system-ui;padding:2rem"><p>${NOT_VALID}</p>`, 404, securityHeaders)
    const view = await buildReportView(db, r)
    const base = `${VIEW_PATH}/${r.publicToken}`
    return c.html(renderReportHtml(view, { photoSrc: (p) => `${base}/photos/${p.id}`, pdfHref: `${base}/pdf` }), 200, { ...securityHeaders, 'Content-Security-Policy': PAGE_CSP })
  })

  app.get('/:token/pdf', async (c) => {
    const r = await byToken(c, c.req.param('token'))
    if (!r) return fail(c, 404, NOT_VALID)
    return shared.pdfResponse(await buildReportView(db, r), r.companyId)
  })

  // One photo of THIS report: its id has to be one the report names, on the report's own job.
  app.get('/:token/photos/:photoId', async (c) => {
    const r = await byToken(c, c.req.param('token'))
    if (!r) return fail(c, 404, NOT_VALID)
    const photoId = c.req.param('photoId')
    if (!sectionsOf(r.sections).some((s) => s.photoIds.includes(photoId))) return fail(c, 404, 'Photo not found')
    const [p] = await db.select().from(jobPhoto).where(and(eq(jobPhoto.id, photoId), eq(jobPhoto.jobId, r.jobId), eq(jobPhoto.companyId, r.companyId))).limit(1)
    if (!p || !String(p.url || '').startsWith(MEDIA_PREFIX) || String(p.url).includes('..')) return fail(c, 404, 'Photo not found')
    try {
      const obj = await (d.services.storage as any).getObject(String(p.url).slice(MEDIA_PREFIX.length))
      const type = String(obj?.contentType || '')
      if (!obj || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return fail(c, 404, 'Photo not found')
      return new Response(obj.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } })
    } catch { return fail(c, 404, 'Photo not found') }
  })
  return app
}
