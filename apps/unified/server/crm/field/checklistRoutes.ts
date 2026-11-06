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
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { ownJobScope, sniffType, withoutSigningEvidence } from '@twomiah/tenant-backend'
import { formSubmission, formTemplate, job, jobAssignee, crewLogin, jobPhoto } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, listAll, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { uploadedForm } from '../office/upload.ts'
import { PROMPT_STATUSES, createChecklistLifeRoutes, ensureAttached, jobMomentStep, promptOnOf } from './checklistLife.ts'

export const CHECKLIST_CATEGORY = 'job_checklist'
const MAX_SIGNATURE = 400_000
/** Photos on one photo question, and the size of one photo (the same limits as a job's own photos). */
export const MAX_QUESTION_PHOTOS = 6
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX_OPTIONS = 30

/**
 * The kinds of question (Housecall Pro: checkbox, text, pass/flag/fail, photo, single- and multi-select; Jobber: short and long
 * answer, dropdown, checkbox, number, image, date, signature). `section` is not a question: it is a heading that groups the
 * questions under it until the next heading (HCP and Jobber sections); it is never answered and never required.
 */
const FIELD_TYPES = ['pass_fail', 'yes_no', 'text', 'dropdown', 'multi_select', 'number', 'date', 'photo', 'signature', 'section'] as const
type FieldType = typeof FIELD_TYPES[number]
/** The kinds that offer the person a list of choices the owner wrote. */
const CHOICE_TYPES: FieldType[] = ['dropdown', 'multi_select']
interface Field { id: string; label: string; type: FieldType; required: boolean; options?: string[] }

const fieldSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string({ error: 'Write the question' }).trim().min(1, 'Write the question').max(200, 'At most 200 characters'),
  type: z.enum(FIELD_TYPES, { error: 'Pick the kind of answer' }),
  required: z.boolean().default(true),
  options: z.array(z.string().trim().min(1, 'A choice cannot be blank').max(80, 'A choice is at most 80 characters')).max(MAX_OPTIONS, `At most ${MAX_OPTIONS} choices`).optional(),
}).superRefine((f, ctx) => {
  if (!CHOICE_TYPES.includes(f.type)) return
  const o = f.options ?? []
  if (o.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Give at least two choices' })
  else if (new Set(o.map((x) => x.toLowerCase())).size !== o.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Each choice must be different' })
})
const templateSchema = z.object({
  name: z.string({ error: 'Give the checklist a name' }).trim().min(1, 'Give the checklist a name').max(80, 'At most 80 characters'),
  description: z.string().trim().max(300, 'At most 300 characters').nullish(),
  fields: z.array(fieldSchema).min(1, 'Add at least one question').max(60, 'At most 60 questions')
    .refine((fs) => fs.some((f) => f.type !== 'section'), 'Add at least one question'),
  jobTypes: z.array(z.string().trim().min(1).max(40)).max(20, 'At most 20 job types').default([]),
  /** The job moves (on the way, started, completed) that ask the people on the job to fill this in (ServiceTitan triggers). */
  promptOn: z.array(z.enum(PROMPT_STATUSES)).max(3).default([]),
  requireSignature: z.boolean().default(false),
  requirePhoto: z.boolean().default(false),
  active: z.boolean().default(true),
})

const answerSchema = z.object({
  id: z.string().min(1).max(64),
  value: z.string().max(2000).default(''),
  notes: z.string().max(2000).nullish(),
  /** Multi-select: every choice ticked. */
  choices: z.array(z.string().max(80)).max(MAX_OPTIONS).optional(),
  /** Photo question: the /media addresses of the photos taken for it (uploaded through POST /job/:jobId/photos). */
  photos: z.array(z.string().max(2000)).max(MAX_QUESTION_PHOTOS).optional(),
  /** Signature question: the drawn signature. */
  signature: z.string().startsWith('data:image/', 'A signature is required.').max(MAX_SIGNATURE, 'Signature image is too large.').optional(),
})
const signatureSchema = z.object({
  signature: z.string({ error: 'A signature is required.' }).startsWith('data:image/', 'A signature is required.').max(MAX_SIGNATURE, 'Signature image is too large.'),
  signedBy: z.string({ error: 'Please type your full name to sign.' }).trim().min(1, 'Please type your full name to sign.').max(120),
  consent: z.literal(true, { error: 'You must agree to sign electronically before signing.' }),
})
const submitSchema = z.object({
  /** Made by the phone before it sends: a send repeated after a lost reply finds the one already saved instead of saving twice. */
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Not a valid id').optional(),
  templateId: z.string({ error: 'Pick the checklist' }).min(1, 'Pick the checklist'),
  answers: z.array(answerSchema).max(100),
  overallNotes: z.string().max(4000).nullish(),
  signature: signatureSchema.optional(),
  /**
   * What the phone's offline queue adds when it has uploaded photos for a save (apps/mobile/src/offline/localPhotos.ts):
   * `photos` are the uploaded addresses, in order, and `photoKeys[i]` is the question photo i was taken for; `notes` says
   * how many photos could not be sent. They are folded into the answers below.
   */
  photos: z.array(z.string().max(2000)).max(60).optional(),
  photoKeys: z.array(z.string().max(64)).max(60).optional(),
  notes: z.string().max(2000).nullish(),
})

const ANSWERS: Partial<Record<FieldType, string[]>> = { pass_fail: ['pass', 'fail', 'attention'], yes_no: ['yes', 'no'] }
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
/** A real calendar day, written YYYY-MM-DD. */
const isDay = (v: string) => {
  const m = DAY.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}
/** The /media address a photo for this job's checklists must be under: this business's, this job's. */
const photoPrefix = (companyId: string, jobId: string) => `/media/photos/${companyId}/checklist/${jobId}/`

type Answer = z.infer<typeof answerSchema>
/**
 * Is this answer a good one for this question? null when it is; else what to tell the person. A blank answer is fine here
 * (whether blank is allowed is the question's `required`, checked separately).
 */
function answerProblem(f: Field, a: Answer, companyId: string, jobId: string): { message: string; code: string; hint: string } | null {
  const bad = (message: string, hint: string, code = 'bad_answer') => ({ message, code, hint })
  const allowed = ANSWERS[f.type]
  switch (f.type) {
    case 'section': return bad('One answer is for a heading, not a question. Refresh the checklist and try again.', 'Not a question', 'unknown_question')
    case 'pass_fail': case 'yes_no':
      return a.value && allowed && !allowed.includes(a.value) ? bad(`"${f.label}" needs one of: ${allowed.join(', ')}.`, `Pick ${allowed.join(', ')}`) : null
    case 'dropdown':
      return a.value && !(f.options ?? []).includes(a.value) ? bad(`"${f.label}" needs one of its choices.`, 'Pick one of the choices') : null
    case 'multi_select': {
      const picked = a.choices ?? []
      if (picked.some((x) => !(f.options ?? []).includes(x))) return bad(`"${f.label}" has a choice that is not on the list.`, 'Pick from the choices')
      return new Set(picked).size !== picked.length ? bad(`"${f.label}" has the same choice twice.`, 'Pick each choice once') : null
    }
    case 'number':
      return a.value && !(/^-?\d{1,15}(\.\d{1,6})?$/.test(a.value.trim())) ? bad(`"${f.label}" needs a number.`, 'Type a number, such as 12 or 3.5') : null
    case 'date':
      return a.value && !isDay(a.value.trim()) ? bad(`"${f.label}" needs a date.`, 'Pick a date') : null
    case 'photo': {
      const own = photoPrefix(companyId, jobId)
      return (a.photos ?? []).some((p) => !p.startsWith(own) || p.includes('..')) ? bad(`A photo for "${f.label}" could not be read — take it again.`, 'Take the photo again', 'bad_photo') : null
    }
    case 'signature': return null
    default: return null
  }
}
/** Did this answer actually answer the question? (A required question is not left empty.) */
function isAnswered(f: Field, a: Answer | undefined): boolean {
  if (!a) return false
  switch (f.type) {
    case 'multi_select': return (a.choices ?? []).length > 0
    case 'photo': return (a.photos ?? []).length > 0
    case 'signature': return !!a.signature
    case 'section': return true
    default: return !!(a.value || '').trim()
  }
}

/** The template a person sees: the questions, the job types it is for, what it asks for. */
const shapeTemplate = (r: any) => ({
  id: r.id, name: r.name, description: r.description ?? null, active: !!r.active,
  fields: (Array.isArray(r.fields) ? r.fields : []) as Field[],
  jobTypes: Array.isArray(r.autoAttachTo?.jobTypes) ? (r.autoAttachTo.jobTypes as string[]) : [],
  promptOn: promptOnOf(r),
  requireSignature: !!r.requireSignature, requirePhoto: !!r.requirePhoto,
  updatedAt: r.updatedAt,
})

const appliesTo = (tpl: ReturnType<typeof shapeTemplate>, jobType: string | null | undefined) =>
  tpl.jobTypes.length === 0 || tpl.jobTypes.includes(String(jobType || ''))

/**
 * What a job's checklists still owe: the active checklists for the job's type, the copies filled in so far, and for each checklist
 * with no finished copy a line saying why ("not filled in yet" / "needs the customer to sign").
 * `required` marks the ones that must be done before the job can be completed: a checklist with a required question, or that asks
 * for the customer's signature or a photo. A checklist of nothing but optional questions is offered, never demanded.
 */
export async function owedOnJob(db: any, companyId: string, j: { id: string; jobType?: string | null }) {
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
    required: x.requireSignature || x.requirePhoto || x.fields.some((f: Field) => f.required),
  }))
  return { templates, subs, outstanding }
}

