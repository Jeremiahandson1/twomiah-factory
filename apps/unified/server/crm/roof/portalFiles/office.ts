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
import { PORTAL_TOOLS, closeOnCollected, setCloseOnCollected, homeownerOf } from '../../../data/homeownerPortal.ts'
import { roofPortalJobFiles } from './portal.ts'
import { company as companyTable } from '../../../db/schema/index.ts'
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { document, inspectionReport, jobPhoto, roofJobPost } from '../../../db/schema/index.ts'
import { POSTS_FEATURE } from './portal.ts'
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

  // ---- Row 21 (portal_tools, not ready; AccuLynx): see it as the homeowner, tell them, their last visit, close on Collected ----
  const toolsOn = (c: any) => d.features.isFeatureEnabled(c.get('user').companyId, PORTAL_TOOLS).catch(() => false)
  const homeownerFiles = roofPortalJobFiles(d)
  app.get('/homeowner', requirePermission('jobs:read'), async (c) => {
    if (!(await toolsOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const jobId = c.req.query('jobId') || ''
    if (!(await jobFor(c, jobId))) return fail(c, 404, 'Job not found')
    const who = await homeownerOf(db, me.companyId, jobId)
    // Exactly what their portal lists for this job (the portal's own list, filtered to the job).
    // The files only: a job's own line (kind 'job', no name — the place its message thread hangs in the portal) is not a file, and
    // showed as a blank "(Job)" here (roofing live test 11/07).
    const sees = who ? (await homeownerFiles.list(who)).filter((f: any) => f.jobId === jobId && f.kind !== 'job') : []
    return one(c, {
      homeowner: who ? { name: who.name, portalOn: !!who.portalEnabled && !!who.portalToken, lastVisit: who.lastPortalVisit ? new Date(who.lastPortalVisit).toISOString() : null } : null,
      sees, closeOnCollected: await closeOnCollected(db, me.companyId),
    })
  })
  app.put('/settings', requirePermission('company:update'), async (c) => {
    if (!(await toolsOn(c))) return fail(c, 404, 'Not found')
    const b: any = await c.req.json().catch(() => ({}))
    if (typeof b?.closeOnCollected !== 'boolean') return fail(c, 400, 'Say whether the portal closes when the job is Collected.')
    return one(c, { closeOnCollected: await setCloseOnCollected(db, c.get('user').companyId, b.closeOnCollected) })
  })
  app.post('/notify', requirePermission('portal:share'), async (c) => {
    if (!(await toolsOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const jobId = String(b?.jobId || '')
    if (!(await jobFor(c, jobId))) return fail(c, 404, 'Job not found')
    const who = await homeownerOf(db, me.companyId, jobId)
    if (!who) return fail(c, 409, 'This job has no homeowner to tell.')
    if (!who.portalEnabled || !who.portalToken) return fail(c, 409, 'Their portal is off. Turn it on from the contact first.')
    const origin = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    if (!/^https?:\/\//.test(origin)) return fail(c, 409, 'The app’s web address is not set, so there is no link to send.')
    const link = `${origin}/portal/${who.portalToken}`
    const [co] = await db.select({ name: companyTable.name }).from(companyTable).where(eq(companyTable.id, me.companyId)).limit(1)
    const first = String(who.name || '').trim().split(/\s+/)[0] || 'there'
    const message = `Hi ${first}, ${co?.name || 'we'} added new photos and documents for your project. See them at ${link}`
    const mobile = String(who.mobile || who.phone || '').trim()
    if (mobile && !who.optedOutSms) {
      const r: any = await d.services.sms.sendSMS(me.companyId, { contactId: who.id, message, jobId, userId: me.userId }).catch((e: any) => ({ success: false, error: e?.message }))
      if (r?.success === false) return fail(c, 502, r.error ? `The text was not sent: ${r.error}` : 'The text was not sent.')
      return one(c, { sent: 'text' })
    }
    if (String(who.email || '').trim() && !who.emailOptOut) {
      const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
      await (d.services as any).emailService.sendRaw({ to: String(who.email).trim(), subject: `New photos and documents for your project — ${co?.name || ''}`.trim(), html: `<p>${esc(message.replace(link, ''))}</p><p><a href="${esc(link)}">Open your portal</a></p>` })
      return one(c, { sent: 'email' })
    }
    return fail(c, 409, 'No way to reach the homeowner: no phone or email, or they opted out.')
  })

  // ---- Row 22 (portal_posts_packets, not ready; AccuLynx): the job thread, packets, company documents ----
  const postsOn = (c: any) => d.features.isFeatureEnabled(c.get('user').companyId, POSTS_FEATURE).catch(() => false)
  app.get('/posts', requirePermission('jobs:read'), async (c) => {
    if (!(await postsOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const jobId = c.req.query('jobId') || ''
    if (!(await jobFor(c, jobId))) return fail(c, 404, 'Job not found')
    const rows = await db.select().from(roofJobPost).where(and(eq(roofJobPost.jobId, jobId), eq(roofJobPost.companyId, me.companyId))).orderBy(asc(roofJobPost.createdAt), asc(roofJobPost.id))
    await db.update(roofJobPost).set({ readAt: new Date() }).where(and(eq(roofJobPost.jobId, jobId), eq(roofJobPost.fromHomeowner, true), isNull(roofJobPost.readAt)))
    return one(c, { data: rows.map((r: any) => ({ id: r.id, fromHomeowner: !!r.fromHomeowner, body: r.body, at: r.createdAt, read: !!r.readAt })) })
  })
  app.post('/posts', requirePermission('portal:share'), async (c) => {
    if (!(await postsOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const j = await jobFor(c, String(b?.jobId || ''))
    if (!j) return fail(c, 404, 'Job not found')
    const text = typeof b?.body === 'string' ? b.body.trim() : ''
    if (!text || text.length > 4000) return fail(c, 400, 'Write the message (4,000 characters at most).', 'validation_failed', { body: 'Required' })
    const [r] = await db.insert(roofJobPost).values({ companyId: me.companyId, jobId: (j as any).id ?? b.jobId, contactId: (j as any).contactId ?? null, fromHomeowner: false, userId: me.userId, body: text } as any).returning()
    return one(c, { id: r.id, fromHomeowner: false, body: r.body, at: r.createdAt, read: false }, 201)
  })
  // Share several of the job's files in one go (a packet), and — if asked — tell the homeowner once.
  app.put('/packet', requirePermission('portal:share'), async (c) => {
    if (!(await postsOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const jobId = String(b?.jobId || '')
    if (!(await jobFor(c, jobId))) return fail(c, 404, 'Job not found')
    const items: Array<{ kind: string; id: string }> = Array.isArray(b?.items) ? b.items.filter((x: any) => x && typeof x.id === 'string' && ['photos', 'documents', 'reports'].includes(x.kind)).slice(0, 200) : []
    if (!items.length) return fail(c, 400, 'Pick the files to share.')
    const ids = (k: string) => items.filter((x) => x.kind === k).map((x) => x.id)
    const scope = (t: any, k: string) => and(eq(t.companyId, me.companyId), eq(t.jobId, jobId), inArray(t.id, ids(k).length ? ids(k) : ['']))
    const a = await db.update(jobPhoto).set({ sharedWithCustomer: true } as any).where(scope(jobPhoto, 'photos')).returning({ id: jobPhoto.id })
    const docOk = await canSee(me.role, 'documents:read', me.userId).catch(() => false)
    const bdocs = docOk ? await db.update(document).set({ sharedWithCustomer: true, updatedAt: new Date() } as any).where(scope(document, 'documents')).returning({ id: document.id }) : []
    const rep = (await d.features.isFeatureEnabled(me.companyId, 'inspection_reports')) ? await db.update(inspectionReport).set({ sharedWithCustomer: true, updatedAt: new Date() } as any).where(scope(inspectionReport, 'reports')).returning({ id: inspectionReport.id }) : []
    return one(c, { shared: a.length + bdocs.length + rep.length })
  })
  // The company's own documents (no job, no customer) and whether every homeowner's portal shows each.
  app.get('/company-documents', requirePermission('documents:read'), async (c) => {
    if (!(await postsOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const rows = await db.select().from(document).where(and(eq(document.companyId, me.companyId), isNull(document.jobId), isNull(document.contactId), isNull(document.projectId))).orderBy(desc(document.createdAt), asc(document.id)).limit(500)
    return one(c, { data: rows.map((x: any) => ({ id: x.id, name: x.name, type: x.type, shared: !!x.sharedWithAllCustomers })) })
  })
  app.put('/company-documents/:id', requirePermission('portal:share'), async (c) => {
    if (!(await postsOn(c))) return fail(c, 404, 'Not found')
    const me = c.get('user')
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [row] = await db.update(document).set({ sharedWithAllCustomers: parsed.data.shared, updatedAt: new Date() } as any)
      .where(and(eq(document.id, c.req.param('id')), eq(document.companyId, me.companyId), isNull(document.jobId), isNull(document.contactId))).returning({ id: document.id })
    if (!row) return fail(c, 404, 'Document not found')
    return one(c, { id: row.id, shared: parsed.data.shared })
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
