import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { rfi, project, user } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { createActorName } from '../shared/index.ts'

/** Who answered this, by name, for the record. Never the request body. (shared: auth/actorName) */
const actorName = createActorName({ db, tables: { user } })

const app = new Hono()
app.use('*', authenticate)

const rfiSchema = z.object({
  subject: z.string().min(1),
  question: z.string().min(1),
  projectId: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: z.string().optional(),
  assignedTo: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(rfi.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(rfi.status, status))
  if (projectId) conditions.push(eq(rfi.projectId, projectId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(rfi).where(where).orderBy(desc(rfi.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(rfi).where(where),
  ])

  // Fetch related projects
  const projectIds = [...new Set(data.map(r => r.projectId))]
  const projects = projectIds.length
    ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
    : []
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))

  const dataWithRelations = data.map(r => ({ ...r, project: projectMap[r.projectId] || null }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundRfi] = await db.select().from(rfi).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
  if (!foundRfi) return c.json({ error: 'RFI not found' }, 404)

  const [rfiProject] = await db.select().from(project).where(eq(project.id, foundRfi.projectId)).limit(1)

  return c.json({ ...foundRfi, project: rfiProject || null })
})

app.post('/', requirePermission('rfis:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = rfiSchema.parse(await c.req.json())

  const [{ value: cnt }] = await db.select({ value: count() }).from(rfi).where(and(eq(rfi.companyId, currentUser.companyId), eq(rfi.projectId, data.projectId)))

  const [newRfi] = await db.insert(rfi).values({
    ...data,
    number: `RFI-${String(Number(cnt) + 1).padStart(3, '0')}`,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    companyId: currentUser.companyId,
  }).returning()

  return c.json(newRfi, 201)
})

app.put('/:id', requirePermission('rfis:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = rfiSchema.partial().parse(await c.req.json())

  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate)

  // Scoped to the caller's company like the reads above, not matched on id alone.
  const [updated] = await db.update(rfi).set(updateData).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
  if (!updated) return c.json({ error: 'RFI not found' }, 404)
  return c.json(updated)
})

app.delete('/:id', requirePermission('rfis:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(rfi).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
  if (!gone) return c.json({ error: 'RFI not found' }, 404)
  return c.body(null, 204)
})

/**
 * AN RFI IS A QUESTION AND THE ANSWER SOMEBODY GAVE. (T32 H11)
 *
 * The report closed RFI-001 while it was unanswered (allowed, and that is fine — a question can be
 * withdrawn), answered it, closed it, then answered it AGAIN. The second answer replaced the first
 * with no history, the status went back to Answered and `closedAt` was cleared. `respondedBy` was
 * taken from the request body and was always null.
 *
 * On a construction job an RFI answer is the instruction the work was done to. Being able to replace
 * it afterwards, with nothing recording that it changed, is the same class of fault as rewriting a
 * daily log (T32 H10) or editing an approved change order (T32 H2): a record that can be quietly
 * changed is not a record.
 *
 * Three rules:
 *   1. A CLOSED RFI TAKES NO NEW ANSWER. Reopen it first — which is a visible act with its own
 *      endpoint, so the change is in the history rather than hidden inside an answer.
 *   2. AN ANSWER IS NOT OVERWRITTEN. Replacing one needs `?replace=true`, and the previous answer is
 *      kept — appended under a dated heading, so the thread reads in order. There is no revision
 *      table: the answer column holds the whole thread, which is what `response` already is on a
 *      printed RFI, and a new table for this one field is not worth a migration.
 *   3. THE RESPONDER IS THE SIGNED-IN PERSON, never the body.
 */
const CLOSED = 'closed'

