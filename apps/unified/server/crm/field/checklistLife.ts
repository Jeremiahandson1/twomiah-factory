// A checklist through the job's life (Job Checklists, NOT READY: feature `job_checklists`). The checklist pages and rules are
// checklistRoutes.ts; this is what happens around them, from the job being made to the invoice:
//
//   · when a job is MADE, every active checklist for its type is added to it as a row (form_submission, status 'assigned'),
//     not only offered (Housecall Pro job templates, Jobber auto-attach). A job made another way (an agreement's next visit,
//     online booking) gets its rows the first time anyone opens its checklists (ensureAttached is idempotent);
//   · when a job moves INTO a status a checklist asks to be prompted on (ServiceTitan triggers), the people on the job get a
//     phone notice naming the form;
//   · when a visit is done and a checklist on it is not, the office is told (Jobber), and the Checklists report lists them;
//   · a finished checklist is a PDF: downloaded, emailed to the customer, and attached to the invoice, where it is listed
//     and goes out with the invoice email (Jobber, Housecall Pro, ServiceTitan).
//
// Nothing here decides whether a job may be completed: that is checklistRoutes.ts (completionRefusal), the one rule.
import { Hono } from 'hono'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { companyTimeZone, parseRange, ReportError, storeDateString } from '@twomiah/tenant-backend'
import { company, contact, document, formSubmission, formTemplate, invoice, job, jobAssignee, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import type { JobMomentKind } from '../services.ts'

const CATEGORY = 'job_checklist'
/** The `type` a not-yet-filled row carries. Not an `items` list, so nothing that reads filled checklists (the customer's portal) sees it. */
export const PENDING_TYPE = 'job_checklist_pending'
/** The job moves a checklist can ask to be prompted on, and the words for them. */
export const PROMPT_STATUSES = ['dispatched', 'in_progress', 'completed'] as const
export type PromptStatus = typeof PROMPT_STATUSES[number]
const PROMPT_WORDS: Record<PromptStatus, string> = { dispatched: 'on the way', in_progress: 'started', completed: 'completed' }
const MOMENT_STATUS: Partial<Record<JobMomentKind, PromptStatus>> = { dispatched: 'dispatched', started: 'in_progress', completed: 'completed' }

const jobTypesOf = (t: any): string[] => (Array.isArray(t?.autoAttachTo?.jobTypes) ? t.autoAttachTo.jobTypes : [])
export const promptOnOf = (t: any): PromptStatus[] => (Array.isArray(t?.autoAttachTo?.promptOn) ? t.autoAttachTo.promptOn.filter((s: any) => (PROMPT_STATUSES as readonly string[]).includes(s)) : [])
const fitsJob = (t: any, jobType: string | null | undefined) => jobTypesOf(t).length === 0 || jobTypesOf(t).includes(String(jobType || ''))

/** The active checklists that apply to this job. */
async function templatesFor(db: any, companyId: string, j: { jobType?: string | null }) {
  const rows = await db.select().from(formTemplate).where(and(eq(formTemplate.companyId, companyId), eq(formTemplate.category, CATEGORY), eq(formTemplate.active, true)))
  return rows.filter((t: any) => fitsJob(t, j.jobType))
}

/**
 * Give the job a row for each active checklist that fits it and that it has no row for yet (waiting or filled). Safe to call
 * again: it adds only what is missing. Returns how many rows it added.
 */
export async function ensureAttached(db: any, companyId: string, j: { id: string; jobType?: string | null; contactId?: string | null }): Promise<number> {
  const templates = await templatesFor(db, companyId, j)
  if (!templates.length) return 0
  const have = await db.select({ templateId: formSubmission.templateId }).from(formSubmission).where(and(eq(formSubmission.companyId, companyId), eq(formSubmission.jobId, j.id)))
  const taken = new Set(have.map((h: any) => h.templateId))
  const missing = templates.filter((t: any) => !taken.has(t.id))
  if (!missing.length) return 0
  await db.insert(formSubmission).values(missing.map((t: any) => ({
    id: createId(), companyId, templateId: t.id, jobId: j.id, contactId: j.contactId ?? null,
    values: { type: PENDING_TYPE, templateName: t.name }, status: 'assigned',
  })) as any)
  return missing.length
}

/** What the office is told when a visit is done and a checklist on it is not. */
export const notDoneSentence = (number: string | null | undefined, names: string[]) =>
  `${number ? `Job ${number}` : 'A job'} is done, but ${names.length === 1 ? `the checklist “${names[0]}” was` : `${names.length} checklists were`} not filled in${names.length > 1 ? `: ${names.join(', ')}` : ''}.`

/** The moments of a job that this feature acts on. Registered once, when the checklist routes are mounted. */
export function jobMomentStep(d: CrmDeps) {
  const canSee = canSeeWith(d.permissions)
  return async (kind: JobMomentKind, ctx: { job: any; companyId: string; userId: string }) => {
    const { job: j, companyId } = ctx
    if (!(await d.features.isFeatureEnabled(companyId, 'job_checklists'))) return
    if (kind === 'created') { await ensureAttached(d.db, companyId, j); return }
    const status = MOMENT_STATUS[kind]
    if (!status) return
    await ensureAttached(d.db, companyId, j)
    // Rows still waiting to be filled in on this job.
    const open = await d.db.select({ id: formSubmission.id, templateId: formSubmission.templateId, status: formSubmission.status }).from(formSubmission)
      .where(and(eq(formSubmission.companyId, companyId), eq(formSubmission.jobId, j.id), inArray(formSubmission.status, ['assigned', 'awaiting_signature'])))
    // A prompt is for a form nobody has started; the not-done alert also counts one that still needs the customer's signature.
    const waiting = kind === 'completed' ? open : open.filter((w: any) => w.status === 'assigned')
    if (!waiting.length) return
    const templates = new Map<string, any>((await d.db.select().from(formTemplate).where(inArray(formTemplate.id, waiting.map((w: any) => w.templateId)))).map((t: any) => [t.id, t]))
    if (kind === 'completed') {
      // Done, and these are still unfilled (a checklist with nothing required may be left): tell the office.
      const names = waiting.map((w: any) => templates.get(w.templateId)?.name).filter(Boolean) as string[]
      if (!names.length) return
      const people = await d.db.select({ id: user.id, role: user.role }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
      const office: string[] = []
      for (const p of people) if (await canSee(p.role, 'jobs:dispatch', p.id)) office.push(p.id)
      await d.phonePush.send(companyId, office, { title: 'Checklist not done', body: notDoneSentence(j.number, names), data: { type: 'job', id: j.id } })
      return
    }
    // A move a checklist asked to be prompted on: the people on the job are asked to fill it in.
    const asked = waiting.map((w: any) => templates.get(w.templateId)).filter((t: any) => t && promptOnOf(t).includes(status))
    if (!asked.length) return
    const others = await d.db.select({ userId: jobAssignee.userId }).from(jobAssignee).where(eq(jobAssignee.jobId, j.id)).catch(() => [])
    const crew = [...new Set([j.assignedToId, ...others.map((o: any) => o.userId)].filter(Boolean))] as string[]
    const names = asked.map((t: any) => t.name)
    await d.phonePush.send(companyId, crew.length ? crew : [ctx.userId], {
      title: names.length === 1 ? `Fill in “${names[0]}”` : `${names.length} checklists to fill in`,
      body: `${j.number ? `${j.number} · ` : ''}${j.title || 'Your job'} is ${PROMPT_WORDS[status]}${names.length > 1 ? `: ${names.join(', ')}` : ''}.`,
      data: { type: 'job', id: j.id },
    })
    await d.db.update(formSubmission).set({ updatedAt: new Date() } as any).where(inArray(formSubmission.id, waiting.filter((w: any) => asked.some((t: any) => t.id === w.templateId)).map((w: any) => w.id)))
  }
}

// ── the PDF ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ANSWER_WORDS: Record<string, string> = { pass: 'Pass', fail: 'Fail', attention: 'Needs attention', yes: 'Yes', no: 'No' }
const dayWords = (tz: string, d: Date | string | null | undefined) => {
  if (!d) return ''
  const day = storeDateString(new Date(d), tz)
  const [y, m, dd] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
}
const imageBytes = (dataUrl: string): Buffer | null => {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || '')
  return m ? Buffer.from(m[2], 'base64') : null
}

export interface PdfInput {
  company: any; job: any; contact: any; tz: string
  template: { name: string }
  submission: any
  /** A stored photo's bytes by its /media address, or null (a photo that cannot be read is left out, with a note). */
  photo: (url: string) => Promise<Buffer | null>
}

/** The finished checklist as the customer would be handed it: who, where, every question and its answer, photos, signatures. */
export async function buildChecklistPdf(i: PdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 54, size: 'LETTER' })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const finished = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))
  const s = i.submission
  const v = (s.values ?? {}) as any

  doc.fontSize(20).fillColor('black').text(i.company?.name || 'Company')
  doc.fontSize(9).fillColor('#555')
  const cityLine = [i.company?.city, i.company?.state].filter(Boolean).join(', ')
  for (const line of [i.company?.address, [cityLine, i.company?.zip].filter(Boolean).join(' '), [i.company?.phone, i.company?.email].filter(Boolean).join(' · ')]) if (line) doc.text(String(line))
  doc.moveDown().fillColor('black').fontSize(15).text(i.template.name)
  doc.fontSize(10)
  const who = i.contact ? (i.contact.name || [i.contact.firstName, i.contact.lastName].filter(Boolean).join(' ')) : ''
  doc.text(`Job: ${[i.job?.number, i.job?.title].filter(Boolean).join(' · ')}`)
  if (who) doc.text(`Customer: ${who}`)
  if (i.job?.address) doc.text(`Address: ${i.job.address}`)
  const completed = v.completedAt || s.submittedAt
  if (completed) doc.text(`Completed: ${dayWords(i.tz, completed)}`)
  doc.moveDown()

  for (const it of Array.isArray(v.items) ? v.items : []) {
    if (doc.y > 690) doc.addPage()
    if (it.type === 'section') { doc.moveDown(0.4).font('Helvetica-Bold').fontSize(12).text(String(it.label)).font('Helvetica').fontSize(10); continue }
    doc.font('Helvetica-Bold').text(String(it.label), { continued: false }).font('Helvetica')
    if (it.type === 'photo') {
      const urls: string[] = Array.isArray(it.photos) ? it.photos : []
      if (!urls.length) doc.fillColor('#555').text('No photos').fillColor('black')
      let missing = 0
      for (const u of urls) {
        const bytes = await i.photo(u).catch(() => null)
        if (!bytes) { missing++; continue }
        try { if (doc.y > 560) doc.addPage(); doc.image(bytes, { fit: [220, 160] }); doc.moveDown(0.3) } catch { missing++ }
      }
      if (missing) doc.fillColor('#555').text(`${missing} photo${missing === 1 ? '' : 's'} could not be shown`).fillColor('black')
    } else if (it.type === 'signature') {
      const img = it.signature ? imageBytes(it.signature) : null
      if (img) { try { if (doc.y > 600) doc.addPage(); doc.image(img, { fit: [200, 70] }) } catch { doc.text('Signed') } } else doc.text(it.signature || it.signed ? 'Signed' : '—')
    } else if (it.type === 'multi_select') doc.text((it.choices ?? []).join(', ') || '—')
    else doc.text(ANSWER_WORDS[String(it.value)] ?? (String(it.value || '').trim() || '—'))
    if (it.notes) doc.fillColor('#555').text(`Note: ${it.notes}`).fillColor('black')
    doc.moveDown(0.4)
  }
  if (v.overallNotes) { doc.moveDown(0.4).font('Helvetica-Bold').text('Notes').font('Helvetica').text(String(v.overallNotes)) }

  if (s.signedAt && s.signature) {
    if (doc.y > 600) doc.addPage()
    doc.moveDown().font('Helvetica-Bold').text('Customer signature').font('Helvetica')
    const img = imageBytes(s.signature)
    if (img) { try { doc.image(img, { fit: [200, 70] }) } catch { /* the name and time below still prove it */ } }
    doc.text(`${s.signedBy || ''} · ${dayWords(i.tz, s.signedAt)}`)
    doc.fontSize(8).fillColor('#555').text(`Signed electronically. Fingerprint ${String(s.signatureHash || '').slice(0, 16)}`).fillColor('black')
  }
  doc.end()
  return finished
}

