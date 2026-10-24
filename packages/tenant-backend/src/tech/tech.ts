/**
 * The technician's day — /api/tech — ONE implementation for every CRM that offers `tech_mobile_view` (crm,
 * crm-fieldservice, crm-landscaping). Vendored as ../shared; the template's routes/tech.ts wires in its db,
 * tables, socket and the SAME job hooks its routes/jobs.ts runs.
 *
 * The person's own assigned jobs, and three buttons that move one along: on my way, on site, done. Every
 * action reaches only a job assigned to the caller — a manager moving somebody else's job uses /api/jobs.
 * And every write asks jobs:update, the permission the Jobs page's own Start / Complete ask: a field seat holds
 * it, a viewer does not, so a view-only seat that happens to be assigned a job cannot move it from the phone.
 *
 * What changed on the way in from crm-fieldservice/landscaping's identical copies:
 *
 *   · FINISHING A JOB HERE DOES WHAT FINISHING IT ANYWHERE DOES. The copies wrote status 'completed' and
 *     sent a text, and that was all — so a call closed from the phone never scheduled its review request
 *     and, under a service agreement, never booked the next visit. The Jobs page has done both since T21.
 *     The hooks are now passed in from the template's one definition (services/jobHooks.ts), so the two
 *     doors cannot drift again.
 *   · JOBS ONLY MOVE FORWARD. Nothing checked where a job was: "on my way" on a completed job set it back
 *     to dispatched and left its completion time behind. Each move now names the statuses it starts from,
 *     and the current status is in the UPDATE's WHERE so a double tap cannot apply twice.
 *   · THE CHECKLIST READ IS SCOPED LIKE THE WRITE. GET /:id/checklist answered for any job id in the
 *     company; it now answers only for the caller's own job, as every other route here does.
 *   · A CHECKLIST CAN BE SAVED AT ALL. form_submission.template_id is NOT NULL and references
 *     form_template, and the copies inserted no template — so every POST /:id/checklist failed on the
 *     constraint and the technician's "Submit" never saved anything. Each company now gets one form
 *     template for its checklist, created the first time it is needed, and every submission points at it.
 *   · THE CHECKLIST'S NAME COMES FROM THE TEMPLATE. It was stored as 'hvac_inspection_checklist' in a
 *     landscaping CRM. `checklistType` is now the template's word; existing rows keep their old type and
 *     are still read (`legacyChecklistTypes`).
 *
 * The feature gate (`tech_mobile_view`) is applied where the template mounts this, beside its other gates.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, asc, desc, inArray } from 'drizzle-orm'
import type { JobHook } from '../jobs/jobs'
import { companyTimeZone } from '../time/businessDay'
import { noteStamp } from '../time/zoneDay'
import { JOB_MONEY, jobMoneyWithheld, withoutJobMoney, type CanSee } from '../jobs/jobMoney'

export interface TechTables { job: any; contact: any; formSubmission: any; formTemplate: any; equipment?: any }
export interface TechHooks { onDispatch?: JobHook; onStart?: JobHook; onComplete?: JobHook }
export interface TechRoutesDeps {
  db: any
  tables: TechTables
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: { JOB_STATUS_CHANGED: string }
  /** The same hooks routes/jobs.ts passes to createJobRoutes — one definition per template. */
  hooks?: TechHooks
  /** Stored on the form submission, e.g. 'site_checklist', and as the category of its form template. */
  checklistType: string
  /** The form template's name, e.g. 'Site checklist'. */
  checklistTitle: string
  /** Older types this template's checklists were saved under, still returned by GET /:id/checklist. */
  legacyChecklistTypes?: string[]
  /** The permission check that decides which of a job's figures this person sees (../jobs/jobMoney.ts). */
  canSee?: CanSee
  /**
   * The jobs that are this login's: a condition on the job table — its own and its crews' (the unified app's
   * crew_login, 2026-10-24). Not wired → the jobs assigned to the login itself, as before.
   */
  ownJobs?: (userId: string) => any
}

/** Where each move may start from. A finished or cancelled job is not moved from the phone. */
export const TECH_MOVES = {
  'on-my-way': { to: 'dispatched', from: ['scheduled', 'pending', 'confirmed'] },
  'on-site': { to: 'in_progress', from: ['scheduled', 'pending', 'confirmed', 'dispatched'] },
  'complete-job': { to: 'completed', from: ['dispatched', 'in_progress'] },
} as const

