// /api/visit-questions — the questions asked at clock-in and clock-out (care_visit_questions, not ready), and the answers.
//
//   GET    /active?phase=clock_in|clock_out   the questions to ask now (evv:read: the caregiver's phone)
//   GET    /                                  every question, including switched-off ones (care-clients:update: the office)
//   POST   /  PUT /:id  DELETE /:id           write them (care-clients:update)
//   GET    /answers?timeEntryId=&flagged=true&days=30   what was answered, newest first (care-clients:update)
// Gated by the feature in the mount, and by permissions on each action.
import { Hono } from 'hono'
import { and, desc, eq, gte } from 'drizzle-orm'
import { clients, timeEntries, user as users, visitAnswer, visitQuestion } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { KINDS, PHASES, type Phase } from '../core/visitQuestions.ts'
import { who } from './shared.ts'

const ASC_ORDER = (a: any, b: any) => (a.sortOrder - b.sortOrder) || (+new Date(a.createdAt) - +new Date(b.createdAt))

/** A question's fields from a body: { values } or { errors } keyed by field (plain words). */
function questionFields(b: any, creating: boolean, current?: any) {
  const errors: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  const kind = 'kind' in b || creating ? String(b.kind ?? '') : current.kind
  if (creating || 'prompt' in b) {
    const p = String(b.prompt ?? '').trim()
    if (!p) errors.prompt = 'Write the question.'
    else if (p.length > 200) errors.prompt = 'Keep the question under 200 characters.'
    else values.prompt = p
  }
  if (creating || 'kind' in b) { if (!(KINDS as readonly string[]).includes(kind)) errors.kind = 'Pick yes/no, a short answer, or a choice.'; else values.kind = kind }
  if (creating || 'phase' in b) { const ph = String(b.phase ?? ''); if (!(PHASES as readonly string[]).includes(ph)) errors.phase = 'Pick clock-in, clock-out or both.'; else values.phase = ph }
  let options: string[] | null = kind === 'choice' ? (current?.options as string[] | null) ?? null : null
  if (creating || 'options' in b || 'kind' in b) {
    if (kind === 'choice') {
      const list = (Array.isArray(b.options) ? b.options : (current?.options ?? [])).map((o: unknown) => String(o ?? '').trim()).filter(Boolean)
      if (list.length < 2 || list.length > 10 || new Set(list.map((o: string) => o.toLowerCase())).size !== list.length || list.some((o: string) => o.length > 80)) errors.options = 'Give two to ten different choices.'
      else { options = list; values.options = list }
    } else values.options = null
  }
  if ('required' in b) values.required = b.required === true
  if (creating || 'flagOn' in b || 'kind' in b) {
    const f = b.flagOn === undefined ? current?.flagOn ?? null : (b.flagOn === null || String(b.flagOn).trim() === '' ? null : String(b.flagOn).trim())
    if (f !== null && kind === 'text') errors.flagOn = 'A written answer cannot raise a flag. Use yes/no or a choice.'
    else if (f !== null && kind === 'yes_no' && !['yes', 'no'].includes(f.toLowerCase())) errors.flagOn = 'Pick yes or no.'
    else if (f !== null && kind === 'choice' && !(options ?? []).some((o) => o.toLowerCase() === f.toLowerCase())) errors.flagOn = 'Pick one of the choices.'
    else values.flagOn = f === null ? null : (kind === 'yes_no' ? f.toLowerCase() : (options ?? []).find((o) => o.toLowerCase() === f.toLowerCase()) ?? f)
  }
  if ('sortOrder' in b) { const n = Number(b.sortOrder); if (!Number.isInteger(n) || n < 0 || n > 1000) errors.sortOrder = 'Use a whole number from 0 to 1000.'; else values.sortOrder = n }
  if ('isActive' in b) values.isActive = b.isActive !== false
  return { values, errors }
}

export function createVisitQuestionRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const manage = requirePermission('care-clients:update')

  app.get('/active', requirePermission('evv:read'), async (c) => {
    const phase = c.req.query('phase')
    if (phase !== 'clock_in' && phase !== 'clock_out') return fail(c, 400, 'phase must be clock_in or clock_out.', 'bad_phase', { phase: 'Pick clock_in or clock_out' })
    return listAll(c, await core.visitQuestions.activeFor(who(c).companyId, phase as Phase))
  })

  app.get('/', manage, async (c) => {
    const rows = (await d.db.select().from(visitQuestion).where(eq(visitQuestion.companyId, who(c).companyId))).sort(ASC_ORDER)
    return list(c, rows, { page: 1, limit: 200, total: rows.length })
  })

  app.post('/', manage, async (c) => {
    const { companyId } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const { values, errors } = questionFields(b, true)
    if (Object.keys(errors).length) return fail(c, 400, Object.values(errors)[0], 'bad_question', errors)
    const [row] = await d.db.insert(visitQuestion).values({ required: false, ...values, companyId } as any).returning()
    return one(c, row, 201)
  })

  app.put('/:id', manage, async (c) => {
    const { companyId } = who(c)
    const [cur] = await d.db.select().from(visitQuestion).where(and(eq(visitQuestion.id, c.req.param('id')!), eq(visitQuestion.companyId, companyId))).limit(1)
    if (!cur) return fail(c, 404, 'Question not found')
    const b = await c.req.json().catch(() => ({})) as any
    const { values, errors } = questionFields(b, false, cur)
    if (Object.keys(errors).length) return fail(c, 400, Object.values(errors)[0], 'bad_question', errors)
    const [row] = await d.db.update(visitQuestion).set({ ...values, updatedAt: new Date() } as any).where(eq(visitQuestion.id, cur.id)).returning()
    return one(c, row)
  })

  app.delete('/:id', manage, async (c) => {
    const [row] = await d.db.delete(visitQuestion).where(and(eq(visitQuestion.id, c.req.param('id')!), eq(visitQuestion.companyId, who(c).companyId))).returning({ id: visitQuestion.id })
    return row ? done(c) : fail(c, 404, 'Question not found')
  })

  app.get('/answers', manage, async (c) => {
    const { companyId } = who(c)
    const q = c.req.query()
    const days = Math.min(365, Math.max(1, Number(q.days) || 30))
    const rows = await d.db.select({
      id: visitAnswer.id, timeEntryId: visitAnswer.timeEntryId, prompt: visitAnswer.prompt, phase: visitAnswer.phase, answer: visitAnswer.answer,
      flagged: visitAnswer.flagged, createdAt: visitAnswer.createdAt, startTime: timeEntries.startTime,
      clientFirst: clients.firstName, clientLast: clients.lastName, caregiverFirst: users.firstName, caregiverLast: users.lastName,
    }).from(visitAnswer)
      .innerJoin(timeEntries, eq(timeEntries.id, visitAnswer.timeEntryId))
      .innerJoin(clients, eq(clients.id, timeEntries.clientId))
      .innerJoin(users, eq(users.id, timeEntries.caregiverId))
      .where(and(
        eq(visitAnswer.companyId, companyId),
        q.timeEntryId ? eq(visitAnswer.timeEntryId, q.timeEntryId) : gte(visitAnswer.createdAt, new Date(Date.now() - days * 86_400_000)),
        q.flagged === 'true' ? eq(visitAnswer.flagged, true) : undefined,
      ))
      .orderBy(desc(visitAnswer.createdAt)).limit(500)
    return list(c, rows, { page: 1, limit: 500, total: rows.length })
  })

  return app
}