app.post('/:id/respond', requirePermission('rfis:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const response = typeof body?.response === 'string' ? body.response.trim() : ''
  if (!response) return c.json({ error: 'An answer is required.' }, 400)

  const [existing] = await db.select().from(rfi)
    .where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'RFI not found' }, 404)

  if (existing.status === CLOSED) {
    return c.json({
      error: `${existing.number} is closed. Reopen it before answering, so that the change is on the record rather than inside it.`,
      code: 'rfi_closed',
      reopen: `POST /api/rfis/${id}/reopen`,
    }, 400)
  }

  const replacing = existing.response && existing.response.trim().length > 0
  const wantsReplace = c.req.query('replace') === 'true' || body?.replace === true
  if (replacing && !wantsReplace) {
    return c.json({
      error: `${existing.number} has already been answered${existing.respondedBy ? ` by ${existing.respondedBy}` : ''}${existing.respondedAt ? ` on ${new Date(existing.respondedAt).toISOString().slice(0, 10)}` : ''}. Send replace=true to add a revised answer — the original is kept.`,
      code: 'rfi_already_answered',
      answeredBy: existing.respondedBy,
      answeredAt: existing.respondedAt,
    }, 409)
  }

  const responder = await actorName(currentUser)
  // The thread, not a replacement. The old answer stays above the new one, each with who and when.
  const text = replacing
    ? `${existing.response}\n\n--- Revised ${new Date().toISOString().slice(0, 10)} by ${responder} ---\n${response}`
    : response

  const [updated] = await db.update(rfi).set({
    response: text,
    respondedBy: responder,
    respondedAt: new Date(),
    status: 'answered',
    updatedAt: new Date(),
  }).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
  return c.json(updated)
})

/**
 * CLOSING AN UNANSWERED RFI IS DELIBERATE, NOT INCIDENTAL. (T34)
 *
 * T32 allowed it with a note that a question can be withdrawn, and that is still true — refusing it
 * outright would strand a moot question with no way to clear it, which is the kind of refusal that
 * stops real work. The tester filed it again anyway, and they are right about the thing underneath:
 * nothing made you NOTICE. One click turned "nobody ever answered this" into a tidy closed row.
 *
 * On a construction job that distinction is the whole value of the register. "We asked on the 4th
 * and never got an answer" is a position in a delay claim; "closed" reads as resolved.
 *
 * So it takes an explicit `closeUnanswered: true`, the same shape as `allowOverage` on an
 * over-billed purchase order and `replace=true` on a second RFI answer: the accidental case is
 * refused with the answer route named, the deliberate one goes through, and nobody has to remember
 * a new verb.
 *
 * No new column for a reason. `status = closed` with `response` still null already records exactly
 * which of the two happened, and `reopen` reads that same field to decide where an RFI goes back to
 * — writing prose into `response` would make a withdrawn question reopen as "answered".
 */
app.post('/:id/close', requirePermission('rfis:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))

  const [existing] = await db.select().from(rfi)
    .where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'RFI not found' }, 404)

  const answered = !!(existing.response && existing.response.trim().length > 0)
  if (!answered && body?.closeUnanswered !== true) {
    return c.json({
      error: `${existing.number} has no answer. Closing it now records a question nobody answered — answer it first, or send closeUnanswered: true to withdraw it.`,
      code: 'rfi_unanswered',
      respond: `POST /api/rfis/${id}/respond`,
      withdraw: `POST /api/rfis/${id}/close with { "closeUnanswered": true }`,
    }, 400)
  }

  // `closedAt` was never written, so a closed RFI could not say when it closed — and the report saw
  // it "cleared" on re-answer, which it could not have been, because nothing ever set it.
  const [updated] = await db.update(rfi).set({ status: CLOSED, closedAt: new Date(), updatedAt: new Date() }).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
  if (!updated) return c.json({ error: 'RFI not found' }, 404)
  // Says which of the two closes this was, so a caller does not have to infer it from a null.
  return c.json({ ...updated, closedUnanswered: !answered })
})

/**
 * Reopen — the visible act that rule 1 above requires.
 *
 * Without it, "a closed RFI takes no new answer" is a dead end rather than a rule: closing an RFI by
 * mistake would strand it. The status goes back to where the answer left it, so reopening an
 * unanswered one returns it to open and an answered one to answered.
 */
app.post('/:id/reopen', requirePermission('rfis:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(rfi)
    .where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'RFI not found' }, 404)
  if (existing.status !== CLOSED) {
    return c.json({ error: `${existing.number} is ${existing.status}, not closed.`, code: 'rfi_not_closed' }, 400)
  }
  const [updated] = await db.update(rfi).set({
    status: existing.response ? 'answered' : 'open',
    closedAt: null,
    updatedAt: new Date(),
  }).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
  return c.json(updated)
})

export default app
