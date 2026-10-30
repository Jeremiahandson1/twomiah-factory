// /api/checklists — the checklists a business builds for its own job types, filled in on the phone and signed by the
// customer on site (Job Checklists, NOT READY: feature `job_checklists`).
//
// A checklist is a form_template (category 'job_checklist') whose `autoAttachTo` says which job types get it
// ({ jobTypes: [...] }; none listed = every job). A filled one is a form_submission on the job. When the checklist asks
// for the customer's signature, the signature is taken with the same evidence a signed quote carries: who typed their
// name, when, from where, on what device, a fingerprint of exactly what they saw, and that they agreed to sign
// electronically (tenant-backend invoicing/signingEvidence.ts; portal.ts approveQuote).
//
// This is the unified app's own door, not /api/tech: basic has no /api/tech, and the phone must reach the same routes
// on both. The older end-of-visit "site checklist" (tech.ts, category site_checklist) is untouched.
//
// Who:
//   · building and editing the checklists is a company setting (settings:update — the owner and admins);
//   · reading the list for a job, filling one in and getting it signed is jobs:read / jobs:update, and a seat that
//     does not read everyone's work (no jobs:read-all) reaches only the jobs it is on (tenant-backend ownJobScope);
//   · the signature IMAGE, address, browser and fingerprint are evidence for the seat that administers jobs
//     (jobs:dispatch); everyone else sees THAT it was signed, by whom, and when.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { ownJobScope, withoutSigningEvidence } from '@twomiah/tenant-backend'
import { formSubmission, formTemplate, job, jobAssignee, crewLogin, jobPhoto } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, listAll, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'

export const CHECKLIST_CATEGORY = 'job_checklist'
const MAX_SIGNATURE = 400_000

const FIELD_TYPES = ['pass_fail', 'yes_no', 'text'] as const
type FieldType = typeof FIELD_TYPES[number]
interface Field { id: string; label: string; type: FieldType; required: boolean }

const fieldSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string({ error: 'Write the question' }).trim().min(1, 'Write the question').max(200, 'At most 200 characters'),
  type: z.enum(FIELD_TYPES, { error: 'Pick pass / fail, yes / no or text' }),
  required: z.boolean().default(true),
})
const templateSchema = z.object({
  name: z.string({ error: 'Give the checklist a name' }).trim().min(1, 'Give the checklist a name').max(80, 'At most 80 characters'),
  description: z.string().trim().max(300, 'At most 300 characters').nullish(),
  fields: z.array(fieldSchema).min(1, 'Add at least one question').max(60, 'At most 60 questions'),
  jobTypes: z.array(z.string().trim().min(1).max(40)).max(20, 'At most 20 job types').default([]),
  requireSignature: z.boolean().default(false),
  requirePhoto: z.boolean().default(false),
  active: z.boolean().default(true),
})

const answerSchema = z.object({
  id: z.string().min(1).max(64),
  value: z.string().max(2000).default(''),
  notes: z.string().max(2000).nullish(),
})
const signatureSchema = z.object({
  signature: z.string({ error: 'A signature is required.' }).startsWith('data:image/', 'A signature is required.').max(MAX_SIGNATURE, 'Signature image is too large.'),
  signedBy: z.string({ error: 'Please type your full name to sign.' }).trim().min(1, 'Please type your full name to sign.').max(120),
  consent: z.literal(true, { error: 'You must agree to sign electronically before signing.' }),
})
const submitSchema = z.object({
  templateId: z.string({ error: 'Pick the checklist' }).min(1, 'Pick the checklist'),
  answers: z.array(answerSchema).max(100),
  overallNotes: z.string().max(4000).nullish(),
  signature: signatureSchema.optional(),
})

const ANSWERS: Record<FieldType, string[] | null> = { pass_fail: ['pass', 'fail', 'attention'], yes_no: ['yes', 'no'], text: null }

