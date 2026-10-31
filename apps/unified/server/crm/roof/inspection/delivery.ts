// Getting a finished inspection report to people (docs/parity/roof-inspection-report.md #11, #12), added to the office routes:
//
//   POST /:id/send   { via: 'sms' | 'email', message? }   the private link to the job's homeowner, through the CRM's own texting or
//                    email sender (the one every stage text and quote email goes through), recorded on the job's timeline   portal:share
//   POST /:id/copy                                         a FROZEN PDF of the report as it reads now, filed under the job's
//                    documents (type Inspection); later edits to the report do not change it                                documents:create
//
// Sending switches the private link on if it is off (or renews one that ran out), because a link that does not open is not a
// report sent. Nothing is recorded as sent unless the sender took it: a refusal (the homeowner opted out, texting not set up, no
// email provider) comes back in words and the report is not marked sent.
import type { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { newDocumentToken } from '@twomiah/tenant-backend'
import { company, contact, document, inspectionReport, jobNote } from '../../../db/schema/index.ts'
import { cleanLines } from '../../../core/sanitize.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { reportSavedBody, reportSentBody } from '../jobRecord.ts'
import { firstNameOf } from '../validation.ts'
import { reportFileName, reportPdf } from './pdf.ts'
import { buildReportView } from './view.ts'

const sendBody = z.object({ via: z.enum(['sms', 'email']), message: cleanLines().pipe(z.string().max(500, 'A note is 500 characters at most')).optional() })

export interface Copy { documentId: string; savedAt: string; savedById: string | null }
export const copiesRaw = (raw: unknown): Copy[] => (Array.isArray(raw) ? raw.filter((x: any) => x && typeof x.documentId === 'string') : [])

/** What the homeowner can be reached by, and why not when not: for the screen to enable or explain its buttons. */
export async function reachFor(d: CrmDeps, companyId: string, jobContactId: string | null) {
  const { db } = d
  const [co] = await db.select({ name: company.name, enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
  const features = (co?.enabledFeatures as string[] | null) || []
  const [who] = jobContactId ? await db.select().from(contact).where(and(eq(contact.id, jobContactId), eq(contact.companyId, companyId))).limit(1) : []
  const number = who ? who.mobile || who.phone || null : null
  const textingOn = features.includes('two_way_texting') || features.includes('all')
  const textBlocked = !who ? 'This job has no homeowner on file.'
    : !number ? `${firstNameOf(who.name)} has no phone number on file.`
    : who.optedOutSms ? `${firstNameOf(who.name)} has opted out of texts.`
    : !textingOn ? 'Texting is not switched on for this account.' : null
  const emailBlocked = !who ? 'This job has no homeowner on file.' : !who.email ? `${firstNameOf(who.name)} has no email address on file.` : null
  return { who: who || null, companyName: co?.name || '', features, number, textBlocked, emailBlocked }
}

export function addDeliveryRoutes(app: Hono<AppEnv>, d: CrmDeps, h: {
  reportFor: (c: any, id: string) => Promise<any | null>
  jobFor: (c: any, jobId: string) => Promise<any | null>
  linkOf: (r: any) => { url: string } | null
}) {
  const { db } = d
  const { requirePermission } = d.permissions
  const storage = d.services.storage as any
  const note = (companyId: string, jobId: string, userId: string | null, body: string) =>
    db.insert(jobNote).values({ companyId, jobId, userId, isInternal: true, body } as any)

  app.post('/:id/send', requirePermission('portal:share'), async (c) => {
    const me = c.get('user')
    const r = await h.reportFor(c, c.req.param('id'))
    if (!r) return fail(c, 404, 'Report not found')
    const parsed = sendBody.safeParse((await c.req.json().catch(() => null)) ?? {})
    if (!parsed.success) return invalid(c, parsed.error)
    const { via, message } = parsed.data
    const jb = await h.jobFor(c, r.jobId)
    const reach = await reachFor(d, me.companyId, jb?.contactId ?? null)
    const blocked = via === 'sms' ? reach.textBlocked : reach.emailBlocked
    if (blocked || !reach.who) return fail(c, 409, blocked || 'This job has no homeowner on file.', 'cannot_send')

    // The link has to open: switched on, and not run out.
    let row = r
    if (!row.publicToken || (row.linkExpiresAt && new Date(row.linkExpiresAt).getTime() <= Date.now())) {
      ;[row] = await db.update(inspectionReport).set({ publicToken: newDocumentToken(), linkExpiresAt: null, updatedAt: new Date() } as any)
        .where(and(eq(inspectionReport.id, r.id), eq(inspectionReport.companyId, me.companyId))).returning()
    }
    const url = h.linkOf(row)!.url
    const first = firstNameOf(reach.who.name)
    const to = via === 'sms' ? String(reach.number) : String(reach.who.email)
    try {
      if (via === 'sms') {
        const text = `${message ? `${message.replace(/\s+/g, ' ').trim()} ` : `Hi ${first}, your roof inspection report is ready: `}${url} – ${reach.companyName}`
        // The shared sender refuses an opted-out number, an empty usage wallet and a business whose texting is not set up.
        const sent: any = await d.services.sms.sendSMS(me.companyId, { contactId: reach.who.id, toPhone: to, message: text, jobId: r.jobId, userId: me.userId })
        if (!sent || sent.refused || sent.status === 'failed') return fail(c, 502, sent?.errorMessage || 'The text could not be sent.', 'send_failed')
      } else {
        const [co] = await db.select({ phone: company.phone }).from(company).where(eq(company.id, me.companyId)).limit(1)
        await d.services.emailService.send(to, 'inspectionReportSent', { firstName: first, companyName: reach.companyName, companyPhone: co?.phone || '', title: row.title, reportUrl: url, message: message || '' })
      }
    } catch (err: any) { return fail(c, 502, err?.message || 'It could not be sent.', 'send_failed') }

    const [saved] = await db.update(inspectionReport).set({ sentAt: new Date(), sentVia: via, updatedAt: new Date() } as any)
      .where(and(eq(inspectionReport.id, r.id), eq(inspectionReport.companyId, me.companyId))).returning()
    await note(me.companyId, r.jobId, me.userId, reportSentBody(via === 'sms' ? 'text' : 'email', `${reach.who.name} (${to})`, row.title))
    return one(c, { sent: true, via, to, sentAt: new Date(saved.sentAt).toISOString(), link: h.linkOf(saved) })
  })

  app.post('/:id/copy', requirePermission('documents:create'), async (c) => {
    const me = c.get('user')
    const r = await h.reportFor(c, c.req.param('id'))
    if (!r) return fail(c, 404, 'Report not found')
    const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, me.companyId)).limit(1)
    if (!((co?.enabledFeatures as string[] | null) || []).includes('documents')) return fail(c, 409, 'Documents is not switched on for this account, so there is nowhere to file the copy.', 'feature_off')
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'File storage is not set up yet.', 'storage_not_configured')
    const view = await buildReportView(db, r)
    const pdf = await reportPdf(storage, view)
    const day = new Date().toISOString().slice(0, 10)
    const fileName = reportFileName(view.job.number).replace(/\.pdf$/, `-${day}.pdf`)
    const stored = await storage.saveFile(new File([new Uint8Array(pdf)], fileName, { type: 'application/pdf' }), me.companyId, 'documents')
    const jb = await h.jobFor(c, r.jobId)
    const [doc] = await db.insert(document).values({
      companyId: me.companyId, jobId: r.jobId, contactId: jb?.contactId ?? null, uploadedById: me.userId, type: 'inspection',
      name: `${r.title} (${day})`.slice(0, 200), filename: String(stored.path).split('/').pop(), originalName: stored.originalname, mimeType: stored.mimetype, size: stored.size,
      path: stored.path, url: storage.getFileUrl(stored.path, me.companyId),
      description: 'A frozen copy of the inspection report as it read when it was saved. Editing the report later does not change this file.',
    } as any).returning()
    const copies = [...copiesRaw(r.copies), { documentId: doc.id, savedAt: new Date().toISOString(), savedById: me.userId }]
    await db.update(inspectionReport).set({ copies, updatedAt: new Date() } as any).where(and(eq(inspectionReport.id, r.id), eq(inspectionReport.companyId, me.companyId)))
    await note(me.companyId, r.jobId, me.userId, reportSavedBody(r.title))
    return one(c, { document: { id: doc.id, name: doc.name, size: doc.size, createdAt: new Date(doc.createdAt).toISOString() } }, 201)
  })
}

/** The saved copies that are still in the documents (one deleted there drops off the list). */
export async function liveCopies(db: any, r: any) {
  const list = copiesRaw(r.copies)
  if (!list.length) return []
  const docs = await db.select({ id: document.id, name: document.name, size: document.size }).from(document).where(and(inArray(document.id, list.map((x) => x.documentId)), eq(document.companyId, r.companyId)))
  const byId = new Map<string, any>(docs.map((x: any) => [x.id, x]))
  return list.filter((x) => byId.has(x.documentId)).map((x) => ({ documentId: x.documentId, name: byId.get(x.documentId).name, size: byId.get(x.documentId).size, savedAt: x.savedAt })).reverse()
}
