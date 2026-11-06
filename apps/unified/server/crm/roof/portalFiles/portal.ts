// What the customer portal shows a roofing homeowner of their own jobs (docs/parity/roof-portal-documents.md): handed to the
// shared portal as `jobFiles` (packages/tenant-backend portal.ts), which signs the customer in by their private link and
// passes their contact row here. Three rules, each enforced in the query and not by hiding a row afterwards:
//
//   · their own jobs only — job.contact_id is THIS contact, in THIS company. A photo, document or report of anyone else's job
//     is not in the list and is "not found" at its file door, whatever its id and whether or not it is shared;
//   · shared only — the explicit switch (shared_with_customer) is on for that photo, document or report. An unshared file is
//     not listed and not found, though the customer has its id;
//   · the section itself is the not-ready feature `portal_job_files` (the portal gates it), and a report also needs
//     `inspection_reports` on.
//
// What a homeowner is told of a file is named, not "everything but": a photo's caption, kind and day; a document's name, kind,
// type and day; a report's title. Never a place on the map, who uploaded it, internal notes or the stored path.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { PortalJobFiles } from '@twomiah/tenant-backend'
import { document, inspectionReport, job, jobPhoto, roofJobPost, company } from '../../../db/schema/index.ts'

/** Roofing parity row 22 (not ready): the job thread, company documents and packets. */
export const POSTS_FEATURE = 'portal_posts_packets'
import type { CrmDeps } from '../../deps.ts'
import { buildReportView } from '../inspection/view.ts'
import { reportFileName, reportPdf } from '../inspection/pdf.ts'

const MEDIA_PREFIX = '/media/'
const IMAGE = /^image\/(jpeg|png|webp|gif)$/
/** A document the browser may show in the page; everything else is a download, as the office's own file door does. */
const INLINE = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/