const notesSchema = z.object({ notes: z.string().max(2000).optional() })
const checklistSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    status: z.enum(['pass', 'fail', 'attention']),
    notes: z.string().max(2000).optional(),
  })).min(1, 'A checklist needs at least one item').max(100),
  overallNotes: z.string().max(4000).optional(),
})

const MOVE_WORDS: Record<string, string> = { 'on-my-way': 'Tech en route', 'on-site': 'Tech arrived on site', 'complete-job': 'Job completed by tech' }
const STATUS_WORDS: Record<string, string> = { completed: 'finished', cancelled: 'cancelled', dispatched: 'already on the way', in_progress: 'already started', scheduled: 'not started yet', pending: 'not started yet', confirmed: 'not started yet', on_hold: 'on hold' }

export function createTechRoutes(deps: TechRoutesDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, hooks = {} } = deps
  const checklistTypes = [deps.checklistType, ...(deps.legacyChecklistTypes || [])]
  const app = new Hono()
  app.use('*', authenticate)

  /**
   * Every reply here is a whole job row, and the job table carries what a job is worth, the insurer's money and what
   * it cost (../jobs/jobMoney.ts) — the field seat this view is for holds none of the permissions that unlock them.
   * With a `canSee` the one rule decides; without one nothing is handed over, which costs the phone nothing: it shows
   * no figure.
   */
  const ALL_JOB_MONEY = Object.values(JOB_MONEY).flat()
  const shapeJobMoney = async <T,>(c: any, rows: T): Promise<T> =>
    withoutJobMoney(rows, deps.canSee ? await jobMoneyWithheld(deps.canSee, c.get('user')) : ALL_JOB_MONEY)

  /** This login's jobs: its own and its crews' (deps.ownJobs). */
  const mine = (userId: string) => deps.ownJobs ? deps.ownJobs(String(userId)) : eq(t.job.assignedToId, userId)
  const myJob = async (id: string, currentUser: any) => {
    const [row] = await db.select().from(t.job)
      .where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId), mine(currentUser.userId))).limit(1)
    return row || null
  }
  /** The company's checklist form template — found by its category, made once if it does not exist yet. */
  const checklistTemplateId = async (companyId: string, items: Array<{ id: string; label: string }>) => {
    const [found] = await db.select({ id: t.formTemplate.id }).from(t.formTemplate)
      .where(and(eq(t.formTemplate.companyId, companyId), eq(t.formTemplate.category, deps.checklistType))).limit(1)
    if (found) return found.id as string
    const [made] = await db.insert(t.formTemplate).values({
      companyId,
      name: deps.checklistTitle,
      category: deps.checklistType,
      fields: items.map((i) => ({ id: i.id, label: i.label, type: 'pass_fail_attention' })),
    } as any).returning({ id: t.formTemplate.id })
    return made.id as string
  }
  const runHook = async (hook: JobHook | undefined, job: any, currentUser: any) => {
    if (!hook) return {}
    try { return (await hook({ job, companyId: currentUser.companyId, userId: currentUser.userId })) || {} } catch (err: any) { console.warn('[tech] hook failed:', err?.message || err); return {} }
  }

  app.get('/my-jobs', async (c) => {
    const currentUser = c.get('user') as any
    const jobs = await db.select().from(t.job)
      .where(and(eq(t.job.companyId, currentUser.companyId), mine(currentUser.userId)))
      .orderBy(asc(t.job.scheduledDate), asc(t.job.scheduledTime))

    // Only the contacts and equipment these jobs name — the copies fetched the company's whole contact book.
    const contactIds = [...new Set(jobs.map((j: any) => j.contactId).filter(Boolean))] as string[]
    const equipmentIds = t.equipment && t.job.equipmentId ? [...new Set(jobs.map((j: any) => j.equipmentId).filter(Boolean))] as string[] : []
    const [contacts, equipmentList] = await Promise.all([
      contactIds.length
        ? db.select({ id: t.contact.id, name: t.contact.name, phone: t.contact.phone, email: t.contact.email, address: t.contact.address, city: t.contact.city, state: t.contact.state, zip: t.contact.zip })
            .from(t.contact).where(and(eq(t.contact.companyId, currentUser.companyId), inArray(t.contact.id, contactIds)))
        : Promise.resolve([]),
      equipmentIds.length
        ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model, serialNumber: t.equipment.serialNumber, location: t.equipment.location, warrantyExpiry: t.equipment.warrantyExpiry, purchaseDate: t.equipment.purchaseDate })
            .from(t.equipment).where(and(eq(t.equipment.companyId, currentUser.companyId), inArray(t.equipment.id, equipmentIds)))
        : Promise.resolve([]),
    ])
    const contactMap = Object.fromEntries((contacts as any[]).map((x) => [x.id, x]))
    const equipmentMap = Object.fromEntries((equipmentList as any[]).map((x) => [x.id, x]))
    return c.json((await shapeJobMoney(c, jobs)).map((j: any) => ({
      ...j,
      contact: j.contactId ? contactMap[j.contactId] || null : null,
      equipment: j.equipmentId ? equipmentMap[j.equipmentId] || null : null,
    })))
  })

  const move = (path: keyof typeof TECH_MOVES, hook: () => JobHook | undefined) => {
    const rule = TECH_MOVES[path]
    app.post(`/:id/${path}`, requirePermission('jobs:update'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      const body = notesSchema.safeParse(await c.req.json().catch(() => ({})))
      const notes = body.success ? body.data.notes : undefined
      const existing = await myJob(id, currentUser)
      if (!existing) return c.json({ error: 'Job not found' }, 404)
      if (!(rule.from as readonly string[]).includes(existing.status)) {
        return c.json({ error: `This job is ${STATUS_WORDS[existing.status] || existing.status}, so it cannot be moved that way from here.`, code: 'status_order', status: existing.status }, 409)
      }
      const [updated] = await db.update(t.job).set({
        status: rule.to,
        ...(rule.to === 'completed' ? { completedAt: new Date() } : {}),
        internalNotes: [existing.internalNotes, `[${noteStamp(new Date(), await companyTimeZone(db, currentUser.companyId))}] ${MOVE_WORDS[path]}${notes ? ': ' + notes : ''}`].filter(Boolean).join('\n'),
        updatedAt: new Date(),
      } as any).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId), eq(t.job.status, existing.status))).returning()
      if (!updated) return c.json({ error: 'This job changed while you were looking at it. Pull down to refresh.', code: 'changed' }, 409)
      emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status: rule.to })
      const more = await runHook(hook(), updated, currentUser)
      return c.json({ ...(await shapeJobMoney(c, updated)), ...more })
    })
  }
  move('on-my-way', () => hooks.onDispatch)
  move('on-site', () => hooks.onStart)
  move('complete-job', () => hooks.onComplete)

  app.post('/:id/checklist', requirePermission('jobs:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const parsed = checklistSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Check the checklist', issues: parsed.error.issues }, 400)
    const existing = await myJob(id, currentUser)
    if (!existing) return c.json({ error: 'Job not found' }, 404)
    const body = parsed.data
    const templateId = await checklistTemplateId(currentUser.companyId, body.items)
    const [submission] = await db.insert(t.formSubmission).values({
      companyId: currentUser.companyId,
      templateId,
      jobId: id,
      submittedById: currentUser.userId,
      values: { type: deps.checklistType, items: body.items, overallNotes: body.overallNotes || '', completedAt: new Date().toISOString() },
      status: 'submitted',
    }).returning()
    const fail = body.items.filter((i) => i.status === 'fail').length
    const attention = body.items.filter((i) => i.status === 'attention').length
    await db.update(t.job).set({
      internalNotes: [existing.internalNotes, `[${noteStamp(new Date(), await companyTimeZone(db, currentUser.companyId))}] Checklist: ${body.items.length - fail - attention} pass, ${attention} attention, ${fail} fail`].filter(Boolean).join('\n'),
      updatedAt: new Date(),
    } as any).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId)))
    return c.json(submission, 201)
  })

  app.get('/:id/checklist', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    if (!(await myJob(id, currentUser))) return c.json({ error: 'Job not found' }, 404)
    const submissions = await db.select().from(t.formSubmission)
      .where(and(eq(t.formSubmission.companyId, currentUser.companyId), eq(t.formSubmission.jobId, id)))
      .orderBy(desc(t.formSubmission.createdAt))
    return c.json(submissions.filter((s: any) => checklistTypes.includes((s.values as any)?.type)))
  })

  return app
}