const FINISHED = ['submitted', 'signed']
const emailSchema = z.object({ to: z.string().trim().email('Type a valid email address').max(200).optional() })
const attachSchema = z.object({ invoiceId: z.string({ error: 'Pick the invoice' }).min(1, 'Pick the invoice') })

export interface LifeKit {
  /** This job, if the caller may reach it. */
  reachable: (c: any, jobId: string) => Promise<any | null>
}

export function createChecklistLifeRoutes(d: CrmDeps, kit: LifeKit) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const photoBytes = async (url: string): Promise<Buffer | null> => {
    if (!url.startsWith('/media/') || url.includes('..')) return null
    const obj = await d.services.storage.getObject(url.slice('/media/'.length)).catch(() => null)
    return obj ? Buffer.from(obj.body as ArrayBuffer) : null
  }

  /** A finished checklist the caller may reach, with what its PDF needs. */
  async function loadFinished(c: any, id: string) {
    const u = c.get('user')
    const [s] = await db.select().from(formSubmission).where(and(eq(formSubmission.id, id), eq(formSubmission.companyId, u.companyId))).limit(1)
    if (!s || !s.jobId) return { error: fail(c, 404, 'That checklist is not there.') }
    const j = await kit.reachable(c, s.jobId)
    if (!j) return { error: fail(c, 404, 'That checklist is not there.') }
    if (!FINISHED.includes(s.status)) return { error: fail(c, 409, s.status === 'awaiting_signature' ? 'This checklist needs the customer to sign before it can be sent.' : 'This checklist is not filled in yet.', 'not_finished') }
    const [tpl] = await db.select().from(formTemplate).where(eq(formTemplate.id, s.templateId)).limit(1)
    const [co] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
    const [ct] = j.contactId ? await db.select().from(contact).where(and(eq(contact.id, j.contactId), eq(contact.companyId, u.companyId))).limit(1) : [null]
    return { s, j, tpl, co, ct }
  }
  const pdfOf = async (r: { s: any; j: any; tpl: any; co: any; ct: any }, companyId: string) =>
    buildChecklistPdf({ company: r.co, job: r.j, contact: r.ct, tz: await companyTimeZone(db, companyId), template: { name: r.tpl?.name || 'Checklist' }, submission: r.s, photo: photoBytes })
  const fileName = (r: { tpl: any; j: any }) => `${String(r.tpl?.name || 'checklist').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${String(r.j?.number || r.j?.id).replace(/[^A-Za-z0-9-]+/g, '')}.pdf`

  app.get('/submissions/:id/pdf', requirePermission('jobs:read'), async (c) => {
    const r = await loadFinished(c, c.req.param('id'))
    if ('error' in r) return r.error
    const pdf = await pdfOf(r, c.get('user').companyId)
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName(r)}"`, 'Cache-Control': 'no-store' } })
  })

  // Email the PDF to the customer on the job (or to an address typed in). The reply says where it went.
  app.post('/submissions/:id/email', requirePermission('jobs:update'), async (c) => {
    const parsed = emailSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const r = await loadFinished(c, c.req.param('id'))
    if ('error' in r) return r.error
    const to = parsed.data.to || r.ct?.email
    if (!to) return fail(c, 400, 'This job has no customer email address. Type one in, or add it to the customer first.', 'no_email')
    const pdf = await pdfOf(r, c.get('user').companyId)
    const name = r.co?.name || 'Your provider'
    try {
      await d.services.emailService.sendRaw({
        to, subject: `${r.tpl?.name || 'Checklist'} — ${name}`,
        html: `<p>Hello${r.ct?.name ? ` ${String(r.ct.name).replace(/[<>&]/g, '')}` : ''},</p><p>The completed “${String(r.tpl?.name || 'checklist').replace(/[<>&]/g, '')}” for ${String(r.j?.number || 'your job').replace(/[<>&]/g, '')} is attached.</p><p>${String(name).replace(/[<>&]/g, '')}</p>`,
        attachments: [{ filename: fileName(r), content: pdf, contentType: 'application/pdf' }],
      })
    } catch (err: any) {
      d.logger.error('[checklists] email failed', { error: err?.message })
      return fail(c, 502, 'The email could not be sent. Check the address and try again.', 'email_failed')
    }
    audit.log({ action: audit.ACTIONS.SEND ?? 'send', entity: 'checklist_submission', entityId: r.s.id, entityName: r.tpl?.name, metadata: { jobId: r.j.id, to }, req: c })
    return one(c, { sentTo: to })
  })

  // ── on the invoice ───────────────────────────────────────────────────────────────────────────────────────────────────
  const ATTACHED = 'checklist'
  const invoiceOf = async (c: any, id: string) => {
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, c.get('user').companyId))).limit(1)
    return inv || null
  }

  // What an invoice carries from its job's checklists: the PDFs attached, and the finished checklists that could be.
  app.get('/invoice/:invoiceId', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user')
    const inv = await invoiceOf(c, c.req.param('invoiceId'))
    if (!inv) return fail(c, 404, 'Invoice not found')
    const attached = await db.select().from(document).where(and(eq(document.companyId, u.companyId), eq(document.invoiceId, inv.id), eq(document.type, ATTACHED))).orderBy(desc(document.createdAt))
    const subs = inv.jobId ? await db.select().from(formSubmission).where(and(eq(formSubmission.companyId, u.companyId), eq(formSubmission.jobId, inv.jobId), inArray(formSubmission.status, FINISHED))) : []
    const names = new Map<string, string>((await db.select({ id: formTemplate.id, name: formTemplate.name }).from(formTemplate).where(eq(formTemplate.companyId, u.companyId))).map((t: any) => [t.id, t.name]))
    const had = new Set(attached.map((a: any) => a.description))
    return one(c, {
      jobId: inv.jobId ?? null,
      attached: attached.map((a: any) => ({ id: a.id, name: a.name, createdAt: a.createdAt })),
      available: subs.filter((s: any) => !had.has(s.id)).map((s: any) => ({ submissionId: s.id, name: names.get(s.templateId) || 'Checklist', signed: !!s.signedAt })),
    })
  })

  // Attach the finished checklist's PDF to an invoice: a copy is kept (what the customer is handed does not change if the checklist
  // is later switched off) and goes out with the invoice email.
  app.post('/submissions/:id/attach', requirePermission('invoices:update'), async (c) => {
    const parsed = attachSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const u = c.get('user')
    const r = await loadFinished(c, c.req.param('id'))
    if ('error' in r) return r.error
    const inv = await invoiceOf(c, parsed.data.invoiceId)
    if (!inv) return fail(c, 404, 'Invoice not found')
    if (inv.jobId && inv.jobId !== r.j.id) return fail(c, 409, 'That invoice is for a different job.', 'wrong_job')
    if (!inv.jobId && inv.contactId !== r.j.contactId) return fail(c, 409, 'That invoice is for a different customer.', 'wrong_customer')
    const storage: any = d.services.storage
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'File storage is not set up yet.', 'storage_not_configured')
    const [again] = await db.select({ id: document.id }).from(document).where(and(eq(document.companyId, u.companyId), eq(document.invoiceId, inv.id), eq(document.type, ATTACHED), eq(document.description, r.s.id))).limit(1)
    if (again) return one(c, { id: again.id })
    const pdf = await pdfOf(r, u.companyId)
    const docId = createId()
    const path = `documents/${u.companyId}/checklists/${docId}.pdf`
    await storage.put(path, pdf, 'application/pdf')
    const [row] = await db.insert(document).values({
      id: docId, companyId: u.companyId, name: r.tpl?.name || 'Checklist', type: ATTACHED, filename: `${docId}.pdf`, originalName: fileName(r), mimeType: 'application/pdf',
      size: pdf.length, path, url: `/api/checklists/attached/${docId}/file`,
      // The checklist it is a copy of, so the same one is not attached twice.
      description: r.s.id, invoiceId: inv.id, jobId: r.j.id, contactId: inv.contactId ?? null, uploadedById: u.userId,
    } as any).returning()
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'invoice', entityId: inv.id, entityName: inv.number, metadata: { attachedChecklist: r.tpl?.name, submissionId: r.s.id }, req: c })
    return one(c, { id: row.id }, 201)
  })

  app.get('/attached/:documentId/file', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user')
    const [row] = await db.select().from(document).where(and(eq(document.id, c.req.param('documentId')), eq(document.companyId, u.companyId), eq(document.type, ATTACHED))).limit(1)
    if (!row) return fail(c, 404, 'That file is not there.')
    const obj = await d.services.storage.getObject(row.path)
    if (!obj) return fail(c, 404, 'That file is not there.')
    return new Response(obj.body as ArrayBuffer, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${row.originalName}"`, 'Cache-Control': 'no-store' } })
  })

  app.delete('/attached/:documentId', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user')
    const [row] = await db.select().from(document).where(and(eq(document.id, c.req.param('documentId')), eq(document.companyId, u.companyId), eq(document.type, ATTACHED))).limit(1)
    if (!row) return fail(c, 404, 'That file is not there.')
    await db.delete(document).where(eq(document.id, row.id))
    await Promise.resolve((d.services.storage as any).deleteFile?.(row.path)).catch(() => {})
    return done(c)
  })

  // ── the report ───────────────────────────────────────────────────────────────────────────────────────────────────────
  // Per checklist, how many jobs it was added to and how many got it filled in; and the jobs that are DONE with a checklist still
  // unfilled (Jobber's checklists report). The period is the jobs' scheduled days on the company's clock.
  app.get('/report', requirePermission('reports:read'), async (c) => {
    const u = c.get('user')
    const tz = await companyTimeZone(db, u.companyId)
    let range: { gte?: Date; lte?: Date }
    try { range = parseRange(c.req.query('startDate'), c.req.query('endDate'), tz) } catch (e) { if (e instanceof ReportError) return fail(c, 400, e.message); throw e }
    const inRange = [eq(job.companyId, u.companyId), ...(range.gte ? [gte(job.scheduledDate, range.gte)] : []), ...(range.lte ? [lte(job.scheduledDate, range.lte)] : [])]
    const rows = await db.select({
      id: formSubmission.id, templateId: formSubmission.templateId, status: formSubmission.status, jobId: job.id, number: job.number, title: job.title,
      jobStatus: job.status, scheduledDate: job.scheduledDate, completedAt: job.completedAt,
    }).from(formSubmission).innerJoin(job, eq(job.id, formSubmission.jobId)).where(and(eq(formSubmission.companyId, u.companyId), ...inRange))
    const names = new Map<string, string>((await db.select({ id: formTemplate.id, name: formTemplate.name }).from(formTemplate).where(and(eq(formTemplate.companyId, u.companyId), eq(formTemplate.category, CATEGORY)))).map((t: any) => [t.id, t.name]))
    const per = new Map<string, { templateId: string; name: string; added: number; filled: number; waitingSignature: number; notFilled: number }>()
    const notDone: any[] = []
    for (const r of rows) {
      if (!names.has(r.templateId)) continue
      const p = per.get(r.templateId) ?? { templateId: r.templateId, name: names.get(r.templateId)!, added: 0, filled: 0, waitingSignature: 0, notFilled: 0 }
      p.added++
      if (FINISHED.includes(r.status)) p.filled++
      else if (r.status === 'awaiting_signature') p.waitingSignature++
      else p.notFilled++
      per.set(r.templateId, p)
      if (r.jobStatus === 'completed' && !FINISHED.includes(r.status)) notDone.push({ jobId: r.jobId, number: r.number, title: r.title, checklist: names.get(r.templateId), why: r.status === 'awaiting_signature' ? 'Needs the customer to sign' : 'Not filled in', completedAt: r.completedAt, completedOn: r.completedAt ? storeDateString(new Date(r.completedAt), tz) : null })
    }
    return one(c, { byChecklist: [...per.values()].sort((a, b) => a.name.localeCompare(b.name)), notDone: notDone.sort((a, b) => String(b.completedOn).localeCompare(String(a.completedOn))) })
  })
  return app
}

/** The checklist PDFs attached to an invoice, as the invoice email carries them. A file that cannot be read is left off. */
export async function attachedChecklistFiles(db: any, storage: { getObject: (key: string) => Promise<any> }, invoiceId: string) {
  if (!invoiceId) return []
  const rows = await db.select().from(document).where(and(eq(document.invoiceId, invoiceId), eq(document.type, 'checklist'))).orderBy(desc(document.createdAt))
  const out: Array<{ filename: string; content: Buffer; contentType: string }> = []
  for (const r of rows) {
    const obj = await storage.getObject(r.path).catch(() => null)
    if (obj) out.push({ filename: r.originalName, content: Buffer.from(obj.body as ArrayBuffer), contentType: 'application/pdf' })
  }
  return out
}