export function roofPortalJobFiles(d: CrmDeps): PortalJobFiles {
  const { db } = d
  const storage = d.services.storage as any
  const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null)

  /** This customer's own jobs — the only jobs a file can be shown from. */
  const jobsOf = async (contact: any) => {
    if (!contact?.id || !contact?.companyId) return []
    return db.select({ id: job.id, number: job.number, title: job.title, address: job.address, city: job.city }).from(job)
      .where(and(eq(job.companyId, contact.companyId), eq(job.contactId, contact.id))).orderBy(desc(job.createdAt), asc(job.id))
  }
  const reportsOn = (companyId: string) => d.features.isFeatureEnabled(companyId, 'inspection_reports')
  const postsOn = (companyId: string) => (companyId ? d.features.isFeatureEnabled(companyId, POSTS_FEATURE).catch(() => false) : Promise.resolve(false))

  return {
    async list(contact) {
      const jobs: any[] = await jobsOf(contact)
      if (!jobs.length) return []
      const ids = jobs.map((j) => j.id)
      const where = (t: any) => and(inArray(t.jobId, ids), eq(t.companyId, contact.companyId), eq(t.sharedWithCustomer, true))
      const [photos, docs, reports] = await Promise.all([
        db.select().from(jobPhoto).where(where(jobPhoto)).orderBy(asc(jobPhoto.takenAt), asc(jobPhoto.id)),
        db.select().from(document).where(where(document)).orderBy(desc(document.createdAt), asc(document.id)),
        (await reportsOn(contact.companyId)) ? db.select().from(inspectionReport).where(where(inspectionReport)).orderBy(desc(inspectionReport.createdAt), asc(inspectionReport.id)) : Promise.resolve([]),
      ])
      const byJob = new Map(jobs.map((j) => [j.id, j]))
      const head = (jobId: string) => {
        const j = byJob.get(jobId)!
        return { jobId, jobNumber: j.number, jobTitle: j.title, jobAddress: [j.address, j.city].filter(Boolean).join(', ') || null }
      }
      const out = [
        ...reports.map((r: any) => ({ kind: 'report', id: r.id, ...head(r.jobId), name: r.title, type: 'report', mimeType: 'application/pdf', createdAt: iso(r.updatedAt) })),
        ...docs.map((x: any) => ({ kind: 'document', id: x.id, ...head(x.jobId), name: x.name, type: x.type, mimeType: x.mimeType || null, createdAt: iso(x.createdAt) })),
        ...photos.map((p: any) => ({ kind: 'photo', id: p.id, ...head(p.jobId), name: p.caption || 'Photo', type: p.photoType, mimeType: null, takenAt: iso(p.takenAt) })),
      ]
      // Job by job in the order the customer's jobs were made, each job's reports, documents, then photos.
      const order = new Map(ids.map((id, i) => [id, i]))
      out.sort((a, b) => (order.get(a.jobId)! - order.get(b.jobId)!))
      // Row 22: the company's documents for every homeowner, then a line per job so each job's thread has a place even before a file.
      if (await postsOn(contact.companyId)) {
        const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, contact.companyId)).limit(1)
        const shared = await db.select().from(document).where(and(eq(document.companyId, contact.companyId), eq(document.sharedWithAllCustomers, true))).orderBy(desc(document.createdAt), asc(document.id))
        const companyItems = shared.map((x: any) => ({ kind: 'document', id: x.id, jobId: 'company', jobNumber: '', jobTitle: `From ${co?.name || 'us'}`, jobAddress: null, name: x.name, type: x.type, mimeType: x.mimeType || null, createdAt: iso(x.createdAt) }))
        const placeholders = jobs.map((j) => ({ kind: 'job', id: j.id, ...head(j.id), name: '' }))
        return [...out, ...placeholders, ...companyItems]
      }
      return out
    },

    posts: {
      async list(contact, jobId) {
        if (!(await postsOn(contact?.companyId))) return null
        const mine = (await jobsOf(contact)).some((j: any) => j.id === jobId)
        if (!mine) return null
        const rows = await db.select().from(roofJobPost).where(and(eq(roofJobPost.jobId, jobId), eq(roofJobPost.companyId, contact.companyId))).orderBy(asc(roofJobPost.createdAt), asc(roofJobPost.id))
        // Opening the thread reads the office's messages.
        await db.update(roofJobPost).set({ readAt: new Date() }).where(and(eq(roofJobPost.jobId, jobId), eq(roofJobPost.fromHomeowner, false), isNull(roofJobPost.readAt)))
        return rows.map((r: any) => ({ id: r.id, fromYou: !!r.fromHomeowner, body: r.body, at: iso(r.createdAt) }))
      },
      async add(contact, jobId, body) {
        if (!(await postsOn(contact?.companyId))) return null
        if (!(await jobsOf(contact)).some((j: any) => j.id === jobId)) return null
        const [r] = await db.insert(roofJobPost).values({ companyId: contact.companyId, jobId, contactId: contact.id, fromHomeowner: true, body } as any).returning()
        return { id: r.id, fromYou: true, body: r.body, at: iso(r.createdAt) }
      },
    },

    async file(contact, kind, id) {
      const jobs: any[] = await jobsOf(contact)
      if (!jobs.length) return null
      const ids = jobs.map((j) => j.id)
      const mine = (t: any) => and(eq(t.id, id), inArray(t.jobId, ids), eq(t.companyId, contact.companyId), eq(t.sharedWithCustomer, true))

      if (kind === 'photo') {
        const [p] = await db.select().from(jobPhoto).where(mine(jobPhoto)).limit(1)
        if (!p || !String(p.url || '').startsWith(MEDIA_PREFIX) || String(p.url).includes('..')) return null
        const obj = await storage.getObject(String(p.url).slice(MEDIA_PREFIX.length)).catch(() => null)
        const type = String(obj?.contentType || '')
        if (!obj || !IMAGE.test(type)) return null
        return { body: obj.body, contentType: type, filename: `photo-${p.id}.${type.split('/')[1] === 'jpeg' ? 'jpg' : type.split('/')[1]}`, inline: true }
      }

      if (kind === 'document') {
        let [x] = await db.select().from(document).where(mine(document)).limit(1)
        // Row 22: a company document every homeowner sees (warranty terms, a brochure).
        if (!x && (await postsOn(contact.companyId))) [x] = await db.select().from(document).where(and(eq(document.id, id), eq(document.companyId, contact.companyId), eq(document.sharedWithAllCustomers, true))).limit(1)
        // The company's own folder of the store, as the office's file door requires; never another company's key.
        if (!x || !x.path || String(x.path).includes('..') || !String(x.path).startsWith(`${contact.companyId}/`)) return null
        const obj = await storage.getObject(String(x.path)).catch(() => null)
        if (!obj) return null
        const type = String(x.mimeType || obj.contentType || '')
        const inline = INLINE.test(String(obj.contentType || '')) && INLINE.test(type)
        return { body: obj.body, contentType: inline ? type : 'application/octet-stream', filename: x.originalName || x.name || 'document', inline }
      }

      if (kind === 'report') {
        if (!(await reportsOn(contact.companyId))) return null
        const [r] = await db.select().from(inspectionReport).where(mine(inspectionReport)).limit(1)
        if (!r) return null
        const view = await buildReportView(db, r)
        const pdf = await reportPdf(storage, view)
        return { body: new Uint8Array(pdf), contentType: 'application/pdf', filename: reportFileName(view.job.number), inline: true }
      }
      return null
    },
  }
}
