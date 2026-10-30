// What a roofer shows a homeowner (docs/parity/roof-portal-documents.md; roofing depth gap 10), the office's side, behind
// `portal_job_files` (not ready):
//
//   GET /api/job-files?jobId=               the job's photos, documents and inspection reports, each with whether the
//                                           homeowner's portal shows it                                    jobs:read
//   PUT /api/job-files/photos/:id           { shared }                                                     portal:share
//   PUT /api/job-files/documents/:id        { shared } (a document filed under a job)                      portal:share
//   PUT /api/job-files/reports/:id          { shared } (needs inspection_reports on too)                   portal:share
//
// "Shared" is an explicit switch on each photo, document and report, OFF until someone with portal:share turns it on — the
// permission that already means "may hand the customer their way in" (contacts' portal link). Nothing is shared by being
// uploaded, by being a certain kind (a contract is not shown because it is a contract) or by the job's stage. A seat sees and
// changes the files of the jobs it may (the shared jobs rule: seatJob.ts).
//
// The homeowner's side is ./portal.ts (the customer portal's job-files section).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq } from 'drizzle-orm'
import { document, inspectionReport, jobPhoto } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { createSeatJob } from '../seatJob.ts'

const body = z.object({ shared: z.boolean({ error: 'shared is true or false' }) })

export function createJobFilesRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const jobFor = createSeatJob(d)
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const jobId = c.req.query('jobId')
    if (!jobId) return fail(c, 400, 'Say which job (jobId).', 'validation_failed', { jobId: 'Required' })
    if (!(await jobFor(c, jobId))) return fail(c, 404, 'Job not found')
    const mayDocs = await canSee(me.role, 'documents:read', me.userId).catch(() => false)
    const reportsOn = await d.features.isFeatureEnabled(me.companyId, 'inspection_reports')
    const [photos, docs, reports] = await Promise.all([
      db.select().from(jobPhoto).where(and(eq(jobPhoto.jobId, jobId), eq(jobPhoto.companyId, me.companyId))).orderBy(desc(jobPhoto.createdAt), asc(jobPhoto.id)),
      mayDocs ? db.select().from(document).where(and(eq(document.jobId, jobId), eq(document.companyId, me.companyId))).orderBy(desc(document.createdAt), asc(document.id)) : Promise.resolve([]),
      reportsOn ? db.select().from(inspectionReport).where(and(eq(inspectionReport.jobId, jobId), eq(inspectionReport.companyId, me.companyId))).orderBy(desc(inspectionReport.createdAt), asc(inspectionReport.id)) : Promise.resolve([]),
    ])
    return one(c, {
      photos: photos.map((p: any) => ({ id: p.id, caption: p.caption || null, photoType: p.photoType, url: p.url, thumbnailUrl: p.thumbnailUrl || null, takenAt: p.takenAt ? new Date(p.takenAt).toISOString() : null, shared: !!p.sharedWithCustomer })),
      documents: docs.map((x: any) => ({ id: x.id, name: x.name, type: x.type, mimeType: x.mimeType || null, shared: !!x.sharedWithCustomer })),
      reports: reports.map((r: any) => ({ id: r.id, title: r.title, shared: !!r.sharedWithCustomer })),
    })
  })

  app.put('/photos/:id', requirePermission('portal:share'), async (c) => {
    const me = c.get('user')
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [row] = await db.select().from(jobPhoto).where(and(eq(jobPhoto.id, c.req.param('id')), eq(jobPhoto.companyId, me.companyId))).limit(1)
    if (!row || !(await jobFor(c, row.jobId))) return fail(c, 404, 'Photo not found')
    await db.update(jobPhoto).set({ sharedWithCustomer: parsed.data.shared } as any).where(and(eq(jobPhoto.id, row.id), eq(jobPhoto.companyId, me.companyId)))
    return one(c, { id: row.id, shared: parsed.data.shared })
  })

  app.put('/documents/:id', requirePermission('portal:share'), async (c) => {
    const me = c.get('user')
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    // Seeing a document in the list takes documents:read; so does choosing to show it.
    if (!(await canSee(me.role, 'documents:read', me.userId).catch(() => false))) return fail(c, 403, 'Permission denied', 'permission_denied')
    const [row] = await db.select().from(document).where(and(eq(document.id, c.req.param('id')), eq(document.companyId, me.companyId))).limit(1)
    if (!row || !row.jobId || !(await jobFor(c, row.jobId))) return fail(c, 404, 'Document not found')
    await db.update(document).set({ sharedWithCustomer: parsed.data.shared, updatedAt: new Date() } as any).where(and(eq(document.id, row.id), eq(document.companyId, me.companyId)))
    return one(c, { id: row.id, shared: parsed.data.shared })
  })

  app.put('/reports/:id', requirePermission('portal:share'), async (c) => {
    const me = c.get('user')
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    if (!(await d.features.isFeatureEnabled(me.companyId, 'inspection_reports'))) return fail(c, 404, 'Not found')
    const [row] = await db.select().from(inspectionReport).where(and(eq(inspectionReport.id, c.req.param('id')), eq(inspectionReport.companyId, me.companyId))).limit(1)
    if (!row || !(await jobFor(c, row.jobId))) return fail(c, 404, 'Report not found')
    await db.update(inspectionReport).set({ sharedWithCustomer: parsed.data.shared, updatedAt: new Date() } as any).where(and(eq(inspectionReport.id, row.id), eq(inspectionReport.companyId, me.companyId)))
    return one(c, { id: row.id, shared: parsed.data.shared })
  })

  return app
}