/** The sentence a refused completion carries: what is left, by name. */
export const owedSentence = (owed: Array<{ name: string; why: string }>) =>
  `This job can't be completed yet: ${owed.map((o) => `the checklist “${o.name}” ${o.why.startsWith('needs') ? o.why : `is ${o.why}`}`).join('; ')}.`

/**
 * In front of the jobs routes: a job is not completed while a required checklist is unfinished — by the Complete button
 * (POST /:id/complete) or by the status box / Dispatch Board (PUT /:id with status completed). One rule for the phone, the office
 * screen and the API. It only speaks for a business with Job Checklists on, and only to a seat that may update jobs (anyone else
 * is refused by the route as before). A job that is already completed is left to the route. It does not touch the status moves
 * themselves: it only answers "may this job be completed now?".
 */
/**
 * May these jobs be completed now? null when they may; else the sentence naming what is left. The ONE rule every door to
 * "completed" asks: the Complete button, the edit form / Dispatch Board, a job created as completed, and both bulk moves
 * (10/30: creating straight as completed and the bulk "mark completed" went round the rule). Already-completed jobs pass.
 */
export async function completionRefusal(d: CrmDeps, companyId: string, jobs: Array<{ id: string; jobType?: string | null; status?: string | null; number?: string | null }>): Promise<string | null> {
  if (!(await d.features.isFeatureEnabled(companyId, 'job_checklists'))) return null
  const blocked: Array<{ number?: string | null; owed: Array<{ name: string; why: string }> }> = []
  for (const j of jobs) {
    if (j.status === 'completed') continue
    const owed = (await owedOnJob(d.db, companyId, j)).outstanding.filter((o: any) => o.required)
    if (owed.length) blocked.push({ number: j.number, owed })
  }
  if (!blocked.length) return null
  if (jobs.length === 1) return owedSentence(blocked[0].owed)
  return `${blocked.length} of these jobs can't be completed yet — a required checklist is unfinished on ${blocked.map((b) => b.number || 'a job').join(', ')}. Nothing was changed.`
}

/** The jobs a bulk move would complete, as completionRefusal reads them. */
export async function jobsForCompletion(d: CrmDeps, companyId: string, ids: string[]) {
  if (!ids.length) return []
  return d.db.select({ id: job.id, jobType: job.jobType, status: job.status, number: job.number }).from(job).where(and(inArray(job.id, ids), eq(job.companyId, companyId)))
}