/** The template a person sees: the questions, the job types it is for, what it asks for. */
const shapeTemplate = (r: any) => ({
  id: r.id, name: r.name, description: r.description ?? null, active: !!r.active,
  fields: (Array.isArray(r.fields) ? r.fields : []) as Field[],
  jobTypes: Array.isArray(r.autoAttachTo?.jobTypes) ? (r.autoAttachTo.jobTypes as string[]) : [],
  requireSignature: !!r.requireSignature, requirePhoto: !!r.requirePhoto,
  updatedAt: r.updatedAt,
})

const appliesTo = (tpl: ReturnType<typeof shapeTemplate>, jobType: string | null | undefined) =>
  tpl.jobTypes.length === 0 || tpl.jobTypes.includes(String(jobType || ''))

export function createChecklistRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()
  const scopeTables = { job, jobAssignee, crewLogin }

  /** This job, if this seat may reach it (every job with jobs:read-all, else only its own). */
  const reachable = async (c: any, jobId: string) => {
    const u = c.get('user')
    const own = await ownJobScope(db, scopeTables, canSee, u)
    const [row] = await db.select().from(job)
      .where(and(eq(job.id, jobId), eq(job.companyId, u.companyId), ...(own ? [own] : []))).limit(1)
    return row || null
  }

  /** A submission as the caller may see it: THAT it was signed always, the evidence for the seat that administers jobs. */
  const shapeSubmission = async (c: any, s: any) => {
    const u = c.get('user')
    const sees = await canSee(u.role, 'jobs:dispatch', u.userId)
    const base = sees ? s : withoutSigningEvidence(s)
    return { ...base, signed: !!s.signedAt, hasSignature: !!s.signature }
  }

  // ── the checklists a business builds ───────────────────────────────────────────────────────────────────────────────
  app.get('/templates', requirePermission('jobs:read'), async (c) => {
    const rows = await db.select().from(formTemplate)
      .where(and(eq(formTemplate.companyId, c.get('user').companyId), eq(formTemplate.category, CHECKLIST_CATEGORY)))
      .orderBy(asc(formTemplate.name), asc(formTemplate.id))
    return listAll(c, rows.map(shapeTemplate))
  })

  const toRow = (v: z.infer<typeof templateSchema>) => ({
    name: v.name, description: v.description || null,
    fields: v.fields.map((f) => ({ id: f.id || createId(), label: f.label, type: f.type, required: f.required })),
    requireSignature: v.requireSignature, requirePhoto: v.requirePhoto, active: v.active,
    autoAttachTo: { jobTypes: [...new Set(v.jobTypes)] },
  })

  app.post('/templates', requirePermission('settings:update'), async (c) => {
    const parsed = templateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [row] = await db.insert(formTemplate).values({ companyId: c.get('user').companyId, category: CHECKLIST_CATEGORY, ...toRow(parsed.data) } as any).returning()
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'checklist', entityId: row.id, entityName: row.name, req: c })
    return one(c, shapeTemplate(row), 201)
  })

  app.put('/templates/:id', requirePermission('settings:update'), async (c) => {
    const parsed = templateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [row] = await db.update(formTemplate).set({ ...toRow(parsed.data), updatedAt: new Date() } as any)
      .where(and(eq(formTemplate.id, c.req.param('id')), eq(formTemplate.companyId, c.get('user').companyId), eq(formTemplate.category, CHECKLIST_CATEGORY))).returning()
    if (!row) return fail(c, 404, 'That checklist is not there.')
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'checklist', entityId: row.id, entityName: row.name, req: c })
    return one(c, shapeTemplate(row))
  })

  // A checklist that has been filled in is kept (the job's record points at it): it is switched off instead of removed.
  app.delete('/templates/:id', requirePermission('settings:update'), async (c) => {
    const companyId = c.get('user').companyId, id = c.req.param('id')
    const [found] = await db.select().from(formTemplate)
      .where(and(eq(formTemplate.id, id), eq(formTemplate.companyId, companyId), eq(formTemplate.category, CHECKLIST_CATEGORY))).limit(1)
    if (!found) return fail(c, 404, 'That checklist is not there.')
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(formSubmission).where(and(eq(formSubmission.templateId, id), eq(formSubmission.companyId, companyId)))
    if (n > 0) {
      await db.update(formTemplate).set({ active: false, updatedAt: new Date() } as any).where(eq(formTemplate.id, id))
      audit.log({ action: audit.ACTIONS.UPDATE, entity: 'checklist', entityId: id, entityName: found.name, metadata: { switchedOff: true }, req: c })
      return one(c, { success: true, archived: true, message: 'It has been filled in on jobs, so it was switched off and kept.' })
    }
    await db.delete(formTemplate).where(eq(formTemplate.id, id))
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'checklist', entityId: id, entityName: found.name, req: c })
    return done(c)
  })

  // ── on a job ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** What is filled in on the job and what is still owed: the checklists for this job's type with no finished copy. */
  const jobView = async (c: any, j: any) => {
    const companyId = c.get('user').companyId
    const templates = (await db.select().from(formTemplate)
      .where(and(eq(formTemplate.companyId, companyId), eq(formTemplate.category, CHECKLIST_CATEGORY), eq(formTemplate.active, true)))
      .orderBy(asc(formTemplate.name), asc(formTemplate.id))).map(shapeTemplate).filter((tpl: any) => appliesTo(tpl, j.jobType))
    const subs = await db.select().from(formSubmission)
      .where(and(eq(formSubmission.companyId, companyId), eq(formSubmission.jobId, j.id), inArray(formSubmission.templateId, templates.length ? templates.map((x: any) => x.id) : ['-'])))
      .orderBy(desc(formSubmission.createdAt), desc(formSubmission.id))
    const finished = (tplId: string) => subs.some((s: any) => s.templateId === tplId && (s.status === 'signed' || s.status === 'submitted'))
    const waiting = (tplId: string) => subs.find((s: any) => s.templateId === tplId && s.status === 'awaiting_signature')
    const outstanding = templates.filter((x: any) => !finished(x.id)).map((x: any) => ({
      templateId: x.id, name: x.name, why: waiting(x.id) ? 'needs the customer to sign' : 'not filled in yet', submissionId: waiting(x.id)?.id ?? null,
    }))
    return { jobId: j.id, jobType: j.jobType ?? null, templates, submissions: await Promise.all(subs.map((s: any) => shapeSubmission(c, s))), outstanding }
  }

  app.get('/job/:jobId', requirePermission('jobs:read'), async (c) => {
    const j = await reachable(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Job not found')
    return one(c, await jobView(c, j))
  })

  const fingerprint = (payload: unknown) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  const signerIp = (c: any): string | null => { const fwd = c.req.header('x-forwarded-for'); if (fwd) return fwd.split(',')[0].trim() || null; return c.req.header('x-real-ip') || null }

  /** The evidence for one signing: exactly the checklist and answers the customer was shown. */
  const evidence = (c: any, submissionId: string, tpl: any, jobId: string, values: unknown, sig: z.infer<typeof signatureSchema>) => {
    const signedAt = new Date()
    return {
      signature: sig.signature, signedAt, signedBy: sig.signedBy, signedIp: signerIp(c), signedUserAgent: c.req.header('user-agent') || null, consentAt: signedAt,
      signatureHash: fingerprint({ submissionId, templateId: tpl.id, name: tpl.name, fields: tpl.fields, jobId, values }),
    }
  }

  app.post('/job/:jobId/submit', requirePermission('jobs:update'), async (c) => {
    const parsed = submitSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const body = parsed.data
    const u = c.get('user')
    const j = await reachable(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Job not found')
    const [row] = await db.select().from(formTemplate)
      .where(and(eq(formTemplate.id, body.templateId), eq(formTemplate.companyId, u.companyId), eq(formTemplate.category, CHECKLIST_CATEGORY))).limit(1)
    if (!row) return fail(c, 404, 'That checklist is not there.')
    const tpl = shapeTemplate(row)
    if (!tpl.active) return fail(c, 409, 'That checklist has been switched off.', 'checklist_off')
    if (!appliesTo(tpl, j.jobType)) return fail(c, 409, `"${tpl.name}" is not used on this kind of job.`, 'not_for_this_job')

    // Every question is answered the way it asks; a required one is not left blank; nothing answers a question that is not there.
    const byId = new Map(tpl.fields.map((f) => [f.id, f]))
    const given = new Map<string, z.infer<typeof answerSchema>>()
    for (const a of body.answers) {
      const f = byId.get(a.id)
      if (!f) return fail(c, 400, 'One answer is for a question that is not on this checklist. Refresh the checklist and try again.', 'unknown_question')
      const allowed = ANSWERS[f.type]
      if (a.value && allowed && !allowed.includes(a.value)) return fail(c, 400, `"${f.label}" needs one of: ${allowed.join(', ')}.`, 'bad_answer', { [f.id]: `Pick ${allowed.join(', ')}` })
      given.set(a.id, a)
    }
    const blank = tpl.fields.filter((f) => f.required && !(given.get(f.id)?.value || '').trim())
    if (blank.length) return fail(c, 400, `Answer "${blank[0].label}"${blank.length > 1 ? ` and ${blank.length - 1} more` : ''} first.`, 'unanswered', Object.fromEntries(blank.map((f) => [f.id, 'Required'])))

    if (tpl.requirePhoto) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobPhoto).where(and(eq(jobPhoto.jobId, j.id), eq(jobPhoto.companyId, u.companyId)))
      if (!n) return fail(c, 400, `"${tpl.name}" needs a photo of the job first. Take one, then send the checklist.`, 'photo_required')
    }

    const id = createId()
    const values = {
      type: CHECKLIST_CATEGORY, templateName: tpl.name,
      items: tpl.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, value: given.get(f.id)?.value ?? '', notes: given.get(f.id)?.notes ?? '' })),
      overallNotes: body.overallNotes || '', completedAt: new Date().toISOString(),
    }
    const signed = body.signature ? evidence(c, id, tpl, j.id, values, body.signature) : null
    const status = signed ? 'signed' : tpl.requireSignature ? 'awaiting_signature' : 'submitted'
    const [saved] = await db.insert(formSubmission).values({
      id, companyId: u.companyId, templateId: tpl.id, jobId: j.id, contactId: j.contactId ?? null, submittedById: u.userId,
      values, status, ...(signed || {}),
    } as any).returning()
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'checklist_submission', entityId: id, entityName: tpl.name, metadata: { jobId: j.id, status, ...(signed ? { signatureHash: signed.signatureHash } : {}) }, req: c })
    return one(c, await shapeSubmission(c, saved), 201)
  })

  // The customer signs one that was filled in first (they were not there yet). Once signed it cannot be signed again or changed.
  app.post('/submissions/:id/sign', requirePermission('jobs:update'), async (c) => {
    const parsed = signatureSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const u = c.get('user')
    const [found] = await db.select().from(formSubmission).where(and(eq(formSubmission.id, c.req.param('id')), eq(formSubmission.companyId, u.companyId))).limit(1)
    if (!found || !found.jobId || !(await reachable(c, found.jobId))) return fail(c, 404, 'That checklist is not there.')
    if (found.signedAt) return fail(c, 409, 'This checklist is already signed.', 'already_signed')
    const [row] = await db.select().from(formTemplate).where(eq(formTemplate.id, found.templateId)).limit(1)
    const tpl = shapeTemplate(row)
    const signed = evidence(c, found.id, tpl, found.jobId, found.values, parsed.data)
    const [saved] = await db.update(formSubmission).set({ ...signed, status: 'signed', updatedAt: new Date() } as any)
      .where(and(eq(formSubmission.id, found.id), isNull(formSubmission.signedAt))).returning()
    if (!saved) return fail(c, 409, 'This checklist is already signed.', 'already_signed')
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'checklist_submission', entityId: found.id, entityName: tpl.name, metadata: { jobId: found.jobId, signed: true, signatureHash: signed.signatureHash }, req: c })
    return one(c, await shapeSubmission(c, saved))
  })

  return app
}