export function createCompletionGate(d: CrmDeps) {
  const canSee = canSeeWith(d.permissions)
  return async (c: any, next: () => Promise<void>) => {
    const method = c.req.method
    const isComplete = method === 'POST' && /\/complete\/?$/.test(c.req.path)
    const isPut = method === 'PUT' && /\/api\/jobs\/[^/]+\/?$/.test(c.req.path)
    const isCreate = method === 'POST' && /\/api\/jobs\/?$/.test(c.req.path)
    if (!isComplete && !isPut && !isCreate) return next()
    const u = c.get('user')
    if (!u?.companyId || !(await d.features.isFeatureEnabled(u.companyId, 'job_checklists'))) return next()
    if (!(await canSee(u.role, isCreate ? 'jobs:create' : 'jobs:update', u.userId))) return next()
    if (isPut || isCreate) {
      const body = await c.req.json().catch(() => null)
      if (body?.status !== 'completed') return next()
      if (isCreate) {
        // A new job owes every required checklist for its type (nothing is filled in yet).
        const why = await completionRefusal(d, u.companyId, [{ id: '', jobType: body.jobType ?? d.settings?.jobs?.defaultType ?? null }])
        return why ? fail(c, 400, why, 'checklist_outstanding') : next()
      }
    }
    const id = isComplete ? c.req.path.replace(/\/complete\/?$/, '').split('/').pop() : c.req.path.replace(/\/$/, '').split('/').pop()
    const [j] = await d.db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, u.companyId))).limit(1)
    if (!j || j.status === 'completed') return next()
    const owed = (await owedOnJob(d.db, u.companyId, j)).outstanding.filter((o: any) => o.required)
    if (!owed.length) return next()
    return fail(c, 400, owedSentence(owed), 'checklist_outstanding')
  }
}

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

  /**
   * A submission as the caller may see it: THAT it was signed always, the evidence for the seat that administers jobs. A drawn
   * signature on a signature QUESTION is the same evidence, so it is left out of the answers for everyone else (they see that
   * the question was signed).
   */
  const shapeSubmission = async (c: any, s: any) => {
    const u = c.get('user')
    const sees = await canSee(u.role, 'jobs:dispatch', u.userId)
    const base: any = sees ? s : withoutSigningEvidence(s)
    if (!sees && Array.isArray(base.values?.items)) {
      base.values = { ...base.values, items: base.values.items.map((i: any) => (i?.signature ? { ...i, signature: undefined, signed: true } : i)) }
    }
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
    // A heading is never required; only the kinds that offer a list keep their choices.
    fields: v.fields.map((f) => ({
      id: f.id || createId(), label: f.label, type: f.type, required: f.type === 'section' ? false : f.required,
      ...(CHOICE_TYPES.includes(f.type) ? { options: (f.options ?? []).map((x) => x.trim()) } : {}),
    })),
    requireSignature: v.requireSignature, requirePhoto: v.requirePhoto, active: v.active,
    autoAttachTo: { jobTypes: [...new Set(v.jobTypes)], promptOn: [...new Set(v.promptOn)] },
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
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(formSubmission).where(and(eq(formSubmission.templateId, id), eq(formSubmission.companyId, companyId), ne(formSubmission.status, 'assigned')))
    if (n === 0) await db.delete(formSubmission).where(and(eq(formSubmission.templateId, id), eq(formSubmission.companyId, companyId), eq(formSubmission.status, 'assigned')))
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
    const { templates, subs, outstanding } = await owedOnJob(db, c.get('user').companyId, j)
    return { jobId: j.id, jobType: j.jobType ?? null, templates, submissions: await Promise.all(subs.filter((s: any) => s.status !== 'assigned').map((s: any) => shapeSubmission(c, s))), outstanding }
  }

  app.get('/job/:jobId', requirePermission('jobs:read'), async (c) => {
    const j = await reachable(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Job not found')
    // A job made another way (an agreement's next visit, an online booking) gets its checklist rows the first time they are opened.
    await ensureAttached(db, c.get('user').companyId, j).catch(() => 0)
    return one(c, await jobView(c, j))
  })

  // POST /job/:jobId/photos — one photo for a checklist's photo question, into the photo store; answers its /media address for the
  // answer's `photos`. The phone's offline queue sends each photo here before it sends the checklist (localPhotos.ts), under a
  // `name` (letters, digits, - and _) made from the save's id, so a retry after a lost reply replaces the file instead of adding
  // one. Its type is read from its bytes, not from what the phone says.
  app.post('/job/:jobId/photos', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const j = await reachable(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Job not found')
    const form = await uploadedForm(c)
    const file = form.get('photo') as File | null
    if (!file || typeof file === 'string') return fail(c, 400, 'No photo provided')
    if (file.size > MAX_PHOTO_BYTES) return fail(c, 400, 'Photo exceeds 10MB limit')
    const buffer = Buffer.from(await file.arrayBuffer())
    const type = sniffType(buffer) || ''
    if (!PHOTO_EXT[type]) return fail(c, 400, 'That file is not an image. JPEG, PNG, GIF and WebP are supported.')
    const storage: any = d.services.storage
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
    const asked = String(form.get('name') || '')
    const name = /^[A-Za-z0-9_-]{8,80}$/.test(asked) ? asked : crypto.randomUUID().replace(/-/g, '')
    const key = `photos/${u.companyId}/checklist/${j.id}/${name}.${PHOTO_EXT[type]}`
    await storage.put(key, buffer, type)
    return one(c, { url: `/media/${key}` }, 201)
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
    const given = new Map<string, Answer>()
    for (const a of body.answers) {
      const f = byId.get(a.id)
      if (!f) return fail(c, 400, 'One answer is for a question that is not on this checklist. Refresh the checklist and try again.', 'unknown_question')
      given.set(a.id, a)
    }
    // Photos the offline queue uploaded for the save belong to the question each was taken for (`photoKeys[i]` is photo i's).
    for (const [i, url] of (body.photos ?? []).entries()) {
      const key = body.photoKeys?.[i]
      const f = key ? byId.get(key) : undefined
      if (!f || f.type !== 'photo') continue
      const a = given.get(f.id) ?? { id: f.id, value: '' }
      given.set(f.id, { ...a, photos: [...(a.photos ?? []), url].slice(0, MAX_QUESTION_PHOTOS) })
    }
    for (const a of given.values()) {
      const f = byId.get(a.id)!
      const p = answerProblem(f, a, u.companyId, j.id)
      if (p) return fail(c, 400, p.message, p.code, { [f.id]: p.hint })
    }
    const blank = tpl.fields.filter((f) => f.required && !isAnswered(f, given.get(f.id)))
    if (blank.length) return fail(c, 400, `Answer "${blank[0].label}"${blank.length > 1 ? ` and ${blank.length - 1} more` : ''} first.`, 'unanswered', Object.fromEntries(blank.map((f) => [f.id, 'Required'])))

    if (tpl.requirePhoto) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobPhoto).where(and(eq(jobPhoto.jobId, j.id), eq(jobPhoto.companyId, u.companyId)))
      if (!n) return fail(c, 400, `"${tpl.name}" needs a photo of the job first. Take one, then send the checklist.`, 'photo_required')
    }

    // The same send again (the phone lost the reply): hand back what was saved, whole, without saving a second copy.
    if (body.id) {
      const [again] = await db.select().from(formSubmission).where(and(eq(formSubmission.id, body.id), eq(formSubmission.companyId, u.companyId), eq(formSubmission.jobId, j.id))).limit(1)
      if (again) return one(c, await shapeSubmission(c, again), 200)
      const [taken] = await db.select({ id: formSubmission.id }).from(formSubmission).where(eq(formSubmission.id, body.id)).limit(1)
      if (taken) return fail(c, 409, 'That send id is already used.', 'id_taken')
    }
    const id = body.id || createId()
    const answeredAt = new Date().toISOString()
    const values = {
      type: CHECKLIST_CATEGORY, templateName: tpl.name,
      // Every row of the checklist in its order, headings included, so the record reads as the tech saw it.
      items: tpl.fields.map((f) => {
        if (f.type === 'section') return { id: f.id, label: f.label, type: f.type }
        const a = given.get(f.id)
        return {
          id: f.id, label: f.label, type: f.type,
          // A multi-select's value is its choices, read out; the list itself is kept beside it.
          value: f.type === 'multi_select' ? (a?.choices ?? []).join(', ') : (a?.value ?? '').trim(),
          notes: a?.notes ?? '',
          ...(f.type === 'multi_select' ? { choices: a?.choices ?? [] } : {}),
          ...(f.type === 'photo' ? { photos: a?.photos ?? [] } : {}),
          ...(f.type === 'signature' && a?.signature ? { signature: a.signature, signedAt: answeredAt } : {}),
        }
      }),
      overallNotes: [body.overallNotes, body.notes].filter(Boolean).join('\n'), completedAt: answeredAt,
    }
    const signed = body.signature ? evidence(c, id, tpl, j.id, values, body.signature) : null
    const status = signed ? 'signed' : tpl.requireSignature ? 'awaiting_signature' : 'submitted'
    const [saved] = await db.insert(formSubmission).values({
      id, companyId: u.companyId, templateId: tpl.id, jobId: j.id, contactId: j.contactId ?? null, submittedById: u.userId,
      values, status, ...(signed || {}),
    } as any).returning()
    // The row this job was given for the checklist is now this filled-in copy.
    await db.delete(formSubmission).where(and(eq(formSubmission.companyId, u.companyId), eq(formSubmission.jobId, j.id), eq(formSubmission.templateId, tpl.id), eq(formSubmission.status, 'assigned')))
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

  // The checklist through the job's life: its PDF, the email, the invoice, the report (./checklistLife.ts).
  app.route('/', createChecklistLifeRoutes(d, { reachable }))
  // …and the job's moments it acts on (rows on creation, prompts on a status change, the not-done alert).
  d.services.onJobMoment(jobMomentStep(d))

  return app
}
